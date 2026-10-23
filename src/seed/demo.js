'use strict';
// ข้อมูลตัวอย่างร้าน DEMO สำหรับแม่ค้าออนไลน์ — สร้างผ่าน service จริง (สต๊อก/movement/เลขบิลถูกต้องเหมือนใช้งานจริง)
const { findSubdistrict } = require('../master');
const { insertShop, updateShop } = require('../routes/shop');
const { insertWarehouse } = require('../routes/warehouses');
const { ean13CheckDigit, createProduct } = require('../services/products');
const orders = require('../services/orders');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const TH_OFFSET = 7 * HOUR; // เวลาไทยไม่มี DST

/** ที่อยู่จากฐานข้อมูลภูมิศาสตร์จริง (พิกัด/รหัสไปรษณีย์ตรง) */
function geoAddress(addressLine, provinceTh, districtTh, subdistrictTh) {
  const g = findSubdistrict(provinceTh, districtTh, subdistrictTh);
  if (!g) throw new Error(`seed: ไม่พบตำบล ${subdistrictTh} ${districtTh} ${provinceTh}`);
  return {
    addressLine, provinceCode: g.provinceCode, provinceName: g.provinceTh, districtCode: g.districtCode, districtName: g.districtTh,
    subdistrictCode: g.subdistrictCode, subdistrictName: g.subdistrictTh, zipCode: g.zipCode, lat: g.lat, lng: g.lng,
  };
}

/** EAN-13 prefix 200 (ใช้ภายในร้าน) พร้อม check digit ถูกต้อง */
const demoBarcode = (productNo, unitNo) => {
  const first12 = `2008851${String(productNo).padStart(3, '0')}${unitNo}0`;
  return first12 + ean13CheckDigit(first12);
};

// [ชื่อ, หน่วยฐาน, ชื่อหน่วยฐาน, ทุน(สตางค์), สต๊อกตั้งต้น, จุดสั่งซื้อ, [[หน่วย, ชื่อ, ตัวตั้ง, ราคาสตางค์], ...]]
const PRODUCTS = [
  ['เซรั่มวิตามินซี 30ml', 'BTL', 'ขวด', '12000', 60, 10, [['BTL', 'ขวด', 1, '29000'], ['PK3', 'แพ็ค 3 ขวด', 3, '79000'], ['BOX24', 'ลัง 24 ขวด', 24, '600000']]],
  ['ครีมกันแดด SPF50 PA++++ 50g', 'TUBE', 'หลอด', '9500', 40, 8, [['TUBE', 'หลอด', 1, '25900'], ['PK2', 'แพ็คคู่ 2 หลอด', 2, '47900']]],
  ['ลิปทินท์เนื้อแมตต์ โทนส้มอิฐ', 'PCS', 'แท่ง', '4500', 120, 24, [['PCS', 'แท่ง', 1, '15900'], ['DOZ', 'โหล 12 แท่ง', 12, '168000']]],
  ['มาส์กหน้าแผ่นสูตรน้ำผึ้ง', 'SHT', 'แผ่น', '1200', 200, 30, [['SHT', 'แผ่น', 1, '3900'], ['BOX10', 'กล่อง 10 แผ่น', 10, '35000']]],
  ['เสื้อยืดโอเวอร์ไซส์ คอตตอน 100%', 'PCS', 'ตัว', '9000', 14, 10, [['PCS', 'ตัว', 1, '25000']]],
  ['กางเกงยีนส์ขาม้า เอวสูง', 'PCS', 'ตัว', '22000', 15, 5, [['PCS', 'ตัว', 1, '49000']]],
  ['ทองม้วนกรอบ สูตรโบราณ', 'PK', 'ถุง', '3500', 48, 12, [['PK', 'ถุง', 1, '8900'], ['BOX12', 'ลัง 12 ถุง', 12, '99000']]],
  ['น้ำพริกเผากุ้งเสียบ 200g', 'JAR', 'กระปุก', '6000', 10, 12, [['JAR', 'กระปุก', 1, '12900'], ['PK3', 'แพ็ค 3 กระปุก', 3, '35900']]],
];

