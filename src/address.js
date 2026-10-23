'use strict';
// บล็อกที่อยู่ (ใช้ซ้ำใน shop / customer / warehouse / ที่อยู่จัดส่งของบิล)
const { str, badRequest } = require('./http');

const ADDRESS_COLUMNS = ['address_line', 'province_code', 'province_name', 'district_code', 'district_name', 'subdistrict_code', 'subdistrict_name', 'zip_code', 'lat', 'lng'];

function coord(value, label, limit) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < -limit || n > limit) throw badRequest(`${label} ไม่ถูกต้อง`);
  return Math.round(n * 1e6) / 1e6;
}

/** body (camelCase) → ค่าที่ตรวจแล้ว (ลำดับตรงกับ ADDRESS_COLUMNS) */
function parseAddress(src = {}) {
  const code = { max: 8, pattern: /^\d*$/, patternMsg: 'รหัสพื้นที่ต้องเป็นตัวเลข' };
  return {
    addressLine: str(src.addressLine, 'ที่อยู่', { max: 500 }),
    provinceCode: str(src.provinceCode, 'รหัสจังหวัด', code),
    provinceName: str(src.provinceName, 'จังหวัด', { max: 80 }),
    districtCode: str(src.districtCode, 'รหัสอำเภอ', code),
    districtName: str(src.districtName, 'อำเภอ/เขต', { max: 80 }),
    subdistrictCode: str(src.subdistrictCode, 'รหัสตำบล', code),
    subdistrictName: str(src.subdistrictName, 'ตำบล/แขวง', { max: 80 }),
    zipCode: str(src.zipCode, 'รหัสไปรษณีย์', { max: 8, pattern: /^\d{5}$/, patternMsg: 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก' }),
    lat: coord(src.lat, 'ละติจูด', 90),
    lng: coord(src.lng, 'ลองจิจูด', 180),
  };
}

const addressValues = (a) => [a.addressLine, a.provinceCode, a.provinceName, a.districtCode, a.districtName, a.subdistrictCode, a.subdistrictName, a.zipCode, a.lat, a.lng];

const numOrNull = (v) => (v === null || v === undefined ? null : Number(v));

/** แถว DB → Address block (lat/lng เป็น number หรือ null) */
function addressFromRow(r) {
  return {
    addressLine: r.address_line,
    provinceCode: r.province_code,
    provinceName: r.province_name,
    districtCode: r.district_code,
    districtName: r.district_name,
    subdistrictCode: r.subdistrict_code,
    subdistrictName: r.subdistrict_name,
    zipCode: r.zip_code,
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lng),
  };
}

module.exports = { ADDRESS_COLUMNS, parseAddress, addressValues, addressFromRow, numOrNull };
