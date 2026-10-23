'use strict';
// AI Co-Pilot ผ่าน Ollama Cloud: ดูดออเดอร์จากแชท + แชทถามเรื่องร้าน (มีโควตาต่อวัน)
const db = require('../db');
const config = require('../config');
const { str, ApiError, badRequest } = require('../http');
const { bahtTextToSatang } = require('../money');
const { CHANNELS, COURIERS, PAY_METHODS } = require('../services/orders');
const { buildDashboard } = require('./dashboard');

const DAILY_QUOTA = { real: 200, demo: 20 };
const MAX_PROMPT_ITEMS = 300;

function ensureAiEnabled() {
  if (!config.ollama.apiKey) throw new ApiError(503, 'AI_DISABLED', 'ยังไม่ได้เปิดใช้ผู้ช่วย AI');
}

/** นับโควตาแบบ atomic (upsert calls+1 เฉพาะเมื่อยังไม่เต็ม) — เต็มแล้ว → 429 */
async function takeQuota(user) {
  const limit = user.is_demo ? DAILY_QUOTA.demo : DAILY_QUOTA.real;
  const { rowCount } = await db.query(
    `INSERT INTO ai_usage (user_id, usage_date, calls) VALUES ($1, (NOW() AT TIME ZONE 'Asia/Bangkok')::date, 1)
     ON CONFLICT (user_id, usage_date) DO UPDATE SET calls = ai_usage.calls + 1 WHERE ai_usage.calls < $2`,
    [user.id, limit]
  );
  if (!rowCount) throw new ApiError(429, 'RATE_LIMIT', `ใช้ผู้ช่วย AI ครบ ${limit} ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้`);
}

async function callOllama(messages, { json }) {
  const body = { model: config.ollama.model, stream: false, messages };
  if (json) body.format = 'json';
  let resp;
  try {
    resp = await fetch(config.ollama.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ollama.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    console.error('[ai] ollama request failed:', err.message);
    throw new ApiError(503, 'AI_UNAVAILABLE', 'ผู้ช่วย AI ไม่ตอบสนอง กรุณาลองใหม่อีกครั้ง');
  }
  if (!resp.ok) {
    console.error('[ai] ollama status', resp.status);
    throw new ApiError(503, 'AI_UNAVAILABLE', 'ผู้ช่วย AI ไม่ตอบสนอง กรุณาลองใหม่อีกครั้ง');
  }
  const data = await resp.json().catch(() => null);
  return String(data?.message?.content || '');
}

/** รายการบาร์โค้ด+สินค้า+ราคา ของร้าน (ใช้ทั้งใส่ prompt และกรองผล AI) */
async function shopCatalog(shopId) {
  const { rows } = await db.query(
    `SELECT b.barcode, b.unit_code, b.price_satang, p.name, p.stock_base, p.base_unit_name, p.unit_conversions_json
       FROM barcodes b JOIN products p ON p.id = b.product_id
      WHERE b.shop_id = $1 AND p.is_active ORDER BY p.id, b.id LIMIT ${MAX_PROMPT_ITEMS}`,
    [shopId]
  );
  return rows.map((r) => {
    const unit = (r.unit_conversions_json || []).find((u) => u.unitCode === r.unit_code);
    const price = BigInt(r.price_satang);
    return {
      barcode: r.barcode, productName: r.name, unitName: unit ? unit.unitName : r.unit_code,
      priceText: `${price / 100n}.${String(price % 100n).padStart(2, '0')}`, stockText: `${r.stock_base} ${r.base_unit_name}`,
    };
  });
}

const catalogText = (catalog) => catalog.map((c) => `- บาร์โค้ด:${c.barcode} | ${c.productName} | หน่วย:${c.unitName} | ราคา:${c.priceText} บาท`).join('\n');

function parseOrderPrompt(catalog) {
  return `คุณคือ AI ผู้ช่วยดูดออเดอร์จากแชทลูกค้าสำหรับแม่ค้าออนไลน์ (MySMEBox)
รายการสินค้าในร้าน (เลือกได้เฉพาะบาร์โค้ดในรายการนี้):
${catalogText(catalog)}

อ่านข้อความแชทลูกค้าแล้วตอบเป็น JSON เท่านั้น (ห้ามมีข้อความอื่น) ตามโครงสร้างนี้:
{
  "customerName": "ชื่อลูกค้า",
  "customerPhone": "เบอร์โทร ตัวเลขล้วน",
  "addressText": "ที่อยู่จัดส่งเต็ม",
  "zipCode": "รหัสไปรษณีย์ 5 หลัก",
  "channel": "${CHANNELS.join('" | "')}",
  "courier": "${COURIERS.join('" | "')}",
  "payMethod": "TRANSFER (โอน) | COD (เก็บเงินปลายทาง) | CASH",
  "shippingBaht": "ค่าส่งเป็นบาท เช่น \\"40\\" หรือ \\"0\\"",
  "items": [ { "barcode": "บาร์โค้ดของหน่วยที่ลูกค้าสั่ง", "qty": 1 } ],
  "note": "หมายเหตุสั้นๆ"
}
ถ้าไม่แน่ใจช่องไหนให้เว้นว่าง ("") ห้ามเดาบาร์โค้ดที่ไม่มีในรายการ`;
}

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

/** ตรวจผล AI ทีละช่อง: enum ต้องอยู่ในรายการ, items เหลือเฉพาะบาร์โค้ดที่มีจริง, เงินแปลงจากข้อความแบบไม่ใช้ float */
function sanitizeDraft(raw, catalog) {
  const byBarcode = new Map(catalog.map((c) => [c.barcode, c]));
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((it) => ({ c: byBarcode.get(clean(it?.barcode, 32)), qty: Number.parseInt(it?.qty, 10) }))
    .filter((x) => x.c)
    .slice(0, 100)
    .map((x) => ({ barcode: x.c.barcode, productName: x.c.productName, unitName: x.c.unitName, qty: x.qty >= 1 && x.qty <= 100000 ? x.qty : 1 }));
  const zip = clean(raw.zipCode, 5);
  const shipping = bahtTextToSatang(raw.shippingBaht ?? raw.shippingSatang ?? '0');
  return {
    customerName: clean(raw.customerName, 160),
    customerPhone: clean(raw.customerPhone, 32).replace(/[^\d+]/g, ''),
    addressText: clean(raw.addressText, 500),
    zipCode: /^\d{5}$/.test(zip) ? zip : '',
    channel: pick(raw.channel, CHANNELS, 'OTHER'),
    courier: pick(raw.courier, COURIERS, 'NONE'),
    payMethod: pick(raw.payMethod, PAY_METHODS, 'TRANSFER'),
    shippingSatang: (shipping ?? 0n).toString(),
    items,
    note: clean(raw.note, 1000),
  };
}

async function parseOrder(ctx) {
  ensureAiEnabled();
  const text = str(ctx.body.text, 'ข้อความ', { min: 1, max: 3000 });
  await takeQuota(ctx.user);
  const catalog = await shopCatalog(ctx.shopId);
  const content = await callOllama([{ role: 'system', content: parseOrderPrompt(catalog) }, { role: 'user', content: text }], { json: true });
  let raw;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new ApiError(503, 'AI_UNAVAILABLE', 'AI อ่านออเดอร์ไม่สำเร็จ กรุณาลองใหม่หรือกรอกเอง');
  }
  return { draft: sanitizeDraft(raw && typeof raw === 'object' ? raw : {}, catalog) };
}

