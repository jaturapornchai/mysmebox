// fetch wrapper กลาง: ส่ง/รับ JSON, cookie same-origin, แปลง error เป็นข้อความไทย

export class ApiError extends Error {
  constructor(message, status, code, data) {
    super(message);
    this.status = status;
    this.code = code || '';
    this.data = data || null;
  }
}

const DEFAULT_MESSAGES = {
  0: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
  400: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
  401: 'กรุณาเข้าสู่ระบบก่อน',
  403: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  404: 'ไม่พบข้อมูลที่ต้องการ',
  409: 'ทำรายการไม่ได้ เพราะข้อมูลไม่ตรงกับสถานะปัจจุบัน',
  413: 'ข้อมูลใหญ่เกินไป',
  429: 'ใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
  500: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
  503: 'บริการนี้ยังไม่เปิดใช้งาน',
};

let unauthorizedHandler = null;
let noShopHandler = null;

/** ตั้งฟังก์ชันที่จะเรียกเมื่อ session หมด (401) */
export function onUnauthorized(fn) { unauthorizedHandler = fn; }
/** ตั้งฟังก์ชันที่จะเรียกเมื่อยังไม่มีร้าน (409 NO_SHOP) */
export function onNoShop(fn) { noShopHandler = fn; }

/**
 * เรียก API
 * @param {string} path เช่น '/api/products'
 * @param {{method?:string, body?:any, headers?:object, quiet401?:boolean}} opts
 */
export async function api(path, opts = {}) {
  const method = (opts.method || (opts.body !== undefined ? 'POST' : 'GET')).toUpperCase();
  const headers = { Accept: 'application/json', ...(opts.headers || {}) };
  const init = { method, credentials: 'same-origin', headers };
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body === undefined ? {} : opts.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(DEFAULT_MESSAGES[0], 0, 'NETWORK');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data || data.ok === false) {
    const msg = (data && typeof data.error === 'string' && data.error) || DEFAULT_MESSAGES[res.status] || DEFAULT_MESSAGES[500];
    const err = new ApiError(msg, res.status, data && data.code, data);
    if (res.status === 401 && !opts.quiet401 && unauthorizedHandler) unauthorizedHandler(err);
    if (res.status === 409 && err.code === 'NO_SHOP' && noShopHandler) noShopHandler(err);
    throw err;
  }
  return data;
}

/** สร้าง query string โดยตัดค่าว่างออก */
export function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? '?' + s : '';
}

/** UUID สำหรับ Idempotency-Key */
export function uuid() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
