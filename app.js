// MySMEBox — Open Source Multi-Shop SaaS & ระบบแม่ค้าออนไลน์ครบวงจร
// - โหมด DEMO ทดลองเล่นฟรีทันที (ไม่ต้องล็อกอิน)
// - ข้อมูลถาวรจากระบบกลาง: 20 ธนาคารในไทย + 77 จังหวัด 928 อำเภอ 7,436 ตำบล พร้อมรหัสไปรษณีย์และพิกัด GPS
// - ระบบแผนที่ฟรี (OpenStreetMap + Leaflet + Nominatim) ปักหมุดลูกค้า โกดัง และติดตามสถานะจุดส่งของ
// - สินค้าหลายหน่วยนับ (ปลีก/แพ็ค/ลัง) + บาร์โค้ดตามหน่วยนับ ([F7c140f1f] & [F2549a90f])
// - ระบบ MCP (Model Context Protocol) เชื่อมต่อกับ AI ตัวอื่น + Ollama Cloud AI Co-Pilot
// - กฎเหล็กข้อ 20: คำนวณเงินทุกชนิดด้วยหน่วยย่อยสตางค์ (BigInt) ห้ามใช้ binary float คำนวณเงิน

const USER_EMAIL_KEY = "mysmebox_active_email_v3";
const ACTIVE_SHOP_KEY = "mysmebox_active_shop_id_v3";

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

function formatSatang(satang) {
  const val = BigInt(satang || 0);
  const isNeg = val < 0n;
  const abs = isNeg ? -val : val;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const wholeFormatted = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fracFormatted = frac.toString().padStart(2, "0");
  return (isNeg ? "-" : "") + wholeFormatted + "." + fracFormatted;
}

function calcPercentSatang(amountSatang, percentInt) {
  const amt = BigInt(amountSatang || 0);
  const pct = BigInt(percentInt || 0);
  const prod = amt * pct;
  const half = 50n;
  return prod >= 0n ? (prod + half) / 100n : (prod - half) / 100n;
}

// คำนวณ Check Digit มาตรฐาน EAN-13 (12 หลักแรก -> คืนค่า 13 หลัก)
function generateEan13Code(prefix3 = "885") {
  const cleanPrefix = String(prefix3 || "885").replace(/\D/g, "").slice(0, 3).padEnd(3, "8");
  let digits12 = cleanPrefix;
  for (let i = 0; i < 9; i++) {
    digits12 += String(Math.floor(Math.random() * 10));
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const num = Number(digits12[i]);
    sum += i % 2 === 0 ? num : num * 3;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return digits12 + String(checkDigit);
}

function fillGeneratedEan13(inputId, prefix = "885") {
  const el = document.getElementById(inputId);
  if (!el) return;
  const code = generateEan13Code(prefix);
  el.value = code;
  showToast(`สร้างบาร์โค้ดมาตรฐาน EAN-13 (${code}) เรียบร้อย!`);
}

const DEFAULT_BANKS = [
  { code: "KBANK", botCode: "004", nameTh: "ธนาคารกสิกรไทย", shortNameTh: "กสิกรไทย", color: "#138F2D", logo: "/banks/kbank.webp" },
  { code: "SCB", botCode: "014", nameTh: "ธนาคารไทยพาณิชย์", shortNameTh: "ไทยพาณิชย์", color: "#4E2E7F", logo: "/banks/scb.webp" },
  { code: "KTB", botCode: "006", nameTh: "ธนาคารกรุงไทย", shortNameTh: "กรุงไทย", color: "#1BA5E1", logo: "/banks/ktb.webp" },
  { code: "BBL", botCode: "002", nameTh: "ธนาคารกรุงเทพ", shortNameTh: "กรุงเทพ", color: "#1E4598", logo: "/banks/bbl.webp" },
  { code: "BAY", botCode: "025", nameTh: "ธนาคารกรุงศรีอยุธยา", shortNameTh: "กรุงศรีอยุธยา", color: "#FEC43B", logo: "/banks/bay.webp" },
  { code: "TTB", botCode: "011", nameTh: "ธนาคารทหารไทยธนชาต", shortNameTh: "ทีเอ็มบีธนชาต (ttb)", color: "#002D63", logo: "/banks/ttb.webp" },
  { code: "GSB", botCode: "030", nameTh: "ธนาคารออมสิน", shortNameTh: "ออมสิน", color: "#EB198D", logo: "/banks/gsb.webp" },
  { code: "BAAC", botCode: "034", nameTh: "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร", shortNameTh: "ธ.ก.ส.", color: "#255231", logo: "/banks/baac.webp" },
  { code: "GHB", botCode: "033", nameTh: "ธนาคารอาคารสงเคราะห์", shortNameTh: "ธอส.", color: "#FF8614", logo: "/banks/ghb.webp" },
  { code: "KKP", botCode: "069", nameTh: "ธนาคารเกียรตินาคินภัทร", shortNameTh: "เกียรตินาคินภัทร", color: "#5A547C", logo: "/banks/kkp.webp" },
  { code: "CIMB", botCode: "022", nameTh: "ธนาคารซีไอเอ็มบีไทย", shortNameTh: "ซีไอเอ็มบีไทย", color: "#7E191D", logo: "/banks/cimb.webp" },
  { code: "TISCO", botCode: "067", nameTh: "ธนาคารทิสโก้", shortNameTh: "ทิสโก้", color: "#104A8B", logo: "/banks/tisco.webp" },
  { code: "UOB", botCode: "024", nameTh: "ธนาคารยูโอบี", shortNameTh: "ยูโอบี", color: "#0B3979", logo: "/banks/uob.webp" },
  { code: "LHB", botCode: "071", nameTh: "ธนาคารแลนด์ แอนด์ เฮ้าส์", shortNameTh: "แลนด์ แอนด์ เฮ้าส์", color: "#6D6E71", logo: "/banks/lhb.webp" },
  { code: "ICBC", botCode: "070", nameTh: "ธนาคารไอซีบีซี (ไทย)", shortNameTh: "ไอซีบีซี (ไทย)", color: "#CD1511", logo: "/banks/icbc.webp" },
  { code: "TCRB", botCode: "073", nameTh: "ธนาคารไทยเครดิต", shortNameTh: "ไทยเครดิต", color: "#004785", logo: "/banks/tcrb.webp" },
  { code: "IBANK", botCode: "066", nameTh: "ธนาคารอิสลามแห่งประเทศไทย", shortNameTh: "อิสลามแห่งประเทศไทย", color: "#164626", logo: "/banks/ibank.webp" },
  { code: "CITI", botCode: "017", nameTh: "ธนาคารซิตี้แบงก์", shortNameTh: "ซิตี้แบงก์", color: "#003B70", logo: "/banks/citi.webp" },
  { code: "HSBC", botCode: "031", nameTh: "ธนาคารเอชเอสบีซี", shortNameTh: "เอชเอสบีซี", color: "#DB0011", logo: "/banks/hsbc.webp" },
  { code: "PROMPTPAY", botCode: "999", nameTh: "พร้อมเพย์ (PromptPay QR)", shortNameTh: "พร้อมเพย์", color: "#0C4370", logo: "/banks/promptpay.webp" },
  { code: "TRUEMONEY", botCode: "998", nameTh: "ทรูมันนี่ วอลเล็ท (TrueMoney)", shortNameTh: "ทรูมันนี่", color: "#FF6600", logo: "/banks/truemoney.webp" }
];

function getBankInfo(bankCode) {
  const code = String(bankCode || "KBANK").toUpperCase();
  const list = Array.isArray(state?.banks) && state.banks.length > 0 ? state.banks : DEFAULT_BANKS;
  return list.find((b) => String(b.code).toUpperCase() === code) || DEFAULT_BANKS[0];
}

function bankLogoBadgeHtml(bankCode, prefixText = "") {
  const b = getBankInfo(bankCode);
  return `<span class="badge" style="background:#f8fafc;border:1px solid var(--border);color:var(--text-main);display:inline-flex;align-items:center;gap:5px;padding:3px 8px;">
    <img src="${b.logo}" width="16" height="16" alt="โลโก้ ${b.nameTh}" style="border-radius:4px;flex-shrink:0;" />
    <span>${prefixText ? prefixText + " " : ""}${b.shortNameTh} (${b.code})</span>
  </span>`;
}

let currentUserEmail = localStorage.getItem(USER_EMAIL_KEY) || "owner.mysmebox@gmail.com";
let currentShopId = localStorage.getItem(ACTIVE_SHOP_KEY) || "";
let saasData = null;

let state = {
  shopId: 1,
  shopCode: "SH-MAIN",
  shopName: "ร้านบิวตี้ออนไลน์ Live สด (สาขาหลัก)",
  category: "แม่ค้าออนไลน์ / สกินแคร์ & แฟชั่น",
  promptPayId: "089-999-8888",
  bankCode: "KBANK",
  myRole: "OWNER",
  myRoleLabel: "เจ้าของร้าน (ดูได้ทุกหน้าจอ)",
  selectedAiModel: "gpt-oss:120b",
  banks: DEFAULT_BANKS,
  provincesList: [],
  posGeoCache: null,
  mapGeoCache: null,
  products: [],
  bills: [],
  expenses: [],
  locations: [],
  members: [],
  shops: [],
  holdingOverview: {
    totalShops: 3,
    totalSalesSatang: "0",
    totalCashSatang: "0",
    totalProfitSatang: "0",
    totalUnpaidSatang: "0"
  },
  centralMaster: {
    banks: DEFAULT_BANKS,
    provincesCount: 77,
    districtsCount: 928,
    subdistrictsCount: 7436
  }
};

let cart = [];
let billFilter = "ALL";
let mapFilter = "ALL";
let activeModalBillId = null;
let leafletMap = null;
let leafletMarkersGroup = null;
let draftPinMarker = null;

function showToast(msg) {
  const el = document.getElementById("appToast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 2800);
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-panel").forEach((el) => {
    el.classList.toggle("active", el.id === "tab-" + tabId);
  });
  document.querySelectorAll("[data-tab-target]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab-target") === tabId);
  });
  renderAll();
  if (tabId === "map") {
    setTimeout(() => {
      initOrRefreshLeafletMap();
    }, 120);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function applyBootstrapPayload(data) {
  if (!data || !data.activeShop) return;
  saasData = data;
  const shop = data.activeShop;
  currentShopId = String(shop.id);
  localStorage.setItem(ACTIVE_SHOP_KEY, currentShopId);

  state.shopId = shop.id;
  state.shopCode = shop.shopCode;
  state.shopName = shop.name;
  state.category = shop.category;
  state.promptPayId = shop.promptPayId || "089-999-8888";
  state.bankCode = shop.bankCode || "KBANK";
  state.myRole = shop.myRole || "OWNER";
  state.myRoleLabel = shop.myRoleLabel || "เจ้าของกิจการ (Owner)";
  state.products = Array.isArray(shop.products) ? shop.products : [];
  state.bills = Array.isArray(shop.bills) ? shop.bills : [];
  state.expenses = Array.isArray(shop.expenses) ? shop.expenses : [];
  state.locations = Array.isArray(shop.locations) ? shop.locations : [];
  state.members = Array.isArray(shop.members) ? shop.members : [];
  state.shops = Array.isArray(data.shops) ? data.shops : [];
  state.holdingOverview = data.holdingOverview || state.holdingOverview;
  if (data.centralMaster) {
    state.centralMaster = data.centralMaster;
    if (Array.isArray(data.centralMaster.banks) && data.centralMaster.banks.length > 0) {
      state.banks = data.centralMaster.banks;
    }
  }

  renderAll();
}

async function fetchBootstrap(shopIdToLoad) {
  const targetShop = shopIdToLoad !== undefined ? shopIdToLoad : currentShopId;
  try {
    const url = `/api/saas/bootstrap?email=${encodeURIComponent(currentUserEmail)}&shopId=${encodeURIComponent(targetShop || "")}`;
    const resp = await fetch(url, {
      headers: { "x-user-email": currentUserEmail }
    });
    const data = await resp.json();
    if (resp.ok && data.ok) {
      applyBootstrapPayload(data);
    }
  } catch (err) {
    console.warn("Bootstrap fetch fallback:", err.message);
  }
}

// ปุ่ม DEMO กดแล้วเข้าดูร้านค้า สินค้า บิล แผนที่ และรายงานครบชุดทันที (ไม่ต้องผ่าน Google Login)
async function enterDemoMode(forceReset = false) {
  currentUserEmail = "owner.mysmebox@gmail.com";
  localStorage.setItem(USER_EMAIL_KEY, currentUserEmail);
  try {
    const resp = await fetch("/api/demo/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forceReset })
    });
    const data = await resp.json();
    if (resp.ok && data.ok) {
      applyBootstrapPayload(data);
      switchTab("dashboard");
      showToast(forceReset ? "🔄 รีเซ็ตข้อมูลตัวอย่าง DEMO ทั้ง 3 ร้านค้าครบชุดเรียบร้อย!" : "🚀 เข้าสู่โหมด DEMO พร้อมข้อมูลร้านค้า สินค้า แผนที่ และรายงานครบชุด!");
      return;
    }
  } catch (err) {
    console.warn("Demo reset error:", err.message);
  }
  await fetchBootstrap("");
  showToast("🚀 เข้าสู่โหมดทดลองเล่น DEMO เรียบร้อย!");
}

