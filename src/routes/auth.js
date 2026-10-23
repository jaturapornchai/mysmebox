'use strict';
const db = require('../db');
const config = require('../config');
const auth = require('../auth');
const { shopJson } = require('./shop');

/** สร้าง/อัปเดตผู้ใช้จากข้อมูล Google (ผู้ใช้จริง is_demo = false) */
async function upsertGoogleUser(client, g) {
  const { rows } = await client.query(
    `INSERT INTO users (email, name, avatar_url) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
     RETURNING id, email, name, avatar_url, is_demo, expires_at`,
    [g.email, g.name, g.picture]
  );
  return rows[0];
}

function register(router) {
  router.post('/api/auth/google', async (ctx) => {
    const g = await auth.verifyGoogleCredential(ctx.body.credential);
    const expiresAt = new Date(Date.now() + config.sessionDays * 86400 * 1000);
    const { user, cookie } = await db.tx(async (client) => {
      const u = await upsertGoogleUser(client, g);
      return { user: u, cookie: await auth.createSession(client, u.id, expiresAt) };
    });
    ctx.responseHeaders['Set-Cookie'] = cookie;
    const shop = await auth.findShopRow(user.id);
    return { user: auth.userJson(user), shop: shopJson(shop) };
  }, { auth: 'none' });

  router.post('/api/auth/logout', async (ctx) => {
    ctx.responseHeaders['Set-Cookie'] = await auth.destroySession(ctx.req);
    return {};
  }, { auth: 'none' });

  router.get('/api/me', async ({ user }) => {
    const shop = await auth.findShopRow(user.id);
    return { user: auth.userJson(user), shop: shopJson(shop) };
  }, { auth: 'user' });
}

module.exports = { register };
