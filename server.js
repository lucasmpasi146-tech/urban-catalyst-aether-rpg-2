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
import { existsSync } from 'node:fs';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET;
const GAME_VERSION = '6.6.0';
const ULR_OWNER = 'lucasmpasi146';
const COPPER_PER_PLATINUM=1000000;
const MAX_WALLET_COPPER=9007199254740991;
let adminBootstrapWarning = '';
const PUBLIC_INDEX = path.join(__dirname, 'public', 'index.html');
if (!existsSync(PUBLIC_INDEX)) {
  console.error('DEPLOY ERROR: Không có public/index.html. Cấu trúc bắt buộc: repo-root/public/index.html.');
  process.exit(1);
}

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
const marketActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 18,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Giao dịch quá nhanh. Hãy đợi một phút.' }
});
const adminActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Quá nhiều thao tác quản trị. Hãy chờ một phút rồi thử lại.' }
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
    ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS role VARCHAR(12) NOT NULL DEFAULT 'player';
    ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS ban_reason TEXT;
    ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS chat_muted_until TIMESTAMPTZ;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='game_accounts_role_check') THEN
        ALTER TABLE game_accounts ADD CONSTRAINT game_accounts_role_check CHECK (role IN ('player','admin'));
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id BIGSERIAL PRIMARY KEY,
      actor_id BIGINT REFERENCES game_accounts(id) ON DELETE SET NULL,
      target_id BIGINT REFERENCES game_accounts(id) ON DELETE SET NULL,
      action VARCHAR(40) NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log(created_at DESC);
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
    CREATE TABLE IF NOT EXISTS marketplace_meta (
      user_id BIGINT PRIMARY KEY REFERENCES game_accounts(id) ON DELETE CASCADE,
      revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0)
    );
    CREATE TABLE IF NOT EXISTS marketplace_events (
      user_id BIGINT NOT NULL REFERENCES game_accounts(id) ON DELETE CASCADE,
      revision BIGINT NOT NULL CHECK (revision > 0),
      gold_delta BIGINT NOT NULL DEFAULT 0,
      removed_uid TEXT,
      added_item JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, revision)
    );
    ALTER TABLE marketplace_events ADD COLUMN IF NOT EXISTS resource_delta JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE TABLE IF NOT EXISTS marketplace_listings (
      id BIGSERIAL PRIMARY KEY,
      seller_id BIGINT NOT NULL REFERENCES game_accounts(id) ON DELETE CASCADE,
      buyer_id BIGINT REFERENCES game_accounts(id) ON DELETE SET NULL,
      item_uid TEXT NOT NULL,
      item JSONB NOT NULL CHECK (jsonb_typeof(item)='object'),
      price BIGINT NOT NULL CHECK (price BETWEEN 10 AND 9007199254740991),
      status VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS marketplace_listings_active_idx ON marketplace_listings(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS marketplace_listings_seller_idx ON marketplace_listings(seller_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS marketplace_listings_buyer_idx ON marketplace_listings(buyer_id, closed_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS marketplace_one_active_uid_idx ON marketplace_listings(seller_id, item_uid) WHERE status='active';
    ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_price_check;
    ALTER TABLE marketplace_listings ADD CONSTRAINT marketplace_listings_price_check CHECK (price BETWEEN 10 AND 9007199254740991);
    UPDATE game_accounts SET last_active_at = COALESCE(last_active_at, created_at);
  `);
  await migrateCurrencyV2();
  await bootstrapConfiguredAdmin();
}


// v6.6: one-way, one-time conversion of old Aether Coin balances to copper units.
// Existing Coin was defined as platinum: 1 Coin = 1 Platinum = 1,000,000 copper.
async function migrateCurrencyV2(){
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(66160266)');
    await db.query(`CREATE TABLE IF NOT EXISTS game_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const done=await db.query('SELECT 1 FROM game_migrations WHERE name=$1',['currency_v2_copper_2026']);
    if(done.rowCount){await db.query('COMMIT');return;}
    // Never silently discard legacy money. Check before multiplying by 1,000,000.
    const overflow=await db.query(`SELECT ga.username FROM game_saves gs
      JOIN game_accounts ga ON ga.id=gs.user_id
      WHERE COALESCE((gs.state->>'currencyVersion')::integer,1)<2
        AND COALESCE(NULLIF(gs.state->>'gold','')::numeric,0)>9007199254
      LIMIT 5`);
    if(overflow.rowCount)throw new Error('Ví Aether Coin vượt giới hạn di trú an toàn cho: '+overflow.rows.map(r=>r.username).join(', ')+'; hãy sao lưu và xử lý riêng.');
    // Keep all calculations exact in PostgreSQL NUMERIC. Preserve guard fields inside save JSON.
    await db.query(`UPDATE game_saves SET state = jsonb_set(jsonb_set(state, '{gold}',
      to_jsonb(LEAST(9007199254740991::numeric, GREATEST(0::numeric, TRUNC(COALESCE(NULLIF(state->>'gold','')::numeric,0)*1000000))))),
      '{currencyVersion}','2'::jsonb), updated_at=NOW()
      WHERE COALESCE((state->>'currencyVersion')::integer,1)<2`);
    await db.query(`UPDATE marketplace_events SET gold_delta = CASE
      WHEN gold_delta>0 THEN LEAST(9007199254740991::bigint,gold_delta::numeric*1000000)
      WHEN gold_delta<0 THEN GREATEST(-9007199254740991::bigint,gold_delta::numeric*1000000)
      ELSE 0 END`);
    await db.query('UPDATE marketplace_listings SET price=price*1000000');
    await db.query("UPDATE marketplace_listings SET status='cancelled',closed_at=NOW() WHERE status='active' AND (item->>'equipmentRank'='ULR' OR item->>'key'='sovereign_arma')");
    // ULR is owner-only. For old saves, remove ULR gear from non-owner accounts
    // and return players with now-forbidden class to a regular starter class.
    const legacy=await db.query(`SELECT gs.user_id,gs.state,ga.username FROM game_saves gs
      JOIN game_accounts ga ON ga.id=gs.user_id FOR UPDATE`);
    for(const row of legacy.rows){
      const st=row.state;const gear=Array.isArray(st.gearInventory)?st.gearInventory:[];
      // Reprice legacy equipment's resale value to the new Black Market baseline.
      for(const item of gear){
        if(item&&Number.isFinite(Number(item.price))&&Number(item.price)>0){
          item.price=Math.min(MAX_WALLET_COPPER,Math.floor(Number(item.price)*100));
        }
      }
      if(st.guildQuest&&Number.isFinite(Number(st.guildQuest.rewardGold)))
        st.guildQuest.rewardGold=Math.min(MAX_WALLET_COPPER,Math.floor(Number(st.guildQuest.rewardGold)*25));
      if(row.username!==ULR_OWNER){
        const valid=gear.filter(g=>g&&g.equipmentRank!=='ULR'&&g.key!=='sovereign_arma');
        st.gearInventory=valid;
        const validUids=new Set(valid.map(g=>g.uid));
        if(st.equippedGear)for(const slot of ['weapon','armor','accessory'])if(st.equippedGear[slot]&&!validUids.has(st.equippedGear[slot]))st.equippedGear[slot]=null;
        if(st.classId==='sovereign')st.classId='music';
        st.sovereignClassUnlocked=false;st.sovereignApCompensationClaimed=false;
      }
      await db.query('UPDATE game_saves SET state=$2::jsonb,updated_at=NOW() WHERE user_id=$1',[row.user_id,JSON.stringify(st)]);
    }
    await db.query('INSERT INTO game_migrations(name) VALUES($1)',['currency_v2_copper_2026']);
    await db.query('COMMIT');
    console.log('Đã chuyển tiền Aether Coin -> 4 mệnh giá (đồng tệ) đúng một lần.');
  }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
  finally{db.release();}
}

async function bootstrapConfiguredAdmin() {
  const username = typeof process.env.ADMIN_USERNAME === 'string' ? process.env.ADMIN_USERNAME.trim().toLowerCase() : '';
  if (!username) {
    console.warn('Chưa cấu hình ADMIN_USERNAME; bảng quản trị sẽ không có tài khoản admin được thiết lập tự động.');
    return;
  }
  if (!validUsername(username)) { adminBootstrapWarning='ADMIN_USERNAME không hợp lệ (phải là username đăng nhập, 3–20 ký tự).'; console.error(adminBootstrapWarning); return; }
  const existing = await pool.query('SELECT id FROM game_accounts WHERE username=$1', [username]);
  if (existing.rowCount) {
    await pool.query("UPDATE game_accounts SET role='admin', is_banned=FALSE, ban_reason=NULL, chat_muted_until=NULL WHERE id=$1", [existing.rows[0].id]);
    console.log(`Tài khoản @${username} được cấp quyền admin qua ADMIN_USERNAME.`);
    adminBootstrapWarning = '';
    return;
  }
  const password = process.env.ADMIN_PASSWORD;
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    adminBootstrapWarning=`ADMIN_USERNAME=@${username} chưa tồn tại trong database và chưa có ADMIN_PASSWORD hợp lệ (12–128 ký tự). Không thể cấp quyền admin tự động.`;
    console.error(adminBootstrapWarning);
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query("INSERT INTO game_accounts(username,password_hash,role) VALUES($1,$2,'admin') ON CONFLICT(username) DO UPDATE SET role='admin', is_banned=FALSE, ban_reason=NULL, chat_muted_until=NULL", [username, passwordHash]);
  console.log(`Đã tạo/cấp quyền admin cho @${username} bằng cấu hình môi trường.`);
  adminBootstrapWarning = '';
}

async function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' });
  try {
    const result = await pool.query(`UPDATE game_accounts SET last_active_at=NOW() WHERE id=$1
      RETURNING id::text AS id, username, role, is_banned AS "isBanned", ban_reason AS "banReason", chat_muted_until AS "chatMutedUntil"`, [req.session.userId]);
    const account = result.rows[0];
    if (!account) return res.status(401).json({ error: 'Tài khoản không còn tồn tại. Hãy đăng nhập lại.' });
    if (account.isBanned) {
      await new Promise(resolve => req.session.destroy(() => resolve()));
      res.clearCookie('aether.sid', { httpOnly: true, secure: isProduction, sameSite: 'lax' });
      return res.status(403).json({ error: account.banReason ? `Tài khoản đã bị khóa: ${account.banReason}` : 'Tài khoản này đã bị khóa khỏi máy chủ.' });
    }
    req.account = account;
    next();
  } catch (error) { next(error); }
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.account?.role !== 'admin') return res.status(403).json({ error: 'Bạn không có quyền quản trị máy chủ.' });
    next();
  });
}
async function recordAdminAction(actorId, action, targetId = null, details = {}) {
  await pool.query('INSERT INTO admin_audit_log(actor_id,target_id,action,details) VALUES($1,$2,$3,$4::jsonb)', [actorId, targetId, action, JSON.stringify(details)]);
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
  if (!Number.isSafeInteger(Number(value.gold)) || Number(value.gold) < 0 || Number(value.gold) > MAX_WALLET_COPPER) return false;
  if (value.currencyVersion !== 2) return false;
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
    res.json({ ok: true, database: 'connected', service: 'urban-catalyst-aether', version: GAME_VERSION, features: ['social','admin','marketplace'] });
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
    res.status(201).json({ username: result.rows[0].username, hasSave: false, role: 'player', isAdmin: false });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!validUsername(username) || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Tên đăng nhập hoặc mật khẩu không hợp lệ.' });
    const result = await pool.query('SELECT id, username, password_hash, role, is_banned, ban_reason FROM game_accounts WHERE username = $1', [username]);
    const user = result.rows[0];
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!valid) return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
    if (user.is_banned) return res.status(403).json({ error: user.ban_reason ? `Tài khoản đã bị khóa: ${user.ban_reason}` : 'Tài khoản này đã bị khóa khỏi máy chủ.' });
    // Re-apply the Render owner role after password verification; safe if account was created after the last deploy.
    if (String(process.env.ADMIN_USERNAME||'').trim().toLowerCase()===user.username){
      await pool.query("UPDATE game_accounts SET role='admin' WHERE id=$1",[user.id]);
      user.role='admin';
    }
    // Regenerate session ID after login to avoid session fixation.
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.userId = String(user.id);
    req.session.username = user.username;
    await saveSession(req);
    const save = await pool.query('SELECT 1 FROM game_saves WHERE user_id = $1', [user.id]);
    res.json({ username: user.username, hasSave: save.rowCount > 0, role: user.role, isAdmin: user.role === 'admin' });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', async (req, res, next) => {
  if (!req.session?.userId) return res.json({ authenticated: false });
  try {
    const result = await pool.query('SELECT id::text AS id, username, role, is_banned AS "isBanned", ban_reason AS "banReason" FROM game_accounts WHERE id=$1', [req.session.userId]);
    const user = result.rows[0];
    if (!user || user.isBanned) {
      await new Promise(resolve => req.session.destroy(() => resolve()));
      res.clearCookie('aether.sid', { httpOnly: true, secure: isProduction, sameSite: 'lax' });
      return res.json({ authenticated: false });
    }
    if(String(process.env.ADMIN_USERNAME||'').trim().toLowerCase()===user.username&&user.role!=='admin'){
      await pool.query("UPDATE game_accounts SET role='admin' WHERE id=$1",[user.id]);user.role='admin';
    }
    res.json({ authenticated: true, username: user.username, role: user.role, isAdmin: user.role === 'admin' });
  } catch (error) { next(error); }
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

