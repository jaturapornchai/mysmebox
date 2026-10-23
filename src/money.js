'use strict';
// เงินทั้งหมดเป็น BigInt หน่วยสตางค์ — ห้ามใช้ float/Number() กับเงิน (AGENTS.md §3)
const { badRequest } = require('./http');

const SATANG_RE = /^\d{1,15}$/;

/** รับ string ตัวเลขจำนวนเต็มหน่วยสตางค์ (เช่น "29000") → BigInt; number/ทศนิยม/ติดลบ → 400 */
function parseSatang(value, label = 'จำนวนเงิน', { fallback } = {}) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return BigInt(fallback);
  if (typeof value !== 'string' || !SATANG_RE.test(value)) {
    throw badRequest(`${label} ต้องเป็นตัวเลขจำนวนเต็มหน่วยสตางค์ (string)`);
  }
  return BigInt(value);
}

/** แปลงข้อความยอดบาท เช่น "40", "40.5", "1,250.75" → BigInt สตางค์ (ไม่ผ่าน float); ไม่ถูกต้อง → null */
function bahtTextToSatang(text) {
  const s = String(text ?? '').replace(/[,\s฿]|บาท/g, '');
  const m = s.match(/^(\d{1,13})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] || '0').padEnd(2, '0'));
}

/** หาร BigInt ปัดครึ่งขึ้น (half away from zero) — ใช้กับ VAT/ต้นทุน */
function roundHalfUpDiv(a, b) {
  if (typeof a !== 'bigint' || typeof b !== 'bigint') throw new TypeError('roundHalfUpDiv ต้องใช้ BigInt');
  if (b <= 0n) throw new RangeError('ตัวหารต้องมากกว่า 0');
  if (a < 0n) return -roundHalfUpDiv(-a, b);
  return (a * 2n + b) / (b * 2n);
}

/** qtyBase = qty * standValue / divideValue ต้องหารลงตัว ไม่ลงตัว → 400 */
function calcQtyBase(qty, standValue, divideValue, label = 'สินค้า') {
  const num = BigInt(qty) * BigInt(standValue);
  const den = BigInt(divideValue);
  if (num % den !== 0n) throw badRequest(`จำนวนของ ${label} แปลงเป็นหน่วยฐานไม่ลงตัว`);
  return num / den;
}

/**
 * สูตรออเดอร์ตาม docs/api.md
 * lines: [{ priceSatang, qty, costBaseSatang, qtyBase }] (BigInt / number จำนวนเต็ม)
 */
function calcOrderTotals({ lines, discountSatang = 0n, shippingSatang = 0n, vatRateBp = 0 }) {
  let itemsTotal = 0n;
  let cost = 0n;
  const lineResults = lines.map((l) => {
    const lineTotal = BigInt(l.priceSatang) * BigInt(l.qty);
    // costBase * qtyBase เป็นจำนวนเต็มอยู่แล้ว (หาร 1) — คงสูตร round_half_up ไว้ตามสัญญา
    const lineCost = roundHalfUpDiv(BigInt(l.costBaseSatang) * BigInt(l.qtyBase), 1n);
    itemsTotal += lineTotal;
    cost += lineCost;
    return { lineTotal, lineCost };
  });
  const discount = BigInt(discountSatang);
  const shipping = BigInt(shippingSatang);
  if (discount > itemsTotal) throw badRequest('ส่วนลดต้องไม่เกินยอดรวมสินค้า');
  const beforeVat = itemsTotal - discount + shipping;
  const vat = roundHalfUpDiv(beforeVat * BigInt(vatRateBp), 10000n);
  return {
    lines: lineResults,
    itemsTotal,
    discount,
    shipping,
    beforeVat,
    vat,
    total: beforeVat + vat,
    cost,
    profit: itemsTotal - discount - cost,
  };
}

module.exports = { parseSatang, bahtTextToSatang, roundHalfUpDiv, calcQtyBase, calcOrderTotals };
