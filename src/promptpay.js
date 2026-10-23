'use strict';
// Thai QR PromptPay (EMVCo Merchant Presented Mode) — สร้าง payload + CRC16-CCITT
const QRCode = require('qrcode');

const PROMPTPAY_AID = 'A000000677010111';

/** TLV: id(2) + ความยาว(2 หลัก) + ค่า */
const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF → hex ตัวใหญ่ 4 หลัก */
function crc16ccitt(text) {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** แปลงเบอร์/เลขประจำตัวเป็นค่าใน tag 29: เบอร์ → sub 01 "0066"+9 หลัก ; เลข 13 หลัก → sub 02 */
function promptpayTarget(id) {
  const digits = String(id || '').replace(/\D/g, '');
  if (/^0\d{9}$/.test(digits)) return tlv('01', `0066${digits.slice(1)}`);
  if (/^\d{13}$/.test(digits)) return tlv('02', digits);
  throw new Error('รหัสพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลข 13 หลัก');
}

/** ยอด BigInt สตางค์ → "123.45" (ไม่ผ่าน float) */
function satangToBahtText(satang) {
  const s = BigInt(satang);
  return `${s / 100n}.${String(s % 100n).padStart(2, '0')}`;
}

/** สร้าง payload; amountSatang = null → QR ไม่ระบุยอด (01 = "11") */
function buildPromptpayPayload(promptpayId, amountSatang = null) {
  const hasAmount = amountSatang !== null && amountSatang !== undefined && BigInt(amountSatang) > 0n;
  let payload =
    tlv('00', '01') +
    tlv('01', hasAmount ? '12' : '11') +
    tlv('29', tlv('00', PROMPTPAY_AID) + promptpayTarget(promptpayId)) +
    tlv('53', '764') +
    (hasAmount ? tlv('54', satangToBahtText(amountSatang)) : '') +
    tlv('58', 'TH');
  payload += '6304';
  return payload + crc16ccitt(payload);
}

function buildQrSvg(payload) {
  return QRCode.toString(payload, { type: 'svg', margin: 1 });
}

module.exports = { crc16ccitt, buildPromptpayPayload, buildQrSvg, satangToBahtText };
