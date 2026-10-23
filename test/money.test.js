'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSatang, bahtTextToSatang, roundHalfUpDiv, calcQtyBase, calcOrderTotals } = require('../src/money');

test('0.1 + 0.2 แบบสตางค์ = 0.30 พอดี (float ให้ 0.30000000000000004)', () => {
  assert.notEqual(0.1 + 0.2, 0.3); // ยืนยันปัญหาของ binary float
  assert.equal(parseSatang('10') + parseSatang('20'), 30n);
  assert.equal(bahtTextToSatang('0.1') + bahtTextToSatang('0.2'), bahtTextToSatang('0.3'));
});

test('parseSatang รับเฉพาะ string ตัวเลขจำนวนเต็ม 1-15 หลัก', () => {
  assert.equal(parseSatang('29000'), 29000n);
  assert.equal(parseSatang('0'), 0n);
  assert.equal(parseSatang('999999999999999'), 999999999999999n);
  for (const bad of [29000, '290.00', '-1', '', ' 1', '1e3', '0x10', '1234567890123456', null, undefined]) {
    assert.throws(() => parseSatang(bad), (e) => e.status === 400, `ควรปฏิเสธ ${JSON.stringify(bad)}`);
  }
  assert.equal(parseSatang(undefined, 'x', { fallback: 0 }), 0n);
});

test('bahtTextToSatang แปลงข้อความบาทโดยไม่ผ่าน float', () => {
  assert.equal(bahtTextToSatang('40'), 4000n);
  assert.equal(bahtTextToSatang('40.5'), 4050n);
  assert.equal(bahtTextToSatang('1,250.75'), 125075n);
  assert.equal(bahtTextToSatang('฿35 บาท'), 3500n);
  assert.equal(bahtTextToSatang('1.005'), null);
  assert.equal(bahtTextToSatang('abc'), null);
});

test('roundHalfUpDiv ปัดครึ่งขึ้นที่ขอบเขตพอดี', () => {
  assert.equal(roundHalfUpDiv(5n, 10n), 1n); // 0.5 → 1
  assert.equal(roundHalfUpDiv(4n, 10n), 0n); // 0.4 → 0
  assert.equal(roundHalfUpDiv(15n, 10n), 2n); // 1.5 → 2
  assert.equal(roundHalfUpDiv(25n, 10n), 3n); // 2.5 → 3 (ไม่ใช่ banker's rounding)
  assert.equal(roundHalfUpDiv(14999n, 10000n), 1n);
  assert.equal(roundHalfUpDiv(15000n, 10000n), 2n);
  assert.equal(roundHalfUpDiv(-15n, 10n), -2n); // ห่างจากศูนย์
  assert.throws(() => roundHalfUpDiv(1n, 0n));
  assert.throws(() => roundHalfUpDiv(1, 2));
});

test('calcQtyBase ต้องหารลงตัว', () => {
  assert.equal(calcQtyBase(2, 3, 1), 6n);
  assert.equal(calcQtyBase(4, 1, 2), 2n);
  assert.throws(() => calcQtyBase(3, 1, 2), (e) => e.status === 400);
});

test('calcOrderTotals ตามสูตร api.md (VAT 7% ปัดครึ่งขึ้น)', () => {
  const t = calcOrderTotals({
    lines: [
      { priceSatang: 29000n, qty: 2, costBaseSatang: 12000n, qtyBase: 2n },
      { priceSatang: 79000n, qty: 1, costBaseSatang: 12000n, qtyBase: 3n },
    ],
    discountSatang: 1000n,
    shippingSatang: 4000n,
    vatRateBp: 700,
  });
  assert.equal(t.itemsTotal, 137000n);
  assert.equal(t.beforeVat, 140000n);
  assert.equal(t.vat, 9800n);
  assert.equal(t.total, 149800n);
  assert.equal(t.cost, 60000n);
  assert.equal(t.profit, 76000n);
  assert.deepEqual(t.lines.map((l) => l.lineTotal), [58000n, 79000n]);

  // beforeVat 150 สตางค์ * 7% = 10.5 → 11
  const half = calcOrderTotals({ lines: [{ priceSatang: 150n, qty: 1, costBaseSatang: 0n, qtyBase: 1n }], vatRateBp: 700 });
  assert.equal(half.vat, 11n);
  assert.equal(half.total, 161n);
  // 149 * 7% = 10.43 → 10
  assert.equal(calcOrderTotals({ lines: [{ priceSatang: 149n, qty: 1, costBaseSatang: 0n, qtyBase: 1n }], vatRateBp: 700 }).vat, 10n);
});

test('ส่วนลดเกินยอดสินค้า → 400', () => {
  assert.throws(
    () => calcOrderTotals({ lines: [{ priceSatang: 100n, qty: 1, costBaseSatang: 0n, qtyBase: 1n }], discountSatang: 101n }),
    (e) => e.status === 400
  );
});
