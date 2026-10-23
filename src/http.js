'use strict';
// เครื่องมือ HTTP กลาง: ส่ง JSON, อ่าน body, error มาตรฐาน และตัวตรวจข้อมูลขาเข้าเล็กๆ

const STATUS_CODES = { 400: 'VALIDATION', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'VALIDATION', 429: 'RATE_LIMIT', 500: 'INTERNAL', 503: 'UNAVAILABLE' };

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code || STATUS_CODES[status] || 'INTERNAL';
  }
}

const badRequest = (message) => new ApiError(400, 'VALIDATION', message);
const notFound = (message = 'ไม่พบข้อมูล') => new ApiError(404, 'NOT_FOUND', message);
const conflict = (message, code = 'CONFLICT') => new ApiError(409, code, message);

// BigInt → string เสมอ (เงินส่งเป็น string ตามสัญญา API)
const jsonReplacer = (_key, value) => (typeof value === 'bigint' ? value.toString() : value);

function sendJson(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const payload = JSON.stringify(body, jsonReplacer);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

/** อ่าน body JSON จำกัดขนาด; body ว่าง = {} */
function readJson(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number.parseInt(req.headers['content-length'] || '0', 10);
    if (declared > limitBytes) {
      reject(new ApiError(413, 'VALIDATION', 'ข้อมูลที่ส่งมีขนาดใหญ่เกินกำหนด'));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > limitBytes) {
        aborted = true;
        reject(new ApiError(413, 'VALIDATION', 'ข้อมูลที่ส่งมีขนาดใหญ่เกินกำหนด'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(badRequest('รูปแบบข้อมูลไม่ถูกต้อง (ต้องเป็น JSON object)'));
        }
        resolve(parsed);
      } catch {
        reject(badRequest('รูปแบบ JSON ไม่ถูกต้อง'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- validators ----------

/** ข้อความ: trim แล้วตรวจความยาว/รูปแบบ; undefined/null = '' */
function str(value, label, { min = 0, max = 255, pattern = null, patternMsg = null } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' && typeof value !== 'number') throw badRequest(`${label} ไม่ถูกต้อง`);
  const s = String(value).trim();
  if (s.length < min) throw badRequest(min <= 1 ? `กรุณากรอก${label}` : `${label} ต้องยาวอย่างน้อย ${min} ตัวอักษร`);
  if (s.length > max) throw badRequest(`${label} ยาวเกิน ${max} ตัวอักษร`);
  if (pattern && s && !pattern.test(s)) throw badRequest(patternMsg || `${label} รูปแบบไม่ถูกต้อง`);
  return s;
}

/** จำนวนเต็ม (number หรือ string ตัวเลข) ในช่วงที่กำหนด */
function int(value, label, { min = 0, max = 1e9, fallback } = {}) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  let n = value;
  if (typeof value === 'string' && /^-?\d{1,12}$/.test(value.trim())) n = Number(value.trim());
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw badRequest(`${label} ต้องเป็นจำนวนเต็ม`);
  if (n < min || n > max) throw badRequest(`${label} ต้องอยู่ระหว่าง ${min} ถึง ${max}`);
  return n;
}

function oneOf(value, label, allowed, fallback) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) throw badRequest(`${label} ไม่ถูกต้อง`);
  return value;
}

function bool(value) {
  return value === true || value === 'true' || value === 1;
}

/** id ในตัว body (string ตัวเลข) → string; ว่าง/null → null */
function optionalId(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value);
  if (!/^\d{1,18}$/.test(s)) throw badRequest(`${label} ไม่ถูกต้อง`);
  return s;
}

/** URL รูปภาพ: ว่าง, path ภายใน (/api/files/...) หรือ https:// เท่านั้น (กัน javascript: XSS) */
function imageUrl(value, label) {
  const s = str(value, label, { max: 500 });
  if (s && !/^\/api\/files\/[\w./-]+$/.test(s) && !/^https:\/\/[^\s"'<>]+$/.test(s)) throw badRequest(`${label} ไม่ถูกต้อง`);
  return s;
}

module.exports = { ApiError, badRequest, notFound, conflict, sendJson, readJson, jsonReplacer, str, int, oneOf, bool, optionalId, imageUrl };
