// ตัวเลือกที่อยู่ไทย: ค้นหาด่วน + จังหวัด → อำเภอ → ตำบล เติมรหัสไปรษณีย์และพิกัดให้อัตโนมัติ
// ใช้ซ้ำใน: เปิดออเดอร์, ลูกค้า, โกดัง, ตั้งค่าร้าน
import { api, qs } from './api.js';
import { esc, debounce, icon } from './ui.js';

let provincesPromise = null;
const geoCache = new Map();

function loadProvinces() {
  if (!provincesPromise) {
    provincesPromise = api('/api/master/provinces').then((r) => r.provinces || []).catch((e) => { provincesPromise = null; throw e; });
  }
  return provincesPromise;
}

function loadGeography(code) {
  const k = String(code);
  if (!geoCache.has(k)) {
    geoCache.set(k, api('/api/master/geography' + qs({ province: k })).then((r) => r.province).catch((e) => { geoCache.delete(k); throw e; }));
  }
  return geoCache.get(k);
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v)); // พิกัดไม่ใช่เงิน ใช้ number ได้

export const EMPTY_ADDRESS = {
  addressLine: '', provinceCode: '', provinceName: '', districtCode: '', districtName: '',
  subdistrictCode: '', subdistrictName: '', zipCode: '', lat: null, lng: null,
};

/** ข้อความที่อยู่เต็มบรรทัดเดียว */
export function addressText(a) {
  if (!a) return '';
  const bkk = String(a.provinceCode || '') === '10' || /กรุงเทพ/.test(a.provinceName || a.province || '');
  const sub = a.subdistrictName || a.subdistrict;
  const dis = a.districtName || a.district;
  const prov = a.provinceName || a.province;
  return [
    a.addressLine,
    sub ? (bkk ? 'แขวง' : 'ต.') + sub : '',
    dis ? (bkk ? 'เขต' : 'อ.') + dis : '',
    prov ? (bkk ? prov : 'จ.' + prov) : '',
    a.zipCode || a.zip || '',
  ].filter(Boolean).join(' ');
}

let seq = 0;

/**
 * @param {HTMLElement} container
 * @param {{value?:object, withLine?:boolean, onChange?:(addr:object)=>void, lineLabel?:string}} opts
 */
