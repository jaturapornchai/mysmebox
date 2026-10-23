'use strict';
// ข้อมูลกลาง: ธนาคารไทย + ภูมิศาสตร์ไทย (77 จังหวัด) — โหลดครั้งเดียวไว้ในหน่วยความจำ
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { badRequest, notFound } = require('./http');

const BANKS = [
  { code: 'KBANK', botCode: '004', nameTh: 'ธนาคารกสิกรไทย', shortNameTh: 'กสิกรไทย', nameEn: 'Kasikornbank', color: '#138F2D' },
  { code: 'SCB', botCode: '014', nameTh: 'ธนาคารไทยพาณิชย์', shortNameTh: 'ไทยพาณิชย์', nameEn: 'Siam Commercial Bank', color: '#4E2E7F' },
  { code: 'KTB', botCode: '006', nameTh: 'ธนาคารกรุงไทย', shortNameTh: 'กรุงไทย', nameEn: 'Krungthai Bank', color: '#1BA5E1' },
  { code: 'BBL', botCode: '002', nameTh: 'ธนาคารกรุงเทพ', shortNameTh: 'กรุงเทพ', nameEn: 'Bangkok Bank', color: '#1E4598' },
  { code: 'BAY', botCode: '025', nameTh: 'ธนาคารกรุงศรีอยุธยา', shortNameTh: 'กรุงศรีอยุธยา', nameEn: 'Bank of Ayudhya', color: '#FEC43B' },
  { code: 'TTB', botCode: '011', nameTh: 'ธนาคารทหารไทยธนชาต', shortNameTh: 'ทีเอ็มบีธนชาต (ttb)', nameEn: 'TMBThanachart Bank', color: '#002D63' },
  { code: 'GSB', botCode: '030', nameTh: 'ธนาคารออมสิน', shortNameTh: 'ออมสิน', nameEn: 'Government Savings Bank', color: '#EB198D' },
  { code: 'BAAC', botCode: '034', nameTh: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร', shortNameTh: 'ธ.ก.ส.', nameEn: 'BAAC', color: '#255231' },
  { code: 'GHB', botCode: '033', nameTh: 'ธนาคารอาคารสงเคราะห์', shortNameTh: 'ธอส.', nameEn: 'Government Housing Bank', color: '#FF8614' },
  { code: 'KKP', botCode: '069', nameTh: 'ธนาคารเกียรตินาคินภัทร', shortNameTh: 'เกียรตินาคินภัทร', nameEn: 'Kiatnakin Phatra Bank', color: '#5A547C' },
  { code: 'CIMB', botCode: '022', nameTh: 'ธนาคารซีไอเอ็มบีไทย', shortNameTh: 'ซีไอเอ็มบีไทย', nameEn: 'CIMB Thai Bank', color: '#7E191D' },
  { code: 'TISCO', botCode: '067', nameTh: 'ธนาคารทิสโก้', shortNameTh: 'ทิสโก้', nameEn: 'TISCO Bank', color: '#104A8B' },
  { code: 'UOB', botCode: '024', nameTh: 'ธนาคารยูโอบี', shortNameTh: 'ยูโอบี', nameEn: 'United Overseas Bank (Thai)', color: '#0B3979' },
  { code: 'LHB', botCode: '071', nameTh: 'ธนาคารแลนด์ แอนด์ เฮ้าส์', shortNameTh: 'แลนด์ แอนด์ เฮ้าส์', nameEn: 'LH Bank', color: '#6D6E71' },
  { code: 'ICBC', botCode: '070', nameTh: 'ธนาคารไอซีบีซี (ไทย)', shortNameTh: 'ไอซีบีซี (ไทย)', nameEn: 'ICBC (Thai)', color: '#CD1511' },
  { code: 'TCRB', botCode: '073', nameTh: 'ธนาคารไทยเครดิต', shortNameTh: 'ไทยเครดิต', nameEn: 'Thai Credit Bank', color: '#004785' },
  { code: 'IBANK', botCode: '066', nameTh: 'ธนาคารอิสลามแห่งประเทศไทย', shortNameTh: 'อิสลามแห่งประเทศไทย', nameEn: 'Islamic Bank of Thailand', color: '#164626' },
  { code: 'CITI', botCode: '017', nameTh: 'ธนาคารซิตี้แบงก์', shortNameTh: 'ซิตี้แบงก์', nameEn: 'Citibank Thailand', color: '#003B70' },
  { code: 'HSBC', botCode: '031', nameTh: 'ธนาคารเอชเอสบีซี', shortNameTh: 'เอชเอสบีซี', nameEn: 'HSBC Thailand', color: '#DB0011' },
  { code: 'PROMPTPAY', botCode: '999', nameTh: 'พร้อมเพย์ (PromptPay QR)', shortNameTh: 'พร้อมเพย์', nameEn: 'PromptPay', color: '#0C4370' },
  { code: 'TRUEMONEY', botCode: '998', nameTh: 'ทรูมันนี่ วอลเล็ท (TrueMoney)', shortNameTh: 'ทรูมันนี่', nameEn: 'TrueMoney Wallet', color: '#FF6600' },
].map((b) => ({ ...b, logo: `/banks/${b.code.toLowerCase()}.webp` }));

const BANK_CODES = new Set(BANKS.map((b) => b.code));
const isBankCode = (code) => BANK_CODES.has(code);

const toNum = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

let geoCache = null;

/** โหลด data/thailand_geo.json ครั้งเดียว + ทำดัชนีแบบแบนไว้ค้นหาที่อยู่ */
function geo() {
  if (geoCache) return geoCache;
  const file = path.join(config.dataDir, 'thailand_geo.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const provinces = (raw.provinces || []).map((p) => ({
    code: String(p.code), th: p.th, en: p.en, lat: toNum(p.lat), lng: toNum(p.lng),
    districts: (p.districts || []).map((d) => ({
      code: String(d.code), th: d.th, lat: toNum(d.lat), lng: toNum(d.lng),
      subdistricts: (d.subdistricts || []).map((s) => ({ code: String(s.code), th: s.th, zipCode: String(s.zip_code || ''), lat: toNum(s.lat), lng: toNum(s.lng) })),
    })),
  }));
  const flat = [];
  for (const p of provinces) {
    for (const d of p.districts) {
      for (const s of d.subdistricts) {
        flat.push({ provinceCode: p.code, provinceTh: p.th, districtCode: d.code, districtTh: d.th, subdistrictCode: s.code, subdistrictTh: s.th, zipCode: s.zipCode, lat: s.lat ?? d.lat, lng: s.lng ?? d.lng });
      }
    }
  }
  geoCache = {
    provinces,
    byCode: new Map(provinces.map((p) => [p.code, p])),
    provinceList: provinces.map(({ code, th, en, lat, lng }) => ({ code, th, en, lat, lng })),
    flat,
  };
  return geoCache;
}

