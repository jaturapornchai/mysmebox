'use strict';
// à¸­à¸­à¹€à¸”à¸­à¸£à¹Œ (à¸šà¸´à¸¥à¸‚à¸²à¸¢): à¸ªà¸£à¹‰à¸²à¸‡ / à¸£à¸±à¸šà¹€à¸‡à¸´à¸™ / à¸ªà¹ˆà¸‡à¸‚à¸­à¸‡ / à¸¢à¸à¹€à¸¥à¸´à¸ â€” à¹ƒà¸Šà¹‰à¸—à¸±à¹‰à¸‡ routes/orders à¹à¸¥à¸° seed/demo
const { str, int, oneOf, bool, optionalId, imageUrl, badRequest, conflict, notFound } = require('../http');
const { parseSatang, calcQtyBase, calcOrderTotals } = require('../money');
const { parseAddress, numOrNull } = require('../address');
const { isBankCode } = require('../master');
const { insertMovement } = require('./products');

const CHANNELS = ['FACEBOOK', 'LINE', 'TIKTOK', 'SHOPEE', 'LAZADA', 'STORE', 'OTHER'];
const COURIERS = ['FLASH', 'KERRY', 'JT', 'THAIPOST', 'SPX', 'LALAMOVE', 'PICKUP', 'NONE'];
const PAY_METHODS = ['TRANSFER', 'COD', 'CASH'];
const SHIP_STATUSES = ['PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED'];

const BILL_COLS = `id, bill_no, customer_id, customer_name, customer_phone, ship_address_line, ship_province, ship_district, ship_subdistrict,
  ship_zip, ship_lat, ship_lng, channel, courier, tracking_no, items_total_satang, discount_satang, shipping_satang, vat_rate_bp,
  vat_satang, total_satang, cost_satang, pay_method, pay_status, paid_at, pay_bank_code, slip_url, ship_status, status, cancel_reason,
  note, created_at`;

// ---------- JSON ----------
function orderJson(r, items) {
  const order = {
    id: r.id,
    billNo: r.bill_no,
    customerId: r.customer_id || null,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    ship: {
      addressLine: r.ship_address_line, province: r.ship_province, district: r.ship_district, subdistrict: r.ship_subdistrict,
      zip: r.ship_zip, lat: numOrNull(r.ship_lat), lng: numOrNull(r.ship_lng),
    },
    channel: r.channel,
    courier: r.courier,
    trackingNo: r.tracking_no,
    itemsTotalSatang: r.items_total_satang,
    discountSatang: r.discount_satang,
    shippingSatang: r.shipping_satang,
    vatRateBp: r.vat_rate_bp,
    vatSatang: r.vat_satang,
    totalSatang: r.total_satang,
    costSatang: r.cost_satang,
    profitSatang: (BigInt(r.items_total_satang) - BigInt(r.discount_satang) - BigInt(r.cost_satang)).toString(),
    payMethod: r.pay_method,
    payStatus: r.pay_status,
    paidAt: r.paid_at ? r.paid_at.toISOString() : null,
    payBankCode: r.pay_bank_code,
    slipUrl: r.slip_url,
    shipStatus: r.ship_status,
    status: r.status,
    cancelReason: r.cancel_reason,
    note: r.note,
  };
  if (items) {
    order.items = items.map((i) => ({
      productId: i.product_id || null, productName: i.product_name, barcode: i.barcode, unitCode: i.unit_code, unitName: i.unit_name,
      qty: i.qty, qtyBase: Number(i.qty_base), priceSatang: i.price_satang, lineTotalSatang: i.line_total_satang,
    }));
  } else {
    order.itemCount = Number(r.item_count || 0);
  }
  order.createdAt = r.created_at.toISOString();
  return order;
}