async function onSwitchShop(newShopId) {
  currentShopId = String(newShopId);
  localStorage.setItem(ACTIVE_SHOP_KEY, currentShopId);
  cart = [];
  await fetchBootstrap(currentShopId);
  const s = state.shops.find((x) => String(x.id) === String(newShopId));
  if (s) {
    showToast(`สลับไปยัง "${s.name}" เรียบร้อย!`);
  }
}

// ============================================================================
// ข้อมูลถาวรจากระบบกลาง: 20 ธนาคารในไทย + 77 จังหวัด 928 อำเภอ 7,436 ตำบล พร้อมพิกัด GPS
// ============================================================================
function renderCentralBanksDropdowns() {
  const banks = state.banks || DEFAULT_BANKS;
  const optionsHtml = banks
    .map((b) => `<option value="${b.code}">${b.shortNameTh} (${b.code}) — ${b.nameTh}</option>`)
    .join("");

  ["posBankSelect", "expBankSelect", "newShopBankSelect"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.innerHTML) {
      el.innerHTML = optionsHtml;
    }
  });

  const gridEl = document.getElementById("centralThaiBanksGrid");
  if (gridEl) {
    gridEl.innerHTML = banks
      .map(
        (b) => `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid var(--border);border-radius:10px;background:#fff;font-size:0.76rem;box-shadow:0 1px 2px rgba(15,23,42,0.04);">
          <img src="${b.logo || `/banks/${String(b.code).toLowerCase()}.webp`}" width="24" height="24" alt="โลโก้ ${b.nameTh}" style="border-radius:6px;flex-shrink:0;" />
          <div style="line-height:1.25;">
            <div style="font-weight:700;color:var(--text-main);">${b.shortNameTh}</div>
            <div style="color:var(--text-muted);font-size:0.68rem;">${b.code} · BOT ${b.botCode || "-"}</div>
          </div>
        </div>
      `
      )
      .join("");
  }

  const badgeEl = document.getElementById("centralMasterSummaryBadge");
  if (badgeEl && state.centralMaster) {
    badgeEl.textContent = `${state.centralMaster.provincesCount || 77} จังหวัด · ${(state.centralMaster.subdistrictsCount || 7436).toLocaleString()} ตำบล · ${banks.length} ธนาคาร`;
  }
}

async function initCentralProvinces() {
  try {
    const resp = await fetch("/api/master/provinces");
    const data = await resp.json();
    if (resp.ok && data.ok && Array.isArray(data.provinces)) {
      state.provincesList = data.provinces;
      const opts = data.provinces
        .map((p) => `<option value="${p.code}">${p.th} (${p.districtCount} อำเภอ/เขต)</option>`)
        .join("");
      const posProv = document.getElementById("posProvinceSelect");
      const mapProv = document.getElementById("mapProvinceSelect");
      if (posProv) {
        posProv.innerHTML = opts;
        posProv.value = "10";
        await onPosProvinceChange("10");
      }
      if (mapProv) {
        mapProv.innerHTML = opts;
        mapProv.value = "10";
        await onMapProvinceChange("10");
      }
    }
  } catch (err) {
    console.warn("Load provinces error:", err.message);
  }
}

async function onPosProvinceChange(provCode) {
  try {
    const resp = await fetch(`/api/master/geography?provinceCode=${encodeURIComponent(provCode)}`);
    const data = await resp.json();
    if (!resp.ok || !data.ok) return;
    state.posGeoCache = data.province;
    const distSelect = document.getElementById("posDistrictSelect");
    const districts = data.province.districts || [];
    distSelect.innerHTML = districts.map((d) => `<option value="${d.code}">${d.th}</option>`).join("");
    if (districts.length > 0) {
      onPosDistrictChange(districts[0].code);
    }
  } catch {}
}

function onPosDistrictChange(distCode) {
  const prov = state.posGeoCache;
  if (!prov) return;
  const dist = (prov.districts || []).find((d) => String(d.code) === String(distCode)) || prov.districts?.[0];
  if (!dist) return;
  const subSelect = document.getElementById("posSubdistrictSelect");
  const subs = dist.subdistricts || [];
  subSelect.innerHTML = subs.map((s) => `<option value="${s.code}">${s.th} (${s.zip_code})</option>`).join("");
  if (subs.length > 0) {
    onPosSubdistrictChange(subs[0].code);
  }
}

function onPosSubdistrictChange(subCode) {
  const prov = state.posGeoCache;
  if (!prov) return;
  const distCode = document.getElementById("posDistrictSelect")?.value;
  const dist = (prov.districts || []).find((d) => String(d.code) === String(distCode)) || prov.districts?.[0];
  const sub = (dist?.subdistricts || []).find((s) => String(s.code) === String(subCode)) || dist?.subdistricts?.[0];
  if (!sub) return;
  document.getElementById("posZipCodeDisplay").textContent = sub.zip_code || "";
  document.getElementById("posLatDisplay").textContent = Number(sub.lat || dist.lat || prov.lat || 13.7563).toFixed(6);
  document.getElementById("posLngDisplay").textContent = Number(sub.lng || dist.lng || prov.lng || 100.5018).toFixed(6);
}

async function onMapProvinceChange(provCode) {
  try {
    const resp = await fetch(`/api/master/geography?provinceCode=${encodeURIComponent(provCode)}`);
    const data = await resp.json();
    if (!resp.ok || !data.ok) return;
    state.mapGeoCache = data.province;
    const distSelect = document.getElementById("mapDistrictSelect");
    const districts = data.province.districts || [];
    distSelect.innerHTML = districts.map((d) => `<option value="${d.code}">${d.th}</option>`).join("");
    if (districts.length > 0) {
      onMapDistrictChange(districts[0].code);
    }
  } catch {}
}

function onMapDistrictChange(distCode) {
  const prov = state.mapGeoCache;
  if (!prov) return;
  const dist = (prov.districts || []).find((d) => String(d.code) === String(distCode)) || prov.districts?.[0];
  if (!dist) return;
  const subSelect = document.getElementById("mapSubdistrictSelect");
  const subs = dist.subdistricts || [];
  subSelect.innerHTML = subs.map((s) => `<option value="${s.code}">${s.th} (${s.zip_code})</option>`).join("");
  if (subs.length > 0) {
    onMapSubdistrictChange(subs[0].code);
  }
}

function onMapSubdistrictChange(subCode) {
  const prov = state.mapGeoCache;
  if (!prov) return;
  const distCode = document.getElementById("mapDistrictSelect")?.value;
  const dist = (prov.districts || []).find((d) => String(d.code) === String(distCode)) || prov.districts?.[0];
  const sub = (dist?.subdistricts || []).find((s) => String(s.code) === String(subCode)) || dist?.subdistricts?.[0];
  if (!sub) return;

  const lat = Number(sub.lat || dist.lat || prov.lat || 13.7563);
  const lng = Number(sub.lng || dist.lng || prov.lng || 100.5018);

  const zipEl = document.getElementById("newLocZip");
  const latEl = document.getElementById("newLocLat");
  const lngEl = document.getElementById("newLocLng");
  if (zipEl) zipEl.value = sub.zip_code || "";
  if (latEl) latEl.value = lat.toFixed(6);
  if (lngEl) lngEl.value = lng.toFixed(6);

  moveDraftPinOnLeaflet(lat, lng, `ต.${sub.th} อ.${dist.th} จ.${prov.th} ${sub.zip_code}`);
}

// ============================================================================
// คำนวณตัวเลขการเงินระดับสตางค์ (BigInt)
// ============================================================================
function computeMetrics() {
  let totalSalesSatang = 0n;
  let cashReceivedSatang = 0n;
  let unpaidReceivableSatang = 0n;
  let grossProfitSatang = 0n;
  let outputVatSatang = 0n;

  for (const b of state.bills) {
    if (b.status === "QUOTED") continue;
    const grand = BigInt(b.grandTotalSatang || 0);
    const profit = BigInt(b.profitSatang || 0);
    const vat = BigInt(b.vatSatang || 0);
    totalSalesSatang += grand;
    grossProfitSatang += profit;
    outputVatSatang += vat;
    if (b.status === "PAID") {
      cashReceivedSatang += grand;
    } else {
      unpaidReceivableSatang += grand;
    }
  }

  let totalExpenseSatang = 0n;
  let totalCashPaidSatang = 0n;
  let inputVatSatang = 0n;
  let totalWhtSatang = 0n;

  for (const ex of state.expenses) {
    totalExpenseSatang += BigInt(ex.amountSatang || 0);
    totalCashPaidSatang += BigInt(ex.netPaySatang || 0);
    inputVatSatang += BigInt(ex.vatSatang || 0);
    totalWhtSatang += BigInt(ex.whtSatang || 0);
  }

  const netProfitSatang = grossProfitSatang - totalExpenseSatang;
  const netCashInHandSatang = cashReceivedSatang - totalCashPaidSatang;
  const netVatPayableSatang = outputVatSatang - inputVatSatang;

  return {
    totalSalesSatang,
    cashReceivedSatang,
    unpaidReceivableSatang,
    grossProfitSatang,
    totalExpenseSatang,
    netProfitSatang,
    netCashInHandSatang,
    outputVatSatang,
    inputVatSatang,
    netVatPayableSatang,
    totalWhtSatang
  };
}

function buildShopContextForAi() {
  const m = computeMetrics();
  return {
    kpi: {
      cash: formatSatang(m.netCashInHandSatang),
      sales: formatSatang(m.totalSalesSatang),
      profit: formatSatang(m.netProfitSatang),
      unpaid: formatSatang(m.unpaidReceivableSatang),
      netVat: formatSatang(m.netVatPayableSatang),
      wht: formatSatang(m.totalWhtSatang)
    },
    products: state.products.map((p) => ({
      id: p.id,
      name: p.name,
      baseUnit: p.baseUnit,
      stockBase: p.stockBase,
      units: (p.units || []).map((u) => ({
        unitCode: u.unitCode,
        unitName: u.unitName,
        factor: u.factor,
        barcode: u.barcode,
        cost: formatSatang(u.costSatang),
        price: formatSatang(u.priceSatang)
      }))
    }))
  };
}

function docTypeLabel(docType) {
  switch (docType) {
    case "TAX_INVOICE":
      return "ใบกำกับภาษี/ใบเสร็จ";
    case "INVOICE":
      return "ใบวางบิล/แจ้งยอด";
    case "QUOTATION":
      return "ใบเสนอราคา";
    default:
      return "บิลเงินสด/ใบเสร็จออนไลน์";
  }
}

function statusBadgeHtml(status) {
  if (status === "PAID") return '<span class="badge badge-green">โอนแล้ว / รับเงินแล้ว</span>';
  if (status === "COD_PENDING") return '<span class="badge badge-amber">ส่ง COD (รอขนส่งโอน)</span>';
  if (status === "UNPAID") return '<span class="badge badge-rose">CF รอโอนเงิน</span>';
  return '<span class="badge badge-blue">ใบเสนอราคา</span>';
}

