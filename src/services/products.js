'use strict';
// สินค้า + หน่วยนับ + บาร์โค้ด (AGENTS.md §2) — ใช้ทั้ง routes/products และ seed
const crypto = require('node:crypto');
const db = require('../db');
const { str, int, badRequest, conflict, notFound, imageUrl } = require('../http');
const { parseSatang } = require('../money');

const UNIT_RE = /^[A-Z0-9_-]{1,20}$/;
const BARCODE_RE = /^[0-9A-Za-z-]{4,32}$/;

const PRODUCT_COLS = 'id, shop_id, code, name, base_unit_code, base_unit_name, cost_base_satang, stock_base, min_stock_base, unit_conversions_json, image_url, is_active, created_at, updated_at';

// ---------- EAN-13 ----------
function ean13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

function randomEan13(prefix) {
  const digits = Array.from(crypto.randomBytes(12 - prefix.length), (b) => b % 10).join('');
  const first12 = prefix + digits;
  return first12 + ean13CheckDigit(first12);
}

/** บาร์โค้ด EAN-13 สุ่มที่ยังไม่ซ้ำในร้าน (และไม่ซ้ำกับที่จองไว้ใน reserved) */
async function generateUniqueBarcode(client, shopId, prefix = '200', reserved = new Set()) {
  for (let i = 0; i < 30; i++) {
    const code = randomEan13(prefix);
    if (reserved.has(code)) continue;
    const { rowCount } = await client.query('SELECT 1 FROM barcodes WHERE shop_id = $1 AND barcode = $2', [shopId, code]);
    if (!rowCount) return code;
  }
  throw conflict('สร้างบาร์โค้ดไม่สำเร็จ กรุณาลองใหม่');
}

// ---------- JSON ----------
function unitsWithStock(row, barcodes) {
  const stock = BigInt(row.stock_base);
  return (row.unit_conversions_json || []).map((u) => ({
    unitCode: u.unitCode,
    unitName: u.unitName,
    standValue: u.standValue,
    divideValue: u.divideValue,
    ratio: u.standValue / u.divideValue,
    // จำนวนที่ขายได้ในหน่วยนี้ = floor(stock * divide / stand)
    availableQty: stock > 0n ? Number((stock * BigInt(u.divideValue)) / BigInt(u.standValue)) : 0,
    matchedBarcodes: barcodes.filter((b) => b.unit_code === u.unitCode).map((b) => b.barcode),
  }));
}

const barcodeJson = (b) => ({
  id: b.id,
  barcode: b.barcode,
  unitCode: b.unit_code,
  priceSatang: b.price_satang,
  priceMemberSatang: b.price_member_satang,
  priceWholesaleSatang: b.price_wholesale_satang,
});

