// MySMEBox — Open Source Multi-Shop SaaS Platform (PostgreSQL + MinIO + Google Auth + Team RBAC + Free Leaflet Map + Central Thai Master Data + Ollama Cloud AI)
// GitHub: https://github.com/jaturapornchai/mysmebox
//
// โครงสร้างสำคัญตามมาตรฐานลุงจืด:
// 1. หน่วยนับ & บาร์โค้ด ([F7c140f1f] & [F2549a90f]):
//    - Product เก็บหน่วยฐาน (base_unit_code, base_unit, stand=1, divide=1), ยอดคงเหลือ (stock_base) และตารางหลายหน่วยนับ (unitConversions) พร้อม Matched Barcodes
//    - Barcode เก็บ barcode, unitCode (อ้างอิงจาก Product), ราคาปลีก/สมาชิก/ส่งตามหน่วยนับ และรูปภาพใน MinIO
// 2. ข้อมูลถาวรส่วนกลาง (Central System Master Data):
//    - ดึงจากระบบกลางอัตโนมัติ ไม่ต้องตั้งค่าใหม่: ธนาคารในไทย 20 แห่ง + พร้อมเพย์ (sys_banks) และข้อมูลภูมิศาสตร์ไทยครบ 77 จังหวัด, 928 อำเภอ/เขต, 7,436 ตำบล/แขวง พร้อมรหัสไปรษณีย์ (zip_code) และพิกัด GPS (lat, lng)
// 3. ระบบแผนที่ฟรี (OpenStreetMap + Leaflet + Nominatim):
//    - ปักหมุดและติดตามตำแหน่ง ลูกค้า (CUSTOMER), โกดัง/สาขา (WAREHOUSE), และจุดจัดส่งพัสดุพร้อมสถานะจัดส่ง (DELIVERY)
// 4. โหมด DEMO ทันที (ไม่ต้องผ่าน Google Login):
//    - กดปุ่ม DEMO เข้าทดลองเล่น ดูรายการสินค้า ร้านค้าหลายสาขา แผนที่ และรายงานการเงิน/ภาษีครบถ้วนทันที

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { Pool } = require("pg");
const Minio = require("minio");

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.error("Failed to read .env:", err.message);
  }
}

loadEnvFile(path.join(__dirname, ".env"));

function autoDiscoverInfraEnv() {
  try {
    if (!process.env.PG_PASSWORD) {
      const pgInspect = JSON.parse(execSync("docker inspect sml_postgresql", { stdio: ["ignore", "pipe", "ignore"] }).toString());
      const envArr = pgInspect[0]?.Config?.Env || [];
      const findEnv = (k) => (envArr.find((x) => x.startsWith(k + "=")) || "").split("=").slice(1).join("=");
      process.env.PG_PASSWORD = findEnv("POSTGRES_PASSWORD");
    }
  } catch {}
  try {
    if (!process.env.MINIO_ACCESS_KEY) {
      const mInspect = JSON.parse(execSync("docker inspect sml_minio", { stdio: ["ignore", "pipe", "ignore"] }).toString());
      const envArr = mInspect[0]?.Config?.Env || [];
      const findEnv = (k) => (envArr.find((x) => x.startsWith(k + "=")) || "").split("=").slice(1).join("=");
      process.env.MINIO_ACCESS_KEY = findEnv("MINIO_ROOT_USER") || findEnv("MINIO_ACCESS_KEY");
      process.env.MINIO_SECRET_KEY = findEnv("MINIO_ROOT_PASSWORD") || findEnv("MINIO_SECRET_KEY");
    }
  } catch {}
}

autoDiscoverInfraEnv();

const PORT = Number(process.env.PORT || 3850);
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || "https://ollama.com/api/chat";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gpt-oss:120b";
const ALLOWED_MODELS = [
  "gpt-oss:120b",
  "deepseek-v4.1-flash",
  "glm-5.3-flash",
  "kimi-k3",
  "gemma4:31b"
];

const pgPool = new Pool({
  host: process.env.PG_HOST || "127.0.0.1",
  port: Number(process.env.PG_PORT || 5432),
  database: process.env.PG_DATABASE || "mysmebox",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "",
  max: 12
});

const MINIO_BUCKET = process.env.MINIO_BUCKET || "mysmebox";
let minioClient = null;
if (process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY) {
  minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || "127.0.0.1",
    port: Number(process.env.MINIO_PORT || 9100),
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY
  });
}

// ============================================================================
// ข้อมูลถาวรจากระบบกลาง (Central System Master Data)
// 1. ธนาคารในประเทศไทยครบถ้วน (THAI_BANKS_MASTER)
// 2. ข้อมูลภูมิศาสตร์ไทยครบ 77 จังหวัด 928 อำเภอ 7,436 ตำบล พร้อมรหัสไปรษณีย์และพิกัด GPS
// ============================================================================
const THAI_BANKS_MASTER = [
  { code: "KBANK", botCode: "004", nameTh: "ธนาคารกสิกรไทย", shortNameTh: "กสิกรไทย", nameEn: "Kasikornbank", color: "#138F2D", logo: "/banks/kbank.webp" },
  { code: "SCB", botCode: "014", nameTh: "ธนาคารไทยพาณิชย์", shortNameTh: "ไทยพาณิชย์", nameEn: "Siam Commercial Bank", color: "#4E2E7F", logo: "/banks/scb.webp" },
  { code: "KTB", botCode: "006", nameTh: "ธนาคารกรุงไทย", shortNameTh: "กรุงไทย", nameEn: "Krungthai Bank", color: "#1BA5E1", logo: "/banks/ktb.webp" },
  { code: "BBL", botCode: "002", nameTh: "ธนาคารกรุงเทพ", shortNameTh: "กรุงเทพ", nameEn: "Bangkok Bank", color: "#1E4598", logo: "/banks/bbl.webp" },
  { code: "BAY", botCode: "025", nameTh: "ธนาคารกรุงศรีอยุธยา", shortNameTh: "กรุงศรีอยุธยา", nameEn: "Bank of Ayudhya", color: "#FEC43B", logo: "/banks/bay.webp" },
  { code: "TTB", botCode: "011", nameTh: "ธนาคารทหารไทยธนชาต", shortNameTh: "ทีเอ็มบีธนชาต (ttb)", nameEn: "TMBThanachart Bank", color: "#002D63", logo: "/banks/ttb.webp" },
  { code: "GSB", botCode: "030", nameTh: "ธนาคารออมสิน", shortNameTh: "ออมสิน", nameEn: "Government Savings Bank", color: "#EB198D", logo: "/banks/gsb.webp" },
  { code: "BAAC", botCode: "034", nameTh: "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร", shortNameTh: "ธ.ก.ส.", nameEn: "BAAC", color: "#255231", logo: "/banks/baac.webp" },
  { code: "GHB", botCode: "033", nameTh: "ธนาคารอาคารสงเคราะห์", shortNameTh: "ธอส.", nameEn: "Government Housing Bank", color: "#FF8614", logo: "/banks/ghb.webp" },
  { code: "KKP", botCode: "069", nameTh: "ธนาคารเกียรตินาคินภัทร", shortNameTh: "เกียรตินาคินภัทร", nameEn: "Kiatnakin Phatra Bank", color: "#5A547C", logo: "/banks/kkp.webp" },
  { code: "CIMB", botCode: "022", nameTh: "ธนาคารซีไอเอ็มบีไทย", shortNameTh: "ซีไอเอ็มบีไทย", nameEn: "CIMB Thai Bank", color: "#7E191D", logo: "/banks/cimb.webp" },
  { code: "TISCO", botCode: "067", nameTh: "ธนาคารทิสโก้", shortNameTh: "ทิสโก้", nameEn: "TISCO Bank", color: "#104A8B", logo: "/banks/tisco.webp" },
  { code: "UOB", botCode: "024", nameTh: "ธนาคารยูโอบี", shortNameTh: "ยูโอบี", nameEn: "United Overseas Bank (Thai)", color: "#0B3979", logo: "/banks/uob.webp" },
  { code: "LHB", botCode: "071", nameTh: "ธนาคารแลนด์ แอนด์ เฮ้าส์", shortNameTh: "แลนด์ แอนด์ เฮ้าส์", nameEn: "LH Bank", color: "#6D6E71", logo: "/banks/lhb.webp" },
  { code: "ICBC", botCode: "070", nameTh: "ธนาคารไอซีบีซี (ไทย)", shortNameTh: "ไอซีบีซี (ไทย)", nameEn: "ICBC (Thai)", color: "#CD1511", logo: "/banks/icbc.webp" },
  { code: "TCRB", botCode: "073", nameTh: "ธนาคารไทยเครดิต", shortNameTh: "ไทยเครดิต", nameEn: "Thai Credit Bank", color: "#004785", logo: "/banks/tcrb.webp" },
  { code: "IBANK", botCode: "066", nameTh: "ธนาคารอิสลามแห่งประเทศไทย", shortNameTh: "อิสลามแห่งประเทศไทย", nameEn: "Islamic Bank of Thailand", color: "#164626", logo: "/banks/ibank.webp" },
  { code: "CITI", botCode: "017", nameTh: "ธนาคารซิตี้แบงก์", shortNameTh: "ซิตี้แบงก์", nameEn: "Citibank Thailand", color: "#003B70", logo: "/banks/citi.webp" },
  { code: "HSBC", botCode: "031", nameTh: "ธนาคารเอชเอสบีซี", shortNameTh: "เอชเอสบีซี", nameEn: "HSBC Thailand", color: "#DB0011", logo: "/banks/hsbc.webp" },
  { code: "PROMPTPAY", botCode: "999", nameTh: "พร้อมเพย์ (PromptPay QR)", shortNameTh: "พร้อมเพย์", nameEn: "PromptPay", color: "#0C4370", logo: "/banks/promptpay.webp" },
  { code: "TRUEMONEY", botCode: "998", nameTh: "ทรูมันนี่ วอลเล็ท (TrueMoney)", shortNameTh: "ทรูมันนี่", nameEn: "TrueMoney Wallet", color: "#FF6600", logo: "/banks/truemoney.webp" }
];

let THAI_GEO = { provinces: [], totalProvinces: 0, totalDistricts: 0, totalSubdistricts: 0, flatSubdistricts: [] };

function loadThailandGeographyMaster() {
  try {
    const geoPath = path.join(__dirname, "data", "thailand_geo.json");
    if (!fs.existsSync(geoPath)) return;
    const raw = JSON.parse(fs.readFileSync(geoPath, "utf8"));
    const provinces = Array.isArray(raw.provinces) ? raw.provinces : [];
    let dCount = 0;
    let sCount = 0;
    const flat = [];

    for (const p of provinces) {
      const districts = Array.isArray(p.districts) ? p.districts : [];
      dCount += districts.length;
      for (const d of districts) {
        const subs = Array.isArray(d.subdistricts) ? d.subdistricts : [];
        sCount += subs.length;
        for (const s of subs) {
          flat.push({
            provinceCode: p.code,
            provinceTh: p.th,
            provinceEn: p.en,
            districtCode: d.code,
            districtTh: d.th,
            districtEn: d.en,
            subdistrictCode: s.code,
            subdistrictTh: s.th,
            subdistrictEn: s.en,
            zipCode: s.zip_code || "",
            lat: Number(s.lat || d.lat || p.lat || 13.7563),
            lng: Number(s.lng || d.lng || p.lng || 100.5018)
          });
        }
      }
    }

    THAI_GEO = {
      provinces,
      totalProvinces: provinces.length,
      totalDistricts: dCount,
      totalSubdistricts: sCount,
      flatSubdistricts: flat
    };
    console.log(`Loaded Central Thai Geography Master: ${provinces.length} provinces, ${dCount} districts, ${sCount} subdistricts with GPS coordinates.`);
  } catch (err) {
    console.error("Failed to load thailand_geo.json:", err.message);
  }
}

loadThailandGeographyMaster();

function toSatang(input) {
  const raw = String(input ?? "0").replace(/,/g, "").trim();
  if (!raw || !/^-?\d+(\.\d{0,4})?$/.test(raw)) return 0n;
  const isNeg = raw.startsWith("-");
  const clean = isNeg ? raw.slice(1) : raw;
  const parts = clean.split(".");
  const whole = BigInt(parts[0] || "0");
  const fracStr = (parts[1] || "").padEnd(3, "0");
  const twoDigits = BigInt(fracStr.slice(0, 2));
  const thirdDigit = Number(fracStr[2] || "0");
  const roundedFrac = thirdDigit >= 5 ? twoDigits + 1n : twoDigits;
  const total = whole * 100n + roundedFrac;
  return isNeg ? -total : total;
}

function calcPercentSatang(amountSatang, percentInt) {
  const amt = BigInt(amountSatang || 0);
  const pct = BigInt(percentInt || 0);
  const prod = amt * pct;
  const half = 50n;
  return prod >= 0n ? (prod + half) / 100n : (prod - half) / 100n;
}

const ROLE_PRESETS = {
  OWNER: {
    label: "เจ้าของกิจการ (Owner)",
    canSell: true,
    canStock: true,
    canExpense: true,
    canViewProfit: true,
    canTax: true,
    canManageTeam: true
  },
  MANAGER: {
    label: "ผู้จัดการร้าน (Manager)",
    canSell: true,
    canStock: true,
    canExpense: true,
    canViewProfit: true,
    canTax: true,
    canManageTeam: false
  },
  ADMIN_LIVE: {
    label: "แอดมินตอบแชท / ดูด CF / เปิดบิล",
    canSell: true,
    canStock: false,
    canExpense: false,
    canViewProfit: false,
    canTax: false,
    canManageTeam: false
  },
  PACKER: {
    label: "ฝ่ายแพ็กของ / ยิงบาร์โค้ดสต๊อก",
    canSell: false,
    canStock: true,
    canExpense: false,
    canViewProfit: false,
    canTax: false,
    canManageTeam: false
  },
  ACCOUNTANT: {
    label: "ฝ่ายบัญชี / สำนักงานบัญชี",
    canSell: false,
    canStock: false,
    canExpense: true,
    canViewProfit: true,
    canTax: true,
    canManageTeam: false
  }
};

