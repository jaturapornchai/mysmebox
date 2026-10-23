'use strict';
const db = require('../db');
const { str, int, oneOf, badRequest, conflict } = require('../http');
const svc = require('../services/orders');
const { buildPromptpayPayload, buildQrSvg } = require('../promptpay');

const STATUS_FILTERS = {
  ALL: '',
  AWAIT_PAY: "AND status = 'ACTIVE' AND pay_status = 'UNPAID'",
  TO_SHIP: "AND status = 'ACTIVE' AND ship_status IN ('PENDING', 'PACKED')",
  SHIPPED: "AND status = 'ACTIVE' AND ship_status = 'SHIPPED'",
  DONE: "AND status = 'ACTIVE' AND pay_status = 'PAID' AND ship_status = 'DELIVERED'",
  CANCELLED: "AND status = 'CANCELLED'",
};

const LIST_COLS = `${svc.BILL_COLS}, (SELECT COUNT(*) FROM bill_items i WHERE i.bill_id = bills.id) AS item_count`;

async function listOrders(shopId, query) {
  const status = oneOf(query.get('status') || 'ALL', 'สถานะ', Object.keys(STATUS_FILTERS));
  const q = str(query.get('q'), 'คำค้น', { max: 100 });
  const limit = int(query.get('limit'), 'limit', { min: 1, max: 100, fallback: 50 });
  const before = query.get('before');
  const params = [shopId];
  let where = `shop_id = $1 ${STATUS_FILTERS[status]}`;
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    where += ` AND (bill_no ILIKE $${params.length} OR customer_name ILIKE $${params.length} OR customer_phone ILIKE $${params.length} OR tracking_no ILIKE $${params.length})`;
  }
  if (before) {
    if (!/^\d{1,18}$/.test(before)) throw badRequest('before ไม่ถูกต้อง');
    params.push(before);
    where += ` AND id < $${params.length}`;
  }
  params.push(limit + 1);
  const { rows } = await db.query(`SELECT ${LIST_COLS} FROM bills WHERE ${where} ORDER BY id DESC LIMIT $${params.length}`, params);
  const page = rows.slice(0, limit);
  return { orders: page.map((r) => svc.orderJson(r)), nextBefore: rows.length > limit ? page[page.length - 1].id : null };
}

function idempotencyKey(req) {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(raw)) throw badRequest('Idempotency-Key ไม่ถูกต้อง (A-Z 0-9 _ . : - ไม่เกิน 64 ตัว)');
  return raw;
}

/** สร้างออเดอร์: ส่ง key เดิมซ้ำ → ตอบบิลเดิม (รวมกรณียิงพร้อมกันแล้วชน unique) */
async function createOrderIdempotent(ctx) {
  const key = idempotencyKey(ctx.req);
  const input = svc.parseOrderInput(ctx.body);
  if (key) {
    const existing = await svc.findBillIdByIdempotencyKey(db.pool, ctx.shopId, key);
    if (existing) return svc.getOrder(db.pool, ctx.shopId, existing);
  }
  try {
    return await db.tx(async (client) => {
      const billId = await svc.createOrder(client, { shopId: ctx.shopId, userId: ctx.user.id, input, idempotencyKey: key });
      return svc.getOrder(client, ctx.shopId, billId);
    });
  } catch (err) {
    if (key && err.code === '23505' && String(err.constraint).includes('idempotency')) {
      const existing = await svc.findBillIdByIdempotencyKey(db.pool, ctx.shopId, key);
      if (existing) return svc.getOrder(db.pool, ctx.shopId, existing);
    }
    throw err;
  }
}

async function promptpayForOrder(shopRow, shopId, billId) {
  const order = await svc.getOrder(db.pool, shopId, billId);
  if (!shopRow.promptpay_id) throw conflict('ร้านยังไม่ได้ตั้งค่าพร้อมเพย์');
  if (order.status === 'CANCELLED') throw conflict('ออเดอร์นี้ถูกยกเลิกแล้ว');
  const payload = buildPromptpayPayload(shopRow.promptpay_id, BigInt(order.totalSatang));
  return { payload, qrSvg: await buildQrSvg(payload), amountSatang: order.totalSatang, promptpayId: shopRow.promptpay_id };
}

function register(router) {
  router.get('/api/orders', async ({ shopId, query }) => listOrders(shopId, query));
  router.get('/api/orders/:id', async ({ shopId, params }) => ({ order: await svc.getOrder(db.pool, shopId, params.id) }));
  router.post('/api/orders', async (ctx) => ({ order: await createOrderIdempotent(ctx) }));

  router.post('/api/orders/:id/pay', async ({ shopId, params, body }) => {
    const input = svc.parsePayInput(body);
    return { order: await db.tx((client) => svc.payOrder(client, shopId, params.id, input)) };
  });

  router.post('/api/orders/:id/ship', async ({ shopId, params, body }) => {
    const input = svc.parseShipInput(body);
    return { order: await db.tx((client) => svc.shipOrder(client, shopId, params.id, input)) };
  });

  router.post('/api/orders/:id/cancel', async ({ shopId, user, params, body }) => {
    const reason = str(body.reason, 'เหตุผลการยกเลิก', { max: 500 });
    return { order: await db.tx((client) => svc.cancelOrder(client, shopId, user.id, params.id, { reason })) };
  });

  router.get('/api/orders/:id/promptpay', async ({ shopRow, shopId, params }) => promptpayForOrder(shopRow, shopId, params.id));
}

module.exports = { register, LIST_COLS };
