'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const config = require('./config');

// pg คืน BIGINT/NUMERIC เป็น string อยู่แล้ว (ไม่แปลงเป็น JS number) — ตรงกับกฎเงินเป็นสตางค์ BigInt
const pool = new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30000 });
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

const query = (text, params) => pool.query(text, params);

/** รัน fn(client) ใน transaction เดียว; error → ROLLBACK แล้วโยนต่อ */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** รัน schema.sql (CREATE ... IF NOT EXISTS ทั้งหมด จึงรันซ้ำได้) — ล็อกกันหลาย process รันพร้อมกัน */
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(sql);
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}

module.exports = { pool, query, tx, migrate };
