'use strict';
// งานเบื้องหลัง: ลบผู้ใช้ DEMO ที่หมดอายุ (ข้อมูลร้านลบตาม ON DELETE CASCADE) และ session หมดอายุ
const db = require('../db');

const INTERVAL_MS = 30 * 60 * 1000;

async function runCleanup() {
  try {
    const demo = await db.query('DELETE FROM users WHERE is_demo AND expires_at < NOW()');
    const sess = await db.query('DELETE FROM sessions WHERE expires_at < NOW()');
    if (demo.rowCount || sess.rowCount) {
      console.log(`[cleanup] ลบผู้ใช้ทดลอง ${demo.rowCount} ราย, session หมดอายุ ${sess.rowCount} รายการ`);
    }
  } catch (err) {
    console.error('[cleanup] error:', err.message);
  }
}

function start() {
  runCleanup();
  setInterval(runCleanup, INTERVAL_MS).unref();
}

module.exports = { start, runCleanup };
