'use strict';
// Rate limit แบบ sliding window เก็บในหน่วยความจำ (เครื่องเดียวพอสำหรับ v1)

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** IP ผู้เรียก: เชื่อ X-Forwarded-For (ตัวแรก) เฉพาะเมื่อมาจาก reverse proxy บนเครื่องเดียวกัน */
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const xff = req.headers['x-forwarded-for'];
  if (LOOPBACK.has(remote) && typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim().slice(0, 64);
  }
  return remote;
}

function createLimiter({ limit, windowMs }) {
  const hits = new Map();

  /** คืน true ถ้ายังไม่เกินโควตา (และนับครั้งนี้) */
  function take(key, now = Date.now()) {
    const since = now - windowMs;
    const list = (hits.get(key) || []).filter((t) => t > since);
    if (list.length >= limit) {
      hits.set(key, list);
      return false;
    }
    list.push(now);
    hits.set(key, list);
    return true;
  }

  // กวาด key ที่หมดอายุ กันหน่วยความจำโต
  const sweeper = setInterval(() => {
    const since = Date.now() - windowMs;
    for (const [key, list] of hits) {
      if (!list.some((t) => t > since)) hits.delete(key);
    }
  }, Math.min(windowMs, 10 * 60 * 1000));
  sweeper.unref();

  return { take };
}

module.exports = { clientIp, createLimiter };
