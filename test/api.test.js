'use strict';
// API integration test: ยิง HTTP จริงไปที่ server จริง + PostgreSQL จริง (DB แยก ถูกลบ/สร้างใหม่ทุกครั้ง)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('../src/config'); // โหลด .env (ไม่ทับ env ที่มี)
const { Client } = require('pg');

const TEST_DB = process.env.TEST_DATABASE_URL;
const ROOT = path.resolve(__dirname, '..');
const skip = TEST_DB ? false : 'ไม่ได้ตั้ง TEST_DATABASE_URL';

const S = {}; // state ที่ส่งต่อระหว่างขั้นตอน
let server;
let mock;
let pg;
let baseUrl;
const mockSeen = { chat: [] };

// ---------- helpers ----------
const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

const ean13Valid = (code) => {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
};

const thaiYYMM = () => {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return String(d.getUTCFullYear() % 100).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0');
};
const thaiDate = (iso) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** session ของผู้ใช้หนึ่งคน (เก็บ cookie เอง) */
function agent(ip) {
  const a = { cookie: '' };
  a.req = async (method, url, body, { headers = {}, origin = baseUrl } = {}) => {
    const h = { ...headers };
    if (a.cookie) h.Cookie = a.cookie;
    if (ip) h['X-Forwarded-For'] = ip;
    if (origin) h.Origin = origin;
    if (body !== undefined || ['POST', 'PUT', 'DELETE'].includes(method)) {
      if (!h['Content-Type']) h['Content-Type'] = 'application/json';
    }
    const res = await fetch(baseUrl + url, { method, headers: h, body: body === undefined ? (method === 'GET' ? undefined : '{}') : typeof body === 'string' ? body : JSON.stringify(body) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const v = setCookie.split(';')[0];
      a.cookie = v === 'sid=' ? '' : v;
      a.lastSetCookie = setCookie;
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ไม่ใช่ JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  for (const m of ['GET', 'POST', 'PUT', 'DELETE']) a[m.toLowerCase()] = (url, body, opts) => a.req(m, url, body, opts);
  return a;
}

function expectOk(r, status = 200) {
  assert.equal(r.status, status, `HTTP ${r.status}: ${r.text.slice(0, 300)}`);
  if (status === 200) assert.equal(r.json.ok, true);
  return r.json;
}
function expectErr(r, status, code) {
  assert.equal(r.status, status, `คาด ${status} ได้ ${r.status}: ${r.text.slice(0, 300)}`);
  assert.equal(r.json.ok, false);
  assert.equal(typeof r.json.error, 'string');
  if (code) assert.equal(r.json.code, code);
}

// ---------- mock Google tokeninfo + Ollama ----------
function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (url.pathname === '/tokeninfo') {
        const t = url.searchParams.get('id_token');
        const base = { aud: 'test-client-id', iss: 'https://accounts.google.com', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3600), name: 'Seller B', picture: 'https://example.com/b.png' };
        if (t === 'good-token-seller-b') return send(200, { ...base, email: 'seller.b@gmail.com' });
        if (t === 'wrong-aud-token-xx') return send(200, { ...base, aud: 'other-client', email: 'x@gmail.com' });
        return send(400, { error: 'invalid_token' });
      }
      if (url.pathname === '/api/chat' && req.method === 'POST') {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          const body = JSON.parse(raw);
          mockSeen.chat.push({ body, auth: req.headers.authorization });
          if (body.format === 'json') {
            const firstBarcode = (body.messages[0].content.match(/บาร์โค้ด:(\S+)/) || [])[1];
            const content = JSON.stringify({
              customerName: 'คุณทดสอบ เอไอ', customerPhone: '081-111-2222', addressText: '1 ถ.พหลโยธิน จตุจักร กทม.', zipCode: '10900',
              channel: 'LINE', courier: 'FLASH', payMethod: 'COD', shippingBaht: '40',
              items: [{ barcode: firstBarcode, qty: 2 }, { barcode: '0000000000000', qty: 1 }], note: 'ส่งด่วน',
            });
            return send(200, { message: { role: 'assistant', content } });
          }
          return send(200, { message: { role: 'assistant', content: 'สวัสดีค่ะ ยอดวันนี้ดีมาก' } });
        });
        return;
      }
      send(404, {});
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function resetDatabase() {
  const u = new URL(TEST_DB);
  const dbName = u.pathname.slice(1);
  // กันพลาดไปลบ DB จริง: ต้องเป็นชื่อที่มีคำว่า test เท่านั้น
  assert.match(dbName, /^[a-z0-9_]*test[a-z0-9_]*$/, 'TEST_DATABASE_URL ต้องชี้ DB ที่ชื่อมีคำว่า test');
  u.pathname = '/postgres';
  const admin = new Client({ connectionString: u.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
}

async function waitHealthy(child) {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('server ปิดตัวก่อนพร้อม');
    try {
      const r = await fetch(baseUrl + '/api/health');
      if (r.ok) return;
    } catch { /* ยังไม่พร้อม */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server ไม่พร้อมภายใน 20 วินาที');
}

test.before(async () => {
  if (skip) return;
  await resetDatabase();
  mock = await startMock();
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: TEST_DB, APP_ORIGIN: baseUrl, SERVE_STATIC: '1',
      COOKIE_SECURE: '0', GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_TOKENINFO_URL: `${mockUrl}/tokeninfo`,
      OLLAMA_API_URL: `${mockUrl}/api/chat`, OLLAMA_API_KEY: 'test-key', OLLAMA_MODEL: 'test-model',
      MINIO_ENDPOINT: process.env.TEST_MINIO_ENDPOINT || '', MINIO_PORT: process.env.TEST_MINIO_PORT || '9000',
      MINIO_ACCESS_KEY: process.env.TEST_MINIO_ACCESS_KEY || '', MINIO_SECRET_KEY: process.env.TEST_MINIO_SECRET_KEY || '', MINIO_BUCKET: 'mysmebox-test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  S.serverLog = '';
  server.stdout.on('data', (d) => { S.serverLog += d; });
  server.stderr.on('data', (d) => { S.serverLog += d; });
  await waitHealthy(server);
  pg = new Client({ connectionString: TEST_DB });
  await pg.connect();
});

test.after(async () => {
  if (server) server.kill();
  if (mock) mock.close();
  if (pg) await pg.end();
  if (S.serverLog && /unhandled error/.test(S.serverLog)) console.log('--- server log ---\n' + S.serverLog);
});

// ================= ระบบ / auth =================
test('health + config', { skip }, async () => {
  const a = agent();
  assert.deepEqual(expectOk(await a.get('/api/health')), { ok: true, db: 'up' });
  const c = expectOk(await a.get('/api/config'));
  assert.equal(c.googleClientId, 'test-client-id');
  assert.equal(c.demoEnabled, true);
});

test('ไม่มี cookie → 401, Origin ผิด → 403, ไม่ใช่ JSON → 400', { skip }, async () => {
  const a = agent('10.0.0.1');
  expectErr(await a.get('/api/me'), 401, 'UNAUTHORIZED');
  expectErr(await a.get('/api/dashboard'), 401, 'UNAUTHORIZED');
  expectErr(await a.get('/api/products'), 401, 'UNAUTHORIZED');
  expectErr(await a.post('/api/demo/start', {}, { origin: 'https://evil.example.com' }), 403, 'FORBIDDEN');
  expectErr(await a.post('/api/demo/start', 'x=1', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), 400, 'VALIDATION');
  expectErr(await a.get('/api/nope'), 404, 'NOT_FOUND');
});

test('demo start → me (ร้านตัวอย่างพร้อมข้อมูล)', { skip }, async () => {
  const A = agent('10.0.0.1');
  const r = await A.post('/api/demo/start', {});
  const j = expectOk(r);
  assert.match(A.lastSetCookie, /^sid=[A-Za-z0-9_-]{43};/);
  assert.match(A.lastSetCookie, /HttpOnly/);
  assert.match(A.lastSetCookie, /SameSite=Lax/);
  assert.equal(j.user.isDemo, true);
  assert.ok(j.user.expiresAt);
  assert.equal(j.shop.name, 'ร้านน้องแนน บิวตี้ (ตัวอย่าง)');
  const me = expectOk(await A.get('/api/me'));
  assert.equal(me.user.id, j.user.id);
  assert.equal(me.shop.promptpayId, '0812345678');
  assert.equal(me.shop.bankCode, 'KBANK');
  assert.equal(typeof me.shop.lat, 'number');
  // session เก็บเฉพาะ hash
  const token = A.cookie.slice(4);
  const { rows } = await pg.query('SELECT token_hash FROM sessions WHERE user_id = $1', [j.user.id]);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
  assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
  S.A = A;
  S.shopA = j.shop;
});

test('seed: สินค้า 8 รายการ หลายหน่วย บาร์โค้ด EAN-13 ถูก, ของใกล้หมด, ออเดอร์ย้อนหลัง', { skip }, async () => {
  const { products } = expectOk(await S.A.get('/api/products'));
  assert.equal(products.length, 8);
  for (const p of products) {
    assert.ok(p.barcodes.length >= 1);
    for (const b of p.barcodes) assert.ok(ean13Valid(b.barcode) && b.barcode.startsWith('200'), b.barcode);
    assert.equal(p.units[0].unitCode, p.baseUnitCode);
    assert.equal(typeof p.costBaseSatang, 'string');
  }
  assert.ok(products.some((p) => p.units.length >= 3));
  const low = expectOk(await S.A.get('/api/products?lowStock=1')).products;
  assert.ok(low.length >= 1 && low.length <= 3, `low=${low.length}`);
  assert.ok(low.every((p) => p.isLowStock));
  const { orders } = expectOk(await S.A.get('/api/orders?limit=100'));
  assert.ok(orders.length >= 12);
  assert.ok(orders.some((o) => o.status === 'CANCELLED'));
  assert.ok(orders.some((o) => o.payMethod === 'COD' && o.payStatus === 'UNPAID'));
  assert.ok(orders.some((o) => o.payMethod === 'TRANSFER' && o.payStatus === 'UNPAID' && o.status === 'ACTIVE'));
  assert.ok(orders.some((o) => o.shipStatus === 'DELIVERED' && o.payStatus === 'PAID'));
  const days = new Set(orders.map((o) => thaiDate(o.createdAt)));
  assert.ok(days.size >= 5, 'กระจายหลายวัน');
  // stock_base ต้องเท่ากับผลรวม movement ทุกสินค้า
  const { rows } = await pg.query(
    `SELECT p.id, p.stock_base, COALESCE(SUM(m.qty_base_delta), 0) AS sum FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
      WHERE p.shop_id = $1 GROUP BY p.id`, [S.shopA.id]);
  for (const r of rows) assert.equal(r.stock_base, r.sum);
  S.seedProducts = products;
});

// ================= สินค้า =================
test('products CRUD: หน่วยนับ, บาร์โค้ดอัตโนมัติ, ซ้ำ 409, validate 400', { skip }, async () => {
  const A = S.A;
  const input = {
    code: '', name: 'สบู่สมุนไพรทดสอบ', baseUnitCode: 'bar', baseUnitName: 'ก้อน', costBaseSatang: '1500', minStockBase: 5, openingStock: 30, imageUrl: '',
    units: [{ unitCode: 'PK4', unitName: 'แพ็ค 4 ก้อน', standValue: 4, divideValue: 1 }, { unitCode: 'HALF', unitName: 'ครึ่งก้อน', standValue: 1, divideValue: 2 }],
    barcodes: [
      { barcode: '', unitCode: 'BAR', priceSatang: '3500' },
      { barcode: 'TEST-PK4-001', unitCode: 'PK4', priceSatang: '12000', priceMemberSatang: '11000', priceWholesaleSatang: '10000' },
      { barcode: '', unitCode: 'HALF', priceSatang: '2000' },
    ],
  };
  const { product: p } = expectOk(await A.post('/api/products', input));
  assert.equal(p.code, 'P0009');
  assert.equal(p.baseUnitCode, 'BAR');
  assert.equal(p.stockBase, 30);
  assert.equal(p.costBaseSatang, '1500');
  assert.deepEqual(p.units.map((u) => [u.unitCode, u.ratio, u.availableQty]), [['BAR', 1, 30], ['PK4', 4, 7], ['HALF', 0.5, 60]]);
  const auto = p.barcodes.filter((b) => b.barcode !== 'TEST-PK4-001');
  assert.equal(auto.length, 2);
  for (const b of auto) assert.ok(ean13Valid(b.barcode) && b.barcode.startsWith('200'));
  assert.deepEqual(p.units[1].matchedBarcodes, ['TEST-PK4-001']);
  assert.equal(p.barcodes.find((b) => b.unitCode === 'PK4').priceWholesaleSatang, '10000');

  // บาร์โค้ดซ้ำกับสินค้าอื่นในร้าน → 409
  const seedBarcode = S.seedProducts[0].barcodes[0].barcode;
  expectErr(await A.post('/api/products', { ...input, barcodes: [{ barcode: seedBarcode, unitCode: 'BAR', priceSatang: '100' }] }), 409, 'CONFLICT');
  // บาร์โค้ดซ้ำกันเองใน input → 409
  expectErr(await A.post('/api/products', { ...input, barcodes: [{ barcode: 'DUP-1', unitCode: 'BAR', priceSatang: '1' }, { barcode: 'DUP-1', unitCode: 'PK4', priceSatang: '1' }] }), 409);
  // รหัสสินค้าซ้ำ → 409
  expectErr(await A.post('/api/products', { ...input, code: 'P0009', barcodes: [{ barcode: '', unitCode: 'BAR', priceSatang: '1' }] }), 409);
  // เงินเป็น number → 400 ; หน่วยไม่มีจริง → 400 ; ไม่มีบาร์โค้ด → 400 ; หน่วยซ้ำ → 400
  expectErr(await A.post('/api/products', { ...input, barcodes: [{ barcode: '', unitCode: 'BAR', priceSatang: 3500 }] }), 400, 'VALIDATION');
  expectErr(await A.post('/api/products', { ...input, barcodes: [{ barcode: '', unitCode: 'BOX', priceSatang: '1' }] }), 400);
  expectErr(await A.post('/api/products', { ...input, barcodes: [] }), 400);
  expectErr(await A.post('/api/products', { ...input, units: [...input.units, { unitCode: 'PK4', unitName: 'x', standValue: 2, divideValue: 1 }] }), 400);
  expectErr(await A.post('/api/products', { ...input, units: [{ unitCode: 'PK0', unitName: 'x', standValue: 0, divideValue: 1 }] }), 400);
  expectErr(await A.post('/api/products', { ...input, costBaseSatang: '15.00' }), 400);

  // ไม่มีการสร้างสินค้าเพิ่มจากคำขอที่ล้มเหลว
  const { rows } = await pg.query('SELECT COUNT(*)::int AS n FROM products WHERE shop_id = $1', [S.shopA.id]);
  assert.equal(rows[0].n, 9);

  // GET / lookup / next-barcode
  assert.equal(expectOk(await A.get(`/api/products/${p.id}`)).product.name, input.name);
  const lk = expectOk(await A.get('/api/products/lookup?barcode=TEST-PK4-001'));
  assert.equal(lk.product.id, p.id);
  assert.equal(lk.barcode.unitCode, 'PK4');
  expectErr(await A.get('/api/products/lookup?barcode=NOPE-0000'), 404, 'NOT_FOUND');
  expectErr(await A.get('/api/products/999999999'), 404);
  const nb = expectOk(await A.get('/api/products/next-barcode?prefix=200'));
  assert.ok(ean13Valid(nb.barcode) && nb.barcode.startsWith('200'));
  // ค้นหาด้วยชื่อ / บาร์โค้ด
  assert.equal(expectOk(await A.get('/api/products?q=' + encodeURIComponent('สมุนไพร'))).products.length, 1);
  assert.equal(expectOk(await A.get('/api/products?q=TEST-PK4')).products[0].id, p.id);

  // PUT แทนที่ชุดบาร์โค้ด/หน่วย สต๊อกไม่เปลี่ยน
  const barBarcode = p.barcodes.find((b) => b.unitCode === 'BAR').barcode;
  const halfBarcode = p.barcodes.find((b) => b.unitCode === 'HALF').barcode;
  const put = expectOk(await A.put(`/api/products/${p.id}`, {
    ...input, code: 'P0009', name: 'สบู่สมุนไพรทดสอบ (ใหม่)', openingStock: 999,
    barcodes: [
      { barcode: barBarcode, unitCode: 'BAR', priceSatang: '3500' },
      { barcode: 'TEST-PK4-001', unitCode: 'PK4', priceSatang: '12500' },
      { barcode: halfBarcode, unitCode: 'HALF', priceSatang: '2000' },
    ],
  })).product;
  assert.equal(put.name, 'สบู่สมุนไพรทดสอบ (ใหม่)');
  assert.equal(put.stockBase, 30);
  assert.equal(put.barcodes.find((b) => b.barcode === 'TEST-PK4-001').priceSatang, '12500');
  expectErr(await A.put(`/api/products/${p.id}`, { ...input, barcodes: [{ barcode: seedBarcode, unitCode: 'BAR', priceSatang: '1' }] }), 409);

  // สต๊อก: รับเข้า / ปรับลดเกิน → 409 / ปรับลด
  assert.equal(expectOk(await A.post(`/api/products/${p.id}/stock`, { type: 'RECEIVE', qtyBase: 10, note: 'รับของล็อตใหม่' })).product.stockBase, 40);
  expectErr(await A.post(`/api/products/${p.id}/stock`, { type: 'ADJUST', qtyBase: -50 }), 409);
  expectErr(await A.post(`/api/products/${p.id}/stock`, { type: 'RECEIVE', qtyBase: -1 }), 400);
  expectErr(await A.post(`/api/products/${p.id}/stock`, { type: 'ADJUST', qtyBase: 0 }), 400);
  assert.equal(expectOk(await A.post(`/api/products/${p.id}/stock`, { type: 'ADJUST', qtyBase: -5, note: 'ของเสีย' })).product.stockBase, 35);
  const mv = expectOk(await A.get(`/api/products/${p.id}/movements`)).movements;
  assert.deepEqual(mv.map((m) => [m.reason, m.qtyBaseDelta, m.balanceAfter]), [['ADJUST', -5, 35], ['RECEIVE', 10, 40], ['OPENING', 30, 30]]);
  S.soap = { id: p.id, bar: barBarcode, half: halfBarcode, pk4: 'TEST-PK4-001' };

  // ลบ (ปิดใช้งาน) สินค้าชั่วคราวอีกตัว
  const tmp = expectOk(await A.post('/api/products', { ...input, name: 'ของชั่วคราว', openingStock: 0, units: [], barcodes: [{ barcode: '', unitCode: 'BAR', priceSatang: '100' }] })).product;
  expectOk(await A.delete(`/api/products/${tmp.id}`));
  assert.ok(!expectOk(await A.get('/api/products')).products.some((x) => x.id === tmp.id));
  expectErr(await A.get(`/api/products/lookup?barcode=${tmp.barcodes[0].barcode}`), 404);
});

// ================= ออเดอร์ =================
const shipAddr = {
  addressLine: '9/9 ซ.ทดสอบ', provinceCode: '10', provinceName: 'กรุงเทพมหานคร', districtCode: '1030', districtName: 'จตุจักร',
  subdistrictCode: '103004', subdistrictName: 'จอมพล', zipCode: '10900', lat: 13.803742, lng: 100.554603,
};

test('order create: สต๊อกลด, movement SALE, idempotency, เลขบิลต่อเนื่อง, 409/400', { skip }, async () => {
  const A = S.A;
  const body = {
    customerId: null, saveCustomer: true, customerName: 'คุณทดสอบ ระบบ', customerPhone: '0811112222', ship: shipAddr,
    channel: 'FACEBOOK', courier: 'FLASH', payMethod: 'COD', paid: false, payBankCode: '', slipUrl: '',
    discountSatang: '1000', shippingSatang: '4000', note: 'ทดสอบ',
    items: [{ barcode: S.soap.pk4, qty: 2 }, { barcode: S.soap.bar, qty: 3, priceSatang: '3000' }],
  };
  const r1 = await A.post('/api/orders', body, { headers: { 'Idempotency-Key': 'test-key-0001' } });
  const o = expectOk(r1).order;
  // 2*12500 + 3*3000 = 34000 ; -1000 + 4000 ; VAT 0
  assert.equal(o.itemsTotalSatang, '34000');
  assert.equal(o.discountSatang, '1000');
  assert.equal(o.shippingSatang, '4000');
  assert.equal(o.vatSatang, '0');
  assert.equal(o.totalSatang, '37000');
  assert.equal(o.costSatang, String(1500 * 11));
  assert.equal(o.profitSatang, String(34000 - 1000 - 16500));
  assert.equal(o.payStatus, 'UNPAID');
  assert.equal(o.shipStatus, 'PENDING');
  assert.equal(o.status, 'ACTIVE');
  assert.match(o.billNo, new RegExp(`^INV-${thaiYYMM()}-\\d{4}$`));
  assert.deepEqual(o.items.map((i) => [i.unitCode, i.qty, i.qtyBase, i.priceSatang, i.lineTotalSatang]), [['PK4', 2, 8, '12500', '25000'], ['BAR', 3, 3, '3000', '9000']]);
  assert.equal(o.ship.lat, 13.803742);
  assert.ok(o.customerId);
  const prod = expectOk(await A.get(`/api/products/${S.soap.id}`)).product;
  assert.equal(prod.stockBase, 35 - 11);
  const mv = expectOk(await A.get(`/api/products/${S.soap.id}/movements`)).movements[0];
  assert.deepEqual([mv.reason, mv.qtyBaseDelta, mv.balanceAfter, mv.refBillNo], ['SALE', -11, 24, o.billNo]);

  // key เดิม → บิลเดิม สต๊อกไม่ลดซ้ำ
  const again = expectOk(await A.post('/api/orders', body, { headers: { 'Idempotency-Key': 'test-key-0001' } })).order;
  assert.equal(again.id, o.id);
  assert.equal(again.billNo, o.billNo);
  assert.equal(expectOk(await A.get(`/api/products/${S.soap.id}`)).product.stockBase, 24);

  // สต๊อกไม่พอ → 409 พร้อมชื่อสินค้า ; หน่วยฐานหารไม่ลงตัว → 400 ; บาร์โค้ดไม่มี → 400 ; ส่วนลดเกิน → 400 ; เงิน number → 400
  const short = await A.post('/api/orders', { ...body, saveCustomer: false, items: [{ barcode: S.soap.bar, qty: 1000 }] });
  expectErr(short, 409, 'CONFLICT');
  assert.match(short.json.error, /สบู่สมุนไพรทดสอบ/);
  expectErr(await A.post('/api/orders', { ...body, saveCustomer: false, items: [{ barcode: S.soap.half, qty: 3 }] }), 400, 'VALIDATION');
  expectErr(await A.post('/api/orders', { ...body, saveCustomer: false, items: [{ barcode: 'NOPE-123', qty: 1 }] }), 400);
  expectErr(await A.post('/api/orders', { ...body, saveCustomer: false, discountSatang: '999999' }), 400);
  expectErr(await A.post('/api/orders', { ...body, saveCustomer: false, shippingSatang: 40 }), 400);
  expectErr(await A.post('/api/orders', { ...body, saveCustomer: false, items: [] }), 400);
  expectErr(await A.post('/api/orders', { ...body, saveCustomer: false, payMethod: 'BITCOIN' }), 400);
  assert.equal(expectOk(await A.get(`/api/products/${S.soap.id}`)).product.stockBase, 24, 'คำขอที่ล้มเหลวต้องไม่ตัดสต๊อก');

  // บิลถัดไป เลขรันต่อ + จ่ายแล้วตอนเปิดบิล (TRANSFER) + ใช้ลูกค้าเดิม + ครึ่งก้อน 4 = 2 ก้อน
  const o2 = expectOk(await A.post('/api/orders', {
    ...body, customerId: o.customerId, saveCustomer: false, customerName: '', customerPhone: '', payMethod: 'TRANSFER', paid: true, payBankCode: 'KBANK',
    discountSatang: '0', shippingSatang: '0', items: [{ barcode: S.soap.half, qty: 4 }],
  }, { headers: { 'Idempotency-Key': 'test-key-0002' } })).order;
  assert.equal(Number(o2.billNo.slice(-4)), Number(o.billNo.slice(-4)) + 1);
  assert.equal(o2.billNo.slice(0, 9), o.billNo.slice(0, 9));
  assert.equal(o2.payStatus, 'PAID');
  assert.ok(o2.paidAt);
  assert.equal(o2.customerName, 'คุณทดสอบ ระบบ');
  assert.equal(o2.items[0].qtyBase, 2);
  assert.equal(o2.totalSatang, '8000');
  assert.equal(expectOk(await A.get(`/api/products/${S.soap.id}`)).product.stockBase, 22);
  S.o1 = o;
  S.o2 = o2;

  // ลูกค้าใหม่ถูกบันทึก
  const cs = expectOk(await A.get('/api/customers?q=' + encodeURIComponent('ทดสอบ ระบบ'))).customers;
  assert.equal(cs.length, 1);
  assert.equal(cs[0].id, o.customerId);
  assert.equal(cs[0].zipCode, '10900');
});

test('orders list/filter/paging + pay → ship → cancel', { skip }, async () => {
  const A = S.A;
  const awaitPay = expectOk(await A.get('/api/orders?status=AWAIT_PAY')).orders;
  assert.ok(awaitPay.some((x) => x.id === S.o1.id));
  assert.ok(awaitPay.every((x) => x.status === 'ACTIVE' && x.payStatus === 'UNPAID'));
  assert.equal(awaitPay[0].items, undefined);
  assert.equal(typeof awaitPay[0].itemCount, 'number');
  const found = expectOk(await A.get('/api/orders?q=' + S.o1.billNo)).orders;
  assert.deepEqual(found.map((x) => x.id), [S.o1.id]);
  assert.equal(found[0].itemCount, 2);
  // เลื่อนหน้า
  const p1 = expectOk(await A.get('/api/orders?limit=5'));
  assert.equal(p1.orders.length, 5);
  assert.ok(p1.nextBefore);
  const p2 = expectOk(await A.get(`/api/orders?limit=5&before=${p1.nextBefore}`));
  assert.ok(p2.orders.every((x) => BigInt(x.id) < BigInt(p1.nextBefore)));
  const all = expectOk(await A.get('/api/orders?limit=100'));
  assert.equal(all.nextBefore, null);
  expectErr(await A.get('/api/orders?status=WHATEVER'), 400);

  // รับเงิน
  const paid = expectOk(await A.post(`/api/orders/${S.o1.id}/pay`, { payBankCode: 'SCB', slipUrl: '' })).order;
  assert.equal(paid.payStatus, 'PAID');
  assert.equal(paid.payBankCode, 'SCB');
  assert.ok(paid.paidAt);
  expectErr(await A.post(`/api/orders/${S.o1.id}/pay`, { payBankCode: 'NOTABANK' }), 400);
  // จัดส่ง
  const shipped = expectOk(await A.post(`/api/orders/${S.o1.id}/ship`, { shipStatus: 'SHIPPED', courier: 'KERRY', trackingNo: 'KEX123456789' })).order;
  assert.deepEqual([shipped.shipStatus, shipped.courier, shipped.trackingNo], ['SHIPPED', 'KERRY', 'KEX123456789']);
  assert.ok(expectOk(await A.get('/api/orders?status=SHIPPED')).orders.some((x) => x.id === S.o1.id));
  assert.ok(expectOk(await A.get('/api/orders?q=KEX123456789')).orders.some((x) => x.id === S.o1.id));
  expectErr(await A.post(`/api/orders/${S.o1.id}/ship`, { shipStatus: 'FLYING' }), 400);

  // ยกเลิก: คืนสต๊อก movement CANCEL, ยกเลิกซ้ำ 409, จ่าย/ส่งบิลยกเลิก 409
  const before = expectOk(await A.get(`/api/products/${S.soap.id}`)).product.stockBase;
  const cancelled = expectOk(await A.post(`/api/orders/${S.o1.id}/cancel`, { reason: 'ลูกค้าเปลี่ยนใจ' })).order;
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.cancelReason, 'ลูกค้าเปลี่ยนใจ');
  assert.equal(expectOk(await A.get(`/api/products/${S.soap.id}`)).product.stockBase, before + 11);
  const mv = expectOk(await A.get(`/api/products/${S.soap.id}/movements`)).movements[0];
  assert.deepEqual([mv.reason, mv.qtyBaseDelta, mv.refBillNo], ['CANCEL', 11, S.o1.billNo]);
  const { rows } = await pg.query("SELECT COUNT(*)::int AS n FROM stock_movements WHERE ref_bill_id = $1 AND reason = 'SALE'", [S.o1.id]);
  assert.equal(rows[0].n, 1, 'movement SALE เดิมต้องยังอยู่ (append-only)');
  expectErr(await A.post(`/api/orders/${S.o1.id}/cancel`, { reason: 'ซ้ำ' }), 409, 'CONFLICT');
  expectErr(await A.post(`/api/orders/${S.o1.id}/pay`, {}), 409);
  expectErr(await A.post(`/api/orders/${S.o1.id}/ship`, { shipStatus: 'DELIVERED' }), 409);
  assert.ok(expectOk(await A.get('/api/orders?status=CANCELLED')).orders.some((x) => x.id === S.o1.id));
  expectErr(await A.get('/api/orders/999999999'), 404);
});

test('promptpay endpoint', { skip }, async () => {
  const r = expectOk(await S.A.get(`/api/orders/${S.o2.id}/promptpay`));
  assert.equal(r.amountSatang, '8000');
  assert.equal(r.promptpayId, '0812345678');
  assert.match(r.payload, /^000201010212/);
  assert.ok(r.payload.includes('01130066812345678'));
  assert.ok(r.payload.includes('540580.00'));
  assert.match(r.qrSvg, /^<svg/);
  const { crc16ccitt } = require('../src/promptpay');
  assert.equal(r.payload.slice(-4), crc16ccitt(r.payload.slice(0, -4)));
  expectErr(await S.A.get(`/api/orders/${S.o1.id}/promptpay`), 409); // ยกเลิกแล้ว
});

// ================= ผู้ใช้คนที่ 2 (Google) + แยกข้อมูลร้าน =================
test('Google login + ตั้งร้าน + เข้าถึงข้อมูลร้านอื่นไม่ได้ (404)', { skip }, async () => {
  const B = agent('10.0.0.2');
  expectErr(await B.post('/api/auth/google', { credential: 'bad-token-zzzzzz' }), 401);
  expectErr(await B.post('/api/auth/google', { credential: 'wrong-aud-token-xx' }), 401);
  const g = expectOk(await B.post('/api/auth/google', { credential: 'good-token-seller-b' }));
  assert.equal(g.user.email, 'seller.b@gmail.com');
  assert.equal(g.user.isDemo, false);
  assert.equal(g.shop, null);
  expectErr(await B.get('/api/shop'), 409, 'NO_SHOP');
  expectErr(await B.get('/api/dashboard'), 409, 'NO_SHOP');
  expectErr(await B.post('/api/shop', { name: '' }), 400);
  const shopB = expectOk(await B.post('/api/shop', { name: 'ร้านบีขายดี' })).shop;
  assert.equal(shopB.name, 'ร้านบีขายดี');
  expectErr(await B.post('/api/shop', { name: 'ร้านที่สอง' }), 409);
  // login ซ้ำได้ร้านเดิม
  const g2 = expectOk(await agent('10.0.0.2').post('/api/auth/google', { credential: 'good-token-seller-b' }));
  assert.equal(g2.shop.id, shopB.id);

  // ข้อมูลร้าน A ต้องมองไม่เห็นจาก B
  const pid = S.soap.id;
  expectErr(await B.get(`/api/products/${pid}`), 404);
  expectErr(await B.put(`/api/products/${pid}`, { name: 'x', baseUnitCode: 'X', baseUnitName: 'x', barcodes: [{ barcode: '', unitCode: 'X', priceSatang: '1' }] }), 404);
  expectErr(await B.delete(`/api/products/${pid}`), 404);
  expectErr(await B.post(`/api/products/${pid}/stock`, { type: 'RECEIVE', qtyBase: 1 }), 404);
  expectErr(await B.get(`/api/products/${pid}/movements`), 404);
  expectErr(await B.get(`/api/products/lookup?barcode=${S.soap.pk4}`), 404);
  expectErr(await B.get(`/api/orders/${S.o2.id}`), 404);
  expectErr(await B.post(`/api/orders/${S.o2.id}/pay`, {}), 404);
  expectErr(await B.post(`/api/orders/${S.o2.id}/cancel`, { reason: 'x' }), 404);
  expectErr(await B.get(`/api/orders/${S.o2.id}/promptpay`), 404);
  expectErr(await B.put(`/api/customers/${S.o1.customerId}`, { name: 'x' }), 404);
  expectErr(await B.delete(`/api/customers/${S.o1.customerId}`), 404);
  assert.equal(expectOk(await B.get('/api/products')).products.length, 0);
  assert.equal(expectOk(await B.get('/api/orders')).orders.length, 0);
  assert.equal(expectOk(await B.get('/api/customers')).customers.length, 0);
  // B ขายของที่ใช้บาร์โค้ดของ A ไม่ได้
  expectErr(await B.post('/api/orders', { customerName: 'x', payMethod: 'CASH', items: [{ barcode: S.soap.pk4, qty: 1 }] }), 400);
  // B ใช้บาร์โค้ดเดียวกับร้าน A ได้ (ไม่ซ้ำข้ามร้าน) ; ร้านยังไม่ตั้งพร้อมเพย์ → 409
  const pb = expectOk(await B.post('/api/products', { name: 'ของร้านบี', baseUnitCode: 'PCS', baseUnitName: 'ชิ้น', openingStock: 5, barcodes: [{ barcode: S.soap.pk4, unitCode: 'PCS', priceSatang: '5000' }] })).product;
  const ob = expectOk(await B.post('/api/orders', { customerName: 'ลูกค้าบี', payMethod: 'TRANSFER', items: [{ barcode: pb.barcodes[0].barcode, qty: 1 }] })).order;
  assert.match(ob.billNo, /-0001$/);
  expectErr(await B.get(`/api/orders/${ob.id}/promptpay`), 409);
  // ตั้งค่าร้าน (validate)
  expectErr(await B.put('/api/shop', { name: 'ร้านบีขายดี', promptpayId: '12345' }), 400);
  expectErr(await B.put('/api/shop', { name: 'ร้านบีขายดี', bankCode: 'XXX' }), 400);
  expectErr(await B.put('/api/shop', { name: 'ร้านบีขายดี', vatRateBp: 10001 }), 400);
  const upd = expectOk(await B.put('/api/shop', { name: 'ร้านบีขายดี', phone: '021234567', promptpayId: '0899999999', bankCode: 'SCB', bankAccountNo: '1112223334', bankAccountName: 'นายบี', vatRateBp: 700, ...shipAddr })).shop;
  assert.equal(upd.vatRateBp, 700);
  assert.equal(upd.subdistrictName, 'จอมพล');
  assert.equal(upd.lat, 13.803742);
  // VAT 7% ของร้าน ณ เวลาออกบิล
  const ov = expectOk(await B.post('/api/orders', { customerName: 'ลูกค้า VAT', payMethod: 'CASH', paid: true, shippingSatang: '15', items: [{ barcode: pb.barcodes[0].barcode, qty: 1, priceSatang: '135' }] })).order;
  assert.equal(ov.vatRateBp, 700);
  assert.equal(ov.vatSatang, '11'); // 150 * 7% = 10.5 → 11
  assert.equal(ov.totalSatang, '161');
  expectOk(await B.get(`/api/orders/${ob.id}/promptpay`));
  S.B = B;
});

test('dashboard ตัวเลขตรงกับออเดอร์ที่มี', { skip }, async () => {
  const d = expectOk(await S.A.get('/api/dashboard'));
  const { orders } = expectOk(await S.A.get('/api/orders?limit=100'));
  const active = orders.filter((o) => o.status === 'ACTIVE');
  const sum = (list, f) => list.reduce((acc, o) => acc + BigInt(o[f]), 0n).toString();
  const todayTh = thaiDate(new Date().toISOString());
  const today = active.filter((o) => thaiDate(o.createdAt) === todayTh);
  const transfer = active.filter((o) => o.payMethod === 'TRANSFER' && o.payStatus === 'UNPAID');
  const cod = active.filter((o) => o.payMethod === 'COD' && o.payStatus === 'UNPAID');
  assert.deepEqual(d.today, { orderCount: today.length, salesSatang: sum(today, 'totalSatang'), profitSatang: sum(today, 'profitSatang') });
  assert.ok(d.today.orderCount >= 2);
  assert.deepEqual(d.awaitingTransfer, { count: transfer.length, amountSatang: sum(transfer, 'totalSatang') });
  assert.deepEqual(d.awaitingCod, { count: cod.length, amountSatang: sum(cod, 'totalSatang') });
  assert.equal(d.toShip.count, active.filter((o) => ['PENDING', 'PACKED'].includes(o.shipStatus)).length);
  assert.equal(d.recentOrders.length, 8);
  assert.deepEqual(d.recentOrders.map((o) => o.id), orders.slice(0, 8).map((o) => o.id));
  const { products } = expectOk(await S.A.get('/api/products?lowStock=1'));
  assert.deepEqual(d.lowStock.map((p) => p.id).sort(), products.map((p) => p.id).sort());
  for (const p of d.lowStock) assert.deepEqual(Object.keys(p).sort(), ['baseUnitName', 'code', 'id', 'minStockBase', 'name', 'stockBase']);
});

test('map + customers + warehouses CRUD', { skip }, async () => {
  const A = S.A;
  const m = expectOk(await A.get('/api/map'));
  assert.equal(m.shop.name, S.shopA.name);
  assert.equal(typeof m.shop.lat, 'number');
  assert.equal(m.customers.length, 7);
  assert.ok(m.customers.every((c) => typeof c.lat === 'number'));
  assert.equal(m.warehouses.length, 2);
  assert.ok(m.deliveries.length >= 1);
  const { orders } = expectOk(await A.get('/api/orders?limit=100'));
  const expected = orders.filter((o) => o.status === 'ACTIVE' && o.shipStatus !== 'DELIVERED' && o.ship.lat !== null).map((o) => o.id).sort();
  assert.deepEqual(m.deliveries.map((x) => x.id).sort(), expected);
  for (const x of m.deliveries) {
    assert.equal(typeof x.totalSatang, 'string');
    assert.ok(x.addressText.length > 0);
  }

  const c = expectOk(await A.post('/api/customers', { name: 'ลูกค้าใหม่', phone: '0800000000', note: 'VIP', ...shipAddr })).customer;
  assert.equal(c.lat, 13.803742);
  expectErr(await A.post('/api/customers', { name: '', phone: '1' }), 400);
  expectErr(await A.post('/api/customers', { name: 'x', zipCode: '123' }), 400);
  expectErr(await A.post('/api/customers', { name: 'x', lat: 200 }), 400);
  const cu = expectOk(await A.put(`/api/customers/${c.id}`, { name: 'ลูกค้าใหม่ (แก้)', phone: '0800000001', lat: null, lng: null })).customer;
  assert.equal(cu.name, 'ลูกค้าใหม่ (แก้)');
  assert.equal(cu.lat, null);
  expectOk(await A.delete(`/api/customers/${c.id}`));
  expectErr(await A.delete(`/api/customers/${c.id}`), 404);

  const wh = expectOk(await A.get('/api/warehouses')).warehouses;
  assert.equal(wh.length, 2);
  const w = expectOk(await A.post('/api/warehouses', { name: 'โกดังใหม่', phone: '', ...shipAddr })).warehouse;
  assert.equal(expectOk(await A.put(`/api/warehouses/${w.id}`, { name: 'โกดังใหม่ 2' })).warehouse.name, 'โกดังใหม่ 2');
  expectErr(await S.B.delete(`/api/warehouses/${w.id}`), 404);
  expectErr(await S.B.put(`/api/warehouses/${w.id}`, { name: 'hack' }), 404);
  expectOk(await A.delete(`/api/warehouses/${w.id}`));
  assert.equal(expectOk(await A.get('/api/warehouses')).warehouses.length, 2);
});

test('master endpoints (ไม่ต้อง login, cache 1 วัน)', { skip }, async () => {
  const a = agent();
  const banks = await a.get('/api/master/banks');
  expectOk(banks);
  assert.equal(banks.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(banks.json.banks.length, 21);
  assert.ok(['PROMPTPAY', 'TRUEMONEY', 'KBANK'].every((c) => banks.json.banks.some((b) => b.code === c)));
  for (const b of banks.json.banks) {
    assert.deepEqual(Object.keys(b).sort(), ['botCode', 'code', 'color', 'logo', 'nameEn', 'nameTh', 'shortNameTh']);
    assert.equal(b.logo, `/banks/${b.code.toLowerCase()}.webp`);
  }
  const prov = expectOk(await a.get('/api/master/provinces')).provinces;
  assert.equal(prov.length, 77);
  assert.deepEqual(Object.keys(prov[0]).sort(), ['code', 'en', 'lat', 'lng', 'th']);
  assert.equal(typeof prov[0].lat, 'number');
  const g = expectOk(await a.get('/api/master/geography?province=10')).province;
  assert.equal(g.th, 'กรุงเทพมหานคร');
  const chatuchak = g.districts.find((d) => d.code === '1030');
  assert.ok(chatuchak.subdistricts.some((s) => s.th === 'จอมพล' && s.zipCode === '10900' && typeof s.lat === 'number'));
  expectErr(await a.get('/api/master/geography?province=99'), 404);
  const byZip = expectOk(await a.get('/api/master/address-search?q=10900')).results;
  assert.ok(byZip.length >= 1 && byZip.length <= 20);
  assert.ok(byZip.every((r) => r.zipCode === '10900'));
  assert.deepEqual(Object.keys(byZip[0]).sort(), ['districtCode', 'districtTh', 'lat', 'lng', 'provinceCode', 'provinceTh', 'subdistrictCode', 'subdistrictTh', 'zipCode']);
  const byName = expectOk(await a.get('/api/master/address-search?q=' + encodeURIComponent('จอมพล'))).results;
  assert.ok(byName.some((r) => r.subdistrictTh === 'จอมพล'));
  expectErr(await a.get('/api/master/address-search?q=a'), 400);
});

test('AI: parse-order กรองบาร์โค้ด, chat, โควตา DEMO 20/วัน', { skip }, async () => {
  const A = S.A;
  const r = expectOk(await A.post('/api/ai/parse-order', { text: 'สั่งเซรั่ม 2 ขวด ส่งคุณทดสอบ 081-111-2222 เก็บปลายทาง' }));
  const sent = mockSeen.chat[0];
  assert.equal(sent.auth, 'Bearer test-key');
  assert.equal(sent.body.model, 'test-model');
  assert.equal(sent.body.stream, false);
  assert.equal(sent.body.format, 'json');
  assert.match(sent.body.messages[0].content, /เซรั่มวิตามินซี/);
  assert.equal(r.draft.items.length, 1, 'บาร์โค้ดที่ไม่มีจริงต้องถูกกรองออก');
  assert.ok(r.draft.items[0].productName);
  assert.equal(r.draft.items[0].qty, 2);
  assert.equal(r.draft.shippingSatang, '4000');
  assert.equal(r.draft.channel, 'LINE');
  assert.equal(r.draft.payMethod, 'COD');
  assert.equal(r.draft.customerPhone, '0811112222');
  assert.equal(r.draft.zipCode, '10900');
  expectErr(await A.post('/api/ai/parse-order', { text: '' }), 400);
  expectErr(await A.post('/api/ai/parse-order', { text: 'x'.repeat(3001) }), 400);

  const c = expectOk(await A.post('/api/ai/chat', { message: 'วันนี้ขายได้เท่าไหร่', history: [{ role: 'user', content: 'สวัสดี' }, { role: 'assistant', content: 'สวัสดีค่ะ' }] }));
  assert.equal(c.reply, 'สวัสดีค่ะ ยอดวันนี้ดีมาก');
  const chatReq = mockSeen.chat[1].body;
  assert.equal(chatReq.format, undefined);
  assert.equal(chatReq.messages.length, 4);
  assert.match(chatReq.messages[0].content, /รอโอน/);
  expectErr(await A.post('/api/ai/chat', { message: 'x', history: Array(11).fill({ role: 'user', content: 'a' }) }), 400);
  expectErr(await A.post('/api/ai/chat', { message: 'x', history: [{ role: 'system', content: 'a' }] }), 400);

  // ใช้ไปแล้ว 2 ครั้ง → อีก 18 ครั้งผ่าน ครั้งที่ 21 → 429
  for (let i = 0; i < 18; i++) expectOk(await A.post('/api/ai/chat', { message: `ข้อ ${i}` }));
  expectErr(await A.post('/api/ai/chat', { message: 'เกินโควตา' }), 429, 'RATE_LIMIT');
  const { rows } = await pg.query('SELECT calls FROM ai_usage u JOIN users x ON x.id = u.user_id WHERE x.id = $1', [(await pg.query('SELECT owner_user_id FROM shops WHERE id = $1', [S.shopA.id])).rows[0].owner_user_id]);
  assert.equal(rows[0].calls, 20);
});

test('upload / files: ไม่มี MinIO → 503 STORAGE_DISABLED (ถ้าตั้ง TEST_MINIO_* จะทดสอบอัปโหลดจริง)', { skip }, async () => {
  const A = S.A;
  // PNG 1x1 จริง
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  expectErr(await agent().post('/api/upload', { kind: 'product', contentType: 'image/png', dataBase64: png }), 401);
  if (!process.env.TEST_MINIO_ENDPOINT) {
    expectErr(await A.post('/api/upload', { kind: 'product', contentType: 'image/png', dataBase64: png }), 503, 'STORAGE_DISABLED');
    expectErr(await A.get(`/api/files/${S.shopA.id}/product/00000000-0000-0000-0000-000000000000.png`), 503, 'STORAGE_DISABLED');
    return;
  }
  expectErr(await A.post('/api/upload', { kind: 'product', contentType: 'image/jpeg', dataBase64: png }), 400); // magic bytes ไม่ตรง
  expectErr(await A.post('/api/upload', { kind: 'video', contentType: 'image/png', dataBase64: png }), 400);
  const up = expectOk(await A.post('/api/upload', { kind: 'slip', contentType: 'image/png', dataBase64: png }));
  assert.match(up.url, new RegExp(`^/api/files/${S.shopA.id}/slip/[0-9a-f-]{36}\\.png$`));
  const res = await fetch(baseUrl + up.url, { headers: { Cookie: A.cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString('base64'), png);
  expectErr(await S.B.get(up.url), 404);
  expectErr(await agent().get(up.url), 401);
});

test('static files: /app, MIME, กัน path traversal', { skip }, async () => {
  const appIndex = path.join(ROOT, 'public', 'app', 'index.html');
  for (const p of ['/app', '/app/']) {
    const r = await fetch(baseUrl + p);
    if (fs.existsSync(appIndex)) {
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
    } else {
      assert.equal(r.status, 404);
    }
  }
  const robots = await fetch(baseUrl + '/robots.txt');
  assert.equal(robots.status, 200);
  assert.equal(robots.headers.get('content-type'), 'text/plain; charset=utf-8');
  const logo = await fetch(baseUrl + '/banks/kbank.webp');
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/webp');
  assert.equal((await fetch(baseUrl + '/no-such-file.js')).status, 404);
  // path traversal ผ่าน raw path (fetch จะ normalize ".." ให้ จึงใช้ http.request ตรง)
  for (const raw of ['/%2e%2e/package.json', '/..%2fpackage.json', '/%2e%2e%2f.env', '/app/..%5c..%5cpackage.json']) {
    const status = await new Promise((resolve, reject) => {
      const u = new URL(baseUrl);
      http.get({ host: u.hostname, port: u.port, path: raw }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert.equal(status, 404, raw);
  }
});

test('demo หมดอายุ → 401 และ cleanup ลบข้อมูลทั้งหมด (cascade)', { skip }, async () => {
  const C = agent('10.0.0.3');
  const j = expectOk(await C.post('/api/demo/start', {}));
  await pg.query("UPDATE users SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [j.user.id]);
  expectErr(await C.get('/api/me'), 401);
  // เรียกงาน cleanup ตัวจริงกับ DB ทดสอบ
  config.databaseUrl = TEST_DB;
  const db = require('../src/db');
  const { runCleanup } = require('../src/jobs/cleanup');
  await runCleanup();
  await db.pool.end();
  const left = await pg.query(
    `SELECT (SELECT COUNT(*) FROM users WHERE id = $1)::int AS u, (SELECT COUNT(*) FROM shops WHERE id = $2)::int AS s,
            (SELECT COUNT(*) FROM bills WHERE shop_id = $2)::int AS b, (SELECT COUNT(*) FROM sessions WHERE user_id = $1)::int AS ss`,
    [j.user.id, j.shop.id]
  );
  assert.deepEqual(left.rows[0], { u: 0, s: 0, b: 0, ss: 0 });
  // ร้าน A ยังอยู่
  expectOk(await S.A.get('/api/me'));
});

test('logout → session ใช้ไม่ได้', { skip }, async () => {
  const B = S.B;
  expectOk(await B.post('/api/auth/logout', {}));
  assert.match(B.lastSetCookie, /Max-Age=0/);
  assert.equal(B.cookie, '');
  expectErr(await B.get('/api/me'), 401);
});

test('demo start เกิน 10 ครั้ง/ชม./IP → 429', { skip }, async () => {
  const D = agent('10.0.0.9');
  for (let i = 0; i < 10; i++) expectOk(await D.post('/api/demo/start', {}));
  expectErr(await D.post('/api/demo/start', {}), 429, 'RATE_LIMIT');
  // IP อื่นยังเปิดได้
  expectOk(await agent('10.0.0.10').post('/api/demo/start', {}));
});