// ============================================================================
// แถบบน & แดชบอร์ดภาพรวมทุกร้านค้า (Holding Overview)
// ============================================================================
function renderHeaderAndHolding() {
  const emailLabel = document.getElementById("activeUserEmailLabel");
  if (emailLabel) emailLabel.textContent = currentUserEmail;

  const holdingEmailBadge = document.getElementById("holdingUserEmailBadge");
  if (holdingEmailBadge) holdingEmailBadge.textContent = currentUserEmail;

  const createOwnerLabel = document.getElementById("createShopOwnerLabel");
  if (createOwnerLabel) createOwnerLabel.textContent = currentUserEmail;

  const roleBadge = document.getElementById("activeRoleBadge");
  if (roleBadge) roleBadge.textContent = `สถานะ: ${state.myRoleLabel}`;

  const shopCodeEl = document.getElementById("activeShopCodeBadge");
  if (shopCodeEl) shopCodeEl.textContent = state.shopCode;

  const shopNameEl = document.getElementById("activeShopNameTitle");
  if (shopNameEl) shopNameEl.textContent = state.shopName;

  const shopCatEl = document.getElementById("activeShopCategoryLabel");
  if (shopCatEl) shopCatEl.textContent = state.category;

  const shopSelector = document.getElementById("shopSelector");
  if (shopSelector && state.shops.length > 0) {
    shopSelector.innerHTML = state.shops
      .map(
        (s) =>
          `<option value="${s.id}" ${String(s.id) === String(state.shopId) ? "selected" : ""}>🏪 ${s.name} (กำไร ฿${formatSatang(s.netProfitSatang)})</option>`
      )
      .join("");
  }

  const h = state.holdingOverview || {};
  const elTotalShops = document.getElementById("holdingTotalShops");
  if (elTotalShops) elTotalShops.textContent = `${h.totalShops || state.shops.length || 1} ร้านค้า`;
  const elHoldSales = document.getElementById("holdingTotalSales");
  if (elHoldSales) elHoldSales.textContent = "฿" + formatSatang(h.totalSalesSatang || "0");
  const elHoldProfit = document.getElementById("holdingTotalProfit");
  if (elHoldProfit) elHoldProfit.textContent = "฿" + formatSatang(h.totalProfitSatang || "0");
  const elHoldCash = document.getElementById("holdingTotalCash");
  if (elHoldCash) elHoldCash.textContent = "฿" + formatSatang(h.totalCashSatang || "0");

  const breakdownEl = document.getElementById("holdingShopsBreakdownList");
  if (breakdownEl && state.shops.length > 0) {
    breakdownEl.innerHTML = state.shops
      .map((s) => {
        const isCurrent = String(s.id) === String(state.shopId);
        return `
          <div class="list-row" style="${isCurrent ? "border:2px solid var(--primary);background:#eff6ff;" : "background:#ffffff;"}">
            <div>
              <div class="inline-group" style="flex-wrap:wrap;margin-bottom:2px;">
                <span class="badge ${isCurrent ? "badge-blue" : "badge-gold"}">${isCurrent ? "กำลังเปิดดูร้านนี้" : s.shopCode}</span>
                <span class="badge badge-green">${s.myRoleLabel}</span>
                <span class="list-title">${s.name}</span>
              </div>
              <div class="list-sub">
                📍 ${s.subdistrictName || ""} ${s.districtName || ""} ${s.provinceName || "กรุงเทพฯ"} · ธนาคารหลัก: <strong>${s.bankCode || "KBANK"}</strong> · สินค้า ${s.productCount} รายการ · บิล ${s.billCount} ใบ
              </div>
            </div>
            <div class="inline-group" style="flex-wrap:wrap;">
              <div style="text-align:right;font-size:0.82rem;">
                <div>ยอดขาย <strong>฿${formatSatang(s.salesSatang)}</strong></div>
                <div style="color:var(--emerald);font-weight:700;">กำไรสุทธิ ฿${formatSatang(s.netProfitSatang)}</div>
              </div>
              ${
                !isCurrent
                  ? `<button type="button" class="btn btn-sm btn-primary" onclick="onSwitchShop('${s.id}')">สลับไปดูร้านนี้</button>`
                  : `<span class="badge badge-blue">✓ ร้านปัจจุบัน</span>`
              }
            </div>
          </div>
        `;
      })
      .join("");
  }
}

function renderDashboard() {
  renderHeaderAndHolding();

  const m = computeMetrics();
  document.getElementById("kpiNetCash").textContent = "฿" + formatSatang(m.netCashInHandSatang);
  document.getElementById("kpiTotalSales").textContent = "฿" + formatSatang(m.totalSalesSatang);
  document.getElementById("kpiNetProfit").textContent = "฿" + formatSatang(m.netProfitSatang);
  document.getElementById("kpiUnpaid").textContent = "฿" + formatSatang(m.unpaidReceivableSatang);

  const lowStockItems = state.products.filter((p) => p.stockBase <= p.minStockBase);
  const pendingBills = state.bills.filter((b) => b.status === "UNPAID" || b.status === "COD_PENDING");

  const alertsHtml = [];
  if (pendingBills.length > 0) {
    alertsHtml.push(`
      <div class="list-row">
        <div>
          <div class="inline-group">
            <span class="badge badge-amber">รอเงินเข้า / COD</span>
            <span class="list-title">มีออเดอร์รอโอนหรือรอเงิน COD จากขนส่ง ${pendingBills.length} บิล (รวม ฿${formatSatang(m.unpaidReceivableSatang)})</span>
          </div>
          <div class="list-sub">ล่าสุด: ${pendingBills[0].customer} (${pendingBills[0].channel || "ออนไลน์"} · เลขพัสดุ ${pendingBills[0].trackingNo || "-"})</div>
        </div>
        <button type="button" class="btn btn-sm btn-outline" onclick="switchTab('docs')">ไปกดรับเงิน</button>
      </div>
    `);
  }
  if (lowStockItems.length > 0) {
    alertsHtml.push(`
      <div class="list-row">
        <div>
          <div class="inline-group">
            <span class="badge badge-rose">ของใกล้หมดสต๊อก</span>
            <span class="list-title">มีสินค้าใกล้หมดสต๊อก ${lowStockItems.length} รายการ</span>
          </div>
          <div class="list-sub">${lowStockItems.map((i) => `${i.name} (เหลือ ${i.stockBase} ${i.baseUnit})`).join(", ")}</div>
        </div>
        <button type="button" class="btn btn-sm btn-outline" onclick="switchTab('stock')">เติมสต๊อก</button>
      </div>
    `);
  }
  alertsHtml.push(`
    <div class="list-row">
      <div>
        <div class="inline-group">
          <span class="badge badge-green">แผนที่ส่งของ &amp; ข้อมูลกลาง</span>
          <span class="list-title">ปักหมุดแผนที่ไว้แล้ว ${state.locations.length} จุด · พร้อมใช้ 20 ธนาคารไทย &amp; 7,436 ตำบลทั่วไทย</span>
        </div>
        <div class="list-sub">ดูพิกัดโกดัง ลูกค้าประจำ และสถานะพัสดุที่กำลังจัดส่งบนแผนที่ฟรีได้ทันที</div>
      </div>
      <button type="button" class="btn btn-sm btn-outline" onclick="switchTab('map')">เปิดแผนที่</button>
    </div>
  `);

  document.getElementById("dashboardAlerts").innerHTML = alertsHtml.join("");

  const recentHtml = state.bills
    .slice(0, 5)
    .map(
      (b) => `
    <div class="list-row">
      <div>
        <div class="inline-group" style="flex-wrap:wrap;">
          ${statusBadgeHtml(b.status)}
          <span class="badge badge-blue">${b.channel || "LINE OA"}</span>
          <span class="list-title">${b.customer}</span>
        </div>
        <div class="list-sub">${b.id} · ${b.courier || "Flash Express"} (${b.trackingNo || "-"}) · ${b.payMethod || ""} · กำไร ฿${formatSatang(b.profitSatang)}</div>
      </div>
      <div class="inline-group">
        <span class="money">฿${formatSatang(b.grandTotalSatang)}</span>
        <button type="button" class="btn btn-sm btn-outline" onclick="openBillModal('${b.id}')">ใบปะหน้า/QR</button>
      </div>
    </div>
  `
    )
    .join("");
  document.getElementById("dashboardRecentBills").innerHTML = recentHtml;
}

// ============================================================================
// แท็บ 2: ขายไว & แม่ค้าออนไลน์ (เลือกหน่วยนับ ขวด/แพ็ค/ลัง + ยิงบาร์โค้ด)
// ============================================================================
function renderPos() {
  const catalogEl = document.getElementById("posProductGrid");
  if (!catalogEl) return;

  catalogEl.innerHTML = state.products
    .map((p) => {
      const isLow = p.stockBase <= p.minStockBase;
      const units = Array.isArray(p.units) ? p.units : [];
      const uomButtons = units
        .map((u) => {
          const profitPerUom = BigInt(u.priceSatang || 0) - BigInt(u.costSatang || 0);
          return `
          <button type="button" class="uom-btn" onclick="addToCart('${p.id}', '${u.unitCode}', '${u.barcode}')">
            <div style="text-align:left;">
              <div><strong>+ ${u.unitName}</strong> <span style="color:var(--text-muted);font-size:0.74rem;">(ตัด ${u.factor} ${p.baseUnit})</span></div>
              <div class="barcode-tag" style="margin-top:2px;">🏷 ${u.barcode}</div>
            </div>
            <div style="text-align:right;">
              <div style="color:var(--primary);font-weight:800;">฿${formatSatang(u.priceSatang)}</div>
              <div style="color:var(--emerald);font-size:0.72rem;">กำไร ฿${formatSatang(profitPerUom)}</div>
            </div>
          </button>
        `;
        })
        .join("");

      return `
        <div class="product-item" style="cursor:default;">
          <div>
            <div class="row-baseline" style="margin-bottom:6px;">
              <span class="badge ${isLow ? "badge-rose" : "badge-blue"}">คงเหลือ ${p.stockBase} ${p.baseUnit}</span>
              <span class="badge badge-gold">${units.length} หน่วยขาย</span>
            </div>
            <div class="product-name">${p.name}</div>
          </div>
          <div class="uom-selector-list">
            ${uomButtons}
          </div>
        </div>
      `;
    })
    .join("");

  renderCart();
}

function addToCart(productId, unitCode, barcodeVal, qtyToAdd = 1) {
  const prod = state.products.find((p) => p.id === productId);
  if (!prod) return;
  const units = Array.isArray(prod.units) ? prod.units : [];
  const uom =
    (barcodeVal && units.find((u) => u.barcode === barcodeVal)) ||
    units.find((u) => u.unitCode === unitCode) ||
    units[0];
  if (!uom) return;

  const key = `${prod.id}__${uom.unitCode}__${uom.barcode}`;
  const existing = cart.find((c) => c.cartKey === key);
  if (existing) {
    existing.qty += qtyToAdd;
  } else {
    cart.push({
      cartKey: key,
      id: prod.id,
      name: prod.name,
      baseUnit: prod.baseUnit,
      unitCode: uom.unitCode,
      unitName: uom.unitName,
      factor: Number(uom.factor || 1),
      barcode: uom.barcode,
      priceSatang: uom.priceSatang,
      costSatang: uom.costSatang,
      qty: qtyToAdd
    });
  }
  renderCart();
  showToast(`เพิ่ม "${prod.name}" (${uom.unitName} · ฿${formatSatang(uom.priceSatang)}) เข้าบิลแล้ว`);
}

function scanBarcodeByInput(customCode) {
  const inputEl = document.getElementById("posBarcodeInput");
  const code = String(customCode || inputEl?.value || "").trim();
  if (!code) {
    showToast("กรุณายิงหรือพิมพ์รหัสบาร์โค้ดครับ");
    return;
  }

  for (const p of state.products) {
    for (const u of p.units || []) {
      if (u.barcode === code || p.sku.toLowerCase() === code.toLowerCase()) {
        addToCart(p.id, u.unitCode, u.barcode, 1);
        if (inputEl) inputEl.value = "";
        showToast(`ยิงบาร์โค้ด ${u.barcode} → ${p.name} (${u.unitName} ฿${formatSatang(u.priceSatang)})`);
        return;
      }
    }
  }
  showToast(`ไม่พบบาร์โค้ด "${code}" ในร้านนี้ครับ`);
}

function changeCartQty(cartKey, delta) {
  const idx = cart.findIndex((c) => c.cartKey === cartKey);
  if (idx === -1) return;
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) {
    cart.splice(idx, 1);
  }
  renderCart();
}

function renderCart() {
  const listEl = document.getElementById("posCartList");
  if (!listEl) return;
  const docType = document.getElementById("posDocType")?.value || "RECEIPT";
  const shippingSatang = toSatang(document.getElementById("posShippingFee")?.value || "0");

  if (cart.length === 0) {
    listEl.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:0.88rem;">แตะเลือกหน่วยขายของสินค้า ยิงบาร์โค้ด หรือวางแชทลูกค้าให้ AI ดูดออเดอร์ได้เลย</div>`;
  } else {
    listEl.innerHTML = cart
      .map((c) => {
        const lineTotal = BigInt(c.priceSatang) * BigInt(c.qty);
        const totalBaseDeduct = c.qty * c.factor;
        return `
        <div class="list-row">
          <div>
            <div class="inline-group" style="flex-wrap:wrap;margin-bottom:2px;">
              <span class="badge badge-blue">${c.unitName}</span>
              <span class="barcode-tag">🏷 ${c.barcode}</span>
              <span style="font-size:0.75rem;color:var(--text-muted);">ตัดสต๊อก ${totalBaseDeduct} ${c.baseUnit}</span>
            </div>
            <div class="list-title">${c.name}</div>
            <div class="list-sub">฿${formatSatang(c.priceSatang)} × ${c.qty} ${c.unitName} = <strong>฿${formatSatang(lineTotal)}</strong></div>
          </div>
          <div class="inline-group">
            <button type="button" class="btn btn-sm btn-outline" onclick="changeCartQty('${c.cartKey}', -1)">-</button>
            <span style="min-width:24px;text-align:center;font-weight:700;">${c.qty}</span>
            <button type="button" class="btn btn-sm btn-outline" onclick="changeCartQty('${c.cartKey}', 1)">+</button>
          </div>
        </div>
      `;
      })
      .join("");
  }

  let itemsTotal = 0n;
  let costTotal = 0n;
  for (const c of cart) {
    itemsTotal += BigInt(c.priceSatang) * BigInt(c.qty);
    costTotal += BigInt(c.costSatang) * BigInt(c.qty);
  }

  const subTotal = itemsTotal + shippingSatang;
  const vatSatang = docType === "TAX_INVOICE" ? calcPercentSatang(subTotal, 7) : 0n;
  const grandTotal = subTotal + vatSatang;
  const profitSatang = itemsTotal - costTotal;

  document.getElementById("posSubTotal").textContent = "฿" + formatSatang(subTotal);
  document.getElementById("posVatTotal").textContent = "฿" + formatSatang(vatSatang);
  document.getElementById("posGrandTotal").textContent = "฿" + formatSatang(grandTotal);
  document.getElementById("posProfitPreview").textContent = "฿" + formatSatang(profitSatang);
}