// Client saves are reconciled against immutable market deltas. This prevents old browser
// snapshots from accidentally restoring listed items or undoing completed trades.
async function withMarketTransaction(handler) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const result = await handler(db); await db.query('COMMIT'); return result; }
  catch (err) { await db.query('ROLLBACK').catch(() => {}); throw err; }
  finally { db.release(); }
}
async function lockAccountIds(db, ids) {
  const unique = [...new Set(ids.map(String))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
  await db.query('SELECT id FROM game_accounts WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [unique]);
}
async function getMarketMeta(db, userId) {
  await db.query('INSERT INTO marketplace_meta(user_id) VALUES($1) ON CONFLICT DO NOTHING',[userId]);
  const result=await db.query('SELECT revision FROM marketplace_meta WHERE user_id=$1', [userId]);
  return Number(result.rows[0]?.revision||0);
}
const MARKET_RESOURCE_TYPES={classTransferTickets:{name:'Giấy Chuyển Class Thường',icon:'📃'},stones:{name:'Ma Thạch',icon:'💎'},shard:{name:'Void Shard',icon:'✧'},cores:{name:'Lõi Aether',icon:'◈'},manuals:{name:'Bí Cấp',icon:'📜'},hpPotions:{name:'Bình HP',icon:'❤️'},manaPotions:{name:'Bình Mana',icon:'💧'}};
function applyMarketDelta(state,event){
  const resource=event.resource_delta??event.resourceDelta??{};
  for(const [key,change] of Object.entries(resource)){
    if(!Object.hasOwn(MARKET_RESOURCE_TYPES,key)||!Number.isSafeInteger(change))continue;
    state[key]=Math.min(1e9,Math.max(0,Math.floor(Number(state[key])||0)+change));
  }
  const gold = Number(event.gold_delta??event.goldDelta??0);
  state.gold = Math.min(MAX_WALLET_COPPER,Math.max(0,Math.floor(Number(state.gold)||0)+gold));
  if(!Array.isArray(state.gearInventory)) state.gearInventory=[];
  const removed=event.removed_uid??event.removedUid;
  if(removed){state.gearInventory=state.gearInventory.filter(item=>item?.uid!==removed);
    if(state.equippedGear&&typeof state.equippedGear==='object')for(const slot of ['weapon','armor','accessory'])if(state.equippedGear[slot]===removed)state.equippedGear[slot]=null;
  }
  const add=event.added_item??event.addedItem;
  if(add&&typeof add==='object'&&state.gearInventory.length<100&&!(state.gearInventory.some(item=>item?.uid===add.uid)))state.gearInventory.push(add);
  return state;
}
async function appendMarketEvent(db,uid, event){
  const meta=await getMarketMeta(db,uid);
  const rev=meta+1;
  const save=await db.query('SELECT state FROM game_saves WHERE user_id=$1 FOR UPDATE',[uid]);
  if(!save.rowCount)throw Object.assign(new Error('Nhân vật chưa có bản lưu trên máy chủ.'),{statusCode:409});
  const state=save.rows[0].state;
  applyMarketDelta(state,event);
  state.marketRevision=rev;
  await db.query('UPDATE marketplace_meta SET revision=$2 WHERE user_id=$1',[uid,rev]);
  await db.query('INSERT INTO marketplace_events(user_id,revision,gold_delta,removed_uid,added_item,resource_delta) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
    [uid,rev,event.goldDelta||0,event.removedUid||null,event.addedItem?JSON.stringify(event.addedItem):null,JSON.stringify(event.resourceDelta||{})]);
  await db.query('UPDATE game_saves SET state=$2::jsonb,updated_at=NOW() WHERE user_id=$1',[uid,JSON.stringify(state)]);
  return { revision:rev, state };
}
app.put('/api/game/save', requireAuth, async (req,res,next)=>{
  if(!savePayloadIsValid(req.body))return res.status(400).json({error:'Dữ liệu lưu game không hợp lệ hoặc vượt giới hạn.'});
  if ((req.account.username!==ULR_OWNER || req.account.role!=='admin') && (req.body.classId==='sovereign' || req.body.sovereignClassUnlocked===true || (Array.isArray(req.body.gearInventory)&&req.body.gearInventory.some(item=>item&&(item.equipmentRank==='ULR'||item.key==='sovereign_arma'))))) return res.status(403).json({error:'ULR và Chí Tôn Nguyên Sơ chỉ dành cho tài khoản Admin lucasmpasi146.'});
  const serialized=JSON.stringify(req.body);
  if(Buffer.byteLength(serialized,'utf8')>400*1024)return res.status(413).json({error:'Dữ liệu lưu game quá lớn.'});
  try {
    const outcome=await withMarketTransaction(async db=>{
      await lockAccountIds(db,[req.account.id]);
      const revision=await getMarketMeta(db,req.account.id);
      const fromRev=Number(req.body.marketRevision||0);
      if(!Number.isSafeInteger(fromRev)||fromRev<0||fromRev>revision) return {error:'Phiên lưu Chợ không hợp lệ, vui lòng tải lại nhân vật.',status:409};
      const state={...req.body,accountUsername:req.account.username,lastSeen:Date.now()};
      let deltas=[];
      if(fromRev<revision){
        const events=await db.query('SELECT revision,gold_delta,removed_uid,added_item,resource_delta FROM marketplace_events WHERE user_id=$1 AND revision>$2 ORDER BY revision',[req.account.id,fromRev]);
        deltas=events.rows;
        for(const event of deltas)applyMarketDelta(state,event);
      }
      state.marketRevision=revision;
      const updated=await db.query(`INSERT INTO game_saves(user_id,state,updated_at) VALUES($1,$2::jsonb,NOW())
        ON CONFLICT(user_id) DO UPDATE SET state=EXCLUDED.state,updated_at=NOW() RETURNING updated_at`,[req.account.id,JSON.stringify(state)]);
      return {ok:true,updatedAt:updated.rows[0].updated_at,marketRevision:revision,marketDeltas:deltas};
    });
    if(outcome.error)return res.status(outcome.status).json({error:outcome.error});
    res.json(outcome);
  } catch(error){next(error);}
});

app.delete('/api/game/save',requireAuth,async(req,res,next)=>{
  try {
    const result=await withMarketTransaction(async db=>{
      await lockAccountIds(db,[req.account.id]);
      const active=await db.query("SELECT COUNT(*)::int AS count FROM marketplace_listings WHERE seller_id=$1 AND status='active'",[req.account.id]);
      if(active.rows[0].count)return {error:'Hãy hủy hoặc bán hết tin đăng đang hoạt động trước khi xóa nhân vật.',status:409};
      await db.query('DELETE FROM game_saves WHERE user_id=$1',[req.account.id]);
      await db.query('DELETE FROM marketplace_events WHERE user_id=$1',[req.account.id]);
      await db.query('DELETE FROM marketplace_meta WHERE user_id=$1',[req.account.id]);
      return {ok:true};
    });
    if(result.error)return res.status(result.status).json({error:result.error});
    res.json(result);
  }catch(error){next(error);}
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
    if (channel === 'world' && req.account?.chatMutedUntil && new Date(req.account.chatMutedUntil).getTime() > Date.now()) {
      return res.status(403).json({ error: `Bạn đang bị khóa chat Thế giới đến ${new Date(req.account.chatMutedUntil).toLocaleString('vi-VN')}.` });
    }
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


// Player-driven marketplace (independent from NPC Black Market).
// Equipment is held in escrow in the listing. Payments and transfers are atomic.
function validListingId(value){return /^\d{1,19}$/.test(String(value||''));}
function marketResponseError(error){return {error:error.message||'Không thể thực hiện giao dịch.'};}
const listingSelect=`l.id::text AS id,l.seller_id::text AS "sellerId",seller.username AS "sellerUsername",
  l.buyer_id::text AS "buyerId", buyer.username AS "buyerUsername", l.item,l.price::text AS price,
  l.status,l.created_at AS "createdAt",l.closed_at AS "closedAt"`;
app.get('/api/marketplace/listings',requireAuth,async(req,res,next)=>{
  const search=typeof req.query.search==='string'?req.query.search.trim().slice(0,50):'';
  try{
    const result=await pool.query(`SELECT ${listingSelect} FROM marketplace_listings l
      JOIN game_accounts seller ON seller.id=l.seller_id LEFT JOIN game_accounts buyer ON buyer.id=l.buyer_id
      WHERE l.status='active' AND ($1='' OR l.item->>'name' ILIKE '%' || $1 || '%')
      ORDER BY l.created_at DESC,l.id DESC LIMIT 80`,[search]);
    res.json({listings:result.rows});
  }catch(error){next(error);}
});
app.get('/api/marketplace/my',requireAuth,async(req,res,next)=>{
  try{
    const result=await pool.query(`SELECT ${listingSelect} FROM marketplace_listings l
      JOIN game_accounts seller ON seller.id=l.seller_id LEFT JOIN game_accounts buyer ON buyer.id=l.buyer_id
      WHERE l.seller_id=$1 OR l.buyer_id=$1 ORDER BY l.id DESC LIMIT 80`,[req.account.id]);
    res.json({listings:result.rows});
  }catch(error){next(error);}
});
app.get('/api/marketplace/sync',requireAuth,async(req,res,next)=>{
  try{
    const fromRev=Number(req.query.since||0);
    if(!Number.isSafeInteger(fromRev)||fromRev<0)return res.status(400).json({error:'Mốc đồng bộ không hợp lệ.'});
    const revResult=await pool.query('SELECT revision FROM marketplace_meta WHERE user_id=$1',[req.account.id]);
    const revision=Number(revResult.rows[0]?.revision||0);
    if(fromRev>revision)return res.status(409).json({error:'Bản lưu cục bộ mới hơn sổ giao dịch của server.'});
    const events=await pool.query('SELECT revision,gold_delta,removed_uid,added_item,resource_delta FROM marketplace_events WHERE user_id=$1 AND revision>$2 ORDER BY revision LIMIT 1000',[req.account.id,fromRev]);
    res.json({revision,events:events.rows,hasMore:events.rows.length===1000});
  }catch(error){next(error);}
});
app.post('/api/marketplace/listings',requireAuth,marketActionLimiter,async(req,res,next)=>{
  const uid=typeof req.body?.uid==='string'?req.body.uid.trim():'';
  const resourceKey=typeof req.body?.resourceKey==='string'?req.body.resourceKey:'';
  const quantity=Number(req.body?.quantity);
  const resourceMode=Object.hasOwn(MARKET_RESOURCE_TYPES,resourceKey);
  const price=Number(req.body?.price);
  if((!resourceMode&&(uid.length<2||uid.length>128))||(resourceMode&&(!Number.isSafeInteger(quantity)||quantity<1||quantity>9999))||!Number.isSafeInteger(price)||price<10||price>MAX_WALLET_COPPER)return res.status(400).json({error:'Vật phẩm hoặc giá không hợp lệ (10–9.007.199.254.740.991 đồng tệ).'});
  try{
    const result=await withMarketTransaction(async db=>{
      await lockAccountIds(db,[req.account.id]);
      const count=await db.query("SELECT COUNT(*)::int AS n FROM marketplace_listings WHERE seller_id=$1 AND status='active'",[req.account.id]);
      if(count.rows[0].n>=20)return {error:'Mỗi tài khoản đăng tối đa 20 mặt hàng.',status:409};
      const save=await db.query('SELECT state FROM game_saves WHERE user_id=$1 FOR UPDATE',[req.account.id]);
      if(!save.rowCount)return {error:'Bạn phải tạo nhân vật và lưu game trước khi giao dịch.',status:409};
      const state=save.rows[0].state;
      let item=null;let marketUid=uid;
      if(resourceMode){
        if((Number(state[resourceKey])||0)<quantity)return {error:'Bạn không có đủ nguyên liệu/vật phẩm để ký gửi.',status:409};
        const t=MARKET_RESOURCE_TYPES[resourceKey];
        item={type:'resource',key:resourceKey,name:t.name,icon:t.icon,quantity,slot:'material',rarity:'Nguyên liệu',equipmentRank:'—'};
        marketUid='resource:'+crypto.randomUUID();
      } else {item=Array.isArray(state.gearInventory)?state.gearInventory.find(i=>i&&i.uid===uid):null;}
      if(!item)return {error:'Trang bị không còn trong túi trên máy chủ; hãy đồng bộ lại.',status:409};
      if(!['weapon','armor','accessory','material'].includes(item.slot)||typeof item.name!=='string'||!item.name.trim()||item.name.length>120)return {error:'Loại trang bị chưa được hỗ trợ giao dịch.',status:400};
      if(!resourceMode&&state.equippedGear&&Object.values(state.equippedGear).includes(uid))return {error:'Tháo trang bị trước khi đăng bán.',status:409};
      if(!resourceMode&&(item.key==='sovereign_arma'||item.noLevelRequirement===true||item.equipmentRank==='ULR'))return {error:'Vũ khí độc quyền ULR không được giao dịch.',status:403};
      const ins=await db.query("INSERT INTO marketplace_listings(seller_id,item_uid,item,price) VALUES($1,$2,$3::jsonb,$4) RETURNING id::text AS id",[req.account.id,marketUid,JSON.stringify(item),price]);
      await appendMarketEvent(db,req.account.id,resourceMode?{resourceDelta:{[resourceKey]:-quantity}}:{goldDelta:0,removedUid:uid});
      return {ok:true,id:ins.rows[0].id};
    });
    if(result.error)return res.status(result.status).json({error:result.error});
    res.status(201).json(result);
  }catch(error){if(error.code==='23505')return res.status(409).json({error:'Vật phẩm đã có tin đăng hoạt động.'});next(error);}
});
app.post('/api/marketplace/listings/:id/buy',requireAuth,marketActionLimiter,async(req,res,next)=>{
  const id=req.params.id;if(!validListingId(id))return res.status(400).json({error:'Mã tin đăng không hợp lệ.'});
  try{
    const result=await withMarketTransaction(async db=>{
      const listingQ=await db.query('SELECT * FROM marketplace_listings WHERE id=$1 FOR UPDATE',[id]);
      const l=listingQ.rows[0]; if(!l||l.status!=='active')return {error:'Tin đăng đã bán hoặc bị hủy.',status:409};
      if(String(l.seller_id)===String(req.account.id))return {error:'Bạn không thể tự mua vật phẩm của mình.',status:403};
      await lockAccountIds(db,[l.seller_id,req.account.id]);
      const saves=await db.query('SELECT user_id::text AS uid,state FROM game_saves WHERE user_id=ANY($1::bigint[]) FOR UPDATE',[[String(l.seller_id),String(req.account.id)]]);
      const buyer=saves.rows.find(r=>r.uid===String(req.account.id))?.state;
      const seller=saves.rows.find(r=>r.uid===String(l.seller_id))?.state;
      if(!buyer||!seller)return {error:'Người bán hoặc mua chưa có dữ liệu nhân vật.',status:409};
      const price=Number(l.price);
      if(!Number.isSafeInteger(price)||price<10||price>MAX_WALLET_COPPER)return {error:'Giá vật phẩm không hợp lệ.',status:409};
      if(Number(buyer.gold||0)<price)return {error:'Không đủ tiền tệ để mua.',status:409};
      if(Number(seller.gold||0)+price>MAX_WALLET_COPPER)return {error:'Ví tiền người bán sắp chạm giới hạn lưu trữ.',status:409};
      if(l.item?.equipmentRank==='ULR'||l.item?.key==='sovereign_arma')return {error:'Vật phẩm ULR độc quyền không được giao dịch.',status:403};
      const resourceMode=l.item?.type==='resource';
      if(!resourceMode&&(buyer.gearInventory||[]).length>=100)return {error:'Túi trang bị đã đầy (100 món).',status:409};
      const resourceKey=resourceMode?l.item.key:null;
      const quantity=Number(l.item?.quantity||0);
      if(resourceMode&&(!Object.hasOwn(MARKET_RESOURCE_TYPES,resourceKey)||!Number.isSafeInteger(quantity)||quantity<1||quantity>9999))return {error:'Vật phẩm đăng bán không hợp lệ.',status:409};
      const incoming=resourceMode?null:{...l.item,uid:crypto.randomUUID(),dropped:false};
      await appendMarketEvent(db,req.account.id,resourceMode?{goldDelta:-price,resourceDelta:{[resourceKey]:quantity}}:{goldDelta:-price,addedItem:incoming});
      await appendMarketEvent(db,l.seller_id,{goldDelta:price});
      await db.query("UPDATE marketplace_listings SET status='sold',buyer_id=$2,closed_at=NOW() WHERE id=$1",[id,req.account.id]);
      return {ok:true,id:String(id),item:incoming,name:l.item.name,price};
    });
    if(result.error)return res.status(result.status).json({error:result.error});
    res.json(result);
  }catch(error){next(error);}
});
app.post('/api/marketplace/listings/:id/cancel',requireAuth,marketActionLimiter,async(req,res,next)=>{
  const id=req.params.id;if(!validListingId(id))return res.status(400).json({error:'Mã tin đăng không hợp lệ.'});
  try{
    const result=await withMarketTransaction(async db=>{
      const listingQ=await db.query('SELECT * FROM marketplace_listings WHERE id=$1 FOR UPDATE',[id]);
      const l=listingQ.rows[0];if(!l||l.status!=='active')return {error:'Tin đăng đã hoàn tất hoặc bị hủy.',status:409};
      if(String(l.seller_id)!==String(req.account.id))return {error:'Bạn không sở hữu tin đăng này.',status:403};
      await lockAccountIds(db,[req.account.id]);
      const q=await db.query('SELECT state FROM game_saves WHERE user_id=$1 FOR UPDATE',[req.account.id]);
      if(!q.rowCount||(l.item?.type!=='resource'&&q.rows[0].state.gearInventory?.length>=100))return {error:'Túi đồ đầy hoặc chưa có nhân vật; không thể hoàn trả vật phẩm.',status:409};
      if(l.item?.type==='resource'){
        if(!Object.hasOwn(MARKET_RESOURCE_TYPES,l.item.key))return {error:'Loại vật phẩm ký gửi không hợp lệ.',status:409};
        await appendMarketEvent(db,req.account.id,{resourceDelta:{[l.item.key]:Number(l.item.quantity)}});
      }else await appendMarketEvent(db,req.account.id,{goldDelta:0,addedItem:l.item});
      await db.query("UPDATE marketplace_listings SET status='cancelled',closed_at=NOW() WHERE id=$1",[id]);
      return {ok:true,id:String(id)};
    });
    if(result.error)return res.status(result.status).json({error:result.error});
    res.json(result);
  }catch(error){next(error);}
});

app.get('/api/admin/status',requireAuth,async(req,res,next)=>{
  const configured=(process.env.ADMIN_USERNAME||'').trim().toLowerCase();
  const canReadAdminWarning=req.account.username===configured||req.account.role==='admin';
  res.json({version:GAME_VERSION,username:req.account.username,role:req.account.role,isAdmin:req.account.role==='admin',
    adminEnvSet:Boolean(configured),envMatchesAccount:configured===req.account.username,bootWarning:canReadAdminWarning?adminBootstrapWarning:(configured?'ADMIN_USERNAME khác username đang đăng nhập.':'Chưa thiết lập ADMIN_USERNAME.'),
    diagnostics:req.account.role==='admin'?'Quyền admin đã được backend xác thực.':'Đăng nhập bằng đúng ADMIN_USERNAME, xác nhận Render đang chạy server.js mới và chọn Deploy latest commit.'});
});

// Admin API: every operation is authorized against the database role, never a client-supplied flag.
app.get('/api/admin/overview', requireAdmin, async (req, res, next) => {
  try {
    const [accounts, online, banned, muted] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM game_accounts'),
      pool.query("SELECT COUNT(*)::int AS count FROM game_accounts WHERE last_active_at > NOW()-INTERVAL '90 seconds' AND is_banned=FALSE"),
      pool.query('SELECT COUNT(*)::int AS count FROM game_accounts WHERE is_banned=TRUE'),
      pool.query('SELECT COUNT(*)::int AS count FROM game_accounts WHERE chat_muted_until > NOW()'),
    ]);
    res.json({ ok: true, accounts: accounts.rows[0].count, online: online.rows[0].count, banned: banned.rows[0].count, muted: muted.rows[0].count });
  } catch (error) { next(error); }
});

app.get('/api/admin/accounts', requireAdmin, async (req, res, next) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 40) : '';
  try {
    const result = await pool.query(`
      SELECT a.id::text AS id, a.username, a.role, a.is_banned AS "isBanned", a.ban_reason AS "banReason",
        a.chat_muted_until AS "chatMutedUntil", a.created_at AS "createdAt", a.last_active_at AS "lastActiveAt",
        COALESCE(NULLIF(s.state->>'characterName',''),a.username) AS "characterName",
        CASE WHEN COALESCE(s.state->>'level','') ~ '^[0-9]+$' THEN (s.state->>'level')::int ELSE 1 END AS level,
        (COALESCE(a.last_active_at,a.created_at) > NOW()-INTERVAL '90 seconds' AND a.is_banned=FALSE) AS "isOnline"
      FROM game_accounts a LEFT JOIN game_saves s ON s.user_id=a.id
      WHERE ($1='' OR a.username ILIKE '%' || $1 || '%' OR COALESCE(s.state->>'characterName','') ILIKE '%' || $1 || '%')
      ORDER BY (a.role='admin') DESC, a.created_at DESC LIMIT 100`, [search]);
    res.json({ accounts: result.rows.map(a => ({ ...a, isMuted: !!a.chatMutedUntil && new Date(a.chatMutedUntil).getTime() > Date.now() })) });
  } catch (error) { next(error); }
});