const CUSTOMERS = [
  ['คุณมะลิ ศรีสุข', '0891234567', ['99/12 คอนโดลุมพินี ห้อง 1203', 'กรุงเทพมหานคร', 'จตุจักร', 'ลาดยาว'], 'ลูกค้าประจำ ชอบเซรั่ม'],
  ['คุณเมย์ วงศ์ทอง', '0865559988', ['188 ถ.สีลม', 'กรุงเทพมหานคร', 'บางรัก', 'สุริยวงศ์'], ''],
  ['คุณต้น เชียงใหม่', '0817778899', ['25 ถ.ราชวิถี', 'เชียงใหม่', 'เมืองเชียงใหม่', 'ศรีภูมิ'], 'ส่ง Flash เท่านั้น'],
  ['คุณฝน แก่นนคร', '0823334455', ['111/5 ถ.หน้าเมือง', 'ขอนแก่น', 'เมืองขอนแก่น', 'ในเมือง'], ''],
  ['คุณบี ภูเก็ต', '0956667788', ['7 ถ.ถลาง', 'ภูเก็ต', 'เมืองภูเก็ต', 'ตลาดใหญ่'], 'ชอบซื้อยกกล่อง'],
  ['คุณจอย ชลบุรี', '0841112233', ['55/8 หมู่ 3', 'ชลบุรี', 'เมืองชลบุรี', 'บางปลาสร้อย'], ''],
];

// [วันย้อนหลัง, ชั่วโมงเวลาไทย(null = ไม่กี่นาทีก่อน), ลูกค้า(index|null), [[สินค้า, หน่วย, จำนวน]], ช่องทาง, ขนส่ง, วิธีจ่าย, จ่ายแล้ว, ค่าส่ง, ส่วนลด, ขั้นตอนต่อ]
const ORDERS = [
  [6, 10.25, 0, [[0, 'PK3', 1], [2, 'PCS', 2]], 'FACEBOOK', 'FLASH', 'TRANSFER', true, '4000', '0', { ship: 'DELIVERED', tracking: 'TH0110482735A' }],
  [6, 19.6, 1, [[1, 'PK2', 1]], 'LINE', 'KERRY', 'TRANSFER', true, '4500', '0', { ship: 'DELIVERED', tracking: 'KEX0012345678' }],
  [5, 11.1, 2, [[6, 'PK', 4]], 'TIKTOK', 'FLASH', 'COD', false, '3500', '0', { ship: 'DELIVERED', tracking: 'TH0110499812B', payLater: true }],
  [5, 20.5, 3, [[4, 'PCS', 3], [5, 'PCS', 1]], 'FACEBOOK', 'JT', 'TRANSFER', true, '5000', '5000', { ship: 'SHIPPED', tracking: 'JT8800112233' }],
  [4, 13.3, 4, [[3, 'BOX10', 2]], 'SHOPEE', 'SPX', 'COD', false, '0', '0', { ship: 'SHIPPED', tracking: 'TH2401998877S' }],
  [4, 16.0, null, [[7, 'JAR', 2]], 'STORE', 'PICKUP', 'CASH', true, '0', '0', { ship: 'DELIVERED' }],
  [3, 14.2, 5, [[0, 'BTL', 2]], 'LINE', 'FLASH', 'TRANSFER', true, '4000', '0', { cancel: 'ลูกค้าขอยกเลิก (สั่งซ้ำ)' }],
  [2, 9.75, 0, [[2, 'DOZ', 1]], 'FACEBOOK', 'KERRY', 'TRANSFER', true, '5000', '0', { ship: 'PACKED' }],
  [2, 21.25, 2, [[4, 'PCS', 2], [1, 'TUBE', 1]], 'TIKTOK', 'FLASH', 'COD', false, '4000', '0', {}],
  [1, 12.5, 1, [[0, 'BTL', 1], [3, 'SHT', 5]], 'LINE', 'FLASH', 'TRANSFER', false, '4000', '0', {}],
  [1, 18.8, 3, [[6, 'BOX12', 1]], 'FACEBOOK', 'THAIPOST', 'COD', false, '6000', '0', { ship: 'SHIPPED', tracking: 'EF582640193TH' }],
  [0, null, 4, [[0, 'PK3', 2]], 'FACEBOOK', 'FLASH', 'TRANSFER', true, '4000', '0', {}],
  [0, null, 5, [[5, 'PCS', 1], [7, 'PK3', 1]], 'LINE', 'KERRY', 'COD', false, '4500', '0', {}],
];

/** เวลา UTC ของ "ย้อนหลัง N วัน เวลา H นาฬิกา (ไทย)"; วันนี้ (hour=null) = ไม่กี่นาทีก่อนแต่ไม่ข้ามเที่ยงคืน */
function orderTime(daysAgo, hourTh, seq, now) {
  const thMidnight = Math.floor((now + TH_OFFSET) / DAY) * DAY - TH_OFFSET;
  if (hourTh === null) {
    const minutesAgo = (13 - seq) * 15 * 60 * 1000 + 5 * 60 * 1000;
    return new Date(Math.min(now - (13 - seq) * 1000, Math.max(thMidnight + 60 * 1000 * seq, now - minutesAgo)));
  }
  return new Date(thMidnight - daysAgo * DAY + hourTh * HOUR);
}