/** ค้นตำบลจากชื่อ (ใช้ใน seed) */
function findSubdistrict(provinceTh, districtTh, subdistrictTh) {
  return geo().flat.find((r) => r.provinceTh === provinceTh && r.districtTh === districtTh && r.subdistrictTh === subdistrictTh) || null;
}

function searchAddress(q) {
  const term = String(q || '').trim();
  if (term.length < 2) throw badRequest('กรุณาพิมพ์อย่างน้อย 2 ตัวอักษร');
  if (term.length > 60) throw badRequest('คำค้นยาวเกินไป');
  const isZip = /^\d+$/.test(term);
  const results = [];
  for (const r of geo().flat) {
    const hit = isZip ? r.zipCode.startsWith(term) : r.subdistrictTh.includes(term) || r.districtTh.includes(term) || r.provinceTh.includes(term);
    if (hit) {
      results.push(r);
      if (results.length >= 20) break;
    }
  }
  return results;
}

const CACHE_1_DAY = { 'Cache-Control': 'public, max-age=86400' };

function register(router) {
  const opts = { auth: 'none', headers: CACHE_1_DAY };
  router.get('/api/master/banks', async () => ({ banks: BANKS }), opts);
  router.get('/api/master/provinces', async () => ({ provinces: geo().provinceList }), opts);
  router.get('/api/master/geography', async ({ query }) => {
    const p = geo().byCode.get(String(query.get('province') || ''));
    if (!p) throw notFound('ไม่พบจังหวัด');
    return { province: { code: p.code, th: p.th, lat: p.lat, lng: p.lng, districts: p.districts } };
  }, opts);
  router.get('/api/master/address-search', async ({ query }) => ({ results: searchAddress(query.get('q')) }), opts);
}

module.exports = { BANKS, isBankCode, geo, findSubdistrict, searchAddress, register };
