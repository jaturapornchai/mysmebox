'use strict';
// Session ผ่าน cookie `sid`: token สุ่ม 32 bytes (base64url) เก็บเฉพาะ sha256 hex ในตาราง sessions
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');
const { ApiError } = require('./http');

const COOKIE_NAME = 'sid';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

function cookieHeader(value, maxAgeSec) {
  const parts = [`${COOKIE_NAME}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

/** สร้าง session ใหม่ แล้วคืนค่า header Set-Cookie */
async function createSession(client, userId, expiresAt) {
  const token = crypto.randomBytes(32).toString('base64url');
  await client.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, expiresAt]);
  return cookieHeader(token, (expiresAt.getTime() - Date.now()) / 1000);
}

async function destroySession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  return cookieHeader('', 0);
}

const userJson = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatar_url,
  isDemo: u.is_demo,
  expiresAt: u.expires_at ? u.expires_at.toISOString() : null,
});

/** ผู้ใช้จาก cookie หรือ null (session หมดอายุ/ผู้ใช้ DEMO หมดอายุ = ไม่มี) */
async function findUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token || token.length > 100) return null;
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.name, u.avatar_url, u.is_demo, u.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()
        AND (NOT u.is_demo OR u.expires_at > NOW())`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

/** ร้านของผู้ใช้ = ร้านแรกที่เป็นสมาชิก (v1 มีร้านเดียวต่อผู้ใช้) */
async function findShopRow(userId) {
  const { rows } = await db.query(
    `SELECT s.*, m.role FROM shop_members m JOIN shops s ON s.id = m.shop_id
      WHERE m.user_id = $1 ORDER BY m.created_at, m.shop_id LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function requireUser(req) {
  const user = await findUser(req);
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบก่อนใช้งาน');
  return user;
}

/** ตรวจ Google ID token ผ่าน tokeninfo ตาม docs/api.md → { email, name, picture } */
async function verifyGoogleCredential(credential) {
  if (!config.googleClientId) throw new ApiError(503, 'GOOGLE_DISABLED', 'ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วย Google');
  if (typeof credential !== 'string' || credential.length < 10 || credential.length > 4096) {
    throw new ApiError(401, 'UNAUTHORIZED', 'ข้อมูลยืนยันตัวตนจาก Google ไม่ถูกต้อง');
  }
  let info;
  try {
    const url = `${config.googleTokeninfoUrl}?id_token=${encodeURIComponent(credential)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new ApiError(401, 'UNAUTHORIZED', 'ยืนยันตัวตนกับ Google ไม่สำเร็จ');
    info = await resp.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error('[auth] google tokeninfo error:', err.message);
    throw new ApiError(401, 'UNAUTHORIZED', 'ยืนยันตัวตนกับ Google ไม่สำเร็จ');
  }
  const validIss = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  const notExpired = Number.parseInt(info.exp, 10) * 1000 > Date.now();
  const verified = String(info.email_verified) === 'true';
  if (info.aud !== config.googleClientId || !validIss || !notExpired || !verified || !info.email) {
    throw new ApiError(401, 'UNAUTHORIZED', 'ยืนยันตัวตนกับ Google ไม่สำเร็จ');
  }
  return {
    email: String(info.email).toLowerCase().slice(0, 255),
    name: String(info.name || '').slice(0, 255),
    picture: /^https:\/\//.test(info.picture || '') ? String(info.picture) : '',
  };
}

module.exports = { createSession, destroySession, findUser, findShopRow, requireUser, verifyGoogleCredential, userJson, hashToken };
