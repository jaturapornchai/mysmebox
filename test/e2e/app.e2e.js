// E2E ทดสอบหน้าเว็บ MySMEBox v1 ด้วย Playwright (มือถือ 390×844 และจอใหญ่ 1440×900)
// รัน: node test/e2e/app.e2e.js   (ต้องเปิด server: SERVE_STATIC=1 node src/server.js ที่ http://127.0.0.1:3850)
// ตัวแปร: BASE_URL, SCREEN_DIR, PW_PATH (ที่อยู่โมดูล playwright)
const path = require('path');
const fs = require('fs');

const { chromium } = require(process.env.PW_PATH || 'D:/bccode/frontend/node_modules/playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3850';
const SHOTS = process.env.SCREEN_DIR || path.join(__dirname, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
];

const results = [];
function record(vp, step, ok, info = '') {
  results.push({ vp, step, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${vp}] ${step}${info ? ' — ' + info : ''}`);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function step(vp, name, fn) {
  try { const info = await fn(); record(vp, name, true, info || ''); return true; } catch (e) { record(vp, name, false, e.message.split('\n')[0]); return false; }
}

async function apiJson(page, method, url, body, headers = {}) {
  const r = await page.request.fetch(BASE + url, { method, data: body, headers: { 'Content-Type': 'application/json', ...headers } });
  const j = await r.json();
  return { status: r.status(), json: j };
}

async function shot(page, vp, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, `${vp}-${name}.png`), fullPage: false });
}

async function modalPrimary(page, text) {
  const btn = page.locator('.modal-actions button', { hasText: text });
  await btn.click();
}

async function runViewport(browser, cfg) {
  const vp = cfg.name;
  const ctx = await browser.newContext({ viewport: cfg.viewport, isMobile: !!cfg.isMobile, hasTouch: !!cfg.hasTouch, locale: 'th-TH', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const networkErrors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // โหลด tile แผนที่จากภายนอกไม่สำเร็จไม่นับเป็นบั๊กของแอป แต่บันทึกไว้
    if (/Failed to load resource/.test(t)) networkErrors.push(t); else consoleErrors.push(t);
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('tile.openstreetmap')) networkErrors.push(`${r.status()} ${r.url()}`); });

  const ctxData = {};

  await step(vp, 'หน้าแรก: h1 เดียว + JSON-LD 6 ชนิด', async () => {
    await page.goto(BASE + '/');
    assert((await page.locator('h1').count()) === 1, 'h1 ต้องมี 1');
    const types = await page.evaluate(() => JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph'].map((x) => x['@type']));
    for (const t of ['Organization', 'WebSite', 'SoftwareApplication', 'HowTo', 'FAQPage', 'BreadcrumbList']) assert(types.includes(t), 'ขาด ' + t);
    await shot(page, vp, 'landing');
    return types.join(',');
  });

  await step(vp, 'ทดลองใช้ฟรี → หน้าหลักมีตัวเลข', async () => {
    await page.locator('[data-demo]').first().click();
    await page.waitForURL(/\/app\/?/);
    await page.locator('.stat').first().waitFor();
    const v = await page.locator('.stat .stat-value').first().textContent();
    assert(/฿[\d,]+\.\d{2}/.test(v), 'ยอดขายไม่ใช่รูปแบบเงิน: ' + v);
    assert(await page.locator('.demo-bar').isVisible(), 'ไม่มีแถบร้านทดลอง');
    await page.locator('.order-card').first().waitFor();
    await shot(page, vp, 'home');
    return 'ยอดขายวันนี้ ' + v;
  });

  await step(vp, 'เพิ่มสินค้าใหม่ 2 หน่วย + บาร์โค้ด', async () => {
    await page.goto(BASE + '/app/#/products/new');
    await page.locator('[data-f="name"]').fill(`สบู่ทดสอบ ${vp}`);
    await page.locator('[data-f="unitName"]').fill('ขวด');
    await page.locator('[data-f="cost"]').fill('50');
    await page.locator('[data-f="opening"]').fill('20');
    await page.locator('[data-f="minStock"]').fill('3');
    await page.locator('[data-add-unit]').click();
    await page.locator('.unit-row [data-e="unitName"]').fill('แพ็ค 3 ขวด');
    await page.locator('.unit-row [data-e="stand"]').fill('3');
    const groups = page.locator('.bc-group');
    await groups.nth(0).locator('[data-r="price"]').fill('100');
    await groups.nth(0).locator('[data-gen]').click();
    await page.waitForFunction(() => document.querySelectorAll('.bc-group')[0].querySelector('[data-r="barcode"]').value.length === 13);
    await groups.nth(1).locator('[data-r="price"]').fill('280');
    await groups.nth(1).locator('[data-gen]').click();
    await page.waitForFunction(() => document.querySelectorAll('.bc-group')[1].querySelector('[data-r="barcode"]').value.length === 13);
    ctxData.bcBase = await groups.nth(0).locator('[data-r="barcode"]').inputValue();
    ctxData.bcPack = await groups.nth(1).locator('[data-r="barcode"]').inputValue();
    assert(ctxData.bcBase !== ctxData.bcPack, 'บาร์โค้ดซ้ำกัน');
    const profit = await groups.nth(1).locator('[data-profit]').textContent();
    assert(profit.includes('฿130.00'), 'กำไรแพ็คควรเป็น ฿130.00: ' + profit);
    await shot(page, vp, 'product-form');
    await page.locator('[data-save]').click();
    await page.waitForURL(/#\/products\/\d+$/);
    ctxData.productId = page.url().match(/products\/(\d+)/)[1];
    await page.locator('[data-stock]').waitFor();
    const stock = await page.locator('[data-stock]').textContent();
    assert(stock.trim() === '20', 'สต๊อกควรเป็น 20: ' + stock);
    const p = await apiJson(page, 'GET', `/api/products/${ctxData.productId}`);
    const units = p.json.product.units.map((u) => `${u.unitCode}:${u.standValue}`).join(',');
    assert(units.includes('BTL:1') && units.includes('PK3:3'), 'หน่วยผิด ' + units);
    await page.locator('.move').first().waitFor();
    await shot(page, vp, 'product');
    return `id=${ctxData.productId} units=${units} bc=${ctxData.bcBase},${ctxData.bcPack}`;
  });

  await step(vp, 'เปิดออเดอร์: ยิงบาร์โค้ด + ที่อยู่ จังหวัด/อำเภอ/ตำบล → บันทึก ยอดถูก', async () => {
    await page.goto(BASE + '/app/#/orders/new');
    const find = page.locator('[data-find]');
    await find.fill(ctxData.bcPack);
    await find.press('Enter');
    await page.locator('.cart-line').first().waitFor();
    await find.fill(ctxData.bcBase);
    await find.press('Enter');
    await page.locator('.cart-line').nth(1).waitFor();
    await page.locator('.cart-line').nth(1).locator('[data-inc]').click();
    await page.locator('[data-cname]').fill('คุณทดสอบ อีทูอี');
    await page.locator('[data-cphone]').fill('0811111111');
    await page.locator('[data-addr] textarea').fill('99/1 ถ.นิมมานเหมินท์');
    const prov = page.locator('[data-addr] [data-k="prov"]');
    await page.waitForFunction(() => document.querySelector('[data-addr] [data-k="prov"]').options.length > 10);
    await prov.selectOption('50');
    await page.waitForFunction(() => document.querySelector('[data-addr] [data-k="dist"]').options.length > 2);
    const distVal = await page.locator('[data-addr] [data-k="dist"] option').nth(1).getAttribute('value');
    await page.locator('[data-addr] [data-k="dist"]').selectOption(distVal);
    const subVal = await page.locator('[data-addr] [data-k="sub"] option').nth(1).getAttribute('value');
    await page.locator('[data-addr] [data-k="sub"]').selectOption(subVal);
    const zip = await page.locator('[data-addr] [data-k="zip"]').inputValue();
    assert(/^\d{5}$/.test(zip), 'รหัสไปรษณีย์ไม่ถูกเติม: ' + zip);
    const coord = await page.locator('[data-addr] [data-k="coord"]').textContent();
    assert(/\d+\.\d+, \d+\.\d+/.test(coord), 'ไม่มีพิกัด: ' + coord);
    await page.locator('[data-shipping]').fill('40');
    await page.locator('[data-discount]').fill('20');
    const total = await page.locator('[data-total]').textContent();
    assert(total === '฿500.00', 'ยอดรวมหน้าจอควร ฿500.00: ' + total);
    await shot(page, vp, 'order-new');
    await page.locator('[data-summary]').scrollIntoViewIfNeeded();
    await shot(page, vp, 'order-new-summary');
    await page.locator('[data-submit]').click();
    await page.waitForURL(/#\/orders\/\d+$/);
    ctxData.orderId = page.url().match(/orders\/(\d+)/)[1];
    await page.locator('.bill-no').waitFor();
    const o = (await apiJson(page, 'GET', `/api/orders/${ctxData.orderId}`)).json.order;
    assert(o.totalSatang === '50000', 'server total ' + o.totalSatang);
    assert(o.profitSatang === '21000', 'server profit ' + o.profitSatang);
    assert(o.ship.zip === zip, 'zip ใน order ' + o.ship.zip);
    const p = (await apiJson(page, 'GET', `/api/products/${ctxData.productId}`)).json.product;
    assert(p.stockBase === 15, 'สต๊อกหลังขายควร 15: ' + p.stockBase);
    await shot(page, vp, 'order-detail');
    return `${o.billNo} total=${o.totalSatang} profit=${o.profitSatang} stock=${p.stockBase} zip=${zip}`;
  });

  await step(vp, 'QR พร้อมเพย์ modal', async () => {
    await page.locator('[data-act="qr"]').click();
    await page.locator('.qr-img').waitFor();
    await page.waitForFunction(() => { const i = document.querySelector('.qr-img'); return i && i.complete && i.naturalWidth > 0; });
    const amt = await page.locator('.qr-amount').textContent();
    assert(amt === '฿500.00', 'ยอด QR ' + amt);
    await shot(page, vp, 'qr');
    await page.locator('.modal-actions button', { hasText: 'คัดลอก' }).click();
    await page.locator('.modal [data-close]').click();
    return amt;
  });

  await step(vp, 'รับเงิน → แพ็ค → ส่ง (เลขพัสดุ)', async () => {
    await page.locator('[data-act="pay"]').click();
    await modalPrimary(page, 'รับเงินแล้ว');
    await page.locator('[data-act="packed"]').waitFor();
    await page.locator('[data-act="packed"]').click();
    await page.locator('.badge', { hasText: 'แพ็คแล้ว' }).waitFor();
    await page.locator('[data-act="shipped"]').click();
    await page.locator('.modal [data-t]').fill('TH1234567890');
    await modalPrimary(page, 'ส่งแล้ว');
    await page.locator('[data-act="delivered"]').waitFor();
    const o = (await apiJson(page, 'GET', `/api/orders/${ctxData.orderId}`)).json.order;
    assert(o.payStatus === 'PAID' && o.shipStatus === 'SHIPPED' && o.trackingNo === 'TH1234567890', JSON.stringify([o.payStatus, o.shipStatus, o.trackingNo]));
    return `${o.payStatus}/${o.shipStatus}/${o.trackingNo}`;
  });

  await step(vp, 'ใบปะหน้าเปิดได้', async () => {
    const [pop] = await Promise.all([page.waitForEvent('popup'), page.locator('[data-act="label"]').click()]);
    await pop.locator('.sheet').waitFor();
    const txt = await pop.locator('.sheet').textContent();
    assert(txt.includes('คุณทดสอบ อีทูอี') && txt.includes('TH1234567890'), 'ใบปะหน้าไม่มีข้อมูลผู้รับ/เลขพัสดุ');
    await pop.screenshot({ path: path.join(SHOTS, `${vp}-label.png`) });
    await pop.close();
    return 'ok';
  });

  await step(vp, 'ยกเลิกอีกบิล → สต๊อกคืน (+ กันบิลซ้ำด้วย Idempotency-Key)', async () => {
    const key = 'e2e-' + Date.now() + '-' + vp;
    const body = { customerId: null, saveCustomer: false, customerName: 'ลูกค้ายกเลิก', customerPhone: '', ship: {}, channel: 'LINE', courier: 'NONE', payMethod: 'CASH', paid: false, discountSatang: '0', shippingSatang: '0', note: '', items: [{ barcode: ctxData.bcBase, qty: 2 }] };
    const a = await apiJson(page, 'POST', '/api/orders', body, { 'Idempotency-Key': key });
    const b = await apiJson(page, 'POST', '/api/orders', body, { 'Idempotency-Key': key });
    assert(a.status === 200 && b.status === 200 && a.json.order.id === b.json.order.id, `idempotency ${a.status}/${b.status}`);
    let p = (await apiJson(page, 'GET', `/api/products/${ctxData.productId}`)).json.product;
    assert(p.stockBase === 13, 'สต๊อกหลังบิลที่ 2 ควร 13: ' + p.stockBase);
    await page.goto(BASE + `/app/#/orders/${a.json.order.id}`);
    await page.locator('[data-act="cancel"]').click();
    await page.locator('.modal [data-in]').fill('ลูกค้าเปลี่ยนใจ');
    await modalPrimary(page, 'ยกเลิกออเดอร์');
    await page.locator('.alert-red').waitFor();
    p = (await apiJson(page, 'GET', `/api/products/${ctxData.productId}`)).json.product;
    assert(p.stockBase === 15, 'สต๊อกหลังยกเลิกควร 15: ' + p.stockBase);
    return `bill ${a.json.order.billNo} cancelled, stock=${p.stockBase}`;
  });

  await step(vp, 'รายการออเดอร์ + แท็บกรอง', async () => {
    await page.goto(BASE + '/app/#/orders?status=SHIPPED');
    await page.locator('.order-card').first().waitFor();
    const on = await page.locator('.tab.is-on').textContent();
    assert(on === 'ส่งแล้ว', 'แท็บ ' + on);
    await shot(page, vp, 'orders');
    return on;
  });

  await step(vp, 'แผนที่มีหมุด + เพิ่มลูกค้า', async () => {
    await page.goto(BASE + '/app/#/map');
    await page.locator('.leaflet-marker-icon').first().waitFor({ timeout: 15000 });
    const pins = await page.locator('.leaflet-marker-icon').count();
    assert(pins > 0, 'ไม่มีหมุด');
    await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile-loaded').length >= 6, null, { timeout: 15000 }).catch(() => {});
    await shot(page, vp, 'map');
    await page.locator('[data-add="customer"]').click();
    const form = page.locator('[data-form-card]');
    await form.locator('input[name="name"]').fill('ลูกค้าแผนที่ E2E');
    await form.locator('input[name="phone"]').fill('0822222222');
    await form.locator('[data-k="q"]').fill('จอมพล');
    await form.locator('.ap-item').first().click();
    await page.waitForFunction(() => /\d/.test(document.querySelector('[data-form-card] [data-k="coord"]').textContent));
    await page.locator('#map').scrollIntoViewIfNeeded();
    await page.locator('#map').click({ position: { x: 120, y: 120 } });
    await form.locator('[data-save]').click();
    await page.locator('[data-list] .list-row', { hasText: 'ลูกค้าแผนที่ E2E' }).waitFor();
    const r = (await apiJson(page, 'GET', '/api/customers?q=' + encodeURIComponent('ลูกค้าแผนที่'))).json.customers[0];
    assert(r && r.lat != null && r.subdistrictName === 'จอมพล', 'ลูกค้าใหม่ไม่มีพิกัด/ตำบล');
    return `pins=${pins} new customer lat=${r.lat}`;
  });

  await step(vp, 'สินค้า: รับของเข้า (หน่วยแพ็ค) + ปรับยอด + ประวัติ', async () => {
    await page.goto(BASE + `/app/#/products/${ctxData.productId}`);
    await page.locator('[data-receive]').click();
    await page.locator('.modal [data-q]').fill('1');
    await page.locator('.modal [data-u]').selectOption('PK3');
    await modalPrimary(page, 'รับเข้าสต๊อก');
    await page.waitForFunction(() => document.querySelector('[data-stock]') && document.querySelector('[data-stock]').textContent.trim() === '18');
    await page.locator('[data-adjust]').click();
    await page.locator('.modal [data-q]').fill('17');
    await page.locator('.modal [data-n]').fill('ของเสีย 1 ขวด');
    await modalPrimary(page, 'ปรับยอด');
    await page.waitForFunction(() => document.querySelector('[data-stock]') && document.querySelector('[data-stock]').textContent.trim() === '17');
    const mv = (await apiJson(page, 'GET', `/api/products/${ctxData.productId}/movements`)).json.movements.map((m) => `${m.reason}${m.qtyBaseDelta}`);
    assert(mv[0] === 'ADJUST-1' && mv[1] === 'RECEIVE3', 'movements ' + mv.join(','));
    return mv.join(',');
  });

  await step(vp, 'ให้ AI กรอกออเดอร์จากแชท', async () => {
    await page.goto(BASE + '/app/#/orders/new');
    await page.locator('.ai-paste summary').click();
    await page.locator('[data-chat]').fill(`สวัสดีค่ะ ขอสั่ง สบู่ทดสอบ ${vp} 2 ขวด ค่ะ ชื่อ มาลี ใจดี 0891234567 ส่งที่ 12/3 ถ.ห้วยแก้ว ต.สุเทพ อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50200 เก็บเงินปลายทางนะคะ`);
    await page.locator('.ai-paste [data-ai]').click();
    await page.locator('.toast', { hasText: /AI กรอกให้แล้ว|ยังไม่เปิดใช้งาน|AI/ }).first().waitFor({ timeout: 60000 });
    const name = await page.locator('[data-cname]').inputValue();
    const lines = await page.locator('.cart-line').count();
    const pay = await page.locator('[data-pay] .seg-btn.is-on').textContent();
    assert(name.includes('มาลี'), 'ชื่อไม่ถูกเติม: ' + name);
    return `name=${name} cartLines=${lines} pay=${pay}`;
  });

  await step(vp, 'ตั้งค่า: บันทึกพร้อมเพย์/ธนาคาร', async () => {
    await page.goto(BASE + '/app/#/settings');
    await page.locator('input[name="promptpayId"]').fill('0899999999');
    await page.locator('.bank-btn').click();
    await page.locator('.bank-item[data-code="SCB"]').click();
    await page.locator('input[name="bankAccountNo"]').fill('1112223334');
    await shot(page, vp, 'settings');
    await page.locator('[data-save]').click();
    await page.locator('.toast', { hasText: 'บันทึกการตั้งค่าแล้ว' }).waitFor();
    const s = (await apiJson(page, 'GET', '/api/shop')).json.shop;
    assert(s.promptpayId === '0899999999' && s.bankCode === 'SCB' && s.bankAccountNo === '1112223334', JSON.stringify([s.promptpayId, s.bankCode, s.bankAccountNo]));
    return `${s.promptpayId} ${s.bankCode}`;
  });

  await step(vp, 'ผู้ช่วย AI drawer เปิดได้', async () => {
    await page.goto(BASE + '/app/#/');
    await page.locator('[data-ai]').first().click();
    await page.locator('.ai-form textarea').fill('วันนี้ขายได้เท่าไร');
    await page.locator('.ai-form button').click();
    await page.waitForFunction(() => { const m = [...document.querySelectorAll('.ai-msg.ai-assistant')]; return m.length >= 2 && !m[m.length - 1].classList.contains('is-wait'); }, null, { timeout: 60000 });
    const last = await page.locator('.ai-msg.ai-assistant').last().textContent();
    await shot(page, vp, 'ai');
    await page.locator('.ai-head [data-close]').click();
    return last.slice(0, 60);
  });

  await step(vp, 'ออกจากระบบ → หน้าเข้าสู่ระบบ (ปุ่ม Google ปิดเมื่อไม่ตั้งค่า)', async () => {
    await page.goto(BASE + '/app/#/settings');
    await page.locator('[data-logout]').click();
    await page.locator('.auth-card [data-demo]').waitFor();
    const g = await page.locator('[data-google]').textContent();
    await shot(page, vp, 'login');
    const me = await page.request.get(BASE + '/api/me');
    assert(me.status() === 401, '/api/me หลังออกจากระบบควร 401: ' + me.status());
    return g.replace(/\s+/g, ' ').trim().slice(0, 80);
  });

  await step(vp, 'console ไม่มี error', async () => {
    assert(consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    return networkErrors.length ? `network 4xx/5xx ที่คาดไว้/ภายนอก: ${networkErrors.slice(0, 4).join(' | ')}` : 'ไม่มี';
  });

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    const only = process.env.VP;
    for (const cfg of VIEWPORTS) if (!only || only === cfg.name) await runViewport(browser, cfg);
  } finally {
    await browser.close();
  }
  const fail = results.filter((r) => !r.ok);
  console.log(`\nสรุป: ผ่าน ${results.length - fail.length}/${results.length}`);
  process.exit(fail.length ? 1 : 0);
})();