function productJson(row, barcodes = []) {
  const stockBase = Number(row.stock_base);
  const minStockBase = Number(row.min_stock_base);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    baseUnitCode: row.base_unit_code,
    baseUnitName: row.base_unit_name,
    costBaseSatang: row.cost_base_satang,
    stockBase,
    minStockBase,
    isLowStock: stockBase <= minStockBase,
    imageUrl: row.image_url,
    isActive: row.is_active,
    units: unitsWithStock(row, barcodes),
    barcodes: barcodes.map(barcodeJson),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** แนบบาร์โค้ดให้หลายสินค้าในคิวรีเดียว (กัน N+1) */
async function attachBarcodes(client, rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const { rows: bcs } = await client.query(
    'SELECT id, product_id, barcode, unit_code, price_satang, price_member_satang, price_wholesale_satang FROM barcodes WHERE product_id = ANY($1::bigint[]) ORDER BY id',
    [ids]
  );
  return rows.map((r) => productJson(r, bcs.filter((b) => b.product_id === r.id)));
}

async function getProduct(client, shopId, productId) {
  const { rows } = await client.query(`SELECT ${PRODUCT_COLS} FROM products WHERE shop_id = $1 AND id = $2`, [shopId, productId]);
  if (!rows.length) throw notFound('ไม่พบสินค้า');
  return (await attachBarcodes(client, rows))[0];
}

// ---------- input ----------
const unitCode = (v, label) => str(typeof v === 'string' ? v.toUpperCase() : v, label, { min: 1, max: 20, pattern: UNIT_RE, patternMsg: `${label} ใช้ได้เฉพาะ A-Z 0-9 _ - ไม่เกิน 20 ตัว` });

function parseUnits(input, baseUnitCode, baseUnitName) {
  if (input !== undefined && !Array.isArray(input)) throw badRequest('รายการหน่วยนับไม่ถูกต้อง');
  const units = [{ unitCode: baseUnitCode, unitName: baseUnitName, standValue: 1, divideValue: 1 }];
  for (const u of (input || []).slice(0, 21)) {
    const code = unitCode(u?.unitCode, 'รหัสหน่วยนับ');
    const standValue = int(u.standValue, 'ตัวตั้งของหน่วยนับ', { min: 1, max: 100000 });
    const divideValue = int(u.divideValue, 'ตัวหารของหน่วยนับ', { min: 1, max: 100000, fallback: 1 });
    if (code === baseUnitCode) {
      // หน่วยฐานเติมให้อัตโนมัติ — ถ้าส่งมาต้องเป็น 1/1
      if (standValue !== 1 || divideValue !== 1) throw badRequest('หน่วยฐานต้องมีอัตราส่วน 1');
      continue;
    }
    if (units.some((x) => x.unitCode === code)) throw badRequest(`รหัสหน่วยนับ ${code} ซ้ำ`);
    units.push({ unitCode: code, unitName: str(u.unitName, 'ชื่อหน่วยนับ', { min: 1, max: 40 }), standValue, divideValue });
  }
  if (units.length > 20) throw badRequest('หน่วยนับได้ไม่เกิน 20 หน่วย');
  return units;
}

function parseBarcodes(input, units) {
  if (!Array.isArray(input) || input.length < 1) throw badRequest('ต้องมีบาร์โค้ดอย่างน้อย 1 รายการ');
  if (input.length > 50) throw badRequest('บาร์โค้ดได้ไม่เกิน 50 รายการ');
  const seen = new Set();
  return input.map((b) => {
    const barcode = str(b?.barcode, 'บาร์โค้ด', { max: 32, pattern: BARCODE_RE, patternMsg: 'บาร์โค้ดใช้ได้เฉพาะตัวเลข/ตัวอักษรอังกฤษ/ขีด 4-32 ตัว' });
    if (barcode && seen.has(barcode)) throw conflict(`บาร์โค้ด ${barcode} ซ้ำกัน`);
    if (barcode) seen.add(barcode);
    const code = unitCode(b.unitCode, 'หน่วยนับของบาร์โค้ด');
    if (!units.some((u) => u.unitCode === code)) throw badRequest(`บาร์โค้ดอ้างหน่วยนับ ${code} ที่ไม่มีในสินค้า`);
    return {
      barcode,
      unitCode: code,
      priceSatang: parseSatang(b.priceSatang, 'ราคาขาย'),
      priceMemberSatang: parseSatang(b.priceMemberSatang, 'ราคาสมาชิก', { fallback: 0 }),
      priceWholesaleSatang: parseSatang(b.priceWholesaleSatang, 'ราคาส่ง', { fallback: 0 }),
    };
  });
}

function parseProductInput(b, { withOpening }) {
  const baseUnitCode = unitCode(b.baseUnitCode, 'รหัสหน่วยฐาน');
  const baseUnitName = str(b.baseUnitName, 'ชื่อหน่วยฐาน', { min: 1, max: 40 });
  const units = parseUnits(b.units, baseUnitCode, baseUnitName);
  return {
    code: str(b.code, 'รหัสสินค้า', { max: 40, pattern: /^[A-Za-z0-9_.-]*$/, patternMsg: 'รหัสสินค้าใช้ได้เฉพาะ A-Z 0-9 _ . -' }),
    name: str(b.name, 'ชื่อสินค้า', { min: 1, max: 200 }),
    baseUnitCode,
    baseUnitName,
    costBaseSatang: parseSatang(b.costBaseSatang, 'ต้นทุนต่อหน่วยฐาน', { fallback: 0 }),
    minStockBase: int(b.minStockBase, 'จุดสั่งซื้อขั้นต่ำ', { min: 0, max: 1e9, fallback: 0 }),
    openingStock: withOpening ? int(b.openingStock, 'สต๊อกตั้งต้น', { min: 0, max: 1e9, fallback: 0 }) : 0,
    imageUrl: imageUrl(b.imageUrl, 'รูปสินค้า'),
    units,
    barcodes: parseBarcodes(b.barcodes, units),
  };
}

// ---------- write ----------
async function nextProductCode(client, shopId) {
  const { rows } = await client.query(
    "SELECT COALESCE(MAX(substring(code from 2)::bigint), 0) + 1 AS n FROM products WHERE shop_id = $1 AND code ~ '^P[0-9]{1,15}$'",
    [shopId]
  );
  return 'P' + String(rows[0].n).padStart(4, '0');
}

/** ตรวจบาร์โค้ดซ้ำกับสินค้าอื่นในร้าน + เติมบาร์โค้ดที่เว้นว่าง แล้ว insert ทั้งชุด */
async function replaceBarcodes(client, shopId, productId, barcodes) {
  const given = barcodes.map((b) => b.barcode).filter(Boolean);
  if (given.length) {
    const dup = await client.query(
      'SELECT barcode FROM barcodes WHERE shop_id = $1 AND barcode = ANY($2::text[]) AND product_id <> $3 LIMIT 1',
      [shopId, given, productId]
    );
    if (dup.rowCount) throw conflict(`บาร์โค้ด ${dup.rows[0].barcode} ถูกใช้กับสินค้าอื่นแล้ว`);
  }
  await client.query('DELETE FROM barcodes WHERE product_id = $1 AND shop_id = $2', [productId, shopId]);
  const reserved = new Set(given);
  for (const b of barcodes) {
    if (!b.barcode) {
      b.barcode = await generateUniqueBarcode(client, shopId, '200', reserved);
      reserved.add(b.barcode);
    }
  }
  await client.query(
    `INSERT INTO barcodes (shop_id, product_id, barcode, unit_code, price_satang, price_member_satang, price_wholesale_satang)
     SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::bigint[], $6::bigint[], $7::bigint[])`,
    [shopId, productId, barcodes.map((b) => b.barcode), barcodes.map((b) => b.unitCode),
      barcodes.map((b) => b.priceSatang.toString()), barcodes.map((b) => b.priceMemberSatang.toString()), barcodes.map((b) => b.priceWholesaleSatang.toString())]
  );
}

/** บันทึกความเคลื่อนไหวสต๊อก (append-only) */
async function insertMovement(client, m) {
  await client.query(
    `INSERT INTO stock_movements (shop_id, product_id, qty_base_delta, balance_after, reason, ref_bill_id, note, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, NOW()))`,
    [m.shopId, m.productId, m.delta.toString(), m.balanceAfter.toString(), m.reason, m.billId || null, m.note || '', m.userId || null, m.at || null]
  );
}

function mapUniqueViolation(err) {
  if (err && err.code === '23505') {
    if (String(err.constraint).includes('code')) return conflict('รหัสสินค้านี้มีอยู่แล้ว');
    if (String(err.constraint).includes('barcode')) return conflict('บาร์โค้ดนี้ถูกใช้แล้ว');
  }
  return err;
}

async function createProduct(client, shopId, userId, input) {
  const code = input.code || (await nextProductCode(client, shopId));
  let row;
  try {
    await client.query('SAVEPOINT create_product');
    ({ rows: [row] } = await client.query(
      `INSERT INTO products (shop_id, code, name, base_unit_code, base_unit_name, cost_base_satang, stock_base, min_stock_base, unit_conversions_json, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10) RETURNING id`,
      [shopId, code, input.name, input.baseUnitCode, input.baseUnitName, input.costBaseSatang.toString(), input.openingStock, input.minStockBase, JSON.stringify(input.units), input.imageUrl]
    ));
    await replaceBarcodes(client, shopId, row.id, input.barcodes);
    await client.query('RELEASE SAVEPOINT create_product');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT create_product').catch(() => {});
    throw mapUniqueViolation(err);
  }
  if (input.openingStock > 0) {
    await insertMovement(client, { shopId, productId: row.id, delta: BigInt(input.openingStock), balanceAfter: BigInt(input.openingStock), reason: 'OPENING', note: 'สต๊อกตั้งต้น', userId });
  }
  return row.id;
}

async function updateProduct(client, shopId, productId, input) {
  const lock = await client.query('SELECT code FROM products WHERE shop_id = $1 AND id = $2 FOR UPDATE', [shopId, productId]);
  if (!lock.rowCount) throw notFound('ไม่พบสินค้า');
  const code = input.code || lock.rows[0].code;
  try {
    await client.query('SAVEPOINT update_product');
    await client.query(
      `UPDATE products SET code = $3, name = $4, base_unit_code = $5, base_unit_name = $6, cost_base_satang = $7,
              min_stock_base = $8, unit_conversions_json = $9::jsonb, image_url = $10, updated_at = NOW()
        WHERE shop_id = $1 AND id = $2`,
      [shopId, productId, code, input.name, input.baseUnitCode, input.baseUnitName, input.costBaseSatang.toString(), input.minStockBase, JSON.stringify(input.units), input.imageUrl]
    );
    await replaceBarcodes(client, shopId, productId, input.barcodes);
    await client.query('RELEASE SAVEPOINT update_product');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT update_product').catch(() => {});
    throw mapUniqueViolation(err);
  }
}

/** รับเข้า (RECEIVE > 0) หรือปรับยอด (ADJUST ≠ 0) — สต๊อกติดลบไม่ได้ */
async function adjustStock(client, shopId, userId, productId, { type, qtyBase, note }) {
  const { rows } = await client.query('SELECT stock_base FROM products WHERE shop_id = $1 AND id = $2 FOR UPDATE', [shopId, productId]);
  if (!rows.length) throw notFound('ไม่พบสินค้า');
  const delta = BigInt(qtyBase);
  const balance = BigInt(rows[0].stock_base) + delta;
  if (balance < 0n) throw conflict(`สต๊อกคงเหลือไม่พอ (เหลือ ${rows[0].stock_base})`);
  await client.query('UPDATE products SET stock_base = $3, updated_at = NOW() WHERE shop_id = $1 AND id = $2', [shopId, productId, balance.toString()]);
  await insertMovement(client, { shopId, productId, delta, balanceAfter: balance, reason: type, note, userId });
}

module.exports = {
  PRODUCT_COLS, BARCODE_RE, ean13CheckDigit, randomEan13, generateUniqueBarcode, productJson, attachBarcodes, getProduct,
  parseProductInput, createProduct, updateProduct, adjustStock, insertMovement, barcodeJson,
};