const fmtBaht = (satang) => {
  const s = BigInt(satang);
  return `${(s / 100n).toLocaleString('en-US')}.${String(s % 100n).padStart(2, '0')} บาท`;
};

async function chatSystemPrompt(shopRow, shopId) {
  const [d, catalog] = await Promise.all([buildDashboard(shopId), shopCatalog(shopId)]);
  const low = d.lowStock.map((p) => `${p.name} (เหลือ ${p.stockBase} ${p.baseUnitName}, จุดสั่งซื้อ ${p.minStockBase})`).join(', ') || 'ไม่มี';
  return `คุณคือ "ผู้ช่วย AI ประจำตัวแม่ค้าออนไลน์" ของร้าน ${shopRow.name} (MySMEBox)
ข้อมูลจริงของร้านตอนนี้:
- วันนี้: ${d.today.orderCount} ออเดอร์ ยอดขาย ${fmtBaht(d.today.salesSatang)} กำไร ${fmtBaht(d.today.profitSatang)}
- รอโอน: ${d.awaitingTransfer.count} บิล รวม ${fmtBaht(d.awaitingTransfer.amountSatang)}
- COD รอเก็บเงิน: ${d.awaitingCod.count} บิล รวม ${fmtBaht(d.awaitingCod.amountSatang)}
- รอแพ็ก/ส่ง: ${d.toShip.count} บิล
- สินค้าใกล้หมด: ${low}
- รายการสินค้า:
${catalog.slice(0, 100).map((c) => `- ${c.productName} | หน่วย:${c.unitName} | ราคา:${c.priceText} บาท | คงเหลือ:${c.stockText}`).join('\n')}

ตอบเป็นภาษาไทยที่กระชับ เข้าใจง่าย ใช้งานได้จริงทันที ห้ามแต่งตัวเลขที่ไม่มีในข้อมูลข้างบน`;
}

function parseHistory(history) {
  if (history === undefined || history === null) return [];
  if (!Array.isArray(history) || history.length > 10) throw badRequest('ประวัติแชทต้องเป็นรายการไม่เกิน 10 ข้อความ');
  return history.map((h) => {
    if (!h || !['user', 'assistant'].includes(h.role)) throw badRequest('ประวัติแชทไม่ถูกต้อง');
    return { role: h.role, content: str(h.content, 'ข้อความในประวัติแชท', { max: 3000 }) };
  });
}

async function chat(ctx) {
  ensureAiEnabled();
  const message = str(ctx.body.message, 'ข้อความ', { min: 1, max: 3000 });
  const history = parseHistory(ctx.body.history);
  await takeQuota(ctx.user);
  const system = await chatSystemPrompt(ctx.shopRow, ctx.shopId);
  const reply = await callOllama([{ role: 'system', content: system }, ...history, { role: 'user', content: message }], { json: false });
  return { reply: reply.trim() || 'ขออภัย AI ยังตอบไม่ได้ในตอนนี้ ลองถามใหม่อีกครั้ง' };
}

function register(router) {
  router.post('/api/ai/parse-order', parseOrder);
  router.post('/api/ai/chat', chat);
}

module.exports = { register, sanitizeDraft };
