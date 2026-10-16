import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET;

if (!databaseUrl) {
  console.error('Thiếu DATABASE_URL. Hãy tạo PostgreSQL và đặt DATABASE_URL trong biến môi trường.');
  process.exit(1);
}
if (!sessionSecret || sessionSecret.length < 32) {
  console.error('Thiếu SESSION_SECRET hoặc secret quá ngắn. Hãy đặt một chuỗi ngẫu nhiên tối thiểu 32 ký tự.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PGPOOL_MAX || 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

const app = express();
app.disable('x-powered-by');
if (isProduction) app.set('trust proxy', 1);
// The game's existing interface uses inline style/script blocks; CSP is disabled here,
// while the other Helmet headers and same-origin API policy remain enabled.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '512kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

const PgSession = connectPgSimple(session);
app.use(session({
  name: 'aether.sid',
  store: new PgSession({ pool, tableName: 'web_sessions', createTableIfMissing: true, pruneSessionInterval: 15 * 60 }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: isProduction,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Quá nhiều lần thử đăng nhập/đăng ký. Hãy đợi 15 phút rồi thử lại.' }
});
const socialChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Bạn gửi tin nhắn quá nhanh. Hãy đợi một phút rồi thử lại.' }
});

await initializeDatabase();

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_accounts (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(20) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS game_saves (
      user_id BIGINT PRIMARY KEY REFERENCES game_accounts(id) ON DELETE CASCADE,
      state JSONB NOT NULL CHECK (jsonb_typeof(state) = 'object'),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS social_friendships (
      id BIGSERIAL PRIMARY KEY,
      requester_id BIGINT NOT NULL REFERENCES game_accounts(id) ON DELETE CASCADE,
      addressee_id BIGINT NOT NULL REFERENCES game_accounts(id) ON DELETE CASCADE,
      status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (requester_id <> addressee_id),
      UNIQUE (requester_id, addressee_id)
    );
    CREATE INDEX IF NOT EXISTS social_friendships_requester_idx ON social_friendships(requester_id, status);
    CREATE INDEX IF NOT EXISTS social_friendships_addressee_idx ON social_friendships(addressee_id, status);
    CREATE TABLE IF NOT EXISTS social_messages (
      id BIGSERIAL PRIMARY KEY,
      sender_id BIGINT NOT NULL REFERENCES game_accounts(id) ON DELETE CASCADE,
      recipient_id BIGINT REFERENCES game_accounts(id) ON DELETE CASCADE,
      channel VARCHAR(12) NOT NULL CHECK (channel IN ('world','direct')),
      message VARCHAR(250) NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 250),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK ((channel = 'world' AND recipient_id IS NULL) OR (channel = 'direct' AND recipient_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS social_messages_world_idx ON social_messages(channel, id DESC);
    CREATE INDEX IF NOT EXISTS social_messages_direct_idx ON social_messages(sender_id, recipient_id, id DESC);
    UPDATE game_accounts SET last_active_at = COALESCE(last_active_at, created_at);
  `);
}

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' });
  next();
}
function validUsername(value) {
  return typeof value === 'string' && /^[a-z0-9_.-]{3,20}$/.test(value);
}
function savePayloadIsValid(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.characterCreated !== true) return false;
  if (typeof value.characterName !== 'string' || value.characterName.trim().length < 3 || value.characterName.length > 20) return false;
  if (!Number.isFinite(Number(value.level)) || Number(value.level) < 1 || Number(value.level) > 500) return false;
  if (!Number.isFinite(Number(value.xp)) || Number(value.xp) < 0 || Number(value.xp) > 1e12) return false;
  if (!Number.isFinite(Number(value.gold)) || Number(value.gold) < 0 || Number(value.gold) > 1e15) return false;
  if (!Number.isFinite(Number(value.ap)) || Number(value.ap) < 0 || Number(value.ap) > 1e9) return false;
  if (!value.stats || typeof value.stats !== 'object' || Array.isArray(value.stats)) return false;
  return true;
}
async function saveSession(req) {
  await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected', service: 'urban-catalyst-aether' });
  } catch (_error) {
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = req.body?.password;
    const registrationCode = req.body?.registrationCode;
    if (!validUsername(username)) return res.status(400).json({ error: 'Tên đăng nhập cần 3–20 ký tự: chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Mật khẩu cần từ 8 đến 128 ký tự.' });
    if (typeof process.env.REGISTRATION_CODE !== 'string' || process.env.REGISTRATION_CODE.length < 12) return res.status(503).json({ error: 'Chủ server chưa cấu hình REGISTRATION_CODE. Hãy đặt mã riêng trong phần Secrets/Environment của hosting.' });
    if (typeof registrationCode !== 'string') return res.status(403).json({ error: 'Cần mã đăng ký riêng của máy chủ.' });
    const expected = Buffer.from(process.env.REGISTRATION_CODE, 'utf8');
    const supplied = Buffer.from(registrationCode, 'utf8');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return res.status(403).json({ error: 'Mã đăng ký không đúng.' });
    const passwordHash = await bcrypt.hash(password, 12);
    let result;
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      // Default is a private single-player server: exactly one account can be registered.
      // The advisory lock prevents two simultaneous first registrations from racing.
      if ((process.env.SINGLE_PLAYER_MODE || 'true').toLowerCase() !== 'false') {
        await db.query('SELECT pg_advisory_xact_lock($1)', [7345923]);
        const count = await db.query('SELECT COUNT(*)::int AS count FROM game_accounts');
        if (count.rows[0].count > 0) {
          await db.query('ROLLBACK');
          return res.status(403).json({ error: 'Máy chủ này ở chế độ chơi riêng và đã có tài khoản chủ. Hãy đăng nhập thay vì tạo tài khoản mới.' });
        }
      }
      result = await db.query('INSERT INTO game_accounts (username, password_hash) VALUES ($1, $2) RETURNING id, username', [username, passwordHash]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại. Hãy đăng nhập hoặc dùng tên khác.' });
      throw error;
    } finally {
      db.release();
    }
    req.session.userId = String(result.rows[0].id);
    req.session.username = result.rows[0].username;
    await saveSession(req);
    res.status(201).json({ username: result.rows[0].username, hasSave: false });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!validUsername(username) || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Tên đăng nhập hoặc mật khẩu không hợp lệ.' });
    const result = await pool.query('SELECT id, username, password_hash FROM game_accounts WHERE username = $1', [username]);
    const user = result.rows[0];
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!valid) return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
    // Regenerate session ID after login to avoid session fixation.
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.userId = String(user.id);
    req.session.username = user.username;
    await saveSession(req);
    const save = await pool.query('SELECT 1 FROM game_saves WHERE user_id = $1', [user.id]);
    res.json({ username: user.username, hasSave: save.rowCount > 0 });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session?.userId) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: req.session.username });
});

app.post('/api/auth/logout', (req, res, next) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie('aether.sid', { httpOnly: true, secure: isProduction, sameSite: 'lax' });
    res.json({ ok: true });
  });
});

app.get('/api/game/save', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT state, updated_at FROM game_saves WHERE user_id = $1', [req.session.userId]);
    if (!result.rowCount) return res.json({ exists: false, state: null });
    res.json({ exists: true, state: result.rows[0].state, updatedAt: result.rows[0].updated_at });
  } catch (error) { next(error); }
});

app.put('/api/game/save', requireAuth, async (req, res, next) => {
  try {
    if (!savePayloadIsValid(req.body)) return res.status(400).json({ error: 'Dữ liệu lưu game không hợp lệ hoặc vượt giới hạn.' });
    const serialized = JSON.stringify(req.body);
    if (Buffer.byteLength(serialized, 'utf8') > 400 * 1024) return res.status(413).json({ error: 'Dữ liệu lưu game quá lớn.' });
    const state = { ...req.body, accountUsername: req.session.username, lastSeen: Date.now() };
    const result = await pool.query(`
      INSERT INTO game_saves (user_id, state, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
      RETURNING updated_at
    `, [req.session.userId, JSON.stringify(state)]);
    res.json({ ok: true, updatedAt: result.rows[0].updated_at });
  } catch (error) { next(error); }
});

app.delete('/api/game/save', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM game_saves WHERE user_id = $1', [req.session.userId]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});


// Social system: world chat, friend requests, presence, and private messages.
function socialProfileSelect() {
  return `COALESCE(NULLIF(s.state->>'characterName',''), a.username) AS "characterName",
    CASE WHEN COALESCE(s.state->>'level','') ~ '^[0-9]+$' THEN (s.state->>'level')::int ELSE 1 END AS level,
    COALESCE(s.state->>'classId','') AS "classId",
    (COALESCE(a.last_active_at, a.created_at) > NOW() - INTERVAL '90 seconds') AS "isOnline"`;
}
async function acceptedFriendship(userA, userB) {
  const result = await pool.query(`SELECT id FROM social_friendships
    WHERE status='accepted' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)) LIMIT 1`, [userA, userB]);
  return result.rowCount > 0;
}
app.get('/api/social/players', requireAuth, async (req, res, next) => {
  try {
    await pool.query('UPDATE game_accounts SET last_active_at=NOW() WHERE id=$1', [req.session.userId]);
    const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 20) : '';
    const result = await pool.query(`
      SELECT a.id::text AS id, a.username, ${socialProfileSelect()},
        (a.id = $1::bigint) AS "isSelf"
      FROM game_accounts a LEFT JOIN game_saves s ON s.user_id=a.id
      WHERE a.id <> $1::bigint AND ($2 = '' OR a.username ILIKE '%' || $2 || '%' OR COALESCE(s.state->>'characterName','') ILIKE '%' || $2 || '%')
      ORDER BY (COALESCE(a.last_active_at,a.created_at) > NOW() - INTERVAL '90 seconds') DESC, a.last_active_at DESC NULLS LAST, a.username ASC
      LIMIT 40`, [req.session.userId, rawSearch]);
    const online = await pool.query(`SELECT COUNT(*)::int AS count FROM game_accounts WHERE id<>$1 AND last_active_at > NOW()-INTERVAL '90 seconds'`, [req.session.userId]);
    res.json({ players: result.rows, onlineCount: online.rows[0]?.count || 0, refreshedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

app.get('/api/social/friends', requireAuth, async (req, res, next) => {
  try {
    const me = String(req.session.userId);
    const result = await pool.query(`
      SELECT f.id::text AS "requestId", f.requester_id::text AS "requesterId", f.addressee_id::text AS "addresseeId", f.status,
        r.username AS "requesterUsername", a.username AS "addresseeUsername",
        COALESCE(NULLIF(rs.state->>'characterName',''),r.username) AS "requesterCharacterName",
        COALESCE(NULLIF(asv.state->>'characterName',''),a.username) AS "addresseeCharacterName",
        CASE WHEN COALESCE(rs.state->>'level','') ~ '^[0-9]+$' THEN (rs.state->>'level')::int ELSE 1 END AS "requesterLevel",
        CASE WHEN COALESCE(asv.state->>'level','') ~ '^[0-9]+$' THEN (asv.state->>'level')::int ELSE 1 END AS "addresseeLevel",
        COALESCE(rs.state->>'classId','') AS "requesterClassId", COALESCE(asv.state->>'classId','') AS "addresseeClassId",
        (COALESCE(r.last_active_at,r.created_at)>NOW()-INTERVAL '90 seconds') AS "requesterOnline",
        (COALESCE(a.last_active_at,a.created_at)>NOW()-INTERVAL '90 seconds') AS "addresseeOnline"
      FROM social_friendships f
      JOIN game_accounts r ON r.id=f.requester_id
      JOIN game_accounts a ON a.id=f.addressee_id
      LEFT JOIN game_saves rs ON rs.user_id=r.id LEFT JOIN game_saves asv ON asv.user_id=a.id
      WHERE f.requester_id=$1::bigint OR f.addressee_id=$1::bigint
      ORDER BY f.created_at DESC LIMIT 200`, [me]);
    const friends=[], incoming=[], outgoing=[];
    for (const row of result.rows) {
      const isRequester = row.requesterId === me;
      if (row.status === 'accepted') {
        friends.push({ friendshipId: row.requestId, username: isRequester ? row.addresseeUsername : row.requesterUsername,
          characterName: isRequester ? row.addresseeCharacterName : row.requesterCharacterName,
          level: isRequester ? row.addresseeLevel : row.requesterLevel, classId: isRequester ? row.addresseeClassId : row.requesterClassId,
          isOnline: isRequester ? row.addresseeOnline : row.requesterOnline });
      } else if (row.status === 'pending' && !isRequester) {
        incoming.push({ requestId: row.requestId, username: row.requesterUsername, characterName: row.requesterCharacterName,
          level: row.requesterLevel, classId: row.requesterClassId, isOnline: row.requesterOnline });
      } else if (row.status === 'pending' && isRequester) {
        outgoing.push({ requestId: row.requestId, username: row.addresseeUsername, characterName: row.addresseeCharacterName,
          level: row.addresseeLevel, classId: row.addresseeClassId, isOnline: row.addresseeOnline });
      }
    }
    res.json({ friends, incoming, outgoing });
  } catch (error) { next(error); }
});

app.post('/api/social/friends/request', requireAuth, socialChatLimiter, async (req, res, next) => {
  const targetUsername = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  if (!validUsername(targetUsername)) return res.status(400).json({ error: 'Username cần từ 3 đến 20 ký tự hợp lệ.' });
  try {
    const targetResult = await pool.query('SELECT id, username FROM game_accounts WHERE username=$1', [targetUsername]);
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ error: 'Không tìm thấy tài khoản này trên máy chủ.' });
    if (String(target.id) === String(req.session.userId)) return res.status(400).json({ error: 'Bạn không thể tự kết bạn với chính mình.' });
    const existingResult = await pool.query(`SELECT id::text AS id, requester_id::text AS requester_id, status FROM social_friendships
      WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1) LIMIT 1`, [req.session.userId, target.id]);
    const existing = existingResult.rows[0];
    if (existing?.status === 'accepted') return res.status(409).json({ error: 'Hai bạn đã là bạn bè.' });
    if (existing?.status === 'pending') return res.status(409).json({ error: String(existing.requester_id) === String(req.session.userId) ? 'Bạn đã gửi lời mời cho người này rồi.' : 'Người này đã gửi lời mời cho bạn. Hãy chấp nhận trong mục Bạn bè.' });
    let result;
    if (existing) {
      result = await pool.query(`UPDATE social_friendships SET requester_id=$1, addressee_id=$2, status='pending', created_at=NOW(), updated_at=NOW() WHERE id=$3 RETURNING id::text AS id`, [req.session.userId, target.id, existing.id]);
    } else {
      result = await pool.query(`INSERT INTO social_friendships(requester_id,addressee_id,status) VALUES($1,$2,'pending') RETURNING id::text AS id`, [req.session.userId,target.id]);
    }
    res.status(201).json({ ok: true, requestId: result.rows[0].id, username: target.username });
  } catch (error) { next(error); }
});

app.post('/api/social/friends/:requestId/:action', requireAuth, async (req, res, next) => {
  if (!['accept', 'decline'].includes(req.params.action)) return res.status(404).json({ error: 'Thao tác lời mời không hợp lệ.' });
  const requestId = String(req.params.requestId || '');
  if (!/^\d{1,20}$/.test(requestId)) return res.status(400).json({ error: 'Mã lời mời không hợp lệ.' });
  const accept = req.params.action === 'accept';
  try {
    const result = await pool.query(`UPDATE social_friendships SET status=$1, updated_at=NOW()
      WHERE id=$2::bigint AND addressee_id=$3::bigint AND status='pending' RETURNING id`, [accept ? 'accepted' : 'declined', requestId, req.session.userId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Lời mời không còn tồn tại hoặc không thuộc về bạn.' });
    res.json({ ok: true, status: accept ? 'accepted' : 'declined' });
  } catch (error) { next(error); }
});

app.delete('/api/social/friends/:username', requireAuth, async (req, res, next) => {
  const username = String(req.params.username || '').trim().toLowerCase();
  try {
    const target = await pool.query('SELECT id FROM game_accounts WHERE username=$1', [username]);
    if (!target.rowCount) return res.status(404).json({ error: 'Không tìm thấy tài khoản này.' });
    const result = await pool.query(`DELETE FROM social_friendships WHERE status='accepted' AND
      ((requester_id=$1::bigint AND addressee_id=$2::bigint) OR (requester_id=$2::bigint AND addressee_id=$1::bigint))`, [req.session.userId, target.rows[0].id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Người chơi này không nằm trong danh sách bạn bè.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/api/social/chat', requireAuth, async (req, res, next) => {
  const channel = req.query.channel === 'direct' ? 'direct' : 'world';
  try {
    let result;
    if (channel === 'world') {
      result = await pool.query(`SELECT m.id::text AS id,m.channel,m.message,m.created_at AS "createdAt",a.username,
        ${socialProfileSelect()}
        FROM social_messages m JOIN game_accounts a ON a.id=m.sender_id LEFT JOIN game_saves s ON s.user_id=a.id
        WHERE m.channel='world' ORDER BY m.id DESC LIMIT 80`);
    } else {
      const targetUsername = typeof req.query.with === 'string' ? req.query.with.trim().toLowerCase() : '';
      if (!validUsername(targetUsername)) return res.status(400).json({ error: 'Hãy chọn username của người bạn muốn nhắn tin.' });
      const targetResult = await pool.query('SELECT id FROM game_accounts WHERE username=$1', [targetUsername]);
      if (!targetResult.rowCount) return res.status(404).json({ error: 'Không tìm thấy người chơi.' });
      const targetId = targetResult.rows[0].id;
      if (!(await acceptedFriendship(req.session.userId, targetId))) return res.status(403).json({ error: 'Tin nhắn riêng chỉ dùng được giữa bạn bè đã chấp nhận kết bạn.' });
      result = await pool.query(`SELECT m.id::text AS id,m.channel,m.message,m.created_at AS "createdAt",a.username,
        ${socialProfileSelect()}
        FROM social_messages m JOIN game_accounts a ON a.id=m.sender_id LEFT JOIN game_saves s ON s.user_id=a.id
        WHERE m.channel='direct' AND ((m.sender_id=$1::bigint AND m.recipient_id=$2::bigint) OR (m.sender_id=$2::bigint AND m.recipient_id=$1::bigint))
        ORDER BY m.id DESC LIMIT 80`, [req.session.userId,targetId]);
    }
    result.rows.reverse();
    res.json({ channel, messages: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/social/chat', requireAuth, socialChatLimiter, async (req, res, next) => {
  const channel = req.body?.channel === 'direct' ? 'direct' : req.body?.channel === 'world' ? 'world' : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim() : '';
  if (!channel) return res.status(400).json({ error: 'Kênh chat không hợp lệ.' });
  if (!message || message.length > 250) return res.status(400).json({ error: 'Tin nhắn cần có nội dung và tối đa 250 ký tự.' });
  try {
    let recipientId = null;
    if (channel === 'direct') {
      const targetUsername = typeof req.body?.recipientUsername === 'string' ? req.body.recipientUsername.trim().toLowerCase() : '';
      if (!validUsername(targetUsername)) return res.status(400).json({ error: 'Username người nhận không hợp lệ.' });
      const targetResult = await pool.query('SELECT id FROM game_accounts WHERE username=$1', [targetUsername]);
      if (!targetResult.rowCount) return res.status(404).json({ error: 'Không tìm thấy người nhận.' });
      recipientId = targetResult.rows[0].id;
      if (String(recipientId) === String(req.session.userId)) return res.status(400).json({ error: 'Không thể gửi tin nhắn cho chính mình.' });
      if (!(await acceptedFriendship(req.session.userId, recipientId))) return res.status(403).json({ error: 'Hai tài khoản cần kết bạn trước khi nhắn riêng.' });
    }
    const result = await pool.query(`INSERT INTO social_messages(sender_id,recipient_id,channel,message) VALUES($1,$2,$3,$4) RETURNING id::text AS id,created_at AS "createdAt"`, [req.session.userId, recipientId, channel, message]);
    await pool.query('UPDATE game_accounts SET last_active_at=NOW() WHERE id=$1', [req.session.userId]);
    res.status(201).json({ ok: true, id: result.rows[0].id, createdAt: result.rows[0].createdAt });
  } catch (error) { next(error); }
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: isProduction ? '1h' : 0 }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, _req, res, _next) => {
  const errorId = crypto.randomUUID();
  console.error(`[${errorId}]`, error);
  if (res.headersSent) return;
  res.status(500).json({ error: `Máy chủ gặp lỗi. Mã tham chiếu: ${errorId}` });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Urban Catalyst Aether server đang chạy tại cổng ${port}`);
});

async function shutdown(signal) {
  console.log(`Nhận ${signal}, đang đóng server...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
