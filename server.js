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
