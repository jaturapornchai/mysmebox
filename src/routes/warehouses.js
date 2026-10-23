'use strict';
const db = require('../db');
const { str, notFound } = require('../http');
const { parseAddress, addressValues, addressFromRow } = require('../address');

const COLS = 'id, name, phone, address_line, province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code, lat, lng, created_at';

const warehouseJson = (r) => ({ id: r.id, name: r.name, phone: r.phone, ...addressFromRow(r), createdAt: r.created_at.toISOString() });

function parseWarehouse(b) {
  return {
    name: str(b.name, 'ชื่อโกดัง', { min: 1, max: 160 }),
    phone: str(b.phone, 'เบอร์โทร', { max: 32 }),
    address: parseAddress(b),
  };
}

async function insertWarehouse(client, shopId, w) {
  const { rows } = await client.query(
    `INSERT INTO warehouses (shop_id, name, phone, address_line, province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code, lat, lng)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING ${COLS}`,
    [shopId, w.name, w.phone, ...addressValues(w.address)]
  );
  return warehouseJson(rows[0]);
}

function register(router) {
  router.get('/api/warehouses', async ({ shopId }) => {
    const { rows } = await db.query(`SELECT ${COLS} FROM warehouses WHERE shop_id = $1 ORDER BY id LIMIT 200`, [shopId]);
    return { warehouses: rows.map(warehouseJson) };
  });

  router.post('/api/warehouses', async ({ shopId, body }) => ({ warehouse: await insertWarehouse(db.pool, shopId, parseWarehouse(body)) }));

  router.put('/api/warehouses/:id', async ({ shopId, params, body }) => {
    const w = parseWarehouse(body);
    const { rows } = await db.query(
      `UPDATE warehouses SET name = $3, phone = $4, address_line = $5, province_code = $6, province_name = $7, district_code = $8,
              district_name = $9, subdistrict_code = $10, subdistrict_name = $11, zip_code = $12, lat = $13, lng = $14, updated_at = NOW()
        WHERE shop_id = $1 AND id = $2 RETURNING ${COLS}`,
      [shopId, params.id, w.name, w.phone, ...addressValues(w.address)]
    );
    if (!rows.length) throw notFound('ไม่พบโกดัง');
    return { warehouse: warehouseJson(rows[0]) };
  });

  router.delete('/api/warehouses/:id', async ({ shopId, params }) => {
    const r = await db.query('DELETE FROM warehouses WHERE shop_id = $1 AND id = $2', [shopId, params.id]);
    if (!r.rowCount) throw notFound('ไม่พบโกดัง');
    return {};
  });
}

module.exports = { register, warehouseJson, insertWarehouse, COLS };