async function seedProducts(client, shopId, userId) {
  const result = [];
  for (const [i, [name, base, baseName, cost, opening, min, units]] of PRODUCTS.entries()) {
    const input = {
      code: '', name, baseUnitCode: base, baseUnitName: baseName, costBaseSatang: BigInt(cost), minStockBase: min, openingStock: opening, imageUrl: '',
      units: [{ unitCode: base, unitName: baseName, standValue: 1, divideValue: 1 }, ...units.filter((u) => u[0] !== base).map(([c, n, s]) => ({ unitCode: c, unitName: n, standValue: s, divideValue: 1 }))],
      barcodes: units.map(([c, , , price], j) => ({ barcode: demoBarcode(i + 1, j + 1), unitCode: c, priceSatang: BigInt(price), priceMemberSatang: 0n, priceWholesaleSatang: 0n })),
    };
    await createProduct(client, shopId, userId, input);
    result.push(new Map(input.barcodes.map((b) => [b.unitCode, b.barcode])));
  }
  return result;
}

async function seedCustomers(client, shopId) {
  const result = [];
  for (const [name, phone, addr, note] of CUSTOMERS) {
    const a = geoAddress(...addr);
    const { rows } = await client.query(
      `INSERT INTO customers (shop_id, name, phone, note, address_line, province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [shopId, name, phone, note, a.addressLine, a.provinceCode, a.provinceName, a.districtCode, a.districtName, a.subdistrictCode, a.subdistrictName, a.zipCode, a.lat, a.lng]
    );
    result.push({ id: rows[0].id, name, phone, address: a });
  }
  return result;
}

async function seedOrders(client, shopId, userId, barcodes, customers) {
  const now = Date.now();
  for (const [seq, o] of ORDERS.entries()) {
    const [daysAgo, hour, custIdx, items, channel, courier, payMethod, paid, shipping, discount, next] = o;
    const c = custIdx === null ? null : customers[custIdx];
    const input = {
      customerId: c ? c.id : null, saveCustomer: false,
      customerName: c ? c.name : 'ลูกค้าหน้าร้าน', customerPhone: c ? c.phone : '',
      ship: c ? c.address : { addressLine: '', provinceCode: '', provinceName: '', districtCode: '', districtName: '', subdistrictCode: '', subdistrictName: '', zipCode: '', lat: null, lng: null },
      channel, courier, payMethod, paid, payBankCode: paid && payMethod === 'TRANSFER' ? 'KBANK' : '', slipUrl: '',
      discountSatang: BigInt(discount), shippingSatang: BigInt(shipping), note: '',
      items: items.map(([p, unit, qty]) => ({ barcode: barcodes[p].get(unit), qty, priceSatang: null })),
    };
    const billId = await orders.createOrder(client, { shopId, userId, input, at: orderTime(daysAgo, hour, seq, now) });
    if (next.cancel) await orders.cancelOrder(client, shopId, userId, billId, { reason: next.cancel });
    if (next.ship) await orders.shipOrder(client, shopId, billId, { shipStatus: next.ship, courier: null, trackingNo: next.tracking || null });
    if (next.payLater) await orders.payOrder(client, shopId, billId, { payBankCode: '', slipUrl: '' });
  }
}

/** สร้างร้านตัวอย่างครบชุดให้ผู้ใช้ DEMO (client อยู่ใน transaction ของผู้เรียก) */
async function seedDemoShop(client, userId) {
  const created = await insertShop(client, userId, { name: 'ร้านน้องแนน บิวตี้ (ตัวอย่าง)' });
  const shop = await updateShop(client, created.id, {
    name: 'ร้านน้องแนน บิวตี้ (ตัวอย่าง)', phone: '0812345678', promptpayId: '0812345678', bankCode: 'KBANK',
    bankAccountNo: '123-4-56789-0', bankAccountName: 'น.ส. แนน ใจดี', vatRateBp: 0,
    address: geoAddress('88/9 ซ.ลาดพร้าว 15', 'กรุงเทพมหานคร', 'จตุจักร', 'จอมพล'),
  });
  await insertWarehouse(client, shop.id, { name: 'โกดังหลัก ลาดพร้าว', phone: '0812345678', address: geoAddress('12/3 ซ.ลาดพร้าว 1', 'กรุงเทพมหานคร', 'จตุจักร', 'ลาดยาว') });
  await insertWarehouse(client, shop.id, { name: 'จุดฝากของ นนทบุรี', phone: '0899990000', address: geoAddress('45 ถ.ประชาราษฎร์', 'นนทบุรี', 'เมืองนนทบุรี', 'บางกระสอ') });
  const barcodes = await seedProducts(client, shop.id, userId);
  const customers = await seedCustomers(client, shop.id);
  await seedOrders(client, shop.id, userId, barcodes, customers);
  return shop;
}

module.exports = { seedDemoShop, demoBarcode };