async function submitQuickBill() {
  if (cart.length === 0) {
    showToast("กรุณาเลือกสินค้าเข้าบิลอย่างน้อย 1 รายการครับ");
    return;
  }

  const customer = document.getElementById("posCustomer").value.trim() || "ลูกค้าสั่งผ่านแชทออนไลน์";
  const rawAddr = document.getElementById("posAddress").value.trim();
  const prov = state.posGeoCache;
  const distCode = document.getElementById("posDistrictSelect")?.value;
  const subCode = document.getElementById("posSubdistrictSelect")?.value;
  const dist = (prov?.districts || []).find((d) => String(d.code) === String(distCode));
  const sub = (dist?.subdistricts || []).find((s) => String(s.code) === String(subCode));

  const provinceName = prov?.th || "กรุงเทพมหานคร";
  const districtName = dist?.th || "";
  const subdistrictName = sub?.th || "";
  const zipCode = document.getElementById("posZipCodeDisplay")?.textContent || "10110";
  const lat = Number(document.getElementById("posLatDisplay")?.textContent || 13.736);
  const lng = Number(document.getElementById("posLngDisplay")?.textContent || 100.576);

  const fullAddress = `${rawAddr || "จัดส่งด่วน"} ต.${subdistrictName} อ.${districtName} จ.${provinceName} ${zipCode}`.trim();
  const channel = document.getElementById("posChannel")?.value || "LINE OA";
  const courier = document.getElementById("posCourier")?.value || "Flash Express";
  const shippingFee = document.getElementById("posShippingFee")?.value || "0";
  const docType = document.getElementById("posDocType").value;
  const payStatus = document.getElementById("posPayStatus").value;
  const bankCode = document.getElementById("posBankSelect")?.value || "KBANK";
  const slipImageUrl = document.getElementById("posSlipUrl")?.value || "";

  try {
    const resp = await fetch("/api/shops/bills", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUserEmail
      },
      body: JSON.stringify({
        shopId: state.shopId,
        customer,
        address: fullAddress,
        provinceName,
        districtName,
        subdistrictName,
        zipCode,
        lat,
        lng,
        bankCode,
        channel,
        courier,
        shippingFee,
        docType,
        payStatus,
        slipImageUrl,
        items: cart
      })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || "บันทึกบิลไม่สำเร็จ");
    }
    cart = [];
    document.getElementById("posCustomer").value = "";
    document.getElementById("posAddress").value = "";
    if (document.getElementById("posSlipUrl")) document.getElementById("posSlipUrl").value = "";
    if (document.getElementById("posSlipPreview")) document.getElementById("posSlipPreview").textContent = "";
    applyBootstrapPayload(data);
    openBillModal(data.createdBillNo);
    showToast(`เปิดบิล ${data.createdBillNo} + ปักหมุดแผนที่ส่งของเรียบร้อย!`);
  } catch (err) {
    showToast("⚠️ " + err.message);
  }
}

// ============================================================================
// แท็บ 3: รายการบิลขาย · ใบปะหน้ากล่อง · เช็คยอดโอน & COD
// ============================================================================
function setBillFilter(filter) {
  billFilter = filter;
  document.querySelectorAll("[data-bill-filter]").forEach((btn) => {
    btn.classList.toggle("btn-primary", btn.getAttribute("data-bill-filter") === filter);
    btn.classList.toggle("btn-outline", btn.getAttribute("data-bill-filter") !== filter);
  });
  renderDocs();
}

async function markBillPaid(billNo) {
  try {
    const resp = await fetch("/api/shops/bills/paid", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUserEmail
      },
      body: JSON.stringify({
        shopId: state.shopId,
        billNo
      })
    });
    const data = await resp.json();
    if (resp.ok && data.ok) {
      applyBootstrapPayload(data);
      showToast(`อัปเดตบิล ${billNo} เป็นรับเงินแล้ว + ปรับสถานะจัดส่งเรียบร้อย!`);
    }
  } catch (err) {
    showToast("เกิดข้อผิดพลาด: " + err.message);
  }
}

function renderDocs() {
  const el = document.getElementById("docsListContainer");
  if (!el) return;
  const filtered = state.bills.filter((b) => {
    if (billFilter === "ALL") return true;
    return b.status === billFilter;
  });

  if (filtered.length === 0) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);">ไม่มีรายการบิลในหมวดนี้</div>`;
    return;
  }

  el.innerHTML = filtered
    .map((b) => {
      const itemsSummary = (b.items || []).map((i) => `${i.name} (${i.qty} ${i.unitName || "ชิ้น"})`).join(", ");
      return `
      <div class="list-row">
        <div>
          <div class="inline-group" style="margin-bottom:4px;flex-wrap:wrap;">
            ${statusBadgeHtml(b.status)}
            <span class="badge badge-blue">${b.channel || "LINE OA"}</span>
            <span class="badge badge-gold">${b.courier || "Flash"} · ${b.trackingNo || "-"}</span>
            ${bankLogoBadgeHtml(b.bankCode || "KBANK", "รับเข้า")}
            <span class="list-title">${b.id}</span>
          </div>
          <div class="list-title">${b.customer}</div>
          <div class="list-sub">${itemsSummary}</div>
          <div class="list-sub">📍 ${b.address || ""} · ${b.payMethod || ""} · <strong style="color:var(--emerald);">กำไรสุทธิ ฿${formatSatang(b.profitSatang)}</strong></div>
          ${b.slipImageUrl ? `<div style="margin-top:4px;"><a href="${b.slipImageUrl}" target="_blank" style="font-size:0.76rem;color:var(--primary);">🖼 ดูรูปสลิปโอนเงินใน MinIO</a></div>` : ""}
        </div>
        <div class="inline-group" style="flex-wrap:wrap;">
          <span class="money" style="font-size:1.05rem;">฿${formatSatang(b.grandTotalSatang)}</span>
          ${b.status !== "PAID" ? `<button type="button" class="btn btn-sm btn-emerald" onclick="markBillPaid('${b.id}')">✓ รับเงินเข้าแล้ว 1 คลิก</button>` : ""}
          <button type="button" class="btn btn-sm btn-outline" onclick="openBillModal('${b.id}')">ใบปะหน้า / QR</button>
        </div>
      </div>
    `;
    })
    .join("");
}

// ============================================================================
// แท็บ 4: สินค้าหลายหน่วยนับ & บาร์โค้ดตามหน่วยนับ ([F7c140f1f] & [F2549a90f])
// ============================================================================
async function adjustStock(prodCode, deltaBase) {
  try {
    const resp = await fetch("/api/shops/products/stock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUserEmail
      },
      body: JSON.stringify({
        shopId: state.shopId,
        prodCode,
        deltaBase
      })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || "ปรับสต๊อกไม่สำเร็จ");
    }
    applyBootstrapPayload(data);
    showToast(`อัปเดตสต๊อกสินค้า ${prodCode} เรียบร้อย!`);
  } catch (err) {
    showToast("⚠️ " + err.message);
  }
}

async function addNewProduct() {
  const sku = document.getElementById("newProdSku")?.value.trim() || "";
  const name = document.getElementById("newProdName")?.value.trim() || "";
  const baseUnitCode = (document.getElementById("newProdBaseUnitCode")?.value.trim() || "BTL").toUpperCase();
  const baseUnit = document.getElementById("newProdBaseUnit")?.value.trim() || "ขวด";
  const stockBase = Number(document.getElementById("newProdStock")?.value || 24);
  const imageUrl = document.getElementById("newProdImageUrl")?.value || "";

  const baseBarcode = document.getElementById("newProdBaseBarcode")?.value.trim() || generateEan13Code("885");
  const costSatang = toSatang(document.getElementById("newProdCost")?.value || "100");
  const priceSatang = toSatang(document.getElementById("newProdPrice")?.value || "250");
  const wholesaleSatang = toSatang(document.getElementById("newProdWholesale")?.value || document.getElementById("newProdPrice")?.value || "220");

  const packCode = (document.getElementById("newProdPackCode")?.value.trim() || "PK6").toUpperCase();
  const packName = document.getElementById("newProdPackName")?.value.trim() || "";
  const packStand = Number(document.getElementById("newProdPackFactor")?.value || 0);
  const packDivide = Math.max(1, Number(document.getElementById("newProdPackDivide")?.value || 1));
  const packBarcode = document.getElementById("newProdPackBarcode")?.value.trim() || generateEan13Code("885");
  const packPriceSatang = toSatang(document.getElementById("newProdPackPrice")?.value || "0");
  const packWholesaleSatang = toSatang(document.getElementById("newProdPackWholesale")?.value || document.getElementById("newProdPackPrice")?.value || "0");

  if (!name || priceSatang <= 0n) {
    showToast("กรุณากรอกชื่อสินค้าและราคาขายปลีกให้ครบครับ");
    return;
  }

  const unitConversions = [
    {
      unitCode: baseUnitCode,
      unitName: baseUnit,
      standValue: 1,
      divideValue: 1,
      ratio: 1
    }
  ];

  const barcodes = [
    {
      barcode: baseBarcode,
      unitCode: baseUnitCode,
      unitName: baseUnit,
      costSatang: costSatang.toString(),
      priceSatang: priceSatang.toString(),
      priceMemberSatang: priceSatang.toString(),
      priceWholesaleSatang: wholesaleSatang.toString(),
      isMainBarcode: true,
      description: `ขายปลีก 1 ${baseUnit}`
    }
  ];

  if (packName && packStand > 1 && packPriceSatang > 0n) {
    const ratio = packStand / packDivide;
    unitConversions.push({
      unitCode: packCode,
      unitName: packName,
      standValue: packStand,
      divideValue: packDivide,
      ratio
    });
    barcodes.push({
      barcode: packBarcode,
      unitCode: packCode,
      unitName: packName,
      costSatang: (costSatang * BigInt(Math.round(ratio))).toString(),
      priceSatang: packPriceSatang.toString(),
      priceMemberSatang: packPriceSatang.toString(),
      priceWholesaleSatang: packWholesaleSatang.toString(),
      isMainBarcode: false,
      description: `ขายยก ${packName}`
    });
  }

  try {
    const resp = await fetch("/api/shops/products", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUserEmail
      },
      body: JSON.stringify({
        shopId: state.shopId,
        sku,
        name,
        baseUnitCode,
        baseUnit,
        stockBase,
        imageUrl,
        unitConversions,
        barcodes
      })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || "เพิ่มสินค้าไม่สำเร็จ");
    }
    document.getElementById("newProdName").value = "";
    document.getElementById("newProdBaseBarcode").value = "";
    document.getElementById("newProdPackBarcode").value = "";
    applyBootstrapPayload(data);
    showToast(`เพิ่มสินค้า "${name}" (${unitConversions.length} หน่วยนับ) เรียบร้อย!`);
  } catch (err) {
    showToast("⚠️ " + err.message);
  }
}

