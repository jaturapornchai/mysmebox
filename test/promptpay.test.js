'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crc16ccitt, buildPromptpayPayload, buildQrSvg, satangToBahtText } = require('../src/promptpay');

// CRC-16/CCITT-FALSE แบบตาราง (เขียนแยกอิสระจากตัวใน src เพื่อตรวจไขว้)
const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n << 8;
  for (let k = 0; k < 8; k++) c = c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1;
  return c & 0xffff;
});
function crcTable(str) {
  let crc = 0xffff;
  for (const b of Buffer.from(str, 'ascii')) crc = ((crc << 8) ^ TABLE[((crc >> 8) ^ b) & 0xff]) & 0xffff;
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** แตก TLV ระดับบนสุด */
function parseTlv(s) {
  const out = {};
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    out[id] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

test('CRC16-CCITT ตรงค่ามาตรฐาน "123456789" = 29B1', () => {
  assert.equal(crc16ccitt('123456789'), '29B1');
  assert.equal(crcTable('123456789'), '29B1');
  // payload ที่สร้างจากไลบรารีอิสระ promptpay-qr (ลำดับ tag ต่างจากเรา) ปิดท้ายด้วย CRC BB8A
  assert.equal(crc16ccitt('00020101021229370016A000000677010111011300668123456785802TH53037645406100.006304'), 'BB8A');
});

test('payload เบอร์ 0812345678 ยอด 100.00 บาท', () => {
  const payload = buildPromptpayPayload('0812345678', 10000n);
  const body = '000201' + '010212' + '2937' + '0016A000000677010111' + '01130066812345678' + '5303764' + '5406100.00' + '5802TH' + '6304';
  assert.equal(payload.slice(0, -4), body);
  assert.equal(payload.slice(-4), crcTable(body));
  assert.match(payload.slice(-4), /^[0-9A-F]{4}$/);
  const tlv = parseTlv(payload);
  assert.equal(tlv['54'], '100.00');
  assert.equal(tlv['58'], 'TH');
  assert.equal(parseTlv(tlv['29'])['01'], '0066812345678');
});

test('เลขประจำตัว 13 หลักใช้ sub-tag 02 และ QR ไม่ระบุยอดใช้ 01=11', () => {
  const p = buildPromptpayPayload('1234567890123', null);
  const tlv = parseTlv(p);
  assert.equal(tlv['01'], '11');
  assert.equal(tlv['54'], undefined);
  assert.equal(parseTlv(tlv['29'])['02'], '1234567890123');
  assert.equal(p.slice(-4), crcTable(p.slice(0, -4)));
});

test('ยอดสตางค์แปลงเป็นบาท 2 ตำแหน่งโดยไม่ใช้ float', () => {
  assert.equal(satangToBahtText(5n), '0.05');
  assert.equal(satangToBahtText(62000n), '620.00');
  assert.equal(satangToBahtText(123456789n), '1234567.89');
});

test('รหัสพร้อมเพย์ผิดรูปแบบ → error', () => {
  assert.throws(() => buildPromptpayPayload('12345', 100n));
});

test('สร้าง QR SVG ได้', async () => {
  const svg = await buildQrSvg(buildPromptpayPayload('0812345678', 10000n));
  assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
});
