'use strict';
// อัปโหลดรูป (สินค้า/สลิป) เก็บใน MinIO และเสิร์ฟกลับเฉพาะสมาชิกร้านเดียวกัน
const crypto = require('node:crypto');
const config = require('../config');
const { ApiError, oneOf, badRequest, notFound } = require('../http');

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};
const EXT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

let minioClient = null;
let bucketReady = null;

function storage() {
  if (!config.minio.enabled) throw new ApiError(503, 'STORAGE_DISABLED', 'ระบบเก็บไฟล์ยังไม่พร้อมใช้งาน');
  if (!minioClient) {
    const Minio = require('minio');
    const m = config.minio;
    minioClient = new Minio.Client({ endPoint: m.endPoint, port: m.port, useSSL: m.useSSL, accessKey: m.accessKey, secretKey: m.secretKey });
  }
  return minioClient;
}

/** สร้าง bucket ครั้งแรกถ้ายังไม่มี (cache promise ไว้; ล้มเหลว → ลองใหม่รอบหน้า) */
function ensureBucket(client) {
  if (!bucketReady) {
    bucketReady = (async () => {
      if (!(await client.bucketExists(config.minio.bucket))) await client.makeBucket(config.minio.bucket);
    })().catch((err) => {
      bucketReady = null;
      throw err;
    });
  }
  return bucketReady;
}

function decodeImage(body) {
  const kind = oneOf(body.kind, 'ประเภทไฟล์', ['product', 'slip']);
  const contentType = oneOf(body.contentType, 'ชนิดรูป', Object.keys(TYPES));
  if (typeof body.dataBase64 !== 'string' || !body.dataBase64) throw badRequest('ไม่พบข้อมูลรูป');
  const b64 = body.dataBase64.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) throw badRequest('ข้อมูลรูปไม่ถูกต้อง');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw badRequest('ข้อมูลรูปไม่ถูกต้อง');
  if (buf.length > MAX_BYTES) throw badRequest('รูปต้องมีขนาดไม่เกิน 5 MB');
  // ตรวจ magic bytes จริง ไม่เชื่อ contentType ที่ส่งมาอย่างเดียว
  if (buf.length < 12 || !TYPES[contentType].magic(buf)) throw badRequest('ไฟล์ไม่ใช่รูปชนิดที่ระบุ');
  return { kind, contentType, buf };
}

async function upload({ shopId, body }) {
  const client = storage();
  const { kind, contentType, buf } = decodeImage(body);
  const name = `${crypto.randomUUID()}.${TYPES[contentType].ext}`;
  const key = `${shopId}/${kind}/${name}`;
  try {
    await ensureBucket(client);
    await client.putObject(config.minio.bucket, key, buf, buf.length, { 'Content-Type': contentType });
  } catch (err) {
    console.error('[upload] minio put failed:', err.message);
    throw new ApiError(503, 'STORAGE_DISABLED', 'บันทึกไฟล์ไม่สำเร็จ กรุณาลองใหม่');
  }
  return { url: `/api/files/${key}` };
}

async function serveFile(ctx) {
  const client = storage();
  const { shopId: fileShopId, kind, name } = ctx.params;
  // ไฟล์ของร้านอื่น → 404 (ไม่บอกว่ามีอยู่จริงหรือไม่)
  if (fileShopId !== String(ctx.shopId)) throw notFound('ไม่พบไฟล์');
  const m = /^[0-9a-f-]{36}\.(jpg|png|webp)$/.exec(name);
  if (!['product', 'slip'].includes(kind) || !m) throw notFound('ไม่พบไฟล์');
  let stream;
  try {
    stream = await client.getObject(config.minio.bucket, `${fileShopId}/${kind}/${name}`);
  } catch (err) {
    if (err && (err.code === 'NoSuchKey' || err.code === 'NotFound')) throw notFound('ไม่พบไฟล์');
    console.error('[upload] minio get failed:', err.message);
    throw new ApiError(503, 'STORAGE_DISABLED', 'ระบบเก็บไฟล์ไม่พร้อมใช้งาน');
  }
  ctx.handled = true;
  ctx.res.writeHead(200, { 'Content-Type': EXT_TYPES[m[1]], 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  stream.on('error', () => ctx.res.destroy()).pipe(ctx.res);
}

function register(router) {
  router.post('/api/upload', upload, { bodyLimit: 7 * 1024 * 1024 });
  router.get('/api/files/:shopId/:kind/:name', serveFile);
}

module.exports = { register, decodeImage };
