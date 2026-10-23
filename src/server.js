'use strict';
// MySMEBox v1 — HTTP server (node:http ไม่ใช้ framework)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const { ApiError, sendJson, readJson } = require('./http');
const { requireUser, findShopRow } = require('./auth');
const { clientIp } = require('./ratelimit');
const cleanup = require('./jobs/cleanup');

const MB = 1024 * 1024;
const MUTATING = new Set(['POST', 'PUT', 'DELETE']);

// ---------- router ----------
// รูปแบบ path: ":id" หรือชื่อที่ลงท้าย "Id" = ตัวเลขเท่านั้น (กัน id ปลอม) ; ชื่ออื่น = 1 segment
function compilePath(pattern) {
  const names = [];
  const source = pattern.replace(/:([A-Za-z]+)/g, (_m, name) => {
    names.push(name);
    return name === 'id' || name.endsWith('Id') ? '(\\d{1,18})' : '([^/]+)';
  });
  return { regex: new RegExp(`^${source}$`), names };
}

function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler, opts = {}) => routes.push({ method, handler, opts, ...compilePath(pattern) });
  return {
    get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
        const m = r.regex.exec(pathname);
        if (!m) continue;
        const params = {};
        r.names.forEach((n, i) => { params[n] = m[i + 1]; });
        return { route: r, params };
      }
      return { route: null };
    },
  };
}

const router = createRouter();
for (const name of ['auth', 'demo', 'shop', 'dashboard', 'products', 'orders', 'customers', 'warehouses', 'map', 'ai', 'upload']) {
  require(`./routes/${name}`).register(router);
}
require('./master').register(router);
router.get('/api/health', async () => {
  await db.query('SELECT 1');
  return { db: 'up' };
}, { auth: 'none' });
router.get('/api/config', async () => ({ googleClientId: config.googleClientId, demoEnabled: true }), { auth: 'none' });

// ---------- กันคำขอเปลี่ยนข้อมูลข้ามเว็บ (CSRF) ----------
function checkMutationHeaders(req) {
  const origin = req.headers.origin;
  if (origin && config.appOrigin && origin !== config.appOrigin) {
    throw new ApiError(403, 'FORBIDDEN', 'ไม่อนุญาตคำขอจากเว็บไซต์อื่น');
  }
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    throw new ApiError(400, 'VALIDATION', 'ต้องส่งข้อมูลแบบ application/json');
  }
}

async function buildContext(req, res, url, route, params) {
  const ctx = { req, res, url, query: url.searchParams, params, body: {}, ip: clientIp(req), responseHeaders: {}, handled: false };
  const auth = route.opts.auth || 'shop';
  if (auth !== 'none') {
    ctx.user = await requireUser(req);
    if (auth === 'shop') {
      ctx.shopRow = await findShopRow(ctx.user.id);
      if (!ctx.shopRow) throw new ApiError(409, 'NO_SHOP', 'กรุณาตั้งชื่อร้านก่อนเริ่มใช้งาน');
      ctx.shopId = ctx.shopRow.id;
    }
  }
  if (MUTATING.has(req.method)) {
    ctx.body = await readJson(req, route.opts.bodyLimit || MB);
  }
  return ctx;
}

async function handleApi(req, res, url) {
  const { route, params } = router.match(req.method, url.pathname);
  if (!route) throw new ApiError(404, 'NOT_FOUND', 'ไม่พบ API ที่เรียก');
  if (MUTATING.has(req.method)) checkMutationHeaders(req);
  const ctx = await buildContext(req, res, url, route, params);
  const result = await route.handler(ctx);
  if (ctx.handled) return;
  sendJson(res, 200, { ok: true, ...result }, { ...(route.opts.headers || {}), ...ctx.responseHeaders });
}

function handleError(res, err) {
  if (err instanceof ApiError) {
    return sendJson(res, err.status, { ok: false, error: err.message, code: err.code });
  }
  // รายละเอียดอยู่ฝั่ง server เท่านั้น — ผู้ใช้เห็นข้อความกลางๆ
  console.error('[server] unhandled error:', err && err.stack ? err.stack : err);
  if (res.headersSent) return res.destroy();
  sendJson(res, 500, { ok: false, error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง', code: 'INTERNAL' });
}

// ---------- static files (dev/test; production ใช้ Caddy) ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.ico': 'image/x-icon',
};
const PUBLIC_ROOT = path.resolve(config.publicDir);

function resolveStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  if (decoded === '/app' || decoded === '/app/') decoded = '/app/index.html';
  if (decoded.endsWith('/')) decoded += 'index.html';
  const full = path.resolve(PUBLIC_ROOT, '.' + decoded);
  // กัน path traversal: ต้องอยู่ใต้ public/ เท่านั้น
  if (!full.startsWith(PUBLIC_ROOT + path.sep)) return null;
  return full;
}

function serveStatic(req, res, url) {
  const notFoundPage = () => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end('ไม่พบหน้าที่ต้องการ (404)');
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return notFoundPage();
  const file = resolveStaticPath(url.pathname);
  if (!file) return notFoundPage();
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return notFoundPage();
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

async function onRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return sendJson(res, 400, { ok: false, error: 'URL ไม่ถูกต้อง', code: 'VALIDATION' });
  }
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      handleError(res, err);
    }
    return;
  }
  if (config.serveStatic) return serveStatic(req, res, url);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

async function start() {
  await db.migrate();
  cleanup.start();
  const server = http.createServer((req, res) => {
    onRequest(req, res).catch((err) => handleError(res, err));
  });
  server.requestTimeout = 60000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  const addr = server.address();
  console.log(`[server] MySMEBox v1 พร้อมใช้งานที่ http://${addr.address}:${addr.port} (static: ${config.serveStatic ? 'เปิด' : 'ปิด'})`);
  const shutdown = () => {
    server.close(() => db.pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[server] เริ่มระบบไม่สำเร็จ:', err.message);
    process.exit(1);
  });
}

module.exports = { start };