function renderStock() {
  const el = document.getElementById("stockListContainer");
  if (!el) return;

  el.innerHTML = state.products
    .map((p) => {
      const isLow = p.stockBase <= p.minStockBase;
      const convs = Array.isArray(p.unitConversions) ? p.unitConversions : [];
      const bcs = Array.isArray(p.barcodes) ? p.barcodes : [];

      const convRowsHtml = convs
        .map((c) => {
          const matchedText =
            Array.isArray(c.matchedBarcodes) && c.matchedBarcodes.length > 0
              ? c.matchedBarcodes.map((code) => `<span class="barcode-tag">🏷 ${code}</span>`).join(" ")
              : `<span style="color:var(--text-muted);font-size:0.74rem;">ยังไม่มีบาร์โค้ด</span>`;
          const availQty = Math.floor(p.stockBase / Number(c.ratio || 1));
          return `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:6px 8px;font-weight:700;">${c.unitCode}</td>
              <td style="padding:6px 8px;">${c.unitName}</td>
              <td style="padding:6px 8px;text-align:center;">${c.standValue} / ${c.divideValue} (×${c.ratio} ${p.baseUnit})</td>
              <td style="padding:6px 8px;">จัดส่งได้ <strong>${availQty}</strong> ${c.unitName}</td>
              <td style="padding:6px 8px;">${matchedText}</td>
            </tr>
          `;
        })
        .join("");

      const barcodeRowsHtml = bcs
        .map((b) => {
          const matchedConv = convs.find((c) => String(c.unitCode).toUpperCase() === String(b.unitCode).toUpperCase());
          const profit = BigInt(b.priceSatang || 0) - BigInt(b.costSatang || 0);
          return `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:6px 8px;"><span class="barcode-tag">🏷 ${b.barcode}</span></td>
              <td style="padding:6px 8px;"><span class="badge badge-blue">${b.unitName || matchedConv?.unitName || b.unitCode}</span></td>
              <td style="padding:6px 8px;">฿${formatSatang(b.costSatang)}</td>
              <td style="padding:6px 8px;font-weight:700;color:var(--primary);">฿${formatSatang(b.priceSatang)}</td>
              <td style="padding:6px 8px;color:#0369a1;">฿${formatSatang(b.priceWholesaleSatang || b.priceSatang)}</td>
              <td style="padding:6px 8px;color:var(--emerald);font-weight:700;">+฿${formatSatang(profit)}</td>
            </tr>
          `;
        })
        .join("");

      return `
        <div class="list-row" style="flex-direction:column;align-items:stretch;background:#ffffff;">
          <div class="row-baseline" style="flex-wrap:wrap;padding-bottom:8px;border-bottom:1px solid var(--border);">
            <div class="inline-group" style="flex-wrap:wrap;">
              <span class="badge ${isLow ? "badge-rose" : "badge-green"}">
                ${isLow ? "ใกล้หมด! เหลือ " + p.stockBase + " " + p.baseUnit : "สต๊อกหน่วยย่อยรวม " + p.stockBase + " " + p.baseUnit}
              </span>
              <span class="badge badge-blue">หน่วยหลัก: ${p.baseUnit} (${p.baseUnitCode || "PCS"} 1:1)</span>
              <span class="list-title">${p.name} (${p.sku})</span>
              ${p.imageUrl ? `<a href="${p.imageUrl}" target="_blank" class="badge badge-gold">🖼 รูปสินค้า MinIO</a>` : ""}
            </div>
            <div class="inline-group">
              <button type="button" class="btn btn-sm btn-outline" onclick="adjustStock('${p.id}', -1)">-1 ${p.baseUnit}</button>
              <button type="button" class="btn btn-sm btn-primary" onclick="adjustStock('${p.id}', 12)">+ รับของเข้า 12 ${p.baseUnit}</button>
            </div>
          </div>

          <div style="margin-top:8px;">
            <div style="font-size:0.78rem;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">
              1) ตารางหน่วยนับของสินค้า (ตัวตั้ง / ตัวหาร) &amp; บาร์โค้ดที่ผูกกับหน่วยนั้น:
            </div>
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.78rem;background:var(--bg-subtle);border-radius:8px;">
                <thead>
                  <tr style="border-bottom:1px solid var(--border);text-align:left;color:var(--text-muted);">
                    <th style="padding:6px 8px;">รหัสหน่วย</th>
                    <th style="padding:6px 8px;">ชื่อเรียกหน่วยนับ</th>
                    <th style="padding:6px 8px;text-align:center;">ตัวตั้ง/ตัวหาร</th>
                    <th style="padding:6px 8px;">จำนวนที่พร้อมขาย</th>
                    <th style="padding:6px 8px;">บาร์โค้ดของหน่วยนี้ (Matched)</th>
                  </tr>
                </thead>
                <tbody>${convRowsHtml}</tbody>
              </table>
            </div>
          </div>

          <div style="margin-top:8px;">
            <div style="font-size:0.78rem;font-weight:700;color:#1e40af;margin-bottom:4px;">
              2) ตารางบาร์โค้ด &amp; ราคาขายแยกตามหน่วยนับ (ปลีก / เรทตัวแทน):
            </div>
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.78rem;background:#eff6ff;border-radius:8px;">
                <thead>
                  <tr style="border-bottom:1px solid #bfdbfe;text-align:left;color:#1e3a8a;">
                    <th style="padding:6px 8px;">รหัสบาร์โค้ด</th>
                    <th style="padding:6px 8px;">หน่วยที่ขาย</th>
                    <th style="padding:6px 8px;">ต้นทุน</th>
                    <th style="padding:6px 8px;">ราคาปลีก</th>
                    <th style="padding:6px 8px;">ราคาส่ง/ตัวแทน</th>
                    <th style="padding:6px 8px;">กำไร/หน่วย</th>
                  </tr>
                </thead>
                <tbody>${barcodeRowsHtml}</tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

// ============================================================================
// แท็บ 5: ระบบแผนที่ฟรี (OpenStreetMap + Leaflet + Nominatim + GPS)
// ปักหมุด โกดัง (WAREHOUSE) / ลูกค้า (CUSTOMER) / สถานะจุดส่งของ (DELIVERY)
// ============================================================================
function setMapFilter(filter) {
  mapFilter = filter;
  document.querySelectorAll("[data-map-filter]").forEach((btn) => {
    btn.classList.toggle("btn-primary", btn.getAttribute("data-map-filter") === filter);
    btn.classList.toggle("btn-outline", btn.getAttribute("data-map-filter") !== filter);
  });
  renderMapTab();
}

function locTypeBadge(locType) {
  if (locType === "WAREHOUSE") return '<span class="badge badge-gold">🏭 โกดัง/สาขาร้าน</span>';
  if (locType === "DELIVERY") return '<span class="badge badge-blue">🚚 จุดส่งพัสดุ</span>';
  return '<span class="badge badge-green">📍 ลูกค้าประจำ/ตัวแทน</span>';
}

function deliveryStatusBadge(st) {
  if (st === "DELIVERED") return '<span class="badge badge-green">✓ ส่งถึงลูกค้าแล้ว</span>';
  if (st === "COD_PENDING") return '<span class="badge badge-amber">⏳ ส่งแล้ว รอเงิน COD</span>';
  if (st === "IN_TRANSIT") return '<span class="badge badge-blue">🚚 ขนส่งกำลังนำจ่าย</span>';
  if (st === "ACTIVE_WAREHOUSE") return '<span class="badge badge-gold">🏭 โกดังพร้อมส่งของ</span>';
  return '<span class="badge badge-blue">📌 ปักหมุดแล้ว</span>';
}

function initOrRefreshLeafletMap() {
  const mapEl = document.getElementById("InteractiveLeafletMap");
  if (!mapEl || typeof L === "undefined") return;

  if (!leafletMap) {
    L.Icon.Default.imagePath = "/leaflet/";
    leafletMap = L.map("InteractiveLeafletMap").setView([13.7563, 100.5518], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (แผนที่ฟรี MySMEBox)'
    }).addTo(leafletMap);

    leafletMarkersGroup = L.layerGroup().addTo(leafletMap);

    leafletMap.on("click", (ev) => {
      const lat = ev.latlng.lat;
      const lng = ev.latlng.lng;
      const latEl = document.getElementById("newLocLat");
      const lngEl = document.getElementById("newLocLng");
      if (latEl) latEl.value = lat.toFixed(6);
      if (lngEl) lngEl.value = lng.toFixed(6);
      moveDraftPinOnLeaflet(lat, lng, "หมุดที่เลือกใหม่ (พร้อมบันทึก)");
      showToast(`เลือกพิกัดบนแผนที่: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    });
  }

  leafletMap.invalidateSize();
  leafletMarkersGroup.clearLayers();

  const filtered = (state.locations || []).filter((l) => mapFilter === "ALL" || l.locType === mapFilter);
  const bounds = [];

  for (const loc of filtered) {
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;
    bounds.push([loc.lat, loc.lng]);
    const color = loc.locType === "WAREHOUSE" ? "#d97706" : loc.locType === "DELIVERY" ? "#2563eb" : "#059669";
    const emoji = loc.locType === "WAREHOUSE" ? "🏭" : loc.locType === "DELIVERY" ? "🚚" : "📍";

    const divIcon = L.divIcon({
      className: "custom-map-pin",
      html: `<div style="background:${color};color:#fff;padding:4px 8px;border-radius:999px;font-weight:800;font-size:12px;border:2px solid #fff;box-shadow:0 4px 10px rgba(0,0,0,0.3);white-space:nowrap;">${emoji} ${loc.title.slice(0, 18)}</div>`,
      iconSize: [120, 28],
      iconAnchor: [60, 14]
    });

    const marker = L.marker([loc.lat, loc.lng], { icon: divIcon });
    marker.bindPopup(`
      <div style="font-family:inherit;min-width:200px;">
        <div style="font-weight:800;font-size:0.92rem;margin-bottom:4px;">${emoji} ${loc.title}</div>
        <div style="font-size:0.8rem;color:#475569;">${loc.addressLine || ""} ต.${loc.subdistrictName || "-"} อ.${loc.districtName || "-"} จ.${loc.provinceName || "-"} ${loc.zipCode || ""}</div>
        <div style="font-size:0.78rem;margin-top:4px;">ผู้ติดต่อ: <strong>${loc.contactName || "-"}</strong> (${loc.phone || "-"})</div>
        ${loc.trackingNo && loc.trackingNo !== "-" ? `<div style="font-size:0.78rem;color:#1d4ed8;margin-top:2px;">ขนส่ง: ${loc.courier} (${loc.trackingNo})</div>` : ""}
        <div style="font-size:0.74rem;color:#64748b;margin-top:4px;">GPS: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</div>
      </div>
    `);
    leafletMarkersGroup.addLayer(marker);
  }

  if (bounds.length > 0) {
    leafletMap.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
  }
}

function moveDraftPinOnLeaflet(lat, lng, labelText) {
  if (!leafletMap || typeof L === "undefined") return;
  if (draftPinMarker) {
    leafletMap.removeLayer(draftPinMarker);
  }
  draftPinMarker = L.marker([lat, lng]).addTo(leafletMap);
  draftPinMarker.bindPopup(`<strong>📌 ${labelText}</strong><br/>GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}`).openPopup();
  leafletMap.setView([lat, lng], 14, { animate: true });
}

function focusMapPin(lat, lng, title) {
  if (!leafletMap) initOrRefreshLeafletMap();
  if (!leafletMap) return;
  leafletMap.setView([Number(lat), Number(lng)], 15, { animate: true });
  showToast(`เลื่อนแผนที่ไปยัง "${title}"`);
}