function buildProductUnitsAndBarcodes(pRow) {
  const rawUnits = Array.isArray(pRow.units_json) ? pRow.units_json : [];
  const unitConversions = Array.isArray(pRow.unit_conversions_json) && pRow.unit_conversions_json.length > 0
    ? pRow.unit_conversions_json
    : rawUnits.map((u, idx) => ({
        unitCode: u.unitCode || `U${idx + 1}`,
        unitName: u.unitName || pRow.base_unit,
        standValue: Number(u.standValue || u.factor || 1),
        divideValue: Number(u.divideValue || 1),
        ratio: Number(u.standValue || u.factor || 1) / Number(u.divideValue || 1)
      }));

  const barcodes = Array.isArray(pRow.barcodes_json) && pRow.barcodes_json.length > 0
    ? pRow.barcodes_json
    : rawUnits.map((u, idx) => ({
        barcode: u.barcode || "",
        unitCode: u.unitCode || `U${idx + 1}`,
        unitName: u.unitName || pRow.base_unit,
        priceSatang: String(u.priceSatang || "0"),
        priceMemberSatang: String(u.priceMemberSatang || u.priceSatang || "0"),
        priceWholesaleSatang: String(u.priceWholesaleSatang || u.priceSatang || "0"),
        costSatang: String(u.costSatang || "0"),
        isMainBarcode: idx === 0,
        description: u.description || ""
      }));

  const units = barcodes.map((b) => {
    const matchedUom = unitConversions.find((u) => String(u.unitCode).toUpperCase() === String(b.unitCode).toUpperCase()) ||
      unitConversions[0] || { unitCode: b.unitCode, unitName: b.unitName || pRow.base_unit, standValue: 1, divideValue: 1, ratio: 1 };
    const factor = Number(matchedUom.standValue || 1) / Number(matchedUom.divideValue || 1);
    return {
      unitCode: matchedUom.unitCode,
      unitName: matchedUom.unitName,
      standValue: Number(matchedUom.standValue || 1),
      divideValue: Number(matchedUom.divideValue || 1),
      factor,
      barcode: b.barcode,
      costSatang: String(b.costSatang || "0"),
      priceSatang: String(b.priceSatang || "0"),
      priceMemberSatang: String(b.priceMemberSatang || b.priceSatang || "0"),
      priceWholesaleSatang: String(b.priceWholesaleSatang || b.priceSatang || "0"),
      description: b.description || ""
    };
  });

  const enrichedConversions = unitConversions.map((u) => ({
    ...u,
    matchedBarcodes: barcodes
      .filter((b) => String(b.unitCode).toUpperCase() === String(u.unitCode).toUpperCase())
      .map((b) => b.barcode)
  }));

  return {
    unitConversions: enrichedConversions,
    barcodes,
    units
  };
}

