// เงินทุกค่าเป็น "สตางค์" แบบ string ตามสัญญา API — คำนวณด้วย BigInt เท่านั้น (ห้าม parseFloat/Number กับเงิน)

const BAHT_INPUT_RE = /^\d+(\.\d{1,2})?$/;

/** แปลงค่าใดๆ ที่เป็นสตางค์ (string/BigInt) เป็น BigInt; ค่าว่าง = 0n */
export function big(v) {
  if (typeof v === 'bigint') return v;
  if (v === null || v === undefined || v === '') return 0n;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return 0n;
  return BigInt(s);
}

/** ปัดครึ่งขึ้น (half-up, ห่างจากศูนย์) ของ n / d โดย d > 0 */
export function divRoundHalfUp(n, d) {
  n = big(n); d = big(d);
  if (d <= 0n) throw new Error('divisor must be > 0');
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (a * 2n + d) / (2n * d);
  return neg ? -q : q;
}

function groupThousands(s) {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** สตางค์ → "1,234.50" */
export function satangToText(v) {
  const n = big(v);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const baht = a / 100n;
  const st = a % 100n;
  return (neg ? '-' : '') + groupThousands(baht.toString()) + '.' + st.toString().padStart(2, '0');
}

/** สตางค์ → "฿1,234.50" */
export function fmtBaht(v) {
  const t = satangToText(v);
  return t.startsWith('-') ? '-฿' + t.slice(1) : '฿' + t;
}

/** สตางค์ → ข้อความสั้นสำหรับปุ่ม: "฿290" หรือ "฿290.50" */
export function fmtBahtShort(v) {
  const t = fmtBaht(v);
  return t.endsWith('.00') ? t.slice(0, -3) : t;
}

/** สตางค์ → ค่าที่ใส่กลับในช่องกรอก "1234.50" / "290" */
export function satangToInput(v) {
  const n = big(v);
  if (n === 0n) return '';
  const neg = n < 0n;
  const a = neg ? -n : n;
  const st = a % 100n;
  const s = (a / 100n).toString() + (st === 0n ? '' : '.' + st.toString().padStart(2, '0'));
  return (neg ? '-' : '') + s;
}

/**
 * ข้อความบาทที่ผู้ใช้กรอก → สตางค์ string; รูปแบบผิด → null
 * ยอมให้มีจุลภาค/ช่องว่าง/฿ (ตัดทิ้งก่อนตรวจ) ; ค่าว่าง → emptyValue
 */
export function parseBahtInput(text, emptyValue = '0') {
  const s = String(text ?? '').replace(/[,\s฿]/g, '');
  if (s === '') return emptyValue;
  if (!BAHT_INPUT_RE.test(s)) return null;
  const [intPart, frac = ''] = s.split('.');
  return (BigInt(intPart) * 100n + BigInt((frac + '00').slice(0, 2))).toString();
}

export function isValidBahtInput(text) {
  return parseBahtInput(text) !== null;
}