async function searchPlaceOnMap() {
  const q = document.getElementById("mapSearchInput")?.value.trim() || "";
  const box = document.getElementById("mapSearchResultsBox");
  if (!q) {
    showToast("พิมพ์ชื่อสถานที่ ถนน หรือตำบลที่ต้องการค้นหาครับ");
    return;
  }
  if (box) box.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted);">กำลังค้นหาพิกัด "${q}"...</div>`;

  try {
    // 1. ค้นหาจากฐานข้อมูล 7,436 ตำบลในระบบกลางก่อน (เร็วและตรงรหัสไปรษณีย์ไทย 100%)
    const localResp = await fetch(`/api/master/address-search?q=${encodeURIComponent(q)}`);
    const localData = await localResp.json();
    const localItems = Array.isArray(localData.results) ? localData.results.slice(0, 5) : [];

    // 2. ค้นหาเสริมจาก OpenStreetMap Nominatim (ฟรี)
    let osmItems = [];
    try {
      const osmResp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=4&countrycodes=th&q=${encodeURIComponent(q)}`);
      if (osmResp.ok) {
        osmItems = await osmResp.json();
      }
    } catch {}

    const buttons = [];
    for (const it of localItems) {
      buttons.push(`
        <button type="button" class="btn btn-sm btn-outline" style="margin:2px;" onclick="selectSearchCoordinate(${it.lat}, ${it.lng}, '${it.subdistrictTh} ${it.districtTh} ${it.provinceTh}', '${it.zipCode}')">
          📍 ต.${it.subdistrictTh} อ.${it.districtTh} จ.${it.provinceTh} (${it.zipCode})
        </button>
      `);
    }
    for (const osm of osmItems) {
      const cleanName = String(osm.display_name || "").split(",").slice(0, 2).join(", ").replace(/'/g, "");
      buttons.push(`
        <button type="button" class="btn btn-sm btn-outline" style="margin:2px;" onclick="selectSearchCoordinate(${Number(osm.lat)}, ${Number(osm.lon)}, '${cleanName}', '')">
          🗺️ ${cleanName}
        </button>
      `);
    }

    if (box) {
      box.innerHTML =
        buttons.length > 0
          ? `<div style="display:flex;flex-wrap:wrap;gap:4px;">${buttons.join("")}</div>`
          : `<div style="font-size:0.8rem;color:var(--rose);">ไม่พบสถานที่ "${q}" ลองค้นหาด้วยชื่อตำบลหรือจังหวัดดูครับ</div>`;
    }
    if (localItems.length > 0) {
      selectSearchCoordinate(localItems[0].lat, localItems[0].lng, `${localItems[0].subdistrictTh} ${localItems[0].provinceTh}`, localItems[0].zipCode);
    } else if (osmItems.length > 0) {
      selectSearchCoordinate(Number(osmItems[0].lat), Number(osmItems[0].lon), q, "");
    }
  } catch (err) {
    showToast("ค้นหาแผนที่ไม่สำเร็จ: " + err.message);
  }
}

function selectSearchCoordinate(lat, lng, label, zip) {
  const latEl = document.getElementById("newLocLat");
  const lngEl = document.getElementById("newLocLng");
  const zipEl = document.getElementById("newLocZip");
  if (latEl) latEl.value = Number(lat).toFixed(6);
  if (lngEl) lngEl.value = Number(lng).toFixed(6);
  if (zip && zipEl) zipEl.value = zip;
  moveDraftPinOnLeaflet(Number(lat), Number(lng), label);
}

function locateMyCurrentGps() {
  if (!navigator.geolocation) {
    showToast("เบราว์เซอร์นี้ไม่รองรับการดึงพิกัด GPS ปัจจุบันครับ");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      selectSearchCoordinate(lat, lng, "ตำแหน่งปัจจุบันของฉัน (GPS)", "");
      showToast("ดึงพิกัดปัจจุบันของคุณลงแผนที่เรียบร้อย!");
    },
    () => {
      showToast("ไม่สามารถเข้าถึง GPS ปัจจุบันได้ กรุณาแตะเลือกจุดบนแผนที่แทนครับ");
    }
  );
}

async function addNewLocationPin() {
  const locType = document.getElementById("newLocType")?.value || "CUSTOMER";
  const title = document.getElementById("newLocTitle")?.value.trim() || "";
  const contactName = document.getElementById("newLocContact")?.value.trim() || "";
  const phone = document.getElementById("newLocPhone")?.value.trim() || "";
  const addressLine = document.getElementById("newLocAddress")?.value.trim() || "";
  const deliveryStatus = document.getElementById("newLocStatus")?.value || "ACTIVE";
  const zipCode = document.getElementById("newLocZip")?.value || "10230";
  const lat = Number(document.getElementById("newLocLat")?.value || 13.811);
  const lng = Number(document.getElementById("newLocLng")?.value || 100.612);

  const prov = state.mapGeoCache;
  const distCode = document.getElementById("mapDistrictSelect")?.value || "";
  const subCode = document.getElementById("mapSubdistrictSelect")?.value || "";
  const dist = (prov?.districts || []).find((d) => String(d.code) === String(distCode));
  const sub = (dist?.subdistricts || []).find((s) => String(s.code) === String(subCode));

  if (!title) {
    showToast("กรุณาตั้งชื่อจุดปักหมุด เช่น ชื่อโกดัง หรือชื่อลูกค้าครับ");
    return;
  }

  try {
    const resp = await fetch("/api/shops/locations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUserEmail
      },
      body: JSON.stringify({
        shopId: state.shopId,
        locType,
        title,
        contactName,
        phone,
        addressLine,
        provinceCode: prov?.code || "10",
        provinceName: prov?.th || "กรุงเทพมหานคร",
        districtCode: distCode,
        districtName: dist?.th || "",
        subdistrictCode: subCode,
        subdistrictName: sub?.th || "",
        zipCode,
        lat,
        lng,
        deliveryStatus
      })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || "ปักหมุดไม่สำเร็จ");
    }
    document.getElementById("newLocTitle").value = "";
    document.getElementById("newLocContact").value = "";
    document.getElementById("newLocPhone").value = "";
    document.getElementById("newLocAddress").value = "";
    applyBootstrapPayload(data);
    initOrRefreshLeafletMap();
    showToast(`ปักหมุด "${title}" ลงแผนที่เรียบร้อย!`);
  } catch (err) {
    showToast("⚠️ " + err.message);
  }
}

async function updateLocationDeliveryStatus(locCode, nextStatus) {
  try {
    const resp = await fetch("/api/shops/locations/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUserEmail
      },
      body: JSON.stringify({
        shopId: state.shopId,
        locCode,
        deliveryStatus: nextStatus
      })
    });
    const data = await resp.json();
    if (resp.ok && data.ok) {
      applyBootstrapPayload(data);
      initOrRefreshLeafletMap();
      showToast(`อัปเดตสถานะจุดส่งของ ${locCode} เรียบร้อย!`);
    }
  } catch (err) {
    showToast("อัปเดตสถานะไม่สำเร็จ: " + err.message);
  }
}

function renderMapTab() {
  const listEl = document.getElementById("mapLocationsList");
  if (!listEl) return;
  const filtered = (state.locations || []).filter((l) => mapFilter === "ALL" || l.locType === mapFilter);

  if (filtered.length === 0) {
    listEl.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted);">ยังไม่มีหมุดในหมวดนี้</div>`;
  } else {
    listEl.innerHTML = filtered
      .map(
        (l) => `
        <div class="list-row">
          <div>
            <div class="inline-group" style="flex-wrap:wrap;margin-bottom:4px;">
              ${locTypeBadge(l.locType)}
              ${deliveryStatusBadge(l.deliveryStatus)}
              <span class="list-title">${l.title}</span>
            </div>
            <div class="list-sub">
              📍 ${l.addressLine || ""} ต.${l.subdistrictName || "-"} อ.${l.districtName || "-"} จ.${l.provinceName || "-"} ${l.zipCode || ""} (GPS: ${Number(l.lat).toFixed(4)}, ${Number(l.lng).toFixed(4)})
            </div>
            <div class="list-sub">
              ผู้ติดต่อ: ${l.contactName || "-"} (${l.phone || "-"}) ${l.trackingNo && l.trackingNo !== "-" ? `· ขนส่ง: <strong>${l.courier} (${l.trackingNo})</strong>` : ""}
            </div>
          </div>
          <div class="inline-group" style="flex-wrap:wrap;">
            <button type="button" class="btn btn-sm btn-outline" onclick="focusMapPin(${l.lat}, ${l.lng}, '${l.title.replace(/'/g, "")}')">🎯 ดูบนแผนที่</button>
            ${
              l.locType === "DELIVERY" && l.deliveryStatus !== "DELIVERED"
                ? `<button type="button" class="btn btn-sm btn-emerald" onclick="updateLocationDeliveryStatus('${l.id}', 'DELIVERED')">✓ ส่งถึงลูกค้าแล้ว</button>`
                : ""
            }
          </div>
        </div>
      `
      )
      .join("");
  }

  const mapTabPanel = document.getElementById("tab-map");
  if (mapTabPanel && mapTabPanel.classList.contains("active")) {
    initOrRefreshLeafletMap();
  }
}

// ============================================================================
// แท็บ 6: จดรายจ่าย · ค่าแอด · หัก ณ ที่จ่าย 50 ทวิ
// ============================================================================
async function addExpense() {
  const vendor = document.getElementById("expVendor").value.trim() || "ร้านค้า/ผู้รับเงินทั่วไป";
  const category = document.getElementById("expCategory").value.trim() || "ค่าใช้จ่ายร้านค้า";
  const amount = document.getElementById("expAmount").value.trim();
  const hasVat = document.getElementById("expHasVat").value;
  const whtRate = Number(document.getElementById("expWhtRate").value || 0);
  const bankCode = document.getElementById("expBankSelect")?.value || "KBANK";
  const receiptImageUrl = document.getElementById("expReceiptUrl")?.value || "";

  if (toSatang(amount) <= 0n) {
    showToast("กรุณากรอกยอดเงินค่าใช้จ่ายก่อนบันทึกครับ");
    return;
  }

  try {
    const resp = await fetch("/api/shops/expenses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUserEmail
      },
      body: JSON.stringify({
        shopId: state.shopId,
        vendor,
        category,
        amount,
        hasVat,
        whtRate,
        bankCode,
        receiptImageUrl
      })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || "บันทึกรายจ่ายไม่สำเร็จ");
    }
    document.getElementById("expVendor").value = "";
    document.getElementById("expCategory").value = "";
    document.getElementById("expAmount").value = "";
    if (document.getElementById("expReceiptUrl")) document.getElementById("expReceiptUrl").value = "";
    if (document.getElementById("expReceiptPreview")) document.getElementById("expReceiptPreview").textContent = "";
    applyBootstrapPayload(data);
    showToast(`บันทึกรายจ่าย "${vendor}" เรียบร้อย!`);
  } catch (err) {
    showToast("⚠️ " + err.message);
  }
}

function renderExpenses() {
  const el = document.getElementById("expenseListContainer");
  if (!el) return;
  el.innerHTML = state.expenses
    .map(
      (ex) => `
    <div class="list-row">
      <div>
        <div class="inline-group" style="margin-bottom:4px;flex-wrap:wrap;">
          <span class="badge badge-blue">${ex.category}</span>
          ${bankLogoBadgeHtml(ex.bankCode || "KBANK", "จ่ายจาก")}
          ${BigInt(ex.vatSatang || 0) > 0n ? `<span class="badge badge-green">VAT ซื้อ ฿${formatSatang(ex.vatSatang)}</span>` : ""}
          ${ex.whtRate > 0 ? `<span class="badge badge-amber">50 ทวิ หัก ${ex.whtRate}% (฿${formatSatang(ex.whtSatang)})</span>` : ""}
        </div>
        <div class="list-title">${ex.vendor}</div>
        <div class="list-sub">${ex.id} · วันที่ ${ex.date} · ยอดก่อนภาษี ฿${formatSatang(ex.amountSatang)}</div>
        ${ex.receiptImageUrl ? `<div style="margin-top:4px;"><a href="${ex.receiptImageUrl}" target="_blank" style="font-size:0.76rem;color:var(--primary);">🖼 ดูรูปใบเสร็จใน MinIO</a></div>` : ""}
      </div>
      <div class="inline-group">
        <span class="money" style="color:var(--rose);">จ่ายจริง ฿${formatSatang(ex.netPaySatang)}</span>
      </div>
    </div>
  `
    )
    .join("");
}

// ============================================================================
// แท็บ 7: รายงานภาษี & ผู้ช่วย AI + ระบบเชื่อมต่อ MCP (Model Context Protocol)
// ============================================================================
function renderTaxAndAi() {
  const m = computeMetrics();
  document.getElementById("taxOutputVat").textContent = "฿" + formatSatang(m.outputVatSatang);
  document.getElementById("taxInputVat").textContent = "฿" + formatSatang(m.inputVatSatang);
  document.getElementById("taxNetVat").textContent = "฿" + formatSatang(m.netVatPayableSatang);
  document.getElementById("taxTotalWht").textContent = "฿" + formatSatang(m.totalWhtSatang);
  document.getElementById("taxIncomeSummary").textContent = "฿" + formatSatang(m.totalSalesSatang);
  document.getElementById("taxExpenseSummary").textContent = "฿" + formatSatang(m.totalExpenseSatang);
}

async function testMcpToolCall(toolName) {
  const outEl = document.getElementById("mcpOutputBox");
  if (outEl) outEl.textContent = `⏳ กำลังยิงคำสั่ง MCP JSON-RPC 2.0 ไปยัง /api/mcp (Tool: ${toolName})...`;

  try {
    const resp = await fetch("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUserEmail
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: {
            email: currentUserEmail,
            shopId: state.shopId,
            query: "ลาดพร้าว"
          }
        }
      })
    });
    const data = await resp.json();
    const textContent = data?.result?.content?.[0]?.text || JSON.stringify(data, null, 2);
    if (outEl) outEl.textContent = textContent;
    showToast(`ทดสอบเรียก MCP Tool "${toolName}" สำเร็จ!`);
  } catch (err) {
    if (outEl) outEl.textContent = "Error: " + err.message;
  }
}

function copyMcpConfigJson() {
  const cfg = {
    mcpServers: {
      mysmebox: {
        command: "node",
        args: ["mcp-server.js"],
        env: {
          MYSMEBOX_API_URL: "https://www.mysmebox.com/api/mcp",
          MYSMEBOX_USER_EMAIL: currentUserEmail
        }
      }
    }
  };
  const str = JSON.stringify(cfg, null, 2);
  const outEl = document.getElementById("mcpOutputBox");
  if (outEl) outEl.textContent = str;
  navigator.clipboard?.writeText(str);
  showToast("คัดลอกไฟล์ตั้งค่า MCP (JSON) สำหรับไปวางใน Claude / Cursor / Antigravity เรียบร้อย!");
}