async function initDatabaseAndMinio() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS sys_banks (
      code VARCHAR(32) PRIMARY KEY,
      bot_code VARCHAR(16) NOT NULL,
      name_th VARCHAR(255) NOT NULL,
      short_name_th VARCHAR(120) NOT NULL,
      name_en VARCHAR(255) NOT NULL,
      color VARCHAR(32) NOT NULL,
      logo_url TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sys_provinces (
      code VARCHAR(16) PRIMARY KEY,
      name_th VARCHAR(255) NOT NULL,
      name_en VARCHAR(255) NOT NULL,
      lat NUMERIC(12,6) NOT NULL DEFAULT 13.7563,
      lng NUMERIC(12,6) NOT NULL DEFAULT 100.5018,
      district_count INT NOT NULL DEFAULT 0,
      subdistrict_count INT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS users (
      email VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shops (
      id SERIAL PRIMARY KEY,
      shop_code VARCHAR(64) UNIQUE NOT NULL,
      owner_email VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(120) NOT NULL DEFAULT 'แม่ค้าออนไลน์ / ค้าปลีก-ส่ง',
      promptpay_id VARCHAR(64) NOT NULL DEFAULT '089-999-8888',
      bank_code VARCHAR(32) NOT NULL DEFAULT 'KBANK',
      bank_account_no VARCHAR(64) NOT NULL DEFAULT '123-4-56789-0',
      bank_account_name VARCHAR(255) NOT NULL DEFAULT 'บจก. มายเอสเอ็มอีบ็อกซ์ โฮลดิ้ง',
      province_code VARCHAR(16) NOT NULL DEFAULT '10',
      province_name VARCHAR(120) NOT NULL DEFAULT 'กรุงเทพมหานคร',
      district_code VARCHAR(16) NOT NULL DEFAULT '1038',
      district_name VARCHAR(120) NOT NULL DEFAULT 'ลาดพร้าว',
      subdistrict_code VARCHAR(16) NOT NULL DEFAULT '103801',
      subdistrict_name VARCHAR(120) NOT NULL DEFAULT 'ลาดพร้าว',
      zip_code VARCHAR(16) NOT NULL DEFAULT '10230',
      lat NUMERIC(12,6) NOT NULL DEFAULT 13.811000,
      lng NUMERIC(12,6) NOT NULL DEFAULT 100.612000,
      logo_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE shops ADD COLUMN IF NOT EXISTS bank_code VARCHAR(32) NOT NULL DEFAULT 'KBANK';
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS bank_account_no VARCHAR(64) NOT NULL DEFAULT '123-4-56789-0';
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS bank_account_name VARCHAR(255) NOT NULL DEFAULT 'บจก. มายเอสเอ็มอีบ็อกซ์ โฮลดิ้ง';
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS province_code VARCHAR(16) NOT NULL DEFAULT '10';
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS province_name VARCHAR(120) NOT NULL DEFAULT 'กรุงเทพมหานคร';
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS district_code VARCHAR(16) NOT NULL DEFAULT '1038';
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS district_name VARCHAR(120) NOT NULL DEFAULT 'ลาดพร้าว';
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS subdistrict_code VARCHAR(16) NOT NULL DEFAULT '103801';
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS subdistrict_name VARCHAR(120) NOT NULL DEFAULT 'ลาดพร้าว';
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS zip_code VARCHAR(16) NOT NULL DEFAULT '10230';
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS lat NUMERIC(12,6) NOT NULL DEFAULT 13.811000;
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS lng NUMERIC(12,6) NOT NULL DEFAULT 100.612000;

    CREATE TABLE IF NOT EXISTS shop_members (
      id SERIAL PRIMARY KEY,
      shop_id INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'ADMIN_LIVE',
      permissions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      added_by_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(shop_id, email)
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      shop_id INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      prod_code VARCHAR(64) NOT NULL,
      sku VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      base_unit_code VARCHAR(64) NOT NULL DEFAULT 'PCS',
      base_unit VARCHAR(64) NOT NULL,
      stock_base NUMERIC(18,2) NOT NULL DEFAULT 0,
      min_stock_base NUMERIC(18,2) NOT NULL DEFAULT 5,
      image_url TEXT,
      unit_conversions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      barcodes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      units_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE products ADD COLUMN IF NOT EXISTS base_unit_code VARCHAR(64) NOT NULL DEFAULT 'PCS';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_conversions_json JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS barcodes_json JSONB NOT NULL DEFAULT '[]'::jsonb;

    CREATE TABLE IF NOT EXISTS bills (
      id SERIAL PRIMARY KEY,
      shop_id INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      bill_no VARCHAR(64) NOT NULL,
      bill_date VARCHAR(64) NOT NULL,
      customer VARCHAR(255) NOT NULL,
      address TEXT,
      province_name VARCHAR(120) DEFAULT 'กรุงเทพมหานคร',
      district_name VARCHAR(120) DEFAULT '',
      subdistrict_name VARCHAR(120) DEFAULT '',
      zip_code VARCHAR(16) DEFAULT '',
      lat NUMERIC(12,6) DEFAULT 13.756300,
      lng NUMERIC(12,6) DEFAULT 100.501800,
      bank_code VARCHAR(32) DEFAULT 'KBANK',
      channel VARCHAR(64) NOT NULL DEFAULT 'LINE OA',
      courier VARCHAR(64) NOT NULL DEFAULT 'Flash Express',
      tracking_no VARCHAR(100),
      doc_type VARCHAR(40) NOT NULL DEFAULT 'RECEIPT',
      status VARCHAR(40) NOT NULL DEFAULT 'PAID',
      pay_method VARCHAR(100),
      slip_image_url TEXT,
      items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      shipping_satang BIGINT NOT NULL DEFAULT 0,
      subtotal_satang BIGINT NOT NULL DEFAULT 0,
      vat_satang BIGINT NOT NULL DEFAULT 0,
      grand_total_satang BIGINT NOT NULL DEFAULT 0,
      cost_total_satang BIGINT NOT NULL DEFAULT 0,
      profit_satang BIGINT NOT NULL DEFAULT 0,
      created_by_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE bills ADD COLUMN IF NOT EXISTS province_name VARCHAR(120) DEFAULT 'กรุงเทพมหานคร';
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS district_name VARCHAR(120) DEFAULT '';
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS subdistrict_name VARCHAR(120) DEFAULT '';
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS zip_code VARCHAR(16) DEFAULT '';
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS lat NUMERIC(12,6) DEFAULT 13.756300;
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS lng NUMERIC(12,6) DEFAULT 100.501800;
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS bank_code VARCHAR(32) DEFAULT 'KBANK';

    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      shop_id INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      exp_no VARCHAR(64) NOT NULL,
      exp_date VARCHAR(40) NOT NULL,
      vendor VARCHAR(255) NOT NULL,
      category VARCHAR(120) NOT NULL,
      bank_code VARCHAR(32) DEFAULT 'KBANK',
      receipt_image_url TEXT,
      amount_satang BIGINT NOT NULL DEFAULT 0,
      vat_satang BIGINT NOT NULL DEFAULT 0,
      wht_rate INT NOT NULL DEFAULT 0,
      wht_satang BIGINT NOT NULL DEFAULT 0,
      net_pay_satang BIGINT NOT NULL DEFAULT 0,
      created_by_email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_code VARCHAR(32) DEFAULT 'KBANK';

    CREATE TABLE IF NOT EXISTS shop_locations (
      id SERIAL PRIMARY KEY,
      shop_id INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      loc_code VARCHAR(64) NOT NULL,
      loc_type VARCHAR(32) NOT NULL DEFAULT 'CUSTOMER',
      title VARCHAR(255) NOT NULL,
      contact_name VARCHAR(255),
      phone VARCHAR(64),
      address_line TEXT,
      province_code VARCHAR(16),
      province_name VARCHAR(120),
      district_code VARCHAR(16),
      district_name VARCHAR(120),
      subdistrict_code VARCHAR(16),
      subdistrict_name VARCHAR(120),
      zip_code VARCHAR(16),
      lat NUMERIC(12,6) NOT NULL,
      lng NUMERIC(12,6) NOT NULL,
      delivery_status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
      courier VARCHAR(64),
      tracking_no VARCHAR(100),
      bill_no VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_shop_members_email ON shop_members(email);
    CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);
    CREATE INDEX IF NOT EXISTS idx_bills_shop ON bills(shop_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_shop ON expenses(shop_id);
    CREATE INDEX IF NOT EXISTS idx_locations_shop ON shop_locations(shop_id);
  `);

  // Seed Central Thai Banks Master (sys_banks)
  for (const b of THAI_BANKS_MASTER) {
    await pgPool.query(
      `INSERT INTO sys_banks (code, bot_code, name_th, short_name_th, name_en, color, logo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE SET
         bot_code = EXCLUDED.bot_code,
         name_th = EXCLUDED.name_th,
         short_name_th = EXCLUDED.short_name_th,
         name_en = EXCLUDED.name_en,
         color = EXCLUDED.color,
         logo_url = EXCLUDED.logo_url`,
      [b.code, b.botCode, b.nameTh, b.shortNameTh, b.nameEn, b.color, b.logo]
    );
  }

  // Seed Central 77 Thai Provinces Summary in PostgreSQL (sys_provinces)
  for (const p of THAI_GEO.provinces) {
    const districts = Array.isArray(p.districts) ? p.districts : [];
    const subCount = districts.reduce((acc, d) => acc + (Array.isArray(d.subdistricts) ? d.subdistricts.length : 0), 0);
    await pgPool.query(
      `INSERT INTO sys_provinces (code, name_th, name_en, lat, lng, district_count, subdistrict_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE SET
         name_th = EXCLUDED.name_th,
         name_en = EXCLUDED.name_en,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         district_count = EXCLUDED.district_count,
         subdistrict_count = EXCLUDED.subdistrict_count`,
      [p.code, p.th, p.en, Number(p.lat || 13.7563), Number(p.lng || 100.5018), districts.length, subCount]
    );
  }

  if (minioClient) {
    const exists = await minioClient.bucketExists(MINIO_BUCKET).catch(() => false);
    if (!exists) {
      await minioClient.makeBucket(MINIO_BUCKET, "us-east-1").catch((e) => {
        console.warn("MinIO makeBucket warning:", e.message);
      });
    }
  }
}

async function seedRichDemoLocations(shop1Id, shop2Id, shop3Id) {
  const locCheck = await pgPool.query(`SELECT id FROM shop_locations WHERE shop_id = $1 LIMIT 1`, [shop1Id]);
  if (locCheck.rowCount === 0) {
    await pgPool.query(
      `INSERT INTO shop_locations (
         shop_id, loc_code, loc_type, title, contact_name, phone, address_line,
         province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code,
         lat, lng, delivery_status, courier, tracking_no, bill_no
       ) VALUES
       ($1, 'LOC-WH-01', 'WAREHOUSE', 'โกดังหลัก & สตูดิโอไลฟ์สด (ลาดพร้าว)', 'คุณจืด (เจ้าของกิจการ)', '089-999-8888', '88/9 ถ.ลาดพร้าว', '10', 'กรุงเทพมหานคร', '1038', 'ลาดพร้าว', '103801', 'ลาดพร้าว', '10230', 13.811000, 100.612000, 'ACTIVE_WAREHOUSE', '-', '-', '-'),
       ($1, 'LOC-WH-02', 'WAREHOUSE', 'คลังแพ็กสินค้าบางพลี (ใกล้สนามบินสุวรรณภูมิ)', 'หัวหน้าคลังแพ็กของ', '081-777-9900', '120/5 ถ.บางนา-ตราด', '11', 'สมุทรปราการ', '1103', 'บางพลี', '110301', 'บางพลีใหญ่', '10540', 13.618000, 100.694000, 'ACTIVE_WAREHOUSE', '-', '-', '-'),
       ($1, 'LOC-CU-01', 'CUSTOMER', 'คุณพลอย (ตัวแทน VIP สุขุมวิท)', 'คุณพลอย', '081-234-5678', '99/12 ถ.สุขุมวิท', '10', 'กรุงเทพมหานคร', '1039', 'วัฒนา', '103902', 'คลองตันเหนือ', '10110', 13.736000, 100.576000, 'DELIVERED', 'Flash Express', 'TH0129485712A', 'INV-202610-001'),
       ($1, 'LOC-DL-01', 'DELIVERY', 'จัดส่งคุณเมย์ (CF Facebook Live)', 'คุณเมย์', '086-555-9988', '188 ถ.สีลม', '10', 'กรุงเทพมหานคร', '1004', 'บางรัก', '100403', 'สุริยวงศ์', '10500', 13.724000, 100.530000, 'COD_PENDING', 'Kerry / KEX', 'KEX908172635TH', 'INV-202610-002'),
       ($1, 'LOC-DL-02', 'DELIVERY', 'จัดส่งคุณแพรว (ตัวแทนเชียงใหม่ นิมมาน)', 'คุณแพรว เชียงใหม่', '089-444-5566', '22 ถ.นิมมานเหมินท์', '50', 'เชียงใหม่', '5001', 'เมืองเชียงใหม่', '500104', 'สุเทพ', '50200', 18.796143, 98.967026, 'IN_TRANSIT', 'J&T Express', 'JT8273649981', 'INV-202610-003')`,
      [shop1Id]
    );
  }

  if (shop2Id) {
    const loc2Check = await pgPool.query(`SELECT id FROM shop_locations WHERE shop_id = $1 LIMIT 1`, [shop2Id]);
    if (loc2Check.rowCount === 0) {
      await pgPool.query(
        `INSERT INTO shop_locations (
           shop_id, loc_code, loc_type, title, contact_name, phone, address_line,
           province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code,
           lat, lng, delivery_status, courier, tracking_no, bill_no
         ) VALUES
         ($1, 'LOC-WH-01', 'WAREHOUSE', 'โรงคั่วกาแฟ & คลังมัทฉะ (อารีย์)', 'คุณจืด', '089-999-8888', '45 ซ.อารีย์ 2', '10', 'กรุงเทพมหานคร', '1014', 'พญาไท', '101401', 'สามเสนใน', '10400', 13.782000, 100.545000, 'ACTIVE_WAREHOUSE', '-', '-', '-'),
         ($1, 'LOC-CU-01', 'CUSTOMER', 'ร้าน Slowbar อารีย์ (ลูกค้าประจำ)', 'คุณบอย บาริสต้า', '089-777-1234', '88 ซ.อารีย์สัมพันธ์', '10', 'กรุงเทพมหานคร', '1014', 'พญาไท', '101401', 'สามเสนใน', '10400', 13.779500, 100.541000, 'DELIVERED', 'J&T Express', 'JT8273645190', 'INV-202610-001')`,
        [shop2Id]
      );
    }
  }

  if (shop3Id) {
    const loc3Check = await pgPool.query(`SELECT id FROM shop_locations WHERE shop_id = $1 LIMIT 1`, [shop3Id]);
    if (loc3Check.rowCount === 0) {
      await pgPool.query(
        `INSERT INTO shop_locations (
           shop_id, loc_code, loc_type, title, contact_name, phone, address_line,
           province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code,
           lat, lng, delivery_status, courier, tracking_no, bill_no
         ) VALUES
         ($1, 'LOC-WH-01', 'WAREHOUSE', 'สตูดิโอเสื้อผ้าแฟชั่น TikTok (ห้วยขวาง)', 'คุณจืด', '089-999-8888', '99 ถ.รัชดาภิเษก', '10', 'กรุงเทพมหานคร', '1017', 'ห้วยขวาง', '101701', 'ห้วยขวาง', '10310', 13.769000, 100.577000, 'ACTIVE_WAREHOUSE', '-', '-', '-')`,
        [shop3Id]
      );
    }
  }
}

async function ensureUserAndSeedShops(email, name, avatarUrl, forceResetDemo = false) {
  const cleanEmail = String(email || "owner.mysmebox@gmail.com").toLowerCase().trim();
  const cleanName = String(name || cleanEmail.split("@")[0]).trim();

  await pgPool.query(
    `INSERT INTO users (email, name, avatar_url)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)`,
    [cleanEmail, cleanName, avatarUrl || null]
  );

  if (forceResetDemo && cleanEmail === "owner.mysmebox@gmail.com") {
    await pgPool.query(`DELETE FROM shops WHERE owner_email = $1`, [cleanEmail]);
  }

  const memberCheck = await pgPool.query(
    `SELECT shop_id FROM shop_members WHERE email = $1 ORDER BY shop_id ASC`,
    [cleanEmail]
  );

  if (memberCheck.rowCount > 0) {
    // Ensure locations exist even for previously seeded shops
    const ids = memberCheck.rows.map((r) => r.shop_id);
    await seedRichDemoLocations(ids[0], ids[1], ids[2]);
    return;
  }

  // ร้านที่ 1: บิวตี้ออนไลน์ Live สด (สาขาหลัก)
  const shop1Code = "SH-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const s1 = await pgPool.query(
    `INSERT INTO shops (shop_code, owner_email, name, category, promptpay_id, bank_code, bank_account_no, bank_account_name, province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code, lat, lng)
     VALUES ($1, $2, $3, $4, $5, 'KBANK', '123-4-56789-0', 'บจก. มายเอสเอ็มอีบ็อกซ์ บิวตี้', '10', 'กรุงเทพมหานคร', '1038', 'ลาดพร้าว', '103801', 'ลาดพร้าว', '10230', 13.811000, 100.612000) RETURNING id`,
    [shop1Code, cleanEmail, "ร้านบิวตี้ออนไลน์ Live สด (สาขาหลัก)", "แม่ค้าออนไลน์ / สกินแคร์ & แฟชั่น", "089-999-8888"]
  );
  const shop1Id = s1.rows[0].id;

  await pgPool.query(
    `INSERT INTO shop_members (shop_id, email, role, permissions_json, added_by_email)
     VALUES
       ($1, $2, 'OWNER', $3, $2),
       ($1, 'admin.live@gmail.com', 'ADMIN_LIVE', $4, $2),
       ($1, 'packer.team@gmail.com', 'PACKER', $5, $2),
       ($1, 'accounting.sme@gmail.com', 'ACCOUNTANT', $6, $2)
     ON CONFLICT (shop_id, email) DO NOTHING`,
    [
      shop1Id,
      cleanEmail,
      JSON.stringify(ROLE_PRESETS.OWNER),
      JSON.stringify(ROLE_PRESETS.ADMIN_LIVE),
      JSON.stringify(ROLE_PRESETS.PACKER),
      JSON.stringify(ROLE_PRESETS.ACCOUNTANT)
    ]
  );

  const shop1Products = [
    {
      code: "P001",
      sku: "SR-VITC",
      name: "เซรั่มวิตซีเข้มข้น 30ml (ตัวฮิต Live สด)",
      baseUnitCode: "BTL",
      baseUnit: "ขวด",
      stockBase: 48,
      minStockBase: 10,
      unitConversions: [
        { unitCode: "BTL", unitName: "ขวด", standValue: 1, divideValue: 1, ratio: 1 },
        { unitCode: "PK3", unitName: "แพ็ค(3ขวด)", standValue: 3, divideValue: 1, ratio: 3 },
        { unitCode: "BOX12", unitName: "ลัง(12ขวด)", standValue: 12, divideValue: 1, ratio: 12 }
      ],
      barcodes: [
        { barcode: "8859001001011", unitCode: "BTL", unitName: "ขวด", costSatang: "12000", priceSatang: "29000", priceMemberSatang: "27000", priceWholesaleSatang: "25000", isMainBarcode: true, description: "ขวดเดี่ยว 30ml" },
        { barcode: "8859001001035", unitCode: "PK3", unitName: "แพ็ค(3ขวด)", costSatang: "36000", priceSatang: "79000", priceMemberSatang: "75000", priceWholesaleSatang: "72000", isMainBarcode: false, description: "เซ็ตขายดี Live สด แพ็ค 3 ขวด" },
        { barcode: "8859001001127", unitCode: "BOX12", unitName: "ลัง(12ขวด)", costSatang: "144000", priceSatang: "264000", priceMemberSatang: "252000", priceWholesaleSatang: "240000", isMainBarcode: false, description: "ยกลัง 12 ขวด เรทตัวแทน" }
      ]
    },
    {
      code: "P002",
      sku: "SN-SPF",
      name: "กันแดดเนื้อน้ำนม SPF50+ 50ml",
      baseUnitCode: "TUBE",
      baseUnit: "หลอด",
      stockBase: 24,
      minStockBase: 6,
      unitConversions: [
        { unitCode: "TUBE", unitName: "หลอด", standValue: 1, divideValue: 1, ratio: 1 },
        { unitCode: "SET3", unitName: "เซ็ต(3หลอด)", standValue: 3, divideValue: 1, ratio: 3 }
      ],
      barcodes: [
        { barcode: "8859004004019", unitCode: "TUBE", unitName: "หลอด", costSatang: "14000", priceSatang: "32000", priceMemberSatang: "30000", priceWholesaleSatang: "28000", isMainBarcode: true, description: "หลอดเดี่ยว 50ml" },
        { barcode: "8859004004033", unitCode: "SET3", unitName: "เซ็ต(3หลอด)", costSatang: "42000", priceSatang: "89000", priceMemberSatang: "85000", priceWholesaleSatang: "81000", isMainBarcode: false, description: "เซ็ตสุดคุ้ม 3 หลอด" }
      ]
    },
    {
      code: "P003",
      sku: "CL-GLOW",
      name: "คอลลาเจนเปปไทด์ผิวใส 100g (กระปุกชมพู)",
      baseUnitCode: "JAR",
      baseUnit: "กระปุก",
      stockBase: 5,
      minStockBase: 8,
      unitConversions: [
        { unitCode: "JAR", unitName: "กระปุก", standValue: 1, divideValue: 1, ratio: 1 },
        { unitCode: "DUO2", unitName: "แพ็คคู่(2กระปุก)", standValue: 2, divideValue: 1, ratio: 2 },
        { unitCode: "CTN12", unitName: "ลัง(12กระปุก)", standValue: 12, divideValue: 1, ratio: 12 }
      ],
      barcodes: [
        { barcode: "8859005005015", unitCode: "JAR", unitName: "กระปุก", costSatang: "18000", priceSatang: "39000", priceMemberSatang: "37000", priceWholesaleSatang: "35000", isMainBarcode: true, description: "กระปุกเดี่ยว 100g" },
        { barcode: "8859005005022", unitCode: "DUO2", unitName: "แพ็คคู่(2กระปุก)", costSatang: "36000", priceSatang: "75000", priceMemberSatang: "72000", priceWholesaleSatang: "69000", isMainBarcode: false, description: "โปรแพ็คคู่ขายดี" },
        { barcode: "8859005005121", unitCode: "CTN12", unitName: "ลัง(12กระปุก)", costSatang: "216000", priceSatang: "396000", priceMemberSatang: "384000", priceWholesaleSatang: "360000", isMainBarcode: false, description: "ยกลัง 12 กระปุก" }
      ]
    }
  ];

  for (const p of shop1Products) {
    await pgPool.query(
      `INSERT INTO products (shop_id, prod_code, sku, name, base_unit_code, base_unit, stock_base, min_stock_base, unit_conversions_json, barcodes_json, units_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        shop1Id,
        p.code,
        p.sku,
        p.name,
        p.baseUnitCode,
        p.baseUnit,
        p.stockBase,
        p.minStockBase,
        JSON.stringify(p.unitConversions),
        JSON.stringify(p.barcodes),
        JSON.stringify(p.barcodes)
      ]
    );
  }

  await pgPool.query(
    `INSERT INTO bills (
       shop_id, bill_no, bill_date, customer, address, province_name, district_name, subdistrict_name, zip_code, lat, lng, bank_code,
       channel, courier, tracking_no, doc_type, status, pay_method, items_json,
       shipping_satang, subtotal_satang, vat_satang, grand_total_satang, cost_total_satang, profit_satang, created_by_email
     ) VALUES
       ($1, 'INV-202610-001', '2026-10-23 09:15', 'คุณพลอย (ตัวแทน VIP สุขุมวิท)', '99/12 ถ.สุขุมวิท แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพมหานคร 10110 (โทร 081-234-5678)', 'กรุงเทพมหานคร', 'วัฒนา', 'คลองตันเหนือ', '10110', 13.736000, 100.576000, 'KBANK', 'LINE OA', 'Flash Express', 'TH0129485712A', 'TAX_INVOICE', 'PAID', 'โอนเข้าธนาคารกสิกรไทย (KBANK)', $2, 0, 528000, 36960, 564960, 288000, 240000, $5),
       ($1, 'INV-202610-002', '2026-10-23 11:20', 'คุณเมย์ (CF จาก Facebook Live)', '188 ถ.สีลม แขวงสุริยวงศ์ เขตบางรัก กรุงเทพมหานคร 10500 (โทร 086-555-9988)', 'กรุงเทพมหานคร', 'บางรัก', 'สุริยวงศ์', '10500', 13.724000, 100.530000, 'PROMPTPAY', 'Facebook / Live', 'Kerry / KEX', 'KEX908172635TH', 'RECEIPT', 'COD_PENDING', 'COD เก็บเงินปลายทาง', $3, 4000, 251000, 0, 251000, 114000, 133000, $5),
       ($1, 'INV-202610-003', '2026-10-23 13:05', 'คุณแพรว (ตัวแทนเชียงใหม่ นิมมาน)', '22 ถ.นิมมานเหมินท์ ต.สุเทพ อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50200 (โทร 089-444-5566)', 'เชียงใหม่', 'เมืองเชียงใหม่', 'สุเทพ', '50200', 18.796143, 98.967026, 'SCB', 'TikTok Shop', 'J&T Express', 'JT8273649981', 'INVOICE', 'UNPAID', 'CF รอโอนเงิน (ไทยพาณิชย์ SCB)', $4, 5000, 401000, 0, 401000, 216000, 180000, $5)`,
    [
      shop1Id,
      JSON.stringify([
        { id: "P001", name: "เซรั่มวิตซีเข้มข้น 30ml (ตัวฮิต Live สด)", unitCode: "BOX12", unitName: "ลัง(12ขวด)", factor: 12, barcode: "8859001001127", qty: 2, priceSatang: "264000", costSatang: "144000" }
      ]),
      JSON.stringify([
        { id: "P001", name: "เซรั่มวิตซีเข้มข้น 30ml (ตัวฮิต Live สด)", unitCode: "PK3", unitName: "แพ็ค(3ขวด)", factor: 3, barcode: "8859001001035", qty: 2, priceSatang: "79000", costSatang: "36000" },
        { id: "P002", name: "กันแดดเนื้อน้ำนม SPF50+ 50ml", unitCode: "SET3", unitName: "เซ็ต(3หลอด)", factor: 3, barcode: "8859004004033", qty: 1, priceSatang: "89000", costSatang: "42000" }
      ]),
      JSON.stringify([
        { id: "P003", name: "คอลลาเจนเปปไทด์ผิวใส 100g (กระปุกชมพู)", unitCode: "CTN12", unitName: "ลัง(12กระปุก)", factor: 12, barcode: "8859005005121", qty: 1, priceSatang: "396000", costSatang: "216000" }
      ]),
      cleanEmail
    ]
  );

  await pgPool.query(
    `INSERT INTO expenses (shop_id, exp_no, exp_date, vendor, category, bank_code, amount_satang, vat_satang, wht_rate, wht_satang, net_pay_satang, created_by_email)
     VALUES
       ($1, 'EXP-202610-001', '2026-10-23', 'บริษัท แฟลช เอ็กซ์เพรส จำกัด', 'ค่าขนส่งพัสดุรายวัน (หัก 1%)', 'KBANK', 45000, 0, 1, 450, 44550, $2),
       ($1, 'EXP-202610-002', '2026-10-23', 'คุณนนท์ ครีเอเตอร์ (ตัดคลิป TikTok/Reels)', 'ค่าการตลาดและรีวิวสินค้า (หัก 3%)', 'SCB', 100000, 0, 3, 3000, 97000, $2),
       ($1, 'EXP-202610-003', '2026-10-23', 'บจก. แพ็กเกจจิ้งสยาม (มีใบกำกับภาษีซื้อ)', 'ค่ากล่องพัสดุและบับเบิ้ลกันกระแทก', 'KTB', 60000, 4200, 0, 0, 64200, $2)`,
    [shop1Id, cleanEmail]
  );

  // ร้านที่ 2 ในเครือเดียวกัน: ร้านกาแฟคั่วสด & มัทฉะพรีเมียม (สาขา 2)
  const shop2Code = "SH-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const s2 = await pgPool.query(
    `INSERT INTO shops (shop_code, owner_email, name, category, promptpay_id, bank_code, bank_account_no, bank_account_name, province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code, lat, lng)
     VALUES ($1, $2, $3, $4, $5, 'SCB', '409-8-11223-4', 'บจก. มายเอสเอ็มอีบ็อกซ์ คอฟฟี่', '10', 'กรุงเทพมหานคร', '1014', 'พญาไท', '101401', 'สามเสนใน', '10400', 13.782000, 100.545000) RETURNING id`,
    [shop2Code, cleanEmail, "ร้านกาแฟคั่วสด & มัทฉะพรีเมียม (สาขา 2)", "อาหารและเครื่องดื่ม / ขายปลีก-ส่ง", "089-999-8888"]
  );
  const shop2Id = s2.rows[0].id;

  await pgPool.query(
    `INSERT INTO shop_members (shop_id, email, role, permissions_json, added_by_email)
     VALUES ($1, $2, 'OWNER', $3, $2)
     ON CONFLICT (shop_id, email) DO NOTHING`,
    [shop2Id, cleanEmail, JSON.stringify(ROLE_PRESETS.OWNER)]
  );

  const shop2Products = [
    {
      code: "P001",
      sku: "CF-ARB",
      name: "เมล็ดกาแฟคั่วกลาง Arabica 250g",
      baseUnitCode: "BAG",
      baseUnit: "ถุง",
      stockBase: 40,
      minStockBase: 8,
      unitConversions: [
        { unitCode: "BAG", unitName: "ถุง", standValue: 1, divideValue: 1, ratio: 1 },
        { unitCode: "PK2", unitName: "แพ็คคู่(2ถุง)", standValue: 2, divideValue: 1, ratio: 2 },
        { unitCode: "CTN10", unitName: "ลัง(10ถุง)", standValue: 10, divideValue: 1, ratio: 10 }
      ],
      barcodes: [
        { barcode: "8859002002017", unitCode: "BAG", unitName: "ถุง", costSatang: "11000", priceSatang: "22000", priceMemberSatang: "21000", priceWholesaleSatang: "19500", isMainBarcode: true, description: "ถุงซิปล็อกวาล์ว 250g" },
        { barcode: "8859002002024", unitCode: "PK2", unitName: "แพ็คคู่(2ถุง)", costSatang: "22000", priceSatang: "41000", priceMemberSatang: "39500", priceWholesaleSatang: "38000", isMainBarcode: false, description: "แพ็คคู่ 2 ถุง" },
        { barcode: "8859002002109", unitCode: "CTN10", unitName: "ลัง(10ถุง)", costSatang: "110000", priceSatang: "185000", priceMemberSatang: "180000", priceWholesaleSatang: "175000", isMainBarcode: false, description: "ยกลัง 10 ถุง สำหรับร้านกาแฟ" }
      ]
    },
    {
      code: "P002",
      sku: "MT-UJI",
      name: "ผงมัทฉะแท้เกรดพิธีชงชา Uji 100g",
      baseUnitCode: "PCH",
      baseUnit: "ซอง",
      stockBase: 18,
      minStockBase: 6,
      unitConversions: [
        { unitCode: "PCH", unitName: "ซอง", standValue: 1, divideValue: 1, ratio: 1 },
        { unitCode: "BOX6", unitName: "กล่อง(6ซอง)", standValue: 6, divideValue: 1, ratio: 6 }
      ],
      barcodes: [
        { barcode: "8859003003013", unitCode: "PCH", unitName: "ซอง", costSatang: "18000", priceSatang: "35000", priceMemberSatang: "33000", priceWholesaleSatang: "31000", isMainBarcode: true, description: "ซองฟอยล์ 100g" },
        { barcode: "8859003003068", unitCode: "BOX6", unitName: "กล่อง(6ซอง)", costSatang: "108000", priceSatang: "192000", priceMemberSatang: "186000", priceWholesaleSatang: "180000", isMainBarcode: false, description: "ยกกล่อง 6 ซอง เรทคาเฟ่" }
      ]
    }
  ];

  for (const p of shop2Products) {
    await pgPool.query(
      `INSERT INTO products (shop_id, prod_code, sku, name, base_unit_code, base_unit, stock_base, min_stock_base, unit_conversions_json, barcodes_json, units_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        shop2Id,
        p.code,
        p.sku,
        p.name,
        p.baseUnitCode,
        p.baseUnit,
        p.stockBase,
        p.minStockBase,
        JSON.stringify(p.unitConversions),
        JSON.stringify(p.barcodes),
        JSON.stringify(p.barcodes)
      ]
    );
  }

  await pgPool.query(
    `INSERT INTO bills (shop_id, bill_no, bill_date, customer, address, province_name, district_name, subdistrict_name, zip_code, lat, lng, bank_code, channel, courier, tracking_no, doc_type, status, pay_method, items_json, shipping_satang, subtotal_satang, vat_satang, grand_total_satang, cost_total_satang, profit_satang, created_by_email)
     VALUES ($1, 'INV-202610-001', '2026-10-23 10:05', 'ร้าน Slowbar อารีย์', '45 ซ.อารีย์ 2 แขวงสามเสนใน เขตพญาไท กรุงเทพมหานคร 10400', 'กรุงเทพมหานคร', 'พญาไท', 'สามเสนใน', '10400', 13.782000, 100.545000, 'SCB', 'Shopee', 'J&T Express', 'JT8273645190', 'RECEIPT', 'PAID', 'โอนเข้าไทยพาณิชย์ (SCB)', $2, 0, 370000, 0, 370000, 220000, 150000, $3)`,
    [
      shop2Id,
      JSON.stringify([
        { id: "P001", name: "เมล็ดกาแฟคั่วกลาง Arabica 250g", unitCode: "CTN10", unitName: "ลัง(10ถุง)", factor: 10, barcode: "8859002002109", qty: 2, priceSatang: "185000", costSatang: "110000" }
      ]),
      cleanEmail
    ]
  );

  // ร้านที่ 3 ในเครือเดียวกัน: ร้านเสื้อผ้าแฟชั่น TikTok Shop (สาขา 3)
  const shop3Code = "SH-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const s3 = await pgPool.query(
    `INSERT INTO shops (shop_code, owner_email, name, category, promptpay_id, bank_code, bank_account_no, bank_account_name, province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code, lat, lng)
     VALUES ($1, $2, $3, $4, $5, 'KTB', '981-2-34567-8', 'บจก. มายเอสเอ็มอีบ็อกซ์ แฟชั่น', '10', 'กรุงเทพมหานคร', '1017', 'ห้วยขวาง', '101701', 'ห้วยขวาง', '10310', 13.769000, 100.577000) RETURNING id`,
    [shop3Code, cleanEmail, "ร้านเสื้อผ้าแฟชั่น TikTok Live (สาขา 3)", "เสื้อผ้าแฟชั่น / ขายส่งประตูน้ำ-ออนไลน์", "089-999-8888"]
  );
  const shop3Id = s3.rows[0].id;

  await pgPool.query(
    `INSERT INTO shop_members (shop_id, email, role, permissions_json, added_by_email)
     VALUES ($1, $2, 'OWNER', $3, $2)
     ON CONFLICT (shop_id, email) DO NOTHING`,
    [shop3Id, cleanEmail, JSON.stringify(ROLE_PRESETS.OWNER)]
  );

  const shop3Convs = [
    { unitCode: "PCS", unitName: "ตัว", standValue: 1, divideValue: 1, ratio: 1 },
    { unitCode: "PACK6", unitName: "แพ็คคละสี(6ตัว)", standValue: 6, divideValue: 1, ratio: 6 }
  ];
  const shop3Barcodes = [
    { barcode: "8859008008011", unitCode: "PCS", unitName: "ตัว", costSatang: "15000", priceSatang: "29000", priceMemberSatang: "27000", priceWholesaleSatang: "24000", isMainBarcode: true, description: "ขายปลีก 1 ตัว" },
    { barcode: "8859008008066", unitCode: "PACK6", unitName: "แพ็คคละสี(6ตัว)", costSatang: "90000", priceSatang: "150000", priceMemberSatang: "144000", priceWholesaleSatang: "138000", isMainBarcode: false, description: "ยกแพ็คแม่ค้าเอาไปขายต่อ 6 ตัว" }
  ];

  await pgPool.query(
    `INSERT INTO products (shop_id, prod_code, sku, name, base_unit_code, base_unit, stock_base, min_stock_base, unit_conversions_json, barcodes_json, units_json)
     VALUES ($1, 'P001', 'FS-LINEN', 'เชิ้ตลินินพรีเมียมทรงเกาหลี (Free Size)', 'PCS', 'ตัว', 60, 10, $2, $3, $3)`,
    [shop3Id, JSON.stringify(shop3Convs), JSON.stringify(shop3Barcodes)]
  );

  await pgPool.query(
    `INSERT INTO bills (shop_id, bill_no, bill_date, customer, address, province_name, district_name, subdistrict_name, zip_code, lat, lng, bank_code, channel, courier, tracking_no, doc_type, status, pay_method, items_json, shipping_satang, subtotal_satang, vat_satang, grand_total_satang, cost_total_satang, profit_satang, created_by_email)
     VALUES ($1, 'INV-202610-001', '2026-10-23 14:10', 'คุณส้ม (แม่ค้าไลฟ์สดขอนแก่น)', '88 ถ.ศรีจันทร์ ต.ในเมือง อ.เมืองขอนแก่น จ.ขอนแก่น 40000', 'ขอนแก่น', 'เมืองขอนแก่น', 'ในเมือง', '40000', 16.432194, 102.823621, 'KTB', 'TikTok Shop', 'Flash Express', 'TH9918273645B', 'RECEIPT', 'PAID', 'โอนเข้ากรุงไทย (KTB)', $2, 0, 300000, 0, 300000, 180000, 120000, $3)`,
    [
      shop3Id,
      JSON.stringify([
        { id: "P001", name: "เชิ้ตลินินพรีเมียมทรงเกาหลี (Free Size)", unitCode: "PACK6", unitName: "แพ็คคละสี(6ตัว)", factor: 6, barcode: "8859008008066", qty: 2, priceSatang: "150000", costSatang: "90000" }
      ]),
      cleanEmail
    ]
  );

  await seedRichDemoLocations(shop1Id, shop2Id, shop3Id);
}

async function getBootstrapData(email, requestedShopId) {
  const cleanEmail = String(email || "owner.mysmebox@gmail.com").toLowerCase().trim();
  await ensureUserAndSeedShops(cleanEmail, cleanEmail.split("@")[0], null, false);

  const userRes = await pgPool.query(`SELECT email, name, avatar_url FROM users WHERE email = $1`, [cleanEmail]);
  const user = userRes.rows[0] || { email: cleanEmail, name: cleanEmail.split("@")[0] };

  const shopsRes = await pgPool.query(
    `SELECT s.*, sm.role, sm.permissions_json
     FROM shops s
     JOIN shop_members sm ON sm.shop_id = s.id
     WHERE sm.email = $1
     ORDER BY s.id ASC`,
    [cleanEmail]
  );

  const shops = shopsRes.rows;
  const shopIds = shops.map((s) => s.id);

  const billsAll = shopIds.length
    ? (await pgPool.query(`SELECT * FROM bills WHERE shop_id = ANY($1::int[]) ORDER BY id DESC`, [shopIds])).rows
    : [];
  const expensesAll = shopIds.length
    ? (await pgPool.query(`SELECT * FROM expenses WHERE shop_id = ANY($1::int[]) ORDER BY id DESC`, [shopIds])).rows
    : [];
  const productsAll = shopIds.length
    ? (await pgPool.query(`SELECT * FROM products WHERE shop_id = ANY($1::int[]) ORDER BY id ASC`, [shopIds])).rows
    : [];
  const locationsAll = shopIds.length
    ? (await pgPool.query(`SELECT * FROM shop_locations WHERE shop_id = ANY($1::int[]) ORDER BY id ASC`, [shopIds])).rows
    : [];

  let holdingSalesSatang = 0n;
  let holdingCashSatang = 0n;
  let holdingUnpaidSatang = 0n;
  let holdingProfitSatang = 0n;

  const shopSummaries = shops.map((s) => {
    const sBills = billsAll.filter((b) => b.shop_id === s.id);
    const sExps = expensesAll.filter((e) => e.shop_id === s.id);
    const sProds = productsAll.filter((p) => p.shop_id === s.id);

    let sales = 0n;
    let cashIn = 0n;
    let unpaid = 0n;
    let grossProfit = 0n;

    for (const b of sBills) {
      if (b.status === "QUOTED") continue;
      const grand = BigInt(b.grand_total_satang || 0);
      const prof = BigInt(b.profit_satang || 0);
      sales += grand;
      grossProfit += prof;
      if (b.status === "PAID") cashIn += grand;
      else unpaid += grand;
    }

    let expTotal = 0n;
    let cashOut = 0n;
    for (const ex of sExps) {
      expTotal += BigInt(ex.amount_satang || 0);
      cashOut += BigInt(ex.net_pay_satang || 0);
    }

    const netProfit = grossProfit - expTotal;
    const netCash = cashIn - cashOut;
    const lowStockCount = sProds.filter((p) => Number(p.stock_base) <= Number(p.min_stock_base)).length;

    holdingSalesSatang += sales;
    holdingCashSatang += netCash;
    holdingUnpaidSatang += unpaid;
    holdingProfitSatang += netProfit;

    return {
      id: s.id,
      shopCode: s.shop_code,
      name: s.name,
      category: s.category,
      promptPayId: s.promptpay_id,
      bankCode: s.bank_code || "KBANK",
      bankAccountNo: s.bank_account_no || "123-4-56789-0",
      bankAccountName: s.bank_account_name || s.name,
      provinceCode: s.province_code || "10",
      provinceName: s.province_name || "กรุงเทพมหานคร",
      districtCode: s.district_code || "1038",
      districtName: s.district_name || "ลาดพร้าว",
      subdistrictCode: s.subdistrict_code || "103801",
      subdistrictName: s.subdistrict_name || "ลาดพร้าว",
      zipCode: s.zip_code || "10230",
      lat: Number(s.lat || 13.811),
      lng: Number(s.lng || 100.612),
      ownerEmail: s.owner_email,
      myRole: s.role,
      myRoleLabel: ROLE_PRESETS[s.role]?.label || s.role,
      myPermissions: s.permissions_json,
      salesSatang: sales.toString(),
      netProfitSatang: netProfit.toString(),
      netCashSatang: netCash.toString(),
      unpaidSatang: unpaid.toString(),
      billCount: sBills.length,
      productCount: sProds.length,
      lowStockCount
    };
  });

  const activeShopSummary =
    shopSummaries.find((s) => String(s.id) === String(requestedShopId)) || shopSummaries[0];

  if (!activeShopSummary) {
    return {
      user,
      shops: [],
      holdingOverview: {},
      activeShop: null,
      centralMaster: {
        banks: THAI_BANKS_MASTER,
        provincesCount: THAI_GEO.totalProvinces,
        districtsCount: THAI_GEO.totalDistricts,
        subdistrictsCount: THAI_GEO.totalSubdistricts
      }
    };
  }

  const activeId = activeShopSummary.id;
  const membersRes = await pgPool.query(
    `SELECT id, email, role, permissions_json, added_by_email, created_at
     FROM shop_members WHERE shop_id = $1 ORDER BY id ASC`,
    [activeId]
  );

  const activeProducts = productsAll
    .filter((p) => p.shop_id === activeId)
    .map((p) => {
      const { unitConversions, barcodes, units } = buildProductUnitsAndBarcodes(p);
      return {
        id: p.prod_code,
        dbId: p.id,
        sku: p.sku,
        name: p.name,
        baseUnitCode: p.base_unit_code || "PCS",
        baseUnit: p.base_unit,
        stockBase: Number(p.stock_base),
        minStockBase: Number(p.min_stock_base),
        imageUrl: p.image_url || "",
        unitConversions,
        barcodes,
        units
      };
    });

  const activeBills = billsAll
    .filter((b) => b.shop_id === activeId)
    .map((b) => ({
      id: b.bill_no,
      dbId: b.id,
      date: b.bill_date,
      customer: b.customer,
      address: b.address || "",
      provinceName: b.province_name || "กรุงเทพมหานคร",
      districtName: b.district_name || "",
      subdistrictName: b.subdistrict_name || "",
      zipCode: b.zip_code || "",
      lat: Number(b.lat || 13.7563),
      lng: Number(b.lng || 100.5018),
      bankCode: b.bank_code || "KBANK",
      channel: b.channel,
      courier: b.courier,
      trackingNo: b.tracking_no || "-",
      docType: b.doc_type,
      status: b.status,
      payMethod: b.pay_method || "",
      slipImageUrl: b.slip_image_url || "",
      items: Array.isArray(b.items_json) ? b.items_json : [],
      shippingFeeSatang: String(b.shipping_satang || "0"),
      subTotalSatang: String(b.subtotal_satang || "0"),
      vatSatang: String(b.vat_satang || "0"),
      grandTotalSatang: String(b.grand_total_satang || "0"),
      costTotalSatang: String(b.cost_total_satang || "0"),
      profitSatang: String(b.profit_satang || "0"),
      createdByEmail: b.created_by_email || ""
    }));

  const activeExpenses = expensesAll
    .filter((e) => e.shop_id === activeId)
    .map((e) => ({
      id: e.exp_no,
      dbId: e.id,
      date: e.exp_date,
      vendor: e.vendor,
      category: e.category,
      bankCode: e.bank_code || "KBANK",
      receiptImageUrl: e.receipt_image_url || "",
      amountSatang: String(e.amount_satang || "0"),
      vatSatang: String(e.vat_satang || "0"),
      whtRate: Number(e.wht_rate || 0),
      whtSatang: String(e.wht_satang || "0"),
      netPaySatang: String(e.net_pay_satang || "0"),
      createdByEmail: e.created_by_email || ""
    }));

  const activeLocations = locationsAll
    .filter((l) => l.shop_id === activeId)
    .map((l) => ({
      id: l.loc_code,
      dbId: l.id,
      locType: l.loc_type,
      title: l.title,
      contactName: l.contact_name || "",
      phone: l.phone || "",
      addressLine: l.address_line || "",
      provinceCode: l.province_code || "10",
      provinceName: l.province_name || "กรุงเทพมหานคร",
      districtCode: l.district_code || "",
      districtName: l.district_name || "",
      subdistrictCode: l.subdistrict_code || "",
      subdistrictName: l.subdistrict_name || "",
      zipCode: l.zip_code || "",
      lat: Number(l.lat),
      lng: Number(l.lng),
      deliveryStatus: l.delivery_status || "ACTIVE",
      courier: l.courier || "-",
      trackingNo: l.tracking_no || "-",
      billNo: l.bill_no || "-"
    }));

  return {
    user,
    shops: shopSummaries,
    holdingOverview: {
      totalShops: shopSummaries.length,
      totalSalesSatang: holdingSalesSatang.toString(),
      totalCashSatang: holdingCashSatang.toString(),
      totalProfitSatang: holdingProfitSatang.toString(),
      totalUnpaidSatang: holdingUnpaidSatang.toString()
    },
    centralMaster: {
      banks: THAI_BANKS_MASTER,
      provincesCount: THAI_GEO.totalProvinces,
      districtsCount: THAI_GEO.totalDistricts,
      subdistrictsCount: THAI_GEO.totalSubdistricts
    },
    activeShop: {
      ...activeShopSummary,
      members: membersRes.rows.map((m) => ({
        id: m.id,
        email: m.email,
        role: m.role,
        roleLabel: ROLE_PRESETS[m.role]?.label || m.role,
        permissions: m.permissions_json,
        addedByEmail: m.added_by_email
      })),
      products: activeProducts,
      bills: activeBills,
      expenses: activeExpenses,
      locations: activeLocations
    }
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    } catch {}
  }
  return null;
}

async function callOllamaCloud({ model, messages, formatJson }) {
  const apiKey = (process.env.OLLAMA_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("Missing OLLAMA_API_KEY in server environment");
  }

  const chosenModel = ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL;
  const fallbackOrder = [chosenModel, ...ALLOWED_MODELS.filter((m) => m !== chosenModel)];

  let lastErr = null;
  for (const m of fallbackOrder.slice(0, 3)) {
    try {
      const payload = {
        model: m,
        stream: false,
        messages
      };
      if (formatJson) {
        payload.format = "json";
      }

      const resp = await fetch(OLLAMA_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000)
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        lastErr = new Error(`Ollama status ${resp.status}: ${errText.slice(0, 120)}`);
        continue;
      }

      const data = await resp.json();
      const content = data?.message?.content || "";
      return { modelUsed: m, content };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Ollama Cloud call failed");
}

function buildSystemPrompt(mode, shopContext) {
  const productsInfo = Array.isArray(shopContext?.products)
    ? shopContext.products
        .map((p) => {
          const uomText = Array.isArray(p.units)
            ? p.units.map((u) => `[unitCode:${u.unitCode}, หน่วย:${u.unitName}, ตัวคูณ:${u.factor}, บาร์โค้ด:${u.barcode}, ทุน:${u.cost}บ., ขาย:${u.price}บ.]`).join(" ")
            : "";
          return `- ID:${p.id} | ชื่อ:${p.name} | สต๊อกหน่วยฐาน:${p.stockBase} ${p.baseUnit} | หน่วยนับและบาร์โค้ด:${uomText}`;
        })
        .join("\n")
    : "";

  const kpiInfo = shopContext?.kpi
    ? `เงินสดในมือ:${shopContext.kpi.cash} | ยอดขายรวม:${shopContext.kpi.sales} | กำไรสุทธิ:${shopContext.kpi.profit} | ค้างรับ/COD:${shopContext.kpi.unpaid} | VATสุทธิ:${shopContext.kpi.netVat} | หักณที่จ่ายรอส่ง:${shopContext.kpi.wht}`
    : "";

  if (mode === "SMART_COMMAND") {
    return `คุณคือ AI Co-Pilot ของระบบ MySMEBox (แพลตฟอร์ม SaaS บริหารธุรกิจหลายร้านค้า & แม่ค้าออนไลน์)
รายการสินค้าและหน่วยนับปัจจุบันในร้าน:
${productsInfo}

วิเคราะห์คำสั่งภาษาไทยของเจ้าของร้าน แล้วตอบกลับเป็น JSON เท่านั้น (ห้ามมีข้อความอื่นนอก JSON) ตามโครงสร้างนี้:
{
  "action": "CREATE_BILL" | "ADD_EXPENSE" | "ADD_PRODUCT" | "ADVICE",
  "summary": "สรุปสิ่งที่ AI ทำเป็นภาษาไทยสั้นๆ เข้าใจง่าย",
  "bill": {
    "customer": "ชื่อลูกค้า",
    "address": "ที่อยู่จัดส่งและเบอร์โทร",
    "channel": "LINE OA" | "Facebook / Live" | "TikTok Shop" | "Shopee" | "หน้าร้าน",
    "courier": "Flash Express" | "Kerry / KEX" | "J&T Express" | "ไปรษณีย์ไทย (EMS)",
    "shippingFee": "ค่าส่งเป็นตัวเลข เช่น 40.00 หรือ 0",
    "docType": "RECEIPT" | "TAX_INVOICE" | "INVOICE" | "QUOTATION",
    "payStatus": "PAID" | "COD_PENDING" | "UNPAID",
    "items": [ { "productId": "P001", "unitCode": "รหัสหน่วยนับเช่น BTL หรือ PK3 หรือ BOX12", "qty": 1 } ]
  },
  "expense": {
    "vendor": "ชื่อผู้รับเงิน/ร้านค้า",
    "category": "หมวดค่าใช้จ่าย",
    "amount": "ตัวเลขยอดเงินเช่น 500.00",
    "hasVat": "0" | "1",
    "whtRate": "0" | "1" | "3" | "5"
  },
  "product": {
    "name": "ชื่อสินค้าใหม่",
    "baseUnit": "หน่วยฐาน เช่น ชิ้น, ขวด, ถุง",
    "cost": "ราคาทุนหน่วยฐาน เช่น 120.00",
    "price": "ราคาขายหน่วยฐาน เช่น 250.00",
    "stock": 20
  }
}`;
  }

  if (mode === "PARSE_ORDER") {
    return `คุณคือ AI ผู้ช่วยดูดออเดอร์จากแชทลูกค้าสำหรับแม่ค้าออนไลน์ (MySMEBox)
รายการสินค้าและหน่วยนับในร้าน:
${productsInfo}

อ่านข้อความแชทลูกค้าแล้วแปลงเป็น JSON เท่านั้น:
{
  "customer": "ชื่อลูกค้า",
  "address": "ที่อยู่จัดส่งและเบอร์โทรศัพท์ครบถ้วนสำหรับพิมพ์ใบปะหน้า",
  "channel": "LINE OA" | "Facebook / Live" | "TikTok Shop" | "Shopee",
  "courier": "Flash Express" | "Kerry / KEX" | "J&T Express" | "ไปรษณีย์ไทย (EMS)",
  "shippingFee": "ค่าส่งเป็นตัวเลข เช่น 40 หรือ 0",
  "docType": "RECEIPT" | "TAX_INVOICE" | "INVOICE" | "QUOTATION",
  "payStatus": "PAID" (ถ้าโอนแล้ว) | "COD_PENDING" (ถ้าเก็บเงินปลายทาง/COD) | "UNPAID" (ถ้ารอโอน/CF),
  "items": [ { "productId": "P001", "unitCode": "เลือก unitCode ให้ตรงกับหน่วยนับที่สั่ง", "qty": 1 } ],
  "summary": "สรุปออเดอร์ที่ AI ดึงได้สั้นๆ"
}`;
  }

  if (mode === "PARSE_EXPENSE") {
    return `คุณคือ AI ผู้เชี่ยวชาญบัญชีและภาษีแม่ค้าออนไลน์ & SME ไทยของ MySMEBox
อ่านข้อความบิลรายจ่ายแล้วแปลงเป็น JSON เท่านั้น:
{
  "vendor": "ชื่อร้านค้าหรือผู้รับเงิน",
  "category": "หมวดหมู่ค่าใช้จ่าย",
  "amount": "ยอดเงินก่อนภาษีเป็นตัวเลข เช่น 1500.00",
  "hasVat": "1" ถ้ามีภาษีมูลค่าเพิ่ม VAT 7% หรือ "0" ถ้าไม่มี,
  "whtRate": "1" (ค่าขนส่ง) | "3" (จ้างทำของ/บริการ/ฟรีแลนซ์/รีวิว) | "5" (ค่าเช่า) | "0" (ซื้อสินค้าทั่วไป/ไม่หัก),
  "summary": "อธิบายสั้นๆ ว่าทำไมถึงเลือก VAT และอัตราหัก ณ ที่จ่ายนี้"
}`;
  }

  return `คุณคือ "ผู้ช่วย AI ประจำตัวเถ้าแก่ & แม่ค้าออนไลน์ (MySMEBox SaaS AI Co-Pilot ขับเคลื่อนด้วย Ollama Cloud)"
ข้อมูลจริงของร้านตอนนี้:
- ภาพรวมการเงิน: ${kpiInfo}
- สินค้าและหลายหน่วยนับในสต๊อก:\n${productsInfo}

ตอบเป็นภาษาไทยที่กระชับ เข้าใจง่าย ใช้งานได้จริงทันที`;
}

async function checkShopPermission(shopId, email, permKey) {
  const res = await pgPool.query(
    `SELECT role, permissions_json FROM shop_members WHERE shop_id = $1 AND email = $2`,
    [Number(shopId), String(email || "").toLowerCase().trim()]
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  if (row.role === "OWNER") return row;
  if (permKey && !row.permissions_json?.[permKey]) return null;
  return row;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const userEmail = String(req.headers["x-user-email"] || parsedUrl.searchParams.get("email") || "owner.mysmebox@gmail.com")
    .toLowerCase()
    .trim();

  try {
    // 1. สถานะระบบ + ข้อมูลส่วนกลาง
    if (req.method === "GET" && (pathname === "/api/ai/status" || pathname === "/api/health")) {
      return sendJson(res, 200, {
        ok: true,
        provider: "Ollama Cloud",
        activeModel: DEFAULT_MODEL,
        availableModels: ALLOWED_MODELS,
        database: "PostgreSQL (mysmebox)",
        storage: minioClient ? `MinIO (${MINIO_BUCKET})` : "Local Fallback",
        mcpEndpoint: "/api/mcp",
        centralMaster: {
          banks: THAI_BANKS_MASTER.length,
          provinces: THAI_GEO.totalProvinces,
          districts: THAI_GEO.totalDistricts,
          subdistricts: THAI_GEO.totalSubdistricts
        }
      });
    }

    // 2. ข้อมูลถาวรส่วนกลาง (Central System Master Data APIs — ธนาคารในไทย + 77 จังหวัด 928 อำเภอ 7,436 ตำบล พร้อมพิกัด GPS)
    if (req.method === "GET" && pathname === "/api/master/banks") {
      return sendJson(res, 200, { ok: true, banks: THAI_BANKS_MASTER });
    }

    if (req.method === "GET" && pathname === "/api/master/provinces") {
      const list = THAI_GEO.provinces.map((p) => ({
        code: p.code,
        th: p.th,
        en: p.en,
        lat: Number(p.lat || 13.7563),
        lng: Number(p.lng || 100.5018),
        districtCount: Array.isArray(p.districts) ? p.districts.length : 0
      }));
      return sendJson(res, 200, {
        ok: true,
        totalProvinces: THAI_GEO.totalProvinces,
        totalDistricts: THAI_GEO.totalDistricts,
        totalSubdistricts: THAI_GEO.totalSubdistricts,
        provinces: list
      });
    }

    if (req.method === "GET" && pathname === "/api/master/geography") {
      const provCode = parsedUrl.searchParams.get("provinceCode") || "10";
      const prov = THAI_GEO.provinces.find((p) => String(p.code) === String(provCode)) || THAI_GEO.provinces[0];
      if (!prov) {
        return sendJson(res, 404, { ok: false, error: "ไม่พบข้อมูลจังหวัดในระบบกลาง" });
      }
      return sendJson(res, 200, {
        ok: true,
        province: {
          code: prov.code,
          th: prov.th,
          en: prov.en,
          lat: Number(prov.lat || 13.7563),
          lng: Number(prov.lng || 100.5018),
          districts: prov.districts || []
        }
      });
    }

    if (req.method === "GET" && pathname === "/api/master/address-search") {
      const q = String(parsedUrl.searchParams.get("q") || "").trim().toLowerCase();
      if (!q) {
        return sendJson(res, 200, { ok: true, results: THAI_GEO.flatSubdistricts.slice(0, 20) });
      }
      const matched = [];
      for (const item of THAI_GEO.flatSubdistricts) {
        if (
          item.subdistrictTh.toLowerCase().includes(q) ||
          item.districtTh.toLowerCase().includes(q) ||
          item.provinceTh.toLowerCase().includes(q) ||
          item.zipCode.includes(q)
        ) {
          matched.push(item);
          if (matched.length >= 25) break;
        }
      }
      return sendJson(res, 200, { ok: true, results: matched });
    }

    // 3. โหมด DEMO ทันที (ไม่ต้องผ่าน Google Login — สร้าง/รีเซ็ตข้อมูลตัวอย่างครบถ้วน)
    if (req.method === "POST" && pathname === "/api/demo/reset") {
      const body = await readJsonBody(req).catch(() => ({}));
      const force = Boolean(body.forceReset);
      await ensureUserAndSeedShops("owner.mysmebox@gmail.com", "เถ้าแก่ DEMO (ทดลองเล่นฟรีครบทุกระบบ)", null, force);
      const data = await getBootstrapData("owner.mysmebox@gmail.com", null);
      return sendJson(res, 200, { ok: true, isDemo: true, ...data });
    }

    // 4. Google Login / Gmail Switcher
    if (req.method === "POST" && pathname === "/api/auth/google") {
      const body = await readJsonBody(req);
      let email = String(body.email || "").toLowerCase().trim();
      let name = String(body.name || "").trim();
      let avatarUrl = String(body.avatarUrl || "").trim();

      if (body.credential) {
        const tokenResp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(body.credential)}`);
        if (tokenResp.ok) {
          const tokenInfo = await tokenResp.json();
          if (tokenInfo.email) {
            email = String(tokenInfo.email).toLowerCase().trim();
            name = tokenInfo.name || email.split("@")[0];
            avatarUrl = tokenInfo.picture || "";
          }
        }
      }

      if (!email || !email.includes("@")) {
        return sendJson(res, 400, { ok: false, error: "กรุณาระบุอีเมลบัญชี Google (Gmail) ที่ถูกต้องครับ" });
      }
      if (!name) name = email.split("@")[0];

      await ensureUserAndSeedShops(email, name, avatarUrl, false);
      const data = await getBootstrapData(email, body.shopId);
      return sendJson(res, 200, { ok: true, ...data });
    }

    if (req.method === "GET" && pathname === "/api/saas/bootstrap") {
      const shopId = parsedUrl.searchParams.get("shopId");
      const data = await getBootstrapData(userEmail, shopId);
      return sendJson(res, 200, { ok: true, ...data });
    }

    // 5. สร้างร้านค้าใหม่ใน 1 Account (พร้อมผูกธนาคาร & จังหวัด/อำเภอ/ตำบล/พิกัดจากระบบกลาง)
    if (req.method === "POST" && pathname === "/api/shops") {
      const body = await readJsonBody(req);
      const name = String(body.name || "").trim();
      const category = String(body.category || "แม่ค้าออนไลน์ / ค้าปลีก-ส่ง").trim();
      const promptPayId = String(body.promptPayId || "089-999-8888").trim();
      const bankCode = String(body.bankCode || "KBANK").trim();
      const bankAccountNo = String(body.bankAccountNo || "123-4-56789-0").trim();
      const provinceCode = String(body.provinceCode || "10");
      const provinceName = String(body.provinceName || "กรุงเทพมหานคร");
      const districtCode = String(body.districtCode || "1038");
      const districtName = String(body.districtName || "ลาดพร้าว");
      const subdistrictCode = String(body.subdistrictCode || "103801");
      const subdistrictName = String(body.subdistrictName || "ลาดพร้าว");
      const zipCode = String(body.zipCode || "10230");
      const lat = Number(body.lat || 13.811);
      const lng = Number(body.lng || 100.612);

      if (!name) {
        return sendJson(res, 400, { ok: false, error: "กรุณาระบุชื่อร้านค้าใหม่ครับ" });
      }

      const shopCode = "SH-" + crypto.randomBytes(3).toString("hex").toUpperCase();
      const sRes = await pgPool.query(
        `INSERT INTO shops (
           shop_code, owner_email, name, category, promptpay_id,
           bank_code, bank_account_no, bank_account_name,
           province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code, lat, lng
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$3,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [
          shopCode, userEmail, name, category, promptPayId,
          bankCode, bankAccountNo,
          provinceCode, provinceName, districtCode, districtName, subdistrictCode, subdistrictName, zipCode, lat, lng
        ]
      );
      const newShopId = sRes.rows[0].id;

      await pgPool.query(
        `INSERT INTO shop_members (shop_id, email, role, permissions_json, added_by_email)
         VALUES ($1, $2, 'OWNER', $3, $2)`,
        [newShopId, userEmail, JSON.stringify(ROLE_PRESETS.OWNER)]
      );

      const defaultConvs = [
        { unitCode: "PCS", unitName: "ชิ้น", standValue: 1, divideValue: 1, ratio: 1 },
        { unitCode: "PK6", unitName: "แพ็ค(6ชิ้น)", standValue: 6, divideValue: 1, ratio: 6 }
      ];
      const defaultBarcodes = [
        { barcode: "8859" + Math.floor(100000000 + Math.random() * 899999999), unitCode: "PCS", unitName: "ชิ้น", costSatang: "10000", priceSatang: "25000", priceMemberSatang: "24000", priceWholesaleSatang: "22000", isMainBarcode: true, description: "ขายปลีก 1 ชิ้น" },
        { barcode: "8859" + Math.floor(100000000 + Math.random() * 899999999), unitCode: "PK6", unitName: "แพ็ค(6ชิ้น)", costSatang: "60000", priceSatang: "135000", priceMemberSatang: "130000", priceWholesaleSatang: "120000", isMainBarcode: false, description: "ยกแพ็ค 6 ชิ้น" }
      ];
      await pgPool.query(
        `INSERT INTO products (shop_id, prod_code, sku, name, base_unit_code, base_unit, stock_base, min_stock_base, unit_conversions_json, barcodes_json, units_json)
         VALUES ($1, 'P001', 'SKU-001', $2, 'PCS', 'ชิ้น', 30, 6, $3, $4, $4)`,
        [newShopId, `สินค้าขายดีประจำ${name}`, JSON.stringify(defaultConvs), JSON.stringify(defaultBarcodes)]
      );

      await pgPool.query(
        `INSERT INTO shop_locations (
           shop_id, loc_code, loc_type, title, contact_name, phone, address_line,
           province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code,
           lat, lng, delivery_status, courier, tracking_no, bill_no
         ) VALUES ($1, 'LOC-WH-01', 'WAREHOUSE', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ACTIVE_WAREHOUSE', '-', '-', '-')`,
        [
          newShopId, `โกดังหลัก ${name}`, userEmail, promptPayId, `${subdistrictName} ${districtName}`,
          provinceCode, provinceName, districtCode, districtName, subdistrictCode, subdistrictName, zipCode, lat, lng
        ]
      );

      const data = await getBootstrapData(userEmail, newShopId);
      return sendJson(res, 200, { ok: true, newShopId, ...data });
    }

    // 6. จัดการตำแหน่งบนแผนที่ (ลูกค้า / โกดัง / สถานะจุดจัดส่ง)
    if (req.method === "POST" && pathname === "/api/shops/locations") {
      const body = await readJsonBody(req);
      const shopId = Number(body.shopId);
      const countRes = await pgPool.query(`SELECT COUNT(*)::int AS cnt FROM shop_locations WHERE shop_id = $1`, [shopId]);
      const nextNum = String((countRes.rows[0]?.cnt || 0) + 1).padStart(2, "0");
      const locType = ["WAREHOUSE", "CUSTOMER", "DELIVERY"].includes(body.locType) ? body.locType : "CUSTOMER";
      const prefix = locType === "WAREHOUSE" ? "WH" : locType === "DELIVERY" ? "DL" : "CU";
      const locCode = `LOC-${prefix}-${nextNum}`;

      await pgPool.query(
        `INSERT INTO shop_locations (
           shop_id, loc_code, loc_type, title, contact_name, phone, address_line,
           province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code,
           lat, lng, delivery_status, courier, tracking_no, bill_no
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          shopId,
          locCode,
          locType,
          String(body.title || "จุดปักหมุดใหม่"),
          String(body.contactName || ""),
          String(body.phone || ""),
          String(body.addressLine || ""),
          String(body.provinceCode || "10"),
          String(body.provinceName || "กรุงเทพมหานคร"),
          String(body.districtCode || ""),
          String(body.districtName || ""),
          String(body.subdistrictCode || ""),
          String(body.subdistrictName || ""),
          String(body.zipCode || ""),
          Number(body.lat || 13.7563),
          Number(body.lng || 100.5018),
          String(body.deliveryStatus || (locType === "WAREHOUSE" ? "ACTIVE_WAREHOUSE" : locType === "DELIVERY" ? "IN_TRANSIT" : "ACTIVE")),
          String(body.courier || "-"),
          String(body.trackingNo || "-"),
          String(body.billNo || "-")
        ]
      );

      const data = await getBootstrapData(userEmail, shopId);
      return sendJson(res, 200, { ok: true, createdLocCode: locCode, ...data });
    }

    if (req.method === "POST" && pathname === "/api/shops/locations/status") {
      const body = await readJsonBody(req);
      const shopId = Number(body.shopId);
      const locCode = String(body.locCode || "");
      const deliveryStatus = String(body.deliveryStatus || "DELIVERED");

      await pgPool.query(
        `UPDATE shop_locations SET delivery_status = $1 WHERE shop_id = $2 AND loc_code = $3`,
        [deliveryStatus, shopId, locCode]
      );
      const data = await getBootstrapData(userEmail, shopId);
      return sendJson(res, 200, { ok: true, ...data });
    }

    // 7. จัดการทีมงานด้วย Gmail (RBAC)
    if (req.method === "POST" && pathname === "/api/shops/members") {
      const body = await readJsonBody(req);
      const shopId = Number(body.shopId);
      const memberEmail = String(body.email || "").toLowerCase().trim();
      const role = ROLE_PRESETS[body.role] ? body.role : "ADMIN_LIVE";

      const auth = await checkShopPermission(shopId, userEmail, "canManageTeam");
      if (!auth) {
        return sendJson(res, 403, { ok: false, error: "เฉพาะเจ้าของร้าน (Owner) เท่านั้นที่เพิ่มหรือแก้ไขสิทธิ์ทีมงานได้ครับ" });
      }
      if (!memberEmail || !memberEmail.includes("@")) {
        return sendJson(res, 400, { ok: false, error: "กรุณากรอกอีเมล Gmail ของทีมงานให้ถูกต้องครับ" });
      }

      const customPerms = {
        ...ROLE_PRESETS[role],
        ...(body.permissions && typeof body.permissions === "object" ? body.permissions : {})
      };

      await pgPool.query(
        `INSERT INTO users (email, name) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
        [memberEmail, memberEmail.split("@")[0]]
      );

      await pgPool.query(
        `INSERT INTO shop_members (shop_id, email, role, permissions_json, added_by_email)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (shop_id, email)
         DO UPDATE SET role = EXCLUDED.role, permissions_json = EXCLUDED.permissions_json`,
        [shopId, memberEmail, role, JSON.stringify(customPerms), userEmail]
      );

      const data = await getBootstrapData(userEmail, shopId);
      return sendJson(res, 200, { ok: true, ...data });
    }

    if (req.method === "DELETE" && pathname === "/api/shops/members") {
      const body = await readJsonBody(req);
      const shopId = Number(body.shopId);
      const targetEmail = String(body.email || "").toLowerCase().trim();

      const auth = await checkShopPermission(shopId, userEmail, "canManageTeam");
      if (!auth) {
        return sendJson(res, 403, { ok: false, error: "ไม่มีสิทธิ์จัดการสมาชิกทีมงานครับ" });
      }
      if (targetEmail === userEmail) {
        return sendJson(res, 400, { ok: false, error: "ไม่สามารถลบบัญชีเจ้าของร้านของตัวเองได้ครับ" });
      }

      await pgPool.query(`DELETE FROM shop_members WHERE shop_id = $1 AND email = $2`, [shopId, targetEmail]);
      const data = await getBootstrapData(userEmail, shopId);
      return sendJson(res, 200, { ok: true, ...data });
    }

    // 8. อัปโหลดรูปลง MinIO Object Storage
    if (req.method === "POST" && pathname === "/api/upload") {
      const body = await readJsonBody(req);
      const rawBase64 = String(body.base64Data || "");
      const contentType = String(body.contentType || "image/webp");
      const folder = String(body.folder || "items").replace(/[^a-z0-9_-]/gi, "");

      if (!rawBase64) {
        return sendJson(res, 400, { ok: false, error: "ไม่พบข้อมูลไฟล์รูปภาพ" });
      }
      const cleanBase64 = rawBase64.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(cleanBase64, "base64");
      if (buffer.length > 5 * 1024 * 1024) {
        return sendJson(res, 400, { ok: false, error: "ขนาดรูปภาพต้องไม่เกิน 5MB ครับ" });
      }

      const ext = contentType.includes("png") ? "png" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "webp";
      const objKey = `${folder}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;

      if (minioClient) {
        await minioClient.putObject(MINIO_BUCKET, objKey, buffer, buffer.length, { "Content-Type": contentType });
      } else {
        const localDir = path.join(__dirname, "public", "uploads", folder);
        fs.mkdirSync(localDir, { recursive: true });
        fs.writeFileSync(path.join(__dirname, "public", "uploads", objKey), buffer);
      }

      return sendJson(res, 200, {
        ok: true,
        bucket: MINIO_BUCKET,
        key: objKey,
        url: `/api/files/${objKey}`
      });
    }

    if (req.method === "GET" && pathname.startsWith("/api/files/")) {
      const objKey = pathname.replace("/api/files/", "").replace(/\.\./g, "");
      if (!objKey) {
        res.writeHead(404);
        return res.end("Not found");
      }
      if (minioClient) {
        try {
          const stat = await minioClient.statObject(MINIO_BUCKET, objKey);
          const stream = await minioClient.getObject(MINIO_BUCKET, objKey);
          res.writeHead(200, {
            "Content-Type": stat.metaData?.["content-type"] || "image/webp",
            "Cache-Control": "public, max-age=86400"
          });
          return stream.pipe(res);
        } catch {
          res.writeHead(404);
          return res.end("Image not found in MinIO");
        }
      }
    }

    // 9. สินค้าหลายหน่วยนับ & บาร์โค้ดตามหน่วยนับ
    if (req.method === "POST" && pathname === "/api/shops/products") {
      const body = await readJsonBody(req);
      const shopId = Number(body.shopId);
      const auth = await checkShopPermission(shopId, userEmail, "canStock");
      if (!auth) {
        return sendJson(res, 403, { ok: false, error: "สิทธิ์ของคุณไม่อนุญาตให้เพิ่มหรือแก้ไขสต๊อกสินค้าครับ" });
      }

      const countRes = await pgPool.query(`SELECT COUNT(*)::int AS cnt FROM products WHERE shop_id = $1`, [shopId]);
      const nextNum = String((countRes.rows[0]?.cnt || 0) + 1).padStart(3, "0");
      const prodCode = `P${nextNum}`;
      const sku = String(body.sku || `SKU-${nextNum}`).trim();
      const name = String(body.name || "").trim();
      const baseUnitCode = String(body.baseUnitCode || "PCS").toUpperCase().trim();
      const baseUnit = String(body.baseUnit || "ชิ้น").trim();
      const stockBase = Number(body.stockBase ?? 20);
      const imageUrl = String(body.imageUrl || "").trim();
      const unitConversions = Array.isArray(body.unitConversions) ? body.unitConversions : [];
      const barcodes = Array.isArray(body.barcodes) ? body.barcodes : [];

      if (!name || barcodes.length === 0) {
        return sendJson(res, 400, { ok: false, error: "กรุณาระบุชื่อสินค้าและบาร์โค้ดอย่างน้อย 1 รายการครับ" });
      }

      await pgPool.query(
        `INSERT INTO products (shop_id, prod_code, sku, name, base_unit_code, base_unit, stock_base, min_stock_base, image_url, unit_conversions_json, barcodes_json, units_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 6, $8, $9, $10, $10)`,
        [shopId, prodCode, sku, name, baseUnitCode, baseUnit, stockBase, imageUrl, JSON.stringify(unitConversions), JSON.stringify(barcodes)]
      );

      const data = await getBootstrapData(userEmail, shopId);
      return sendJson(res, 200, { ok: true, ...data });
    }

    if (req.method === "POST" && pathname === "/api/shops/products/stock") {
      const body = await readJsonBody(req);
      const shopId = Number(body.shopId);
      const prodCode = String(body.prodCode || "");
      const deltaBase = Number(body.deltaBase || 0);

      const auth = await checkShopPermission(shopId, userEmail, "canStock");
      if (!auth) {
        return sendJson(res, 403, { ok: false, error: "สิทธิ์ของคุณไม่อนุญาตให้ปรับสต๊อกสินค้าครับ" });
      }

      await pgPool.query(
        `UPDATE products
         SET stock_base = GREATEST(0, stock_base + $1)
         WHERE shop_id = $2 AND prod_code = $3`,
        [deltaBase, shopId, prodCode]
      );

      const data = await getBootstrapData(userEmail, shopId);
      return sendJson(res, 200, { ok: true, ...data });
    }

    // 10. เปิดบิลขายออนไลน์ (พร้อมผูกธนาคารรับโอน + จังหวัด/อำเภอ/ตำบล/พิกัดจัดส่งลงแผนที่อัตโนมัติ)
    if (req.method === "POST" && pathname === "/api/shops/bills") {
      const body = await readJsonBody(req);
      const shopId = Number(body.shopId);
      const auth = await checkShopPermission(shopId, userEmail, "canSell");
      if (!auth) {
        return sendJson(res, 403, { ok: false, error: "สิทธิ์ของคุณไม่อนุญาตให้เปิดบิลขายครับ" });
      }

      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) {
        return sendJson(res, 400, { ok: false, error: "กรุณาเลือกสินค้าอย่างน้อย 1 รายการครับ" });
      }

      let itemsTotal = 0n;
      let costTotal = 0n;
      for (const it of items) {
        itemsTotal += BigInt(it.priceSatang || 0) * BigInt(it.qty || 1);
        costTotal += BigInt(it.costSatang || 0) * BigInt(it.qty || 1);
      }

      const shippingSatang = toSatang(body.shippingFee || "0");
      const subTotalSatang = itemsTotal + shippingSatang;
      const docType = String(body.docType || "RECEIPT");
      const vatSatang = docType === "TAX_INVOICE" ? calcPercentSatang(subTotalSatang, 7) : 0n;
      const grandTotalSatang = subTotalSatang + vatSatang;
      const profitSatang = itemsTotal - costTotal;
      const finalStatus = docType === "QUOTATION" ? "QUOTED" : String(body.payStatus || "PAID");
      const bankCode = String(body.bankCode || "KBANK");
      const bankObj = THAI_BANKS_MASTER.find((b) => b.code === bankCode) || THAI_BANKS_MASTER[0];

      const countRes = await pgPool.query(`SELECT COUNT(*)::int AS cnt FROM bills WHERE shop_id = $1`, [shopId]);
      const nextNum = String((countRes.rows[0]?.cnt || 0) + 1).padStart(3, "0");
      const billNo = `INV-202610-${nextNum}`;
      const billDate = "2026-10-23 " + new Date().toTimeString().slice(0, 5);
      const trackingNo = finalStatus === "QUOTED" ? "-" : String(body.trackingNo || "TH" + Math.floor(1000000000 + Math.random() * 8999999999));
      const payMethod =
        finalStatus === "PAID"
          ? `โอนเข้า ${bankObj.shortNameTh} (${bankObj.code})`
          : finalStatus === "COD_PENDING"
          ? "COD เก็บเงินปลายทาง"
          : finalStatus === "UNPAID"
          ? `CF รอโอน (${bankObj.shortNameTh})`
          : "ใบเสนอราคา";

      const provinceName = String(body.provinceName || "กรุงเทพมหานคร");
      const districtName = String(body.districtName || "");
      const subdistrictName = String(body.subdistrictName || "");
      const zipCode = String(body.zipCode || "");
      const lat = Number(body.lat || 13.7563);
      const lng = Number(body.lng || 100.5018);
      const customer = String(body.customer || "ลูกค้าออนไลน์");
      const address = String(body.address || `${subdistrictName} ${districtName} ${provinceName} ${zipCode}`).trim();
      const courier = String(body.courier || "Flash Express");

      await pgPool.query(
        `INSERT INTO bills (
           shop_id, bill_no, bill_date, customer, address,
           province_name, district_name, subdistrict_name, zip_code, lat, lng, bank_code,
           channel, courier, tracking_no, doc_type, status, pay_method, slip_image_url, items_json,
           shipping_satang, subtotal_satang, vat_satang, grand_total_satang, cost_total_satang, profit_satang, created_by_email
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
        [
          shopId, billNo, billDate, customer, address,
          provinceName, districtName, subdistrictName, zipCode, lat, lng, bankCode,
          String(body.channel || "LINE OA"), courier, trackingNo, docType, finalStatus, payMethod,
          String(body.slipImageUrl || ""), JSON.stringify(items),
          shippingSatang.toString(), subTotalSatang.toString(), vatSatang.toString(),
          grandTotalSatang.toString(), costTotal.toString(), profitSatang.toString(), userEmail
        ]
      );

      // ปักหมุดจุดจัดส่งของบิลนี้ลงบนแผนที่อัตโนมัติ
      await pgPool.query(
        `INSERT INTO shop_locations (
           shop_id, loc_code, loc_type, title, contact_name, phone, address_line,
           province_code, province_name, district_code, district_name, subdistrict_code, subdistrict_name, zip_code,
           lat, lng, delivery_status, courier, tracking_no, bill_no
         ) VALUES ($1,$2,'DELIVERY',$3,$4,'',$5,'',$6,'',$7,'',$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          shopId,
          `LOC-DL-${nextNum}`,
          `จัดส่ง ${customer} (${billNo})`,
          customer,
          address,
          provinceName,
          districtName,
          subdistrictName,
          zipCode,
          lat,
          lng,
          finalStatus === "COD_PENDING" ? "COD_PENDING" : finalStatus === "PAID" ? "IN_TRANSIT" : "PREPARING",
          courier,
          trackingNo,
          billNo
        ]
      );

      if (finalStatus !== "QUOTED") {
        for (const it of items) {
          const deductBase = Number(it.qty || 1) * Number(it.factor || 1);
          await pgPool.query(
            `UPDATE products SET stock_base = GREATEST(0, stock_base - $1) WHERE shop_id = $2 AND prod_code = $3`,
            [deductBase, shopId, String(it.id)]
          );
        }
      }

      const data = await getBootstrapData(userEmail, shopId);
      return sendJson(res, 200, { ok: true, createdBillNo: billNo, ...data });
    }

    if (req.method === "POST" && pathname === "/api/shops/bills/paid") {
      const body = await readJsonBody(req);
      const shopId = Number(body.shopId);
      const billNo = String(body.billNo || "");

      await pgPool.query(
        `UPDATE bills
         SET status = 'PAID',
             doc_type = CASE WHEN doc_type IN ('QUOTATION', 'INVOICE') THEN 'RECEIPT' ELSE doc_type END,
             pay_method = 'รับโอน/COD เข้าแล้ว (1-Click)'
         WHERE shop_id = $1 AND bill_no = $2`,
        [shopId, billNo]
      );

      await pgPool.query(
        `UPDATE shop_locations SET delivery_status = 'DELIVERED' WHERE shop_id = $1 AND bill_no = $2`,
        [shopId, billNo]
      );

      const data = await getBootstrapData(userEmail, shopId);
      return sendJson(res, 200, { ok: true, ...data });
    }

    // 11. บันทึกค่าใช้จ่าย & 50 ทวิ
    if (req.method === "POST" && pathname === "/api/shops/expenses") {
      const body = await readJsonBody(req);
      const shopId = Number(body.shopId);
      const auth = await checkShopPermission(shopId, userEmail, "canExpense");
      if (!auth) {
        return sendJson(res, 403, { ok: false, error: "สิทธิ์ของคุณไม่อนุญาตให้บันทึกรายจ่ายครับ" });
      }

      const amountSatang = toSatang(body.amount);
      if (amountSatang <= 0n) {
        return sendJson(res, 400, { ok: false, error: "กรุณาระบุยอดค่าใช้จ่ายครับ" });
      }
      const hasVat = String(body.hasVat) === "1";
      const whtRate = Number(body.whtRate || 0);
      const vatSatang = hasVat ? calcPercentSatang(amountSatang, 7) : 0n;
      const whtSatang = whtRate > 0 ? calcPercentSatang(amountSatang, whtRate) : 0n;
      const netPaySatang = amountSatang + vatSatang - whtSatang;
      const bankCode = String(body.bankCode || "KBANK");

      const countRes = await pgPool.query(`SELECT COUNT(*)::int AS cnt FROM expenses WHERE shop_id = $1`, [shopId]);
      const nextNum = String((countRes.rows[0]?.cnt || 0) + 1).padStart(3, "0");
      const expNo = `EXP-202610-${nextNum}`;

      await pgPool.query(
        `INSERT INTO expenses (
           shop_id, exp_no, exp_date, vendor, category, bank_code, receipt_image_url,
           amount_satang, vat_satang, wht_rate, wht_satang, net_pay_satang, created_by_email
         ) VALUES ($1,$2,'2026-10-23',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          shopId,
          expNo,
          String(body.vendor || "ร้านค้าทั่วไป"),
          String(body.category || "ค่าใช้จ่ายกิจการ"),
          bankCode,
          String(body.receiptImageUrl || ""),
          amountSatang.toString(),
          vatSatang.toString(),
          whtRate,
          whtSatang.toString(),
          netPaySatang.toString(),
          userEmail
        ]
      );

      const data = await getBootstrapData(userEmail, shopId);
      return sendJson(res, 200, { ok: true, ...data });
    }

    // 12. Ollama Cloud AI Co-Pilot
    if (req.method === "POST" && pathname === "/api/ai/chat") {
      const body = await readJsonBody(req);
      const mode = String(body.mode || "ASSISTANT_CHAT").slice(0, 40);
      const prompt = String(body.prompt || "").trim().slice(0, 3000);
      const model = String(body.model || DEFAULT_MODEL).trim();
      const shopContext = body.shopContext && typeof body.shopContext === "object" ? body.shopContext : {};

      if (!prompt) {
        return sendJson(res, 400, { ok: false, error: "กรุณาพิมพ์ข้อความหรือคำสั่งสำหรับ AI ครับ" });
      }

      const isStructured = mode === "SMART_COMMAND" || mode === "PARSE_ORDER" || mode === "PARSE_EXPENSE";
      const sysPrompt = buildSystemPrompt(mode, shopContext);

      const { modelUsed, content } = await callOllamaCloud({
        model,
        formatJson: isStructured,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: prompt }
        ]
      });

      const parsed = isStructured ? extractJsonObject(content) : null;
      return sendJson(res, 200, {
        ok: true,
        provider: "Ollama Cloud",
        model: modelUsed,
        mode,
        reply: content,
        structured: parsed
      });
    }

    // 13. ระบบ MCP (Model Context Protocol) เชื่อมต่อกับ AI ตัวอื่น (Claude Desktop, Cursor, ChatGPT, Gemini, Antigravity)
    const MCP_TOOLS_DEFINITION = [
      {
        name: "mysmebox_get_overview",
        description: "ดึงภาพรวมยอดขาย กำไรสุทธิ เงินสดคงเหลือ รายการร้านค้าทั้งหมดในเครือ (Multi-Shop) และข้อมูลร้านค้าที่เลือก",
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string", description: "อีเมลเจ้าของร้าน เช่น owner.mysmebox@gmail.com" },
            shopId: { type: "number", description: "รหัสร้านค้า (เว้นว่างเพื่อดูร้านหลัก)" }
          }
        }
      },
      {
        name: "mysmebox_list_products",
        description: "ดูรายการสินค้าทั้งหมดในร้าน สต๊อกหน่วยย่อย ตารางหลายหน่วยนับ (ขวด/แพ็ค/ลัง) และบาร์โค้ดตามหน่วยนับ",
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string", description: "อีเมลผู้ใช้งาน" },
            shopId: { type: "number", description: "รหัสร้านค้า" }
          }
        }
      },
      {
        name: "mysmebox_create_bill",
        description: "เปิดบิลขายออนไลน์ให้ลูกค้า (ตัดสต๊อกตามหน่วยนับ ปักหมุดแผนที่ส่งของ และคำนวณกำไรระดับสตางค์อัตโนมัติ)",
        inputSchema: {
          type: "object",
          properties: {
            shopId: { type: "number", description: "รหัสร้านค้า" },
            customer: { type: "string", description: "ชื่อลูกค้า" },
            address: { type: "string", description: "ที่อยู่จัดส่งและเบอร์โทร" },
            channel: { type: "string", description: "LINE OA, Facebook / Live, TikTok Shop, Shopee" },
            courier: { type: "string", description: "Flash Express, Kerry / KEX, J&T Express, ไปรษณีย์ไทย (EMS)" },
            payStatus: { type: "string", description: "PAID, COD_PENDING, UNPAID" },
            productCode: { type: "string", description: "รหัสสินค้า เช่น P001" },
            unitCode: { type: "string", description: "รหัสหน่วยนับ เช่น BTL, PK3, BOX12" },
            qty: { type: "number", description: "จำนวนที่สั่ง" }
          },
          required: ["customer"]
        }
      },
      {
        name: "mysmebox_lookup_thai_master",
        description: "ค้นหาข้อมูลถาวรจากระบบกลาง: รายชื่อ 20 ธนาคารในไทย และค้นหา 77 จังหวัด 928 อำเภอ 7,436 ตำบล พร้อมรหัสไปรษณีย์และพิกัดแผนที่ GPS",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "คำค้นหาตำบล อำเภอ จังหวัด หรือรหัสไปรษณีย์ เช่น ลาดพร้าว, สุเทพ, 10110" }
          }
        }
      },
      {
        name: "mysmebox_list_map_locations",
        description: "ดูรายการพิกัดแผนที่ลูกค้าประจำ โกดังเก็บของ และสถานะจุดจัดส่งพัสดุของร้านค้า",
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string", description: "อีเมลผู้ใช้งาน" },
            shopId: { type: "number", description: "รหัสร้านค้า" }
          }
        }
      }
    ];

    if (req.method === "GET" && pathname === "/api/mcp") {
      return sendJson(res, 200, {
        ok: true,
        protocol: "Model Context Protocol (MCP)",
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: "mysmebox-mcp-server",
          version: "1.0.0",
          description: "MCP Server สำหรับเชื่อม AI ตัวอื่น (Claude, ChatGPT, Cursor, Gemini, Antigravity) เข้ากับระบบแม่ค้าออนไลน์ MySMEBox"
        },
        endpoints: {
          jsonRpcHttp: "https://www.mysmebox.com/api/mcp",
          stdioCommand: "node mcp-server.js"
        },
        tools: MCP_TOOLS_DEFINITION
      });
    }

    if (req.method === "POST" && pathname === "/api/mcp") {
      const rpc = await readJsonBody(req);
      const id = rpc.id !== undefined ? rpc.id : null;
      const method = String(rpc.method || "");
      const params = rpc.params || {};

      if (method === "initialize") {
        return sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: { listChanged: false },
              resources: { listChanged: false }
            },
            serverInfo: {
              name: "mysmebox-mcp-server",
              version: "1.0.0"
            }
          }
        });
      }

      if (method === "notifications/initialized" || method === "ping") {
        return sendJson(res, 200, { jsonrpc: "2.0", id, result: {} });
      }

      if (method === "tools/list") {
        return sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          result: { tools: MCP_TOOLS_DEFINITION }
        });
      }

      if (method === "resources/list") {
        return sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            resources: [
              {
                uri: "mysmebox://master/thai-banks",
                name: "รายชื่อธนาคารในประเทศไทย (ระบบกลาง)",
                mimeType: "application/json"
              },
              {
                uri: "mysmebox://master/thai-provinces",
                name: "รายชื่อ 77 จังหวัด 928 อำเภอ 7,436 ตำบล พร้อมพิกัด GPS",
                mimeType: "application/json"
              }
            ]
          }
        });
      }

      if (method === "tools/call") {
        const toolName = String(params.name || "");
        const args = params.arguments || {};
        const targetEmail = String(args.email || userEmail || "owner.mysmebox@gmail.com");
        const boot = await getBootstrapData(targetEmail, args.shopId);

        if (toolName === "mysmebox_get_overview") {
          return sendJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    holdingOverview: boot.holdingOverview,
                    shops: boot.shops,
                    activeShopName: boot.activeShop?.name,
                    recentBillsCount: boot.activeShop?.bills?.length || 0
                  }, null, 2)
                }
              ]
            }
          });
        }

        if (toolName === "mysmebox_list_products") {
          return sendJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(boot.activeShop?.products || [], null, 2)
                }
              ]
            }
          });
        }

        if (toolName === "mysmebox_lookup_thai_master") {
          const q = String(args.query || "").trim().toLowerCase();
          const matchedGeo = q
            ? THAI_GEO.flatSubdistricts.filter((x) =>
                x.subdistrictTh.includes(q) || x.districtTh.includes(q) || x.provinceTh.includes(q) || x.zipCode.includes(q)
              ).slice(0, 10)
            : THAI_GEO.flatSubdistricts.slice(0, 5);
          return sendJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    centralSummary: {
                      totalBanks: THAI_BANKS_MASTER.length,
                      totalProvinces: THAI_GEO.totalProvinces,
                      totalDistricts: THAI_GEO.totalDistricts,
                      totalSubdistricts: THAI_GEO.totalSubdistricts
                    },
                    banks: THAI_BANKS_MASTER.slice(0, 10),
                    matchedSubdistrictsWithGps: matchedGeo
                  }, null, 2)
                }
              ]
            }
          });
        }

        if (toolName === "mysmebox_list_map_locations") {
          return sendJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(boot.activeShop?.locations || [], null, 2)
                }
              ]
            }
          });
        }

        if (toolName === "mysmebox_create_bill") {
          const shop = boot.activeShop;
          const prod = (shop?.products || []).find((p) => p.id === (args.productCode || "P001")) || shop?.products?.[0];
          const uom = prod?.units?.find((u) => u.unitCode === args.unitCode) || prod?.units?.[0];
          const qty = Math.max(1, Number(args.qty || 1));
          const itemsTotal = BigInt(uom?.priceSatang || 29000) * BigInt(qty);
          const costTotal = BigInt(uom?.costSatang || 12000) * BigInt(qty);
          const profitSatang = itemsTotal - costTotal;
          const countRes = await pgPool.query(`SELECT COUNT(*)::int AS cnt FROM bills WHERE shop_id = $1`, [shop.id]);
          const billNo = `INV-MCP-${String((countRes.rows[0]?.cnt || 0) + 1).padStart(3, "0")}`;

          await pgPool.query(
            `INSERT INTO bills (
               shop_id, bill_no, bill_date, customer, address, channel, courier, tracking_no,
               doc_type, status, pay_method, items_json, shipping_satang, subtotal_satang, vat_satang,
               grand_total_satang, cost_total_satang, profit_satang, created_by_email
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'RECEIPT',$9,'สั่งผ่านระบบ MCP AI',$10,0,$11,0,$11,$12,$13,$14)`,
            [
              shop.id,
              billNo,
              "2026-10-23 " + new Date().toTimeString().slice(0, 5),
              String(args.customer || "ลูกค้าสั่งผ่าน MCP AI"),
              String(args.address || "กรุงเทพมหานคร"),
              String(args.channel || "LINE OA"),
              String(args.courier || "Flash Express"),
              "TH" + Math.floor(1000000000 + Math.random() * 8999999999),
              String(args.payStatus || "PAID"),
              JSON.stringify([{
                id: prod.id,
                name: prod.name,
                unitCode: uom.unitCode,
                unitName: uom.unitName,
                factor: uom.factor,
                barcode: uom.barcode,
                qty,
                priceSatang: uom.priceSatang,
                costSatang: uom.costSatang
              }]),
              itemsTotal.toString(),
              costTotal.toString(),
              profitSatang.toString(),
              targetEmail
            ]
          );

          return sendJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: true,
                    message: `เปิดบิล ${billNo} สำเร็จผ่าน MCP`,
                    billNo,
                    customer: args.customer,
                    product: prod.name,
                    unit: uom.unitName,
                    qty,
                    grandTotalSatang: itemsTotal.toString()
                  }, null, 2)
                }
              ]
            }
          });
        }

        return sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown MCP tool: ${toolName}` }
        });
      }

      return sendJson(res, 200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unsupported MCP method: ${method}` }
      });
    }

    sendJson(res, 404, { ok: false, error: "API route not found" });
  } catch (err) {
    console.error("API error:", err);
    sendJson(res, 500, { ok: false, error: err.message || "Internal server error" });
  }
});

initDatabaseAndMinio()
  .then(() => {
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`MySMEBox Open-Source SaaS API (PostgreSQL + MinIO + Central Master + Leaflet Map + Ollama Cloud) listening on http://127.0.0.1:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
