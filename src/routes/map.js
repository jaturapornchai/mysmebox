'use strict';
const db = require('../db');
const { numOrNull } = require('../address');
const customers = require('./customers');
const warehouses = require('./warehouses');

async function deliveries(shopId) {
  const { rows } = await db.query(
    `SELECT id, bill_no, customer_name, ship_status, pay_method, pay_status, total_satang, ship_lat, ship_lng,
            ship_address_line, ship_subdistrict, ship_district, ship_province, ship_zip
       FROM bills
      WHERE shop_id = $1 AND status = 'ACTIVE' AND ship_status <> 'DELIVERED' AND ship_lat IS NOT NULL AND ship_lng IS NOT NULL
      ORDER BY id DESC LIMIT 500`,
    [shopId]
  );
  return rows.map((r) => ({
    id: r.id, billNo: r.bill_no, customerName: r.customer_name, shipStatus: r.ship_status, payMethod: r.pay_method,
    payStatus: r.pay_status, totalSatang: r.total_satang, lat: numOrNull(r.ship_lat), lng: numOrNull(r.ship_lng),
    addressText: [r.ship_address_line, r.ship_subdistrict, r.ship_district, r.ship_province, r.ship_zip].filter(Boolean).join(' '),
  }));
}

function register(router) {
  router.get('/api/map', async ({ shopRow, shopId }) => {
    const [cust, wh, del] = await Promise.all([
      db.query(`SELECT ${customers.COLS} FROM customers WHERE shop_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY id DESC LIMIT 500`, [shopId]),
      db.query(`SELECT ${warehouses.COLS} FROM warehouses WHERE shop_id = $1 ORDER BY id LIMIT 200`, [shopId]),
      deliveries(shopId),
    ]);
    return {
      shop: { name: shopRow.name, lat: numOrNull(shopRow.lat), lng: numOrNull(shopRow.lng) },
      customers: cust.rows.map(customers.customerJson),
      warehouses: wh.rows.map(warehouses.warehouseJson),
      deliveries: del,
    };
  });
}

module.exports = { register };
