'use strict';
const db = require('../db');
const { orderJson } = require('../services/orders');
const { LIST_COLS } = require('./orders');

// เริ่มต้นวันนี้ตามเวลาไทย (คืนเป็น timestamptz ให้ใช้ index created_at ได้)
const TODAY_START_TH = "(date_trunc('day', NOW() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')";

async function summary(client, shopId) {
  const { rows } = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at >= ${TODAY_START_TH}) AS today_count,
       COALESCE(SUM(total_satang) FILTER (WHERE created_at >= ${TODAY_START_TH}), 0)::bigint AS today_sales,
       COALESCE(SUM(items_total_satang - discount_satang - cost_satang) FILTER (WHERE created_at >= ${TODAY_START_TH}), 0)::bigint AS today_profit,
       COUNT(*) FILTER (WHERE pay_method = 'TRANSFER' AND pay_status = 'UNPAID') AS transfer_count,
       COALESCE(SUM(total_satang) FILTER (WHERE pay_method = 'TRANSFER' AND pay_status = 'UNPAID'), 0)::bigint AS transfer_amount,
       COUNT(*) FILTER (WHERE pay_method = 'COD' AND pay_status = 'UNPAID') AS cod_count,
       COALESCE(SUM(total_satang) FILTER (WHERE pay_method = 'COD' AND pay_status = 'UNPAID'), 0)::bigint AS cod_amount,
       COUNT(*) FILTER (WHERE ship_status IN ('PENDING', 'PACKED')) AS to_ship
     FROM bills WHERE shop_id = $1 AND status = 'ACTIVE'`,
    [shopId]
  );
  return rows[0];
}

async function lowStock(client, shopId, limit = 10) {
  const { rows } = await client.query(
    `SELECT id, code, name, stock_base, min_stock_base, base_unit_name FROM products
      WHERE shop_id = $1 AND is_active AND stock_base <= min_stock_base
      ORDER BY stock_base - min_stock_base, id LIMIT $2`,
    [shopId, limit]
  );
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, stockBase: Number(r.stock_base), minStockBase: Number(r.min_stock_base), baseUnitName: r.base_unit_name }));
}

async function recentOrders(client, shopId, limit = 8) {
  const { rows } = await client.query(`SELECT ${LIST_COLS} FROM bills WHERE shop_id = $1 ORDER BY id DESC LIMIT $2`, [shopId, limit]);
  return rows.map((r) => orderJson(r));
}

async function buildDashboard(shopId) {
  const [s, low, recent] = await Promise.all([summary(db.pool, shopId), lowStock(db.pool, shopId), recentOrders(db.pool, shopId)]);
  return {
    today: { orderCount: Number(s.today_count), salesSatang: s.today_sales, profitSatang: s.today_profit },
    awaitingTransfer: { count: Number(s.transfer_count), amountSatang: s.transfer_amount },
    awaitingCod: { count: Number(s.cod_count), amountSatang: s.cod_amount },
    toShip: { count: Number(s.to_ship) },
    lowStock: low,
    recentOrders: recent,
  };
}

function register(router) {
  router.get('/api/dashboard', async ({ shopId }) => buildDashboard(shopId));
}

module.exports = { register, buildDashboard };