app.get('/api/admin/world-messages', requireAdmin, async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT m.id::text AS id, m.message, m.created_at AS "createdAt", a.username,
      COALESCE(NULLIF(s.state->>'characterName',''),a.username) AS "characterName"
      FROM social_messages m JOIN game_accounts a ON a.id=m.sender_id LEFT JOIN game_saves s ON s.user_id=a.id
      WHERE m.channel='world' ORDER BY m.id DESC LIMIT 40`);
    res.json({ messages: result.rows });
  } catch (error) { next(error); }
});

app.patch('/api/admin/accounts/:username', requireAdmin, adminActionLimiter, async (req, res, next) => {
  const username = String(req.params.username || '').trim().toLowerCase();
  const action = req.body?.action;
  const allowed = ['ban','unban','mute','unmute'];
  if (!validUsername(username) || !allowed.includes(action)) return res.status(400).json({ error: 'Tài khoản hoặc thao tác quản trị không hợp lệ.' });
  try {
    const targetResult = await pool.query('SELECT id::text AS id, username, role FROM game_accounts WHERE username=$1', [username]);
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    if (target.role === 'admin') return res.status(403).json({ error: 'Không thể khóa hoặc tắt chat của tài khoản admin. Hãy quản lý quyền qua ADMIN_USERNAME trong Render.' });
    if (String(target.id) === String(req.account.id)) return res.status(400).json({ error: 'Không thể áp dụng thao tác này lên tài khoản của chính bạn.' });
    if (action === 'ban') {
      const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
      await pool.query('UPDATE game_accounts SET is_banned=TRUE, ban_reason=$1 WHERE id=$2', [reason || 'Vi phạm quy tắc máy chủ', target.id]);
      await recordAdminAction(req.account.id, 'ban', target.id, { reason: reason || 'Vi phạm quy tắc máy chủ' });
    } else if (action === 'unban') {
      await pool.query('UPDATE game_accounts SET is_banned=FALSE, ban_reason=NULL WHERE id=$1', [target.id]);
      await recordAdminAction(req.account.id, 'unban', target.id, {});
    } else if (action === 'mute') {
      const rawMinutes = Number(req.body.minutes ?? 60);
      const minutes = Number.isFinite(rawMinutes) ? Math.max(1, Math.min(10080, Math.floor(rawMinutes))) : 60;
      const until = new Date(Date.now() + minutes * 60_000);
      await pool.query('UPDATE game_accounts SET chat_muted_until=$1 WHERE id=$2', [until, target.id]);
      await recordAdminAction(req.account.id, 'mute_world_chat', target.id, { minutes, until: until.toISOString() });
    } else {
      await pool.query('UPDATE game_accounts SET chat_muted_until=NULL WHERE id=$1', [target.id]);
      await recordAdminAction(req.account.id, 'unmute_world_chat', target.id, {});
    }
    res.json({ ok: true, username: target.username, action });
  } catch (error) { next(error); }
});

app.post('/api/admin/announce', requireAdmin, adminActionLimiter, async (req, res, next) => {
  const raw = typeof req.body?.message === 'string' ? req.body.message.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim() : '';
  const message = raw.slice(0, 215);
  if (!message) return res.status(400).json({ error: 'Nội dung thông báo không được để trống.' });
  try {
    const finalMessage = `📢 THÔNG BÁO QUẢN TRỊ: ${message}`;
    const result = await pool.query("INSERT INTO social_messages(sender_id,recipient_id,channel,message) VALUES($1,NULL,'world',$2) RETURNING id::text AS id, created_at AS \"createdAt\"", [req.account.id, finalMessage]);
    await recordAdminAction(req.account.id, 'world_announcement', null, { message });
    res.status(201).json({ ok: true, id: result.rows[0].id, createdAt: result.rows[0].createdAt });
  } catch (error) { next(error); }
});

app.delete('/api/admin/world-messages/:id', requireAdmin, adminActionLimiter, async (req, res, next) => {
  const id = String(req.params.id || '');
  if (!/^\d{1,20}$/.test(id)) return res.status(400).json({ error: 'Mã tin nhắn không hợp lệ.' });
  try {
    const existing = await pool.query("SELECT id::text AS id, sender_id::text AS \"senderId\", message FROM social_messages WHERE id=$1::bigint AND channel='world'", [id]);
    if (!existing.rowCount) return res.status(404).json({ error: 'Không tìm thấy tin nhắn Thế giới.' });
    await pool.query("DELETE FROM social_messages WHERE id=$1::bigint AND channel='world'", [id]);
    await recordAdminAction(req.account.id, 'delete_world_message', existing.rows[0].senderId, { messageId: id, message: existing.rows[0].message.slice(0, 250) });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/api/admin/audit', requireAdmin, async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT l.id::text AS id, l.action, l.details, l.created_at AS "createdAt",
      actor.username AS "actorUsername", target.username AS "targetUsername"
      FROM admin_audit_log l LEFT JOIN game_accounts actor ON actor.id=l.actor_id LEFT JOIN game_accounts target ON target.id=l.target_id
      ORDER BY l.id DESC LIMIT 100`);
    res.json({ entries: result.rows });
  } catch (error) { next(error); }
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: isProduction ? '1h' : 0,
  setHeaders(res,resourcePath){if(resourcePath.endsWith('index.html'))res.setHeader('Cache-Control','no-store');} }));
app.get('*', (_req,res) => { if(!existsSync(PUBLIC_INDEX))return res.status(503).send('Thiếu public/index.html trên Render. Hãy upload nguyên thư mục public/ ở gốc repo và deploy bản đầy đủ.'); res.sendFile(PUBLIC_INDEX,{headers:{'Cache-Control':'no-store'}}); });

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
