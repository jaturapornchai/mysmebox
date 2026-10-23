'use strict';
// อ่านค่าตั้งระบบจาก environment (+ ไฟล์ .env แบบง่าย ที่ไม่ทับค่า env ที่ตั้งไว้แล้ว)
// ห้ามดึงรหัสผ่านจาก docker inspect หรือแหล่งอื่น — ความลับต้องมาจาก env เท่านั้น
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function parseEnvValue(raw) {
  const value = raw.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.indexOf(quote, 1) > 0) {
    return value.slice(1, value.indexOf(quote, 1));
  }
  // ตัดคอมเมนต์ท้ายบรรทัด (" # ...") เช่น "# pragma: allowlist secret"
  const hash = value.search(/\s#/);
  return (hash >= 0 ? value.slice(0, hash) : value).trim();
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!m) continue;
    // ไม่ทับค่าที่ตั้งมาจาก environment จริง (รวมค่าว่างที่ตั้งใจปิดฟีเจอร์)
    if (Object.prototype.hasOwnProperty.call(process.env, m[1])) continue;
    process.env[m[1]] = parseEnvValue(m[2]);
  }
}

loadDotEnv(path.join(ROOT_DIR, '.env'));

const env = (name, fallback = '') => {
  const v = process.env[name];
  return v === undefined ? fallback : String(v).trim();
};
const envBool = (name, fallback) => {
  const v = env(name, '').toLowerCase();
  if (v === '') return fallback;
  return v === '1' || v === 'true' || v === 'yes';
};

function buildDatabaseUrl() {
  if (env('DATABASE_URL')) return env('DATABASE_URL');
  const user = encodeURIComponent(env('PG_USER', 'postgres'));
  const pass = encodeURIComponent(env('PG_PASSWORD', ''));
  const host = env('PG_HOST', '127.0.0.1');
  const port = env('PG_PORT', '5432');
  const db = env('PG_DATABASE', 'mysmebox');
  return `postgres://${user}${pass ? ':' + pass : ''}@${host}:${port}/${db}`;
}

const isProduction = env('NODE_ENV') === 'production';

const minio = {
  endPoint: env('MINIO_ENDPOINT'),
  port: Number.parseInt(env('MINIO_PORT', '9000'), 10) || 9000,
  bucket: env('MINIO_BUCKET', 'mysmebox'),
  accessKey: env('MINIO_ACCESS_KEY'),
  secretKey: env('MINIO_SECRET_KEY'),
  useSSL: envBool('MINIO_USE_SSL', false),
};
minio.enabled = Boolean(minio.endPoint && minio.accessKey && minio.secretKey && minio.bucket);

const config = {
  rootDir: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),
  dataDir: path.join(ROOT_DIR, 'data'),
  isProduction,
  port: Number.parseInt(env('PORT', '3850'), 10),
  host: env('HOST', '127.0.0.1'),
  databaseUrl: buildDatabaseUrl(),
  minio,
  googleClientId: env('GOOGLE_CLIENT_ID') || null,
  // เปลี่ยนได้เฉพาะเพื่อทดสอบ (mock server) — production ใช้ค่าเริ่มต้นของ Google
  googleTokeninfoUrl: env('GOOGLE_TOKENINFO_URL', 'https://oauth2.googleapis.com/tokeninfo'),
  ollama: {
    url: env('OLLAMA_API_URL', 'https://ollama.com/api/chat'),
    apiKey: env('OLLAMA_API_KEY'),
    model: env('OLLAMA_MODEL', 'gpt-oss:120b'),
  },
  appOrigin: env('APP_ORIGIN').replace(/\/+$/, ''),
  cookieSecure: envBool('COOKIE_SECURE', isProduction),
  serveStatic: env('SERVE_STATIC', '1') !== '0',
  businessTz: 'Asia/Bangkok',
  sessionDays: 30,
  demoHours: 24,
};

module.exports = config;