// ============================================================================
// แท็บ 8: เปิดเพจ/ร้านค้าใหม่ & กำหนดสิทธิ์ลูกน้องด้วย Gmail
// ============================================================================
function renderTeamAndShops() {
  const shopsEl = document.getElementById("multiShopCardsList");
  if (shopsEl) {
    shopsEl.innerHTML = state.shops
      .map((s) => {
        const isCurrent = String(s.id) === String(state.shopId);
        return `
          <div class="list-row" style="${isCurrent ? "border:2px solid var(--primary);background:#eff6ff;" : ""}">
            <div>
              <div class="inline-group" style="flex-wrap:wrap;margin-bottom:2px;">
                <span class="badge ${isCurrent ? "badge-blue" : "badge-gold"}">${s.shopCode}</span>
                <span class="badge badge-green">${s.myRoleLabel}</span>
                ${bankLogoBadgeHtml(s.bankCode || "KBANK", "")}
                <span class="list-title">${s.name}</span>
              </div>
              <div class="list-sub">
                หมวด: ${s.category} · ธนาคาร: ${s.bankCode || "KBANK"} (${s.bankAccountNo || ""}) · พร้อมเพย์: ${s.promptPayId}
              </div>
              <div class="list-sub">
                ยอดขาย: <strong>฿${formatSatang(s.salesSatang)}</strong> · <strong style="color:var(--emerald);">กำไรสุทธิ: ฿${formatSatang(s.netProfitSatang)}</strong>
              </div>
            </div>
            <div>
              ${
                !isCurrent
                  ? `<button type="button" class="btn btn-sm btn-primary" onclick="onSwitchShop('${s.id}')">สลับมาบริหารร้านนี้</button>`
                  : `<span class="badge badge-blue">✓ กำลังเปิดใช้งาน</span>`
              }
            </div>
          </div>
        `;
      })
      .join("");
  }

  const membersEl = document.getElementById("teamMembersList");
  if (membersEl) {
    membersEl.innerHTML = state.members
      .map((m) => {
        const p = m.permissions || {};
        const tags = [
          p.canSell ? "เปิดบิลขาย" : null,
          p.canStock ? "สต๊อก/หน่วยนับ" : null,
          p.canExpense ? "จดรายจ่าย" : null,
          p.canViewProfit ? "ดูกำไร" : null,
          p.canTax ? "ดูภาษี" : null,
          p.canManageTeam ? "จัดการทีม" : null
        ]
          .filter(Boolean)
          .join(" · ");

        return `
          <div class="list-row">
            <div>
              <div class="inline-group" style="flex-wrap:wrap;margin-bottom:2px;">
                <span class="badge ${m.role === "OWNER" ? "badge-gold" : "badge-blue"}">${m.roleLabel}</span>
                <span class="list-title">${m.email}</span>
              </div>
              <div class="list-sub">สิทธิ์ที่ทำได้: ${tags || "ดูข้อมูลพื้นฐาน"}</div>
            </div>
            <div class="inline-group">
              <button type="button" class="btn btn-sm btn-outline" onclick="quickSwitchGmail('${m.email}', '${m.roleLabel}')">ลองสลับเป็นคนนี้</button>
              ${
                m.role !== "OWNER"
                  ? `<button type="button" class="btn btn-sm btn-outline" style="color:var(--rose);" onclick="removeShopMember('${m.email}')">ลบออก</button>`
                  : ""
              }
            </div>
          </div>
        `;
      })
      .join("");
  }
}

async function createNewShop() {
  const name = document.getElementById("newShopName")?.value.trim();
  const category = document.getElementById("newShopCategory")?.value.trim() || "แม่ค้าออนไลน์";
  const promptPayId = document.getElementById("newShopPromptPay")?.value.trim() || "089-999-8888";
  const bankCode = document.getElementById("newShopBankSelect")?.value || "KBANK";
  const bankAccountNo = document.getElementById("newShopBankAcc")?.value.trim() || "123-4-56789-0";

  if (!name) {
    showToast("กรุณาตั้งชื่อร้านค้าหรือเพจใหม่ก่อนครับ");
    return;
  }

  try {
    const resp = await fetch("/api/shops", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUserEmail
      },
      body: JSON.stringify({
        name,
        category,
        promptPayId,
        bankCode,
        bankAccountNo
      })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || "สร้างร้านค้าไม่สำเร็จ");
    }
    document.getElementById("newShopName").value = "";
    applyBootstrapPayload(data);
    showToast(`เปิดร้านใหม่ "${name}" สำเร็จ! สลับมาที่ร้านใหม่ให้แล้ว`);
  } catch (err) {
    showToast("⚠️ " + err.message);
  }
}

function onRolePresetChange(role) {
  const presets = {
    ADMIN_LIVE: { sell: true, stock: false, exp: false, profit: false, tax: false, team: false },
    PACKER: { sell: false, stock: true, exp: false, profit: false, tax: false, team: false },
    ACCOUNTANT: { sell: false, stock: false, exp: true, profit: true, tax: true, team: false },
    MANAGER: { sell: true, stock: true, exp: true, profit: true, tax: true, team: false }
  };
  const p = presets[role] || presets.ADMIN_LIVE;
  document.getElementById("permCanSell").checked = p.sell;
  document.getElementById("permCanStock").checked = p.stock;
  document.getElementById("permCanExpense").checked = p.exp;
  document.getElementById("permCanViewProfit").checked = p.profit;
  document.getElementById("permCanTax").checked = p.tax;
  document.getElementById("permCanManageTeam").checked = p.team;
}

async function addShopMember() {
  const email = document.getElementById("newMemberEmail")?.value.trim();
  const role = document.getElementById("newMemberRole")?.value || "ADMIN_LIVE";
  const permissions = {
    canSell: document.getElementById("permCanSell")?.checked || false,
    canStock: document.getElementById("permCanStock")?.checked || false,
    canExpense: document.getElementById("permCanExpense")?.checked || false,
    canViewProfit: document.getElementById("permCanViewProfit")?.checked || false,
    canTax: document.getElementById("permCanTax")?.checked || false,
    canManageTeam: document.getElementById("permCanManageTeam")?.checked || false
  };

  if (!email || !email.includes("@")) {
    showToast("กรุณากรอกอีเมล Gmail ของลูกน้องให้ถูกต้องครับ");
    return;
  }

  try {
    const resp = await fetch("/api/shops/members", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUserEmail
      },
      body: JSON.stringify({
        shopId: state.shopId,
        email,
        role,
        permissions
      })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || "เพิ่มทีมงานไม่สำเร็จ");
    }
    document.getElementById("newMemberEmail").value = "";
    applyBootstrapPayload(data);
    showToast(`เพิ่มสิทธิ์ให้ ${email} เข้าร้านนี้เรียบร้อย!`);
  } catch (err) {
    showToast("⚠️ " + err.message);
  }
}

async function removeShopMember(targetEmail) {
  try {
    const resp = await fetch("/api/shops/members", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-user-email": currentUserEmail
      },
      body: JSON.stringify({
        shopId: state.shopId,
        email: targetEmail
      })
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || "ลบสมาชิกไม่สำเร็จ");
    }
    applyBootstrapPayload(data);
    showToast(`ลบ ${targetEmail} ออกจากร้านเรียบร้อย`);
  } catch (err) {
    showToast("⚠️ " + err.message);
  }
}

// ============================================================================
// Google Login Modal & MinIO Image Upload
// ============================================================================
function openGoogleLoginModal() {
  document.getElementById("googleLoginModalBackdrop")?.classList.add("open");
}

function closeGoogleLoginModal() {
  document.getElementById("googleLoginModalBackdrop")?.classList.remove("open");
}

async function submitGoogleLogin() {
  const email = document.getElementById("loginEmailInput")?.value.trim();
  const name = document.getElementById("loginNameInput")?.value.trim();
  if (!email || !email.includes("@")) {
    showToast("กรุณากรอกอีเมล Gmail ให้ถูกต้องครับ");
    return;
  }
  await quickSwitchGmail(email, name || email.split("@")[0]);
  closeGoogleLoginModal();
}

async function quickSwitchGmail(email, name) {
  currentUserEmail = String(email).toLowerCase().trim();
  localStorage.setItem(USER_EMAIL_KEY, currentUserEmail);
  try {
    const resp = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: currentUserEmail, name })
    });
    const data = await resp.json();
    if (resp.ok && data.ok) {
      applyBootstrapPayload(data);
      closeGoogleLoginModal();
      showToast(`สลับบัญชีเป็น ${currentUserEmail} เรียบร้อย!`);
    }
  } catch (err) {
    showToast("สลับบัญชีไม่สำเร็จ: " + err.message);
  }
}

async function handleUploadImage(fileInput, folder, hiddenInputId) {
  const file = fileInput?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const resp = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": currentUserEmail
        },
        body: JSON.stringify({
          folder,
          contentType: file.type || "image/webp",
          base64Data: reader.result
        })
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || "อัปโหลดรูปไม่สำเร็จ");
      }
      const hiddenEl = document.getElementById(hiddenInputId);
      if (hiddenEl) hiddenEl.value = data.url;
      const previewId = hiddenInputId.replace("Url", "Preview");
      const previewEl = document.getElementById(previewId);
      if (previewEl) {
        previewEl.innerHTML = `✅ อัปโหลดเข้า MinIO สำเร็จ: <a href="${data.url}" target="_blank">${data.key}</a>`;
      }
      showToast("อัปโหลดรูปภาพเข้า MinIO สำเร็จ!");
    } catch (err) {
      showToast("⚠️ " + err.message);
    }
  };
  reader.readAsDataURL(file);
}

// ============================================================================
// Ollama Cloud AI Co-Pilot Functions
// ============================================================================
async function callAiApi(mode, prompt) {
  const modelSelect = document.getElementById("aiModelSelect");
  const model = modelSelect?.value || state.selectedAiModel || "gpt-oss:120b";
  state.selectedAiModel = model;

  const resp = await fetch("/api/ai/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-email": currentUserEmail
    },
    body: JSON.stringify({
      mode,
      prompt,
      model,
      shopContext: buildShopContextForAi()
    })
  });
  const data = await resp.json();
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || "เรียกใช้งาน Ollama Cloud ไม่สำเร็จ");
  }
  return data;
}

