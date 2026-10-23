'use strict';
const db = require('../db');
const { str, int, badRequest, conflict } = require('../http');
const { parseAddress, addressValues, addressFromRow } = require('../address');
const { isBankCode } = require('../master');

function shopJson(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    promptpayId: r.promptpay_id,
    bankCode: r.bank_code,
    bankAccountNo: r.bank_account_no,
    bankAccountName: r.bank_account_name,
    vatRateBp: r.vat_rate_bp,
    ...addressFromRow(r),
  };
}

const shopName = (v) => str(v, 'ชื่อร้าน', { min: 1, max: 160 });

/** สร้างร้าน + ใส่เจ้าของเป็นสมาชิก OWNER (ใช้ทั้ง POST /api/shop และ demo) */
async function insertShop(client, userId, fields) {
  const { rows } = await client.query('INSERT INTO shops (owner_user_id, name) VALUES ($1, $2) RETURNING *', [userId, fields.name]);
  await client.query("INSERT INTO shop_members (shop_id, user_id, role) VALUES ($1, $2, 'OWNER')", [rows[0].id, userId]);
  return rows[0];
}

function parseShopInput(b) {
  const promptpayId = str(b.promptpayId, 'พร้อมเพย์', { max: 13, pattern: /^(0\d{9}|\d{13})$/, patternMsg: 'พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก (ขึ้นต้นด้วย 0) หรือเลข 13 หลัก' });
  const bankCode = str(b.bankCode, 'ธนาคาร', { max: 16 });
  if (bankCode && !isBankCode(bankCode)) throw badRequest('ธนาคารไม่ถูกต้อง');
  return {
    name: shopName(b.name),
    phone: str(b.phone, 'เบอร์โทร', { max: 32 }),
    promptpayId,
    bankCode,
    bankAccountNo: str(b.bankAccountNo, 'เลขบัญชี', { max: 32, pattern: /^[0-9-]*$/, patternMsg: 'เลขบัญชีต้องเป็นตัวเลข' }),
    bankAccountName: str(b.bankAccountName, 'ชื่อบัญชี', { max: 160 }),
    vatRateBp: int(b.vatRateBp, 'อัตรา VAT', { min: 0, max: 10000, fallback: 0 }),
    address: parseAddress(b),
  };
}

async function updateShop(client, shopId, s) {
  const { rows } = await client.query(
    `UPDATE shops SET name = $2, phone = $3, promptpay_id = $4, bank_code = $5, bank_account_no = $6, bank_account_name = $7, vat_rate_bp = $8,
            address_line = $9, province_code = $10, province_name = $11, district_code = $12, district_name = $13,
            subdistrict_code = $14, subdistrict_name = $15, zip_code = $16, lat = $17, lng = $18, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [shopId, s.name, s.phone, s.promptpayId, s.bankCode, s.bankAccountNo, s.bankAccountName, s.vatRateBp, ...addressValues(s.address)]
  );
  return rows[0];
}

function register(router) {
  router.post('/api/shop', async ({ user, body }) => {
    const name = shopName(body.name);
    const shop = await db.tx(async (client) => {
      // ล็อกแถวผู้ใช้กันกดสร้างร้านซ้อนกัน 2 ครั้ง
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const existing = await client.query('SELECT 1 FROM shop_members WHERE user_id = $1 LIMIT 1', [user.id]);
      if (existing.rowCount) throw conflict('บัญชีนี้มีร้านค้าแล้ว');
      return insertShop(client, user.id, { name });
    });
    return { shop: shopJson(shop) };
  }, { auth: 'user' });

  router.get('/api/shop', async ({ shopRow }) => ({ shop: shopJson(shopRow) }));

  router.put('/api/shop', async ({ shopId, body }) => {
    const input = parseShopInput(body);
    const shop = await db.tx((client) => updateShop(client, shopId, input));
    return { shop: shopJson(shop) };
  });
}

module.exports = { register, shopJson, insertShop, updateShop, parseShopInput };