async function getOrder(client, shopId, billId) {
  const { rows } = await client.query(`SELECT ${BILL_COLS} FROM bills WHERE shop_id = $1 AND id = $2`, [shopId, billId]);
  if (!rows.length) throw notFound('à¹„à¸¡à¹ˆà¸žà¸šà¸­à¸­à¹€à¸”à¸­à¸£à¹Œ');
  const { rows: items } = await client.query(
    'SELECT product_id, product_name, barcode, unit_code, unit_name, qty, qty_base, price_satang, line_total_satang FROM bill_items WHERE bill_id = $1 ORDER BY id',
    [billId]
  );
  return orderJson(rows[0], items);
}

// ---------- input ----------
function parseOrderItems(items) {
  if (!Array.isArray(items) || items.length < 1) throw badRequest('à¸à¸£à¸¸à¸“à¸²à¹€à¸¥à¸·à¸­à¸à¸ªà¸´à¸™à¸„à¹‰à¸²à¸­à¸¢à¹ˆà¸²à¸‡à¸™à¹‰à¸­à¸¢ 1 à¸£à¸²à¸¢à¸à¸²à¸£');
  if (items.length > 100) throw badRequest('à¸ªà¸´à¸™à¸„à¹‰à¸²à¹ƒà¸™à¸šà¸´à¸¥à¹„à¸”à¹‰à¹„à¸¡à¹ˆà¹€à¸à¸´à¸™ 100 à¸£à¸²à¸¢à¸à¸²à¸£');
  return items.map((it) => ({
    barcode: str(it?.barcode, 'à¸šà¸²à¸£à¹Œà¹‚à¸„à¹‰à¸”à¸ªà¸´à¸™à¸„à¹‰à¸²', { min: 1, max: 32 }),
    qty: int(it.qty, 'à¸ˆà¸³à¸™à¸§à¸™à¸ªà¸´à¸™à¸„à¹‰à¸²', { min: 1, max: 100000 }),
    priceSatang: it.priceSatang === undefined || it.priceSatang === null || it.priceSatang === '' ? null : parseSatang(it.priceSatang, 'à¸£à¸²à¸„à¸²à¸‚à¸²à¸¢'),
  }));
}

function parseOrderInput(b) {
  const payBankCode = str(b.payBankCode, 'à¸˜à¸™à¸²à¸„à¸²à¸£à¸—à¸µà¹ˆà¸£à¸±à¸šà¹€à¸‡à¸´à¸™', { max: 16 });
  if (payBankCode && !isBankCode(payBankCode)) throw badRequest('à¸˜à¸™à¸²à¸„à¸²à¸£à¸—à¸µà¹ˆà¸£à¸±à¸šà¹€à¸‡à¸´à¸™à¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¹‰à¸­à¸‡');
  const customerId = optionalId(b.customerId, 'à¸¥à¸¹à¸à¸„à¹‰à¸²');
  return {
    customerId,
    saveCustomer: bool(b.saveCustomer),
    customerName: str(b.customerName, 'à¸Šà¸·à¹ˆà¸­à¸¥à¸¹à¸à¸„à¹‰à¸²', { min: customerId ? 0 : 1, max: 160 }),
    customerPhone: str(b.customerPhone, 'à¹€à¸šà¸­à¸£à¹Œà¹‚à¸—à¸£à¸¥à¸¹à¸à¸„à¹‰à¸²', { max: 32 }),
    ship: parseAddress(b.ship || {}),
    channel: oneOf(b.channel, 'à¸Šà¹ˆà¸­à¸‡à¸—à¸²à¸‡à¸‚à¸²à¸¢', CHANNELS, 'OTHER'),
    courier: oneOf(b.courier, 'à¸‚à¸™à¸ªà¹ˆà¸‡', COURIERS, 'NONE'),
    payMethod: oneOf(b.payMethod, 'à¸§à¸´à¸˜à¸µà¸Šà¸³à¸£à¸°à¹€à¸‡à¸´à¸™', PAY_METHODS),
    paid: bool(b.paid),
    payBankCode,
    slipUrl: imageUrl(b.slipUrl, 'à¸ªà¸¥à¸´à¸›'),
    discountSatang: parseSatang(b.discountSatang, 'à¸ªà¹ˆà¸§à¸™à¸¥à¸”', { fallback: 0 }),
    shippingSatang: parseSatang(b.shippingSatang, 'à¸„à¹ˆà¸²à¸ªà¹ˆà¸‡', { fallback: 0 }),
    note: str(b.note, 'à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸', { max: 1000 }),
    items: parseOrderItems(b.items),
  };
}

