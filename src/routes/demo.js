'use strict';
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const auth = require('../auth');
const { ApiError } = require('../http');
const { createLimiter } = require('../ratelimit');
const { seedDemoShop } = require('../seed/demo');
const { shopJson } = require('./shop');

// จำกัดการเปิดร้านทดลอง 10 ครั้ง/ชม./IP กันสร้างข้อมูลขยะ
const demoLimiter = createLimiter({ limit: 10, windowMs: 3600 * 1000 });

function register(router) {
  router.post('/api/demo/start', async (ctx) => {
    if (!demoLimiter.take(ctx.ip)) throw new ApiError(429, 'RATE_LIMIT', 'เปิดร้านทดลองบ่อยเกินไป กรุณาลองใหม่ภายหลัง');
    const expiresAt = new Date(Date.now() + config.demoHours * 3600 * 1000);
    const email = `demo-${crypto.randomBytes(8).toString('hex')}@demo.mysmebox.invalid`;
    const result = await db.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (email, name, is_demo, expires_at) VALUES ($1, 'ผู้ใช้ทดลอง', TRUE, $2)
         RETURNING id, email, name, avatar_url, is_demo, expires_at`,
        [email, expiresAt]
      );
      const shop = await seedDemoShop(client, rows[0].id);
      const cookie = await auth.createSession(client, rows[0].id, expiresAt);
      return { user: rows[0], shop, cookie };
    });
    ctx.responseHeaders['Set-Cookie'] = result.cookie;
    return { user: auth.userJson(result.user), shop: shopJson(result.shop) };
  }, { auth: 'none' });
}

module.exports = { register };
