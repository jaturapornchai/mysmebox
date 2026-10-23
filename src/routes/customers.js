'use strict';
const db = require('../db');
const { str, notFound } = require('../http');
const { parseAddress, addressValues, addressFromRow } = require('../address');

const COLS = 'id, name, phone, note, address_line, province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code, lat, lng, created_at';

const customerJson = (r) => ({ id: r.id, name: r.name, phone: r.phone, note: r.note, ...addressFromRow(r), createdAt: r.created_at.toISOString() });

function parseCustomer(b) {
  return {
    name: str(b.name, 'ชื่อลูกค้า', { min: 1, max: 160 }),
    phone: str(b.phone, 'เบอร์โทร', { max: 32 }),
    note: str(b.note, 'หมายเหตุ', { max: 1000 }),
    address: parseAddress(b),
  };
}

async function listCustomers(shopId, q) {
  const term = str(q, 'คำค้น', { max: 100 });
  const params = [shopId];
  let where = 'shop_id = $1';
  if (term) {
    params.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
    where += ' AND (name ILIKE $2 OR phone ILIKE $2)';
  }
  const { rows } = await db.query(`SELECT ${COLS} FROM customers WHERE ${where} ORDER BY id DESC LIMIT 100`, params);
  return rows.map(customerJson);
}

function register(router) {
  router.get('/api/customers', async ({ shopId, query }) => ({ customers: await listCustomers(shopId, query.get('q')) }));

  router.post('/api/customers', async ({ shopId, body }) => {
    const c = parseCustomer(body);
    const { rows } = await db.query(
      `INSERT INTO customers (shop_id, name, phone, note, address_line, province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING ${COLS}`,
      [shopId, c.name, c.phone, c.note, ...addressValues(c.address)]
    );
    return { customer: customerJson(rows[0]) };
  });

  router.put('/api/customers/:id', async ({ shopId, params, body }) => {
    const c = parseCustomer(body);
    const { rows } = await db.query(
      `UPDATE customers SET name = $3, phone = $4, note = $5, address_line = $6, province_code = $7, province_name = $8, district_code = $9,
              district_name = $10, subdistrict_code = $11, subdistrict_name = $12, zip_code = $13, lat = $14, lng = $15, updated_at = NOW()
        WHERE shop_id = $1 AND id = $2 RETURNING ${COLS}`,
      [shopId, params.id, c.name, c.phone, c.note, ...addressValues(c.address)]
    );
    if (!rows.length) throw notFound('ไม่พบลูกค้า');
    return { customer: customerJson(rows[0]) };
  });

  router.delete('/api/customers/:id', async ({ shopId, params }) => {
    // บิลเก่าเก็บชื่อ/ที่อยู่เป็น snapshot อยู่แล้ว (customer_id → NULL)
    const r = await db.query('DELETE FROM customers WHERE shop_id = $1 AND id = $2', [shopId, params.id]);
    if (!r.rowCount) throw notFound('ไม่พบลูกค้า');
    return {};
  });
}

module.exports = { register, customerJson, COLS };