// ---------- create ----------
const byNumericId = (a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

/** lock à¸ªà¸´à¸™à¸„à¹‰à¸²à¸—à¸µà¹ˆà¹€à¸à¸µà¹ˆà¸¢à¸§à¸‚à¹‰à¸­à¸‡à¹€à¸£à¸µà¸¢à¸‡à¸•à¸²à¸¡ id (à¸à¸±à¸™ deadlock) â†’ Map id â†’ row */
async function lockProducts(client, shopId, productIds) {
  const ids = [...new Set(productIds)].sort(byNumericId);
  const { rows } = await client.query(
    'SELECT id, name, is_active, stock_base, cost_base_satang, base_unit_name, unit_conversions_json FROM products WHERE shop_id = $1 AND id = ANY($2::bigint[]) ORDER BY id FOR UPDATE',
    [shopId, ids]
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** à¹à¸›à¸¥à¸‡à¸£à¸²à¸¢à¸à¸²à¸£à¸‚à¸²à¹€à¸‚à¹‰à¸²à¹€à¸›à¹‡à¸™à¸šà¸£à¸£à¸—à¸±à¸”à¸šà¸´à¸¥ (snapshot à¸Šà¸·à¹ˆà¸­/à¸«à¸™à¹ˆà¸§à¸¢/à¸£à¸²à¸„à¸²) */
async function buildLines(client, shopId, items) {
  const codes = [...new Set(items.map((i) => i.barcode))];
  const { rows: bcRows } = await client.query(
    'SELECT barcode, unit_code, price_satang, product_id FROM barcodes WHERE shop_id = $1 AND barcode = ANY($2::text[])',
    [shopId, codes]
  );
  const bcMap = new Map(bcRows.map((b) => [b.barcode, b]));
  for (const c of codes) if (!bcMap.has(c)) throw badRequest(`à¹„à¸¡à¹ˆà¸žà¸šà¸ªà¸´à¸™à¸„à¹‰à¸²à¸—à¸µà¹ˆà¹ƒà¸Šà¹‰à¸šà¸²à¸£à¹Œà¹‚à¸„à¹‰à¸” ${c}`);
  const products = await lockProducts(client, shopId, bcRows.map((b) => b.product_id));
  const lines = items.map((it) => {
    const bc = bcMap.get(it.barcode);
    const p = products.get(bc.product_id);
    if (!p || !p.is_active) throw badRequest(`à¸ªà¸´à¸™à¸„à¹‰à¸²à¸šà¸²à¸£à¹Œà¹‚à¸„à¹‰à¸” ${it.barcode} à¸–à¸¹à¸à¸›à¸´à¸”à¹ƒà¸Šà¹‰à¸‡à¸²à¸™à¹à¸¥à¹‰à¸§`);
    const unit = (p.unit_conversions_json || []).find((u) => u.unitCode === bc.unit_code);
    if (!unit) throw badRequest(`à¸«à¸™à¹ˆà¸§à¸¢à¸™à¸±à¸šà¸‚à¸­à¸‡à¸šà¸²à¸£à¹Œà¹‚à¸„à¹‰à¸” ${it.barcode} à¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¹‰à¸­à¸‡`);
    return {
      product: p, barcode: it.barcode, unit, qty: it.qty,
      qtyBase: calcQtyBase(it.qty, unit.standValue, unit.divideValue, p.name),
      priceSatang: it.priceSatang ?? BigInt(bc.price_satang),
      costBaseSatang: BigInt(p.cost_base_satang),
    };
  });
  return { lines, products };
}

/** à¸£à¸§à¸¡à¸ˆà¸³à¸™à¸§à¸™à¸«à¸™à¹ˆà¸§à¸¢à¸à¸²à¸™à¸•à¹ˆà¸­à¸ªà¸´à¸™à¸„à¹‰à¸² à¹à¸¥à¹‰à¸§à¸•à¸£à¸§à¸ˆà¸ªà¸•à¹Šà¸­à¸ (à¸«à¹‰à¸²à¸¡à¸•à¸´à¸”à¸¥à¸š) */
function checkStock(lines) {
  const need = new Map();
  for (const l of lines) need.set(l.product.id, (need.get(l.product.id) || 0n) + l.qtyBase);
  for (const l of lines) {
    const stock = BigInt(l.product.stock_base);
    if (stock < need.get(l.product.id)) {
      throw conflict(`à¸ªà¸´à¸™à¸„à¹‰à¸² "${l.product.name}" à¸„à¸‡à¹€à¸«à¸¥à¸·à¸­à¹„à¸¡à¹ˆà¸žà¸­ (à¹€à¸«à¸¥à¸·à¸­ ${stock} ${l.product.base_unit_name})`, 'CONFLICT');
    }
  }
  return need;
}

async function resolveCustomer(client, shopId, input) {
  if (input.customerId) {
    const { rows } = await client.query('SELECT id, name, phone FROM customers WHERE shop_id = $1 AND id = $2', [shopId, input.customerId]);
    if (!rows.length) throw badRequest('à¹„à¸¡à¹ˆà¸žà¸šà¸¥à¸¹à¸à¸„à¹‰à¸²à¸—à¸µà¹ˆà¹€à¸¥à¸·à¸­à¸');
    return { id: rows[0].id, name: input.customerName || rows[0].name, phone: input.customerPhone || rows[0].phone };
  }
  if (!input.saveCustomer) return { id: null, name: input.customerName, phone: input.customerPhone };
  const s = input.ship;
  const { rows } = await client.query(
    `INSERT INTO customers (shop_id, name, phone, address_line, province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code, lat, lng)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [shopId, input.customerName, input.customerPhone, s.addressLine, s.provinceCode, s.provinceName, s.districtCode, s.districtName, s.subdistrictCode, s.subdistrictName, s.zipCode, s.lat, s.lng]
  );
  return { id: rows[0].id, name: input.customerName, phone: input.customerPhone };
}

/** à¹€à¸¥à¸‚à¸šà¸´à¸¥ INV-YYMM-NNNN (YYMM à¹€à¸§à¸¥à¸²à¹„à¸—à¸¢) â€” UPSERT ... RETURNING à¹ƒà¸™ transaction à¸à¸±à¸™à¹€à¸¥à¸‚à¸Šà¸™ */
async function nextBillNo(client, shopId, at) {
  const { rows } = await client.query(
    `INSERT INTO doc_sequences (shop_id, doc_type, period, last_no)
     VALUES ($1, 'INV', to_char(COALESCE($2::timestamptz, NOW()) AT TIME ZONE 'Asia/Bangkok', 'YYMM'), 1)
     ON CONFLICT (shop_id, doc_type, period) DO UPDATE SET last_no = doc_sequences.last_no + 1
     RETURNING period, last_no`,
    [shopId, at]
  );
  return `INV-${rows[0].period}-${String(rows[0].last_no).padStart(4, '0')}`;
}

async function insertBill(client, { shopId, userId, input, customer, totals, vatRateBp, billNo, idempotencyKey, at }) {
  const s = input.ship;
  const paid = input.paid && input.payMethod !== 'COD'; // COD à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸£à¸±à¸šà¹€à¸‡à¸´à¸™à¸•à¸­à¸™à¹€à¸›à¸´à¸”à¸šà¸´à¸¥
  const { rows } = await client.query(
    `INSERT INTO bills (shop_id, bill_no, customer_id, customer_name, customer_phone, ship_address_line, ship_province, ship_district,
       ship_subdistrict, ship_zip, ship_lat, ship_lng, channel, courier, items_total_satang, discount_satang, shipping_satang,
       vat_rate_bp, vat_satang, total_satang, cost_satang, pay_method, pay_status, paid_at, pay_bank_code, slip_url, note,
       idempotency_key, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::text,
       CASE WHEN $23::text = 'PAID' THEN COALESCE($29::timestamptz, NOW()) END, $24,$25,$26,$27,$28, COALESCE($29::timestamptz, NOW()), COALESCE($29::timestamptz, NOW()))
     RETURNING id`,
    [shopId, billNo, customer.id, customer.name, customer.phone, s.addressLine, s.provinceName, s.districtName, s.subdistrictName,
      s.zipCode, s.lat, s.lng, input.channel, input.courier, totals.itemsTotal.toString(), totals.discount.toString(),
      totals.shipping.toString(), vatRateBp, totals.vat.toString(), totals.total.toString(), totals.cost.toString(), input.payMethod,
      paid ? 'PAID' : 'UNPAID', input.payBankCode, input.slipUrl, input.note, idempotencyKey, userId, at]
  );
  return rows[0].id;
}

async function insertItems(client, billId, lines, totals) {
  const col = (fn) => lines.map(fn);
  await client.query(
    `INSERT INTO bill_items (bill_id, product_id, product_name, barcode, unit_code, unit_name, stand_value, divide_value, qty, qty_base, price_satang, cost_satang, line_total_satang)
     SELECT $1, * FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::int[], $9::int[], $10::bigint[], $11::bigint[], $12::bigint[], $13::bigint[])`,
    [billId, col((l) => l.product.id), col((l) => l.product.name), col((l) => l.barcode), col((l) => l.unit.unitCode), col((l) => l.unit.unitName),
      col((l) => l.unit.standValue), col((l) => l.unit.divideValue), col((l) => l.qty), col((l) => l.qtyBase.toString()),
      col((l) => l.priceSatang.toString()), totals.lines.map((t) => t.lineCost.toString()), totals.lines.map((t) => t.lineTotal.toString())]
  );
}

/** à¸•à¸±à¸”à¸ªà¸•à¹Šà¸­à¸ + movement SALE (à¹€à¸£à¸µà¸¢à¸‡à¸•à¸²à¸¡ id à¸•à¸²à¸¡à¸¥à¸³à¸”à¸±à¸š lock) */
async function deductStock(client, { shopId, userId, billId, billNo, need, products, at }) {
  for (const id of [...need.keys()].sort(byNumericId)) {
    const balance = BigInt(products.get(id).stock_base) - need.get(id);
    await client.query('UPDATE products SET stock_base = $3, updated_at = NOW() WHERE shop_id = $1 AND id = $2', [shopId, id, balance.toString()]);
    await insertMovement(client, { shopId, productId: id, delta: -need.get(id), balanceAfter: balance, reason: 'SALE', billId, note: billNo, userId, at });
  }
}

/**
 * à¸ªà¸£à¹‰à¸²à¸‡à¸­à¸­à¹€à¸”à¸­à¸£à¹Œà¹ƒà¸™ transaction à¸‚à¸­à¸‡à¸œà¸¹à¹‰à¹€à¸£à¸µà¸¢à¸ (client à¸•à¹‰à¸­à¸‡à¸­à¸¢à¸¹à¹ˆà¹ƒà¸™ BEGIN à¹à¸¥à¹‰à¸§)
 * at = à¹€à¸§à¸¥à¸²à¸šà¸´à¸¥ (à¹ƒà¸Šà¹‰à¹€à¸‰à¸žà¸²à¸° seed à¸¢à¹‰à¸­à¸™à¸«à¸¥à¸±à¸‡) ; à¸›à¸à¸•à¸´ null = NOW()
 */
async function createOrder(client, { shopId, userId, input, idempotencyKey = null, at = null }) {
  const { lines, products } = await buildLines(client, shopId, input.items);
  const need = checkStock(lines);
  const { rows: shopRows } = await client.query('SELECT vat_rate_bp FROM shops WHERE id = $1', [shopId]);
  const vatRateBp = shopRows[0].vat_rate_bp;
  const totals = calcOrderTotals({ lines, discountSatang: input.discountSatang, shippingSatang: input.shippingSatang, vatRateBp });
  const customer = await resolveCustomer(client, shopId, input);
  const billNo = await nextBillNo(client, shopId, at);
  const billId = await insertBill(client, { shopId, userId, input, customer, totals, vatRateBp, billNo, idempotencyKey, at });
  await insertItems(client, billId, lines, totals);
  await deductStock(client, { shopId, userId, billId, billNo, need, products, at });
  return billId;
}

async function findBillIdByIdempotencyKey(client, shopId, key) {
  const { rows } = await client.query('SELECT id FROM bills WHERE shop_id = $1 AND idempotency_key = $2', [shopId, key]);
  return rows[0] ? rows[0].id : null;
}

// ---------- pay / ship / cancel ----------
async function lockBill(client, shopId, billId) {
  const { rows } = await client.query('SELECT id, bill_no, status, pay_status FROM bills WHERE shop_id = $1 AND id = $2 FOR UPDATE', [shopId, billId]);
  if (!rows.length) throw notFound('à¹„à¸¡à¹ˆà¸žà¸šà¸­à¸­à¹€à¸”à¸­à¸£à¹Œ');
  return rows[0];
}

function parsePayInput(b) {
  const payBankCode = str(b.payBankCode, 'à¸˜à¸™à¸²à¸„à¸²à¸£à¸—à¸µà¹ˆà¸£à¸±à¸šà¹€à¸‡à¸´à¸™', { max: 16 });
  if (payBankCode && !isBankCode(payBankCode)) throw badRequest('à¸˜à¸™à¸²à¸„à¸²à¸£à¸—à¸µà¹ˆà¸£à¸±à¸šà¹€à¸‡à¸´à¸™à¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¹‰à¸­à¸‡');
  return { payBankCode, slipUrl: imageUrl(b.slipUrl, 'à¸ªà¸¥à¸´à¸›') };
}

/** à¸£à¸±à¸šà¹€à¸‡à¸´à¸™à¹à¸¥à¹‰à¸§: à¸–à¹‰à¸²à¸ˆà¹ˆà¸²à¸¢à¹à¸¥à¹‰à¸§à¸„à¸·à¸™à¸šà¸´à¸¥à¹€à¸”à¸´à¸¡ (à¸à¸±à¸™à¸à¸”à¸‹à¹‰à¸³) ; à¸¢à¸à¹€à¸¥à¸´à¸à¹à¸¥à¹‰à¸§ â†’ 409 */
async function payOrder(client, shopId, billId, { payBankCode, slipUrl }) {
  const bill = await lockBill(client, shopId, billId);
  if (bill.status === 'CANCELLED') throw conflict('à¸­à¸­à¹€à¸”à¸­à¸£à¹Œà¸™à¸µà¹‰à¸–à¸¹à¸à¸¢à¸à¹€à¸¥à¸´à¸à¹à¸¥à¹‰à¸§');
  if (bill.pay_status !== 'PAID') {
    await client.query(
      `UPDATE bills SET pay_status = 'PAID', paid_at = NOW(), pay_bank_code = COALESCE(NULLIF($3, ''), pay_bank_code),
              slip_url = COALESCE(NULLIF($4, ''), slip_url), updated_at = NOW() WHERE shop_id = $1 AND id = $2`,
      [shopId, billId, payBankCode, slipUrl]
    );
  }
  return getOrder(client, shopId, billId);
}

function parseShipInput(b) {
  return {
    shipStatus: oneOf(b.shipStatus, 'à¸ªà¸–à¸²à¸™à¸°à¸ˆà¸±à¸”à¸ªà¹ˆà¸‡', SHIP_STATUSES),
    courier: b.courier === undefined || b.courier === null || b.courier === '' ? null : oneOf(b.courier, 'à¸‚à¸™à¸ªà¹ˆà¸‡', COURIERS),
    trackingNo: b.trackingNo === undefined || b.trackingNo === null ? null : str(b.trackingNo, 'à¹€à¸¥à¸‚à¸žà¸±à¸ªà¸”à¸¸', { max: 40 }),
  };
}

async function shipOrder(client, shopId, billId, { shipStatus, courier, trackingNo }) {
  const bill = await lockBill(client, shopId, billId);
  if (bill.status === 'CANCELLED') throw conflict('à¸­à¸­à¹€à¸”à¸­à¸£à¹Œà¸™à¸µà¹‰à¸–à¸¹à¸à¸¢à¸à¹€à¸¥à¸´à¸à¹à¸¥à¹‰à¸§');
  await client.query(
    `UPDATE bills SET ship_status = $3, courier = COALESCE($4, courier), tracking_no = COALESCE($5, tracking_no), updated_at = NOW()
      WHERE shop_id = $1 AND id = $2`,
    [shopId, billId, shipStatus, courier, trackingNo]
  );
  return getOrder(client, shopId, billId);
}

/** à¸¢à¸à¹€à¸¥à¸´à¸ = à¸„à¸·à¸™à¸ªà¸•à¹Šà¸­à¸à¸”à¹‰à¸§à¸¢ movement CANCEL (à¹„à¸¡à¹ˆà¸¥à¸š/à¹à¸à¹‰ movement à¹€à¸”à¸´à¸¡) */
async function cancelOrder(client, shopId, userId, billId, { reason }) {
  const bill = await lockBill(client, shopId, billId);
  if (bill.status === 'CANCELLED') throw conflict('à¸­à¸­à¹€à¸”à¸­à¸£à¹Œà¸™à¸µà¹‰à¸–à¸¹à¸à¸¢à¸à¹€à¸¥à¸´à¸à¹„à¸›à¹à¸¥à¹‰à¸§');
  const { rows: items } = await client.query('SELECT product_id, qty_base FROM bill_items WHERE bill_id = $1 AND product_id IS NOT NULL', [billId]);
  const back = new Map();
  for (const it of items) back.set(it.product_id, (back.get(it.product_id) || 0n) + BigInt(it.qty_base));
  const products = await lockProducts(client, shopId, [...back.keys()]);
  for (const id of [...back.keys()].sort(byNumericId)) {
    const p = products.get(id);
    if (!p) continue;
    const balance = BigInt(p.stock_base) + back.get(id);
    await client.query('UPDATE products SET stock_base = $3, updated_at = NOW() WHERE shop_id = $1 AND id = $2', [shopId, id, balance.toString()]);
    await insertMovement(client, { shopId, productId: id, delta: back.get(id), balanceAfter: balance, reason: 'CANCEL', billId, note: `à¸¢à¸à¹€à¸¥à¸´à¸ ${bill.bill_no}`, userId });
  }
  await client.query(
    `UPDATE bills SET status = 'CANCELLED', cancelled_at = NOW(), cancel_reason = $3, updated_at = NOW() WHERE shop_id = $1 AND id = $2`,
    [shopId, billId, reason]
  );
  return getOrder(client, shopId, billId);
}

module.exports = {
  CHANNELS, COURIERS, PAY_METHODS, SHIP_STATUSES, BILL_COLS, orderJson, getOrder, parseOrderInput, createOrder,
  findBillIdByIdempotencyKey, parsePayInput, payOrder, parseShipInput, shipOrder, cancelOrder,
};
