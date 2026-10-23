'use strict';
const db = require('../db');
const { str, int, oneOf, badRequest, notFound } = require('../http');
const svc = require('../services/products');

async function listProducts(shopId, query) {
  const q = str(query.get('q'), 'คำค้น', { max: 100 });
  const params = [shopId];
  let where = 'p.shop_id = $1 AND p.is_active';
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    where += ` AND (p.name ILIKE $2 OR p.code ILIKE $2 OR EXISTS (SELECT 1 FROM barcodes b WHERE b.product_id = p.id AND b.barcode ILIKE $2))`;
  }
  if (query.get('lowStock') === '1') where += ' AND p.stock_base <= p.min_stock_base';
  const cols = svc.PRODUCT_COLS.split(', ').map((c) => 'p.' + c).join(', ');
  const { rows } = await db.query(`SELECT ${cols} FROM products p WHERE ${where} ORDER BY p.id DESC LIMIT 500`, params);
  return svc.attachBarcodes(db.pool, rows);
}

async function lookupBarcode(shopId, barcode) {
  const code = str(barcode, 'บาร์โค้ด', { min: 1, max: 32 });
  const { rows } = await db.query(
    'SELECT b.product_id FROM barcodes b JOIN products p ON p.id = b.product_id WHERE b.shop_id = $1 AND b.barcode = $2 AND p.is_active',
    [shopId, code]
  );
  if (!rows.length) throw notFound('ไม่พบสินค้าที่ใช้บาร์โค้ดนี้');
  const product = await svc.getProduct(db.pool, shopId, rows[0].product_id);
  return { product, barcode: product.barcodes.find((b) => b.barcode === code) };
}

async function listMovements(shopId, productId) {
  const exists = await db.query('SELECT 1 FROM products WHERE shop_id = $1 AND id = $2', [shopId, productId]);
  if (!exists.rowCount) throw notFound('ไม่พบสินค้า');
  const { rows } = await db.query(
    `SELECT m.id, m.qty_base_delta, m.balance_after, m.reason, m.note, m.created_at, b.bill_no
       FROM stock_movements m LEFT JOIN bills b ON b.id = m.ref_bill_id
      WHERE m.shop_id = $1 AND m.product_id = $2 ORDER BY m.id DESC LIMIT 50`,
    [shopId, productId]
  );
  return rows.map((m) => ({
    id: m.id,
    qtyBaseDelta: Number(m.qty_base_delta),
    balanceAfter: Number(m.balance_after),
    reason: m.reason,
    refBillNo: m.bill_no || '',
    note: m.note,
    createdAt: m.created_at.toISOString(),
  }));
}

function register(router) {
  router.get('/api/products', async ({ shopId, query }) => ({ products: await listProducts(shopId, query) }));

  router.get('/api/products/lookup', async ({ shopId, query }) => lookupBarcode(shopId, query.get('barcode')));

  router.get('/api/products/next-barcode', async ({ shopId, query }) => {
    const prefix = str(query.get('prefix') || '200', 'prefix', { max: 3, pattern: /^\d{3}$/, patternMsg: 'prefix ต้องเป็นตัวเลข 3 หลัก' });
    return { barcode: await svc.generateUniqueBarcode(db.pool, shopId, prefix) };
  });

  router.get('/api/products/:id', async ({ shopId, params }) => ({ product: await svc.getProduct(db.pool, shopId, params.id) }));

  router.post('/api/products', async ({ shopId, user, body }) => {
    const input = svc.parseProductInput(body, { withOpening: true });
    const product = await db.tx(async (client) => {
      const id = await svc.createProduct(client, shopId, user.id, input);
      return svc.getProduct(client, shopId, id);
    });
    return { product };
  });

  router.put('/api/products/:id', async ({ shopId, params, body }) => {
    const input = svc.parseProductInput(body, { withOpening: false });
    const product = await db.tx(async (client) => {
      await svc.updateProduct(client, shopId, params.id, input);
      return svc.getProduct(client, shopId, params.id);
    });
    return { product };
  });

  router.delete('/api/products/:id', async ({ shopId, params }) => {
    const r = await db.query('UPDATE products SET is_active = FALSE, updated_at = NOW() WHERE shop_id = $1 AND id = $2', [shopId, params.id]);
    if (!r.rowCount) throw notFound('ไม่พบสินค้า');
    return {};
  });

  router.post('/api/products/:id/stock', async ({ shopId, user, params, body }) => {
    const type = oneOf(body.type, 'ประเภทการปรับสต๊อก', ['RECEIVE', 'ADJUST']);
    const qtyBase = int(body.qtyBase, 'จำนวน', { min: type === 'RECEIVE' ? 1 : -1e9, max: 1e9 });
    if (qtyBase === 0) throw badRequest('จำนวนที่ปรับต้องไม่เป็น 0');
    const note = str(body.note, 'หมายเหตุ', { max: 500 });
    const product = await db.tx(async (client) => {
      await svc.adjustStock(client, shopId, user.id, params.id, { type, qtyBase, note });
      return svc.getProduct(client, shopId, params.id);
    });
    return { product };
  });

  router.get('/api/products/:id/movements', async ({ shopId, params }) => ({ movements: await listMovements(shopId, params.id) }));
}

module.exports = { register };