export function createAddressPicker(container, opts = {}) {
  const id = 'ap' + (++seq);
  const withLine = opts.withLine !== false;
  container.classList.add('address-picker');
  container.innerHTML = `
    ${withLine ? `<label class="field"><span>${esc(opts.lineLabel || 'บ้านเลขที่ / ถนน / ซอย')}</span><textarea rows="2" maxlength="300" data-k="line" placeholder="เช่น 88/9 ซ.ลาดพร้าว 15"></textarea></label>` : ''}
    <div class="field ap-search-wrap">
      <span>ค้นหาด่วน (ตำบล / อำเภอ / รหัสไปรษณีย์)</span>
      <div class="input-icon">${icon('search', 18)}<input type="search" data-k="q" autocomplete="off" placeholder="พิมพ์ เช่น จอมพล หรือ 10900" aria-controls="${id}-res"></div>
      <div class="ap-results" id="${id}-res" role="listbox" hidden></div>
    </div>
    <div class="grid-3">
      <label class="field"><span>จังหวัด</span><select data-k="prov"><option value="">กำลังโหลด…</option></select></label>
      <label class="field"><span>อำเภอ / เขต</span><select data-k="dist" disabled><option value="">เลือกจังหวัดก่อน</option></select></label>
      <label class="field"><span>ตำบล / แขวง</span><select data-k="sub" disabled><option value="">เลือกอำเภอก่อน</option></select></label>
    </div>
    <div class="grid-2">
      <label class="field"><span>รหัสไปรษณีย์</span><input data-k="zip" inputmode="numeric" maxlength="5" placeholder="อัตโนมัติ"></label>
      <div class="field"><span>พิกัดแผนที่</span><div class="ap-coord" data-k="coord">ยังไม่มีพิกัด</div></div>
    </div>`;

  const el = (k) => container.querySelector(`[data-k="${k}"]`);
  const line = el('line'), q = el('q'), res = container.querySelector('.ap-results');
  const selProv = el('prov'), selDist = el('dist'), selSub = el('sub'), zip = el('zip'), coord = el('coord');
  let province = null; // geography ของจังหวัดที่เลือก
  let lat = null, lng = null;

  const emit = () => opts.onChange && opts.onChange(getValue());
  const showCoord = () => {
    coord.textContent = lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'ยังไม่มีพิกัด';
  };
  const setCoord = (a, b, silent) => {
    lat = num(a); lng = num(b);
    showCoord();
    if (!silent) emit();
  };

  async function fillProvinces(selected) {
    try {
      const list = await loadProvinces();
      selProv.innerHTML = '<option value="">เลือกจังหวัด</option>' + list.map((p) => `<option value="${esc(p.code)}">${esc(p.th)}</option>`).join('');
      if (selected) selProv.value = String(selected);
    } catch (e) {
      selProv.innerHTML = '<option value="">โหลดจังหวัดไม่ได้</option>';
    }
  }

  async function chooseProvince(code, { keepCoord } = {}) {
    province = null;
    selDist.innerHTML = '<option value="">เลือกจังหวัดก่อน</option>';
    selSub.innerHTML = '<option value="">เลือกอำเภอก่อน</option>';
    selDist.disabled = true; selSub.disabled = true;
    if (!code) return;
    selDist.innerHTML = '<option value="">กำลังโหลด…</option>';
    try {
      province = await loadGeography(code);
    } catch {
      selDist.innerHTML = '<option value="">โหลดข้อมูลไม่ได้</option>';
      return;
    }
    selDist.innerHTML = '<option value="">เลือกอำเภอ / เขต</option>' + (province.districts || []).map((d) => `<option value="${esc(d.code)}">${esc(d.th)}</option>`).join('');
    selDist.disabled = false;
    if (!keepCoord) setCoord(province.lat, province.lng, true);
  }

  function districtObj() {
    return province && (province.districts || []).find((d) => String(d.code) === selDist.value);
  }
  function subdistrictObj() {
    const d = districtObj();
    return d && (d.subdistricts || []).find((s) => String(s.code) === selSub.value);
  }

  function chooseDistrict(code, { keepCoord } = {}) {
    selSub.innerHTML = '<option value="">เลือกอำเภอก่อน</option>';
    selSub.disabled = true;
    const d = districtObj();
    if (!code || !d) return;
    selSub.innerHTML = '<option value="">เลือกตำบล / แขวง</option>' + (d.subdistricts || []).map((s) => `<option value="${esc(s.code)}">${esc(s.th)}</option>`).join('');
    selSub.disabled = false;
    if (!keepCoord) setCoord(d.lat, d.lng, true);
  }

  function chooseSubdistrict({ keepCoord } = {}) {
    const s = subdistrictObj();
    if (s) {
      zip.value = s.zipCode || '';
      if (!keepCoord) setCoord(s.lat, s.lng, true);
    }
  }

  selProv.addEventListener('change', async () => { await chooseProvince(selProv.value); zip.value = ''; emit(); });
  selDist.addEventListener('change', () => { chooseDistrict(selDist.value); zip.value = ''; emit(); });
  selSub.addEventListener('change', () => { chooseSubdistrict(); emit(); });
  zip.addEventListener('input', () => { zip.value = zip.value.replace(/\D/g, '').slice(0, 5); });
  line && line.addEventListener('input', debounce(emit, 300));

  async function applyResult(r) {
    res.hidden = true;
    q.value = '';
    selProv.value = String(r.provinceCode);
    await chooseProvince(r.provinceCode);
    selDist.value = String(r.districtCode);
    chooseDistrict(r.districtCode);
    selSub.value = String(r.subdistrictCode);
    chooseSubdistrict({ keepCoord: true });
    zip.value = r.zipCode || zip.value;
    setCoord(r.lat, r.lng, true);
    emit();
  }

  let lastResults = [];
  const runSearch = async (text, autoPickSingle = false) => {
    const t = text.trim();
    if (t.length < 2) { res.hidden = true; return; }
    try {
      const r = await api('/api/master/address-search' + qs({ q: t }));
      if (q.value.trim() !== t && !autoPickSingle) return;
      lastResults = r.results || [];
      if (autoPickSingle && lastResults.length === 1) { await applyResult(lastResults[0]); return; }
      res.innerHTML = lastResults.length
        ? lastResults.map((x, i) => `<button type="button" role="option" class="ap-item" data-i="${i}"><b>${esc(x.subdistrictTh)}</b> <span>${esc(x.districtTh)} · ${esc(x.provinceTh)}</span> <span class="ap-zip">${esc(x.zipCode)}</span></button>`).join('')
        : '<div class="ap-none">ไม่พบที่อยู่นี้</div>';
      res.hidden = false;
    } catch (e) {
      res.innerHTML = `<div class="ap-none">${esc(e.message)}</div>`;
      res.hidden = false;
    }
  };
  q.addEventListener('input', debounce(() => runSearch(q.value), 250));
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(q.value); } });
  res.addEventListener('click', (e) => {
    const b = e.target.closest('.ap-item');
    if (b) applyResult(lastResults[Number(b.dataset.i)]);
  });
  document.addEventListener('click', (e) => { if (!container.contains(e.target)) res.hidden = true; });

  function getValue() {
    const p = province;
    const d = districtObj();
    const s = subdistrictObj();
    return {
      addressLine: line ? line.value.trim() : '',
      provinceCode: p ? String(p.code) : '',
      provinceName: p ? p.th : '',
      districtCode: d ? String(d.code) : '',
      districtName: d ? d.th : '',
      subdistrictCode: s ? String(s.code) : '',
      subdistrictName: s ? s.th : '',
      zipCode: zip.value.trim(),
      lat, lng,
    };
  }

  async function setValue(a) {
    a = { ...EMPTY_ADDRESS, ...(a || {}) };
    if (line) line.value = a.addressLine || '';
    await fillProvinces(a.provinceCode);
    if (a.provinceCode) {
      await chooseProvince(a.provinceCode, { keepCoord: true });
      if (a.districtCode) {
        selDist.value = String(a.districtCode);
        chooseDistrict(a.districtCode, { keepCoord: true });
        if (a.subdistrictCode) { selSub.value = String(a.subdistrictCode); chooseSubdistrict({ keepCoord: true }); }
      }
    } else {
      selDist.disabled = true; selSub.disabled = true;
    }
    zip.value = a.zipCode || '';
    setCoord(a.lat, a.lng, true);
  }

  const ready = setValue(opts.value);

  return {
    el: container,
    ready,
    getValue,
    setValue,
    /** ตั้งพิกัดจากการแตะแผนที่ / GPS */
    setLatLng: (a, b) => setCoord(a, b),
    /** ค้นหาด้วยข้อความ (เช่น รหัสไปรษณีย์จาก AI) เลือกให้เลยถ้าเจอผลเดียว */
    searchAndPick: async (text) => { q.value = text; await runSearch(text, true); if (!res.hidden) q.focus(); },
    setLine: (t) => { if (line) line.value = t; },
  };
}