async function runAiSmartCommand(presetPrompt) {
  const inputEl = document.getElementById("aiCommandInput");
  const statusEl = document.getElementById("aiCommandStatus");
  const btnEl = document.getElementById("aiCommandBtn");

  if (presetPrompt) {
    inputEl.value = presetPrompt;
  }
  const prompt = inputEl.value.trim();
  if (!prompt) {
    showToast("พิมพ์คำสั่งบอกผู้ช่วย AI ได้เลยครับ");
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = "⏳ AI กำลังทำให้...";
  statusEl.textContent = "กำลังประมวลผลด้วย Ollama Cloud...";

  try {
    const res = await callAiApi("SMART_COMMAND", prompt);
    const st = res.structured;

    if (st && st.action === "CREATE_BILL" && st.bill) {
      cart = [];
      const items = Array.isArray(st.bill.items) ? st.bill.items : [];
      for (const it of items) {
        const prod = state.products.find((p) => p.id === it.productId) || state.products[0];
        if (prod) {
          const uom = (prod.units || []).find((u) => u.unitCode === it.unitCode) || prod.units?.[0];
          if (uom) addToCart(prod.id, uom.unitCode, uom.barcode, Math.max(1, Number(it.qty || 1)));
        }
      }
      if (cart.length === 0 && state.products[0]?.units?.[0]) {
        addToCart(state.products[0].id, state.products[0].units[0].unitCode, state.products[0].units[0].barcode, 1);
      }
      document.getElementById("posCustomer").value = st.bill.customer || "ลูกค้าสั่งผ่าน AI";
      document.getElementById("posAddress").value = st.bill.address || "จัดส่งตามแชท";
      if (st.bill.channel) document.getElementById("posChannel").value = st.bill.channel;
      if (st.bill.courier) document.getElementById("posCourier").value = st.bill.courier;
      if (st.bill.shippingFee !== undefined) document.getElementById("posShippingFee").value = String(st.bill.shippingFee);
      if (st.bill.docType) document.getElementById("posDocType").value = st.bill.docType;
      if (st.bill.payStatus) document.getElementById("posPayStatus").value = st.bill.payStatus;
      switchTab("pos");
      renderCart();
      statusEl.textContent = `✅ Ollama Cloud (${res.model}): ${st.summary || "จัดของลงบิลให้เรียบร้อย กดเปิดบิลได้เลย"}`;
      showToast("AI จัดสินค้าลงบิลให้แล้ว กดปุ่มเปิดบิลได้เลย!");
    } else if (st && st.action === "ADD_EXPENSE" && st.expense) {
      document.getElementById("expVendor").value = st.expense.vendor || "รายการจาก AI";
      document.getElementById("expCategory").value = st.expense.category || "ค่าใช้จ่ายร้านค้า";
      document.getElementById("expAmount").value = String(st.expense.amount || "500");
      document.getElementById("expHasVat").value = String(st.expense.hasVat || "0");
      document.getElementById("expWhtRate").value = String(st.expense.whtRate || "0");
      await addExpense();
      switchTab("expense");
      statusEl.textContent = `✅ Ollama Cloud (${res.model}): ${st.summary || "จดรายจ่ายและคำนวณภาษีให้เรียบร้อย"}`;
    } else {
      const msg = st?.summary || res.reply || "ประมวลผลสำเร็จ";
      statusEl.textContent = `🤖 Ollama Cloud (${res.model}): ${msg}`;
      document.getElementById("aiGeneratedText").value = msg;
    }
  } catch (err) {
    statusEl.textContent = "⚠️ " + err.message;
    showToast(err.message);
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = "🤖 สั่ง AI ทำให้เลย";
  }
}

async function runAiParseOrder() {
  const chatInput = document.getElementById("posAiChatInput");
  const btn = document.getElementById("posAiParseBtn");
  if (!chatInput.value.trim()) {
    chatInput.value = "CF เซรั่มวิตซี 1 แพ็ค กับ กันแดด 1 เซ็ต ส่งคุณแนน 88/5 ซ.ลาดพร้าว 15 จตุจักร กทม 10900 โทร 081-999-2233 ส่ง Flash เก็บปลายทาง COD ค่าส่ง 40 บาท";
  }

  btn.disabled = true;
  btn.textContent = "⏳ AI กำลังแกะแชท...";
  try {
    const res = await callAiApi("PARSE_ORDER", chatInput.value.trim());
    const st = res.structured;
    if (st) {
      cart = [];
      const items = Array.isArray(st.items) ? st.items : [];
      for (const it of items) {
        const prod = state.products.find((p) => p.id === it.productId) || state.products[0];
        if (prod) {
          const uom = (prod.units || []).find((u) => u.unitCode === it.unitCode) || prod.units?.[0];
          if (uom) addToCart(prod.id, uom.unitCode, uom.barcode, Math.max(1, Number(it.qty || 1)));
        }
      }
      if (st.customer) document.getElementById("posCustomer").value = st.customer;
      if (st.address) document.getElementById("posAddress").value = st.address;
      if (st.channel) document.getElementById("posChannel").value = st.channel;
      if (st.courier) document.getElementById("posCourier").value = st.courier;
      if (st.shippingFee !== undefined) document.getElementById("posShippingFee").value = String(st.shippingFee);
      if (st.docType) document.getElementById("posDocType").value = st.docType;
      if (st.payStatus) document.getElementById("posPayStatus").value = st.payStatus;
      renderCart();
      showToast(`AI ดูดแชทเข้าบิลเรียบร้อย!`);
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🤖 ดูดแชทเข้าบิล";
  }
}

async function runAiParseExpense() {
  const inputEl = document.getElementById("expAiRawText");
  const btn = document.getElementById("expAiParseBtn");
  if (!inputEl.value.trim()) {
    inputEl.value = "จ่ายค่าจ้างน้องแพรวรีวิวเซรั่มลง TikTok 3,500 บาท ไม่มี VAT หักภาษี ณ ที่จ่ายตามกฎหมาย";
  }

  btn.disabled = true;
  btn.textContent = "⏳ กำลังแยกบิล...";
  try {
    const res = await callAiApi("PARSE_EXPENSE", inputEl.value.trim());
    const st = res.structured;
    if (st) {
      if (st.vendor) document.getElementById("expVendor").value = st.vendor;
      if (st.category) document.getElementById("expCategory").value = st.category;
      if (st.amount) document.getElementById("expAmount").value = String(st.amount);
      if (st.hasVat !== undefined) document.getElementById("expHasVat").value = String(st.hasVat);
      if (st.whtRate !== undefined) document.getElementById("expWhtRate").value = String(st.whtRate);
      showToast(`AI กรอกข้อมูลบิลให้แล้ว: ${st.summary || "พร้อมบันทึก"}`);
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ ให้ AI กรอกให้";
  }
}

async function generateAiMessage(type) {
  const box = document.getElementById("aiGeneratedText");
  const customAsk = document.getElementById("aiCustomPrompt")?.value.trim();

  let prompt = "";
  if (type === "CUSTOM" && customAsk) {
    prompt = customAsk;
  } else if (type === "LIVE_SCRIPT") {
    prompt = "ช่วยเขียนบทพูดไลฟ์สดและแคปชั่นโพสต์ขายสินค้าในร้าน ชูจุดเด่นโปรซื้อยกแพ็ค/ยกลังคุ้มกว่าซื้อขวดเดี่ยว ใช้ภาษาไทยสนุกๆ แบบแม่ค้าออนไลน์ขายดี";
  } else if (type === "FOLLOW_UP") {
    prompt = `ช่วยร่างข้อความทวงยอดโอนลูกค้าที่ CF ของไว้แบบสุภาพ น่ารัก พร้อมแจ้งเลขพร้อมเพย์ ${state.promptPayId}`;
  } else {
    prompt = "สรุปภาพรวมยอดขายและกำไรของร้านวันนี้ แนะนำสินค้าที่ควรจัดโปรขายแพ็คคู่หรือยกลังเป็นข้อๆ เข้าใจง่าย";
  }

  box.value = "⏳ กำลังถามผู้ช่วย AI สักครู่ครับ...";
  try {
    const res = await callAiApi("ASSISTANT_CHAT", prompt);
    box.value = res.reply;
    showToast(`ผู้ช่วย AI (${res.model}) ตอบกลับเรียบร้อย!`);
  } catch {
    const m = computeMetrics();
    box.value = `📊 สรุปยอดร้าน "${state.shopName}" วันนี้:\n- ยอดขายรวม: ฿${formatSatang(m.totalSalesSatang)} บาท\n- กำไรสุทธิเข้ากระเป๋า: ฿${formatSatang(m.netProfitSatang)} บาท\n- เงินสดเหลือจริงในมือ: ฿${formatSatang(m.netCashInHandSatang)} บาท\n- ยอดรอโอน CF / COD: ฿${formatSatang(m.unpaidReceivableSatang)} บาท`;
  }
}

function copyAiText() {
  const box = document.getElementById("aiGeneratedText");
  if (!box || !box.value) return;
  navigator.clipboard?.writeText(box.value);
  showToast("คัดลอกข้อความเรียบร้อย เอาไปวางใน LINE หรือ Facebook ได้เลย!");
}

function exportAccountingCsv() {
  const rows = [
    ["ประเภท", "เลขที่เอกสาร", "วันที่", "ช่องทาง/ขนส่ง", "ชื่อลูกค้า/ร้านค้า", "ยอดก่อนภาษี", "VAT 7%", "หัก ณ ที่จ่าย", "ยอดสุทธิ", "สถานะ"]
  ];
  for (const b of state.bills) {
    rows.push([
      docTypeLabel(b.docType),
      b.id,
      b.date,
      `${b.channel || "LINE OA"} / ${b.courier || "Flash"} (${b.trackingNo || "-"})`,
      b.customer,
      formatSatang(b.subTotalSatang),
      formatSatang(b.vatSatang),
      "0.00",
      formatSatang(b.grandTotalSatang),
      b.status
    ]);
  }
  for (const ex of state.expenses) {
    rows.push([
      "รายจ่าย (" + ex.category + ")",
      ex.id,
      ex.date,
      ex.bankCode || "KBANK",
      ex.vendor,
      formatSatang(ex.amountSatang),
      formatSatang(ex.vatSatang),
      formatSatang(ex.whtSatang),
      formatSatang(ex.netPaySatang),
      "PAID"
    ]);
  }

  const csvContent = "\uFEFF" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mysmebox-${state.shopCode}-report.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("ดาวน์โหลดไฟล์ Excel (CSV) เรียบร้อย!");
}

function openBillModal(billId) {
  const b = state.bills.find((x) => x.id === billId);
  if (!b) return;
  activeModalBillId = billId;
  document.getElementById("modalDocTitle").textContent = `${docTypeLabel(b.docType)} (${b.id})`;
  document.getElementById("modalCustomer").textContent = `${b.customer} (${b.channel || "LINE OA"})`;
  document.getElementById("modalAddress").textContent = `${b.address} · ขนส่ง: ${b.courier || "Flash Express"} (${b.trackingNo || "-"})`;
  document.getElementById("modalItems").innerHTML = (b.items || [])
    .map((i) => {
      const lineTotal = BigInt(i.priceSatang || 0) * BigInt(i.qty || 1);
      return `<div class="row-baseline" style="padding:6px 0;border-bottom:1px dashed var(--border);font-size:0.86rem;">
      <div>
        <div><strong>${i.name}</strong> × ${i.qty} ${i.unitName || "ชิ้น"}</div>
        <div style="font-size:0.74rem;color:var(--text-muted);">บาร์โค้ด: ${i.barcode || "-"} (ตัดสต๊อก ${i.qty * Number(i.factor || 1)} หน่วยย่อย)</div>
      </div>
      <span class="money">฿${formatSatang(lineTotal)}</span>
    </div>`;
    })
    .join("");
  document.getElementById("modalGrandTotal").textContent = "฿" + formatSatang(b.grandTotalSatang);
  document.getElementById("modalPromptPay").textContent = state.promptPayId;
  document.getElementById("billModalBackdrop").classList.add("open");
}

function closeBillModal() {
  document.getElementById("billModalBackdrop").classList.remove("open");
}

function copyBillSummaryForLine() {
  const b = state.bills.find((x) => x.id === activeModalBillId);
  if (!b) return;
  const lines = [
    `🧾 ${docTypeLabel(b.docType)} #${b.id}`,
    `ลูกค้า: ${b.customer} (${b.channel || "LINE OA"})`,
    `ที่อยู่จัดส่ง: ${b.address}`,
    `ขนส่ง: ${b.courier || "Flash Express"} เลขพัสดุ: ${b.trackingNo || "-"}`,
    ...(b.items || []).map((i) => `- ${i.name} × ${i.qty} ${i.unitName || "ชิ้น"} = ฿${formatSatang(BigInt(i.priceSatang || 0) * BigInt(i.qty || 1))}`),
    `ยอดสุทธิ: ฿${formatSatang(b.grandTotalSatang)} บาท`,
    `พร้อมเพย์: ${state.promptPayId} (${state.shopName})`
  ];
  navigator.clipboard?.writeText(lines.join("\n"));
  showToast("คัดลอกสรุปบิล + เลขพัสดุส่งแชทลูกค้าเรียบร้อย!");
}

async function checkAiStatus() {
  const badge = document.getElementById("aiStatusBadge");
  try {
    const r = await fetch("/api/ai/status");
    const j = await r.json();
    if (j && j.ok && badge) {
      badge.textContent = `🟢 AI (${j.activeModel}) · 77 จังหวัด · 20 ธนาคาร`;
    }
  } catch {
    if (badge) badge.textContent = "🟢 ผู้ช่วย AI พร้อมใช้งาน";
  }
}

function renderAll() {
  renderCentralBanksDropdowns();
  renderDashboard();
  renderPos();
  renderDocs();
  renderStock();
  renderMapTab();
  renderExpenses();
  renderTaxAndAi();
  renderTeamAndShops();
}

window.addEventListener("DOMContentLoaded", async () => {
  renderCentralBanksDropdowns();
  await initCentralProvinces();
  await fetchBootstrap(currentShopId);
  await checkAiStatus();

  const box = document.getElementById("aiGeneratedText");
  if (box) {
    const m = computeMetrics();
    box.value = `🤖 สวัสดีค่ะแม่ค้า! ระบบ MySMEBox พร้อมช่วยดูแลร้าน "${state.shopName}" แล้วค่ะ\n- ยอดขายรวมร้านนี้: ฿${formatSatang(m.totalSalesSatang)} บาท (กำไรสุทธิเข้ากระเป๋า ฿${formatSatang(m.netProfitSatang)} บาท)\n- ข้อมูลธนาคารไทย 20 แห่ง และ 77 จังหวัด 928 อำเภอ 7,436 ตำบล พร้อมพิกัดแผนที่พร้อมใช้งานแล้ว ไม่ต้องตั้งค่าเอง\n- เชื่อมต่อกับ AI ตัวอื่นผ่านระบบ MCP (/api/mcp) ได้ทันที!`;
  }
});
