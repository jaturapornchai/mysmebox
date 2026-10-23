// หน้าสินค้า (เพิ่ม/แก้ไข) + รับของเข้า/ปรับยอด + ประวัติเคลื่อนไหว
import { api, qs } from './api.js';
import { esc, icon, toast, modal, confirmDialog, busy, skeleton, renderError, fmtDateTime } from './ui.js';
import { big, fmtBaht, parseBahtInput, satangToInput } from './money.js';

const UNIT_CODE_RE = /^[A-Z0-9_-]{1,20}$/;
const BARCODE_RE = /^[0-9A-Za-z-]{4,32}$/;
const INT_RE = /^\d{1,6}$/;

// ชื่อหน่วยไทยที่พบบ่อย → รหัสหน่วย (แก้เองได้เสมอ)
const UNIT_MAP = [
  ['กิโลกรัม', 'KG'], ['กระป๋อง', 'CAN'], ['กระปุก', 'JAR'], ['กระสอบ', 'SACK'], ['แกลลอน', 'GAL'], ['เครื่อง', 'UNIT'],
  ['กล่อง', 'BOX'], ['กิโล', 'KG'], ['หลอด', 'TUBE'], ['ขวด', 'BTL'], ['ชิ้น', 'PCS'], ['แพ็ค', 'PK'], ['แพค', 'PK'],
  ['ลัง', 'CTN'], ['ถุง', 'BAG'], ['ซอง', 'SAC'], ['โหล', 'DZ'], ['กรัม', 'G'], ['ลิตร', 'L'], ['เมตร', 'M'],
  ['ม้วน', 'ROLL'], ['แผง', 'PNL'], ['ห่อ', 'PKT'], ['ชุด', 'SET'], ['คู่', 'PR'], ['อัน', 'EA'], ['ตัว', 'EA'],
  ['ใบ', 'PC'], ['แท่ง', 'BAR'], ['ก้อน', 'BAR'], ['เม็ด', 'TAB'], ['มัด', 'BDL'], ['ถาด', 'TRAY'], ['เล่ม', 'BK'],
];

function genUnitCode(name, stand, used) {
  const n = String(name || '').trim();
  let code = '';
  const ascii = n.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (ascii && /^[A-Z]/.test(ascii)) code = ascii.slice(0, 8);
  else {
    const hit = UNIT_MAP.find(([th]) => n.startsWith(th));
    code = hit ? hit[1] : 'U';
    if (stand > 1) code += String(stand);
  }
  let out = code.slice(0, 20), i = 2;
  while (used.has(out)) out = `${code.slice(0, 16)}-${i++}`;
  return out;
}

/** EAN-13 ถัดไป (เพิ่มเลข 12 หลักแรก + คำนวณหลักตรวจสอบใหม่) — ใช้เมื่อเลขที่ระบบเสนอซ้ำกับแถวอื่นในฟอร์ม */
function nextEan13(code) {
  if (!/^\d{13}$/.test(code)) return '';
  const body = (BigInt(code.slice(0, 12)) + 1n).toString().padStart(12, '0');
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}

let uidSeq = 0;
const uid = () => 'u' + (++uidSeq);

export async function render(view, ctx) {
  const id = ctx.params[0] || null;
  ctx.setTitle(id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่', '#/products');
  let product = null;

  const st = {
    name: '', code: '', unitName: '', unitCode: '', unitManual: false, cost: '', opening: '', minStock: '',
    extras: [], // {key, unitName, unitCode, manual, stand, divide}
    rows: [], // {key, unitKey, barcode, price, member, wholesale}
  };

  if (id) {
    view.innerHTML = skeleton(6);
    try {
      product = (await api(`/api/products/${encodeURIComponent(id)}`)).product;
    } catch (e) { if (ctx.isActive()) renderError(view, e, () => render(view, ctx)); return; }
    if (!ctx.isActive()) return;
    st.name = product.name; st.code = product.code;
    st.unitName = product.baseUnitName; st.unitCode = product.baseUnitCode; st.unitManual = true;
    st.cost = satangToInput(product.costBaseSatang); st.minStock = String(product.minStockBase ?? '');
    const keyByCode = { [product.baseUnitCode]: 'base' };
    for (const u of product.units || []) {
      if (u.unitCode === product.baseUnitCode) continue;
      const k = uid();
      keyByCode[u.unitCode] = k;
      st.extras.push({ key: k, unitName: u.unitName, unitCode: u.unitCode, manual: true, stand: String(u.standValue), divide: u.divideValue || 1 });
    }
    for (const b of product.barcodes || []) {
      st.rows.push({ key: uid(), unitKey: keyByCode[b.unitCode] || 'base', barcode: b.barcode, price: satangToInput(b.priceSatang) || '0', member: satangToInput(b.priceMemberSatang), wholesale: satangToInput(b.priceWholesaleSatang) });
    }
  } else {
    st.rows.push({ key: uid(), unitKey: 'base', barcode: '', price: '', member: '', wholesale: '' });
  }

  const unitList = () => [{ key: 'base', unitName: st.unitName, unitCode: st.unitCode, stand: '1', divide: 1 }, ...st.extras];
  const unitByKey = (k) => unitList().find((u) => u.key === k);
  const usedCodes = (exceptKey) => new Set(unitList().filter((u) => u.key !== exceptKey).map((u) => u.unitCode).filter(Boolean));

  view.innerHTML = `
    ${id ? `<section class="card stock-card">
      <div class="stock-now"><span class="muted">คงเหลือ</span><b class="stock-num" data-stock>${esc(product.stockBase)}</b><span>${esc(product.baseUnitName)}</span>${product.isLowStock ? '<span class="badge badge-red">ใกล้หมด</span>' : ''}</div>
      <div class="actions"><button type="button" class="btn btn-primary" data-receive>${icon('plus', 18)}<span>รับของเข้า</span></button><button type="button" class="btn btn-outline" data-adjust>${icon('edit', 18)}<span>ปรับยอด</span></button></div>
    </section>` : ''}
    <form data-form novalidate>
      <section class="card">
        <div class="card-head"><h2>ข้อมูลสินค้า</h2></div>
        <label class="field"><span>ชื่อสินค้า *</span><input data-f="name" maxlength="200" required placeholder="เช่น เซรั่มวิตามินซี 30ml" value="${esc(st.name)}"></label>
        <label class="field"><span>รหัสสินค้า</span><input data-f="code" maxlength="40" placeholder="เว้นว่าง = ระบบตั้งให้" value="${esc(st.code)}"></label>
      </section>
      <section class="card">
        <div class="card-head"><h2>หน่วยเล็กสุดที่นับสต๊อก</h2></div>
        <p class="hint">สต๊อกทั้งหมดนับเป็นหน่วยนี้ เช่น ขวด ชิ้น ซอง</p>
        <div class="grid-2">
          <label class="field"><span>ชื่อหน่วย *</span><input data-f="unitName" maxlength="40" placeholder="เช่น ขวด" value="${esc(st.unitName)}"></label>
          <label class="field"><span>ต้นทุนต่อ<span data-uname="base">${esc(st.unitName || 'หน่วย')}</span> (บาท)</span><input data-f="cost" class="money-input" inputmode="decimal" placeholder="0" value="${esc(st.cost)}"></label>
        </div>
        <div class="grid-2">
          ${id ? '' : `<label class="field"><span>สต๊อกเริ่มต้น</span><input data-f="opening" inputmode="numeric" placeholder="0" value="${esc(st.opening)}"></label>`}
          <label class="field"><span>เตือนเมื่อเหลือไม่เกิน</span><input data-f="minStock" inputmode="numeric" placeholder="0" value="${esc(st.minStock)}"></label>
        </div>
        <details class="mini"><summary>รหัสหน่วย: <b data-basecode>${esc(st.unitCode || '-')}</b></summary>
          <label class="field"><span>รหัสหน่วย (ภาษาอังกฤษตัวใหญ่/ตัวเลข)</span><input data-f="unitCode" maxlength="20" value="${esc(st.unitCode)}"></label>
        </details>
      </section>
      <section class="card">
        <div class="card-head"><h2>ขายเป็นหน่วยใหญ่ได้ด้วย</h2></div>
        <p class="hint">เช่น แพ็ค 3 ขวด, ลัง 12 ขวด — ขายแล้วตัดสต๊อกเป็นหน่วยเล็กให้อัตโนมัติ</p>
        <div data-extras></div>
        <button type="button" class="btn btn-outline" data-add-unit>${icon('plus', 18)}<span>เพิ่มหน่วยใหญ่</span></button>
      </section>
      <section class="card">
        <div class="card-head"><h2>บาร์โค้ดและราคา</h2></div>
        <p class="hint">แต่ละหน่วยมีบาร์โค้ดและราคาขายของตัวเอง เว้นบาร์โค้ดว่างไว้ ระบบจะสร้างให้</p>
        <div data-rows></div>
      </section>
      <div class="form-actions">
        <button type="submit" class="btn btn-accent btn-lg btn-block" data-save>${icon('check')}<span>${id ? 'บันทึกการแก้ไข' : 'บันทึกสินค้า'}</span></button>
      </div>
    </form>
    ${id ? `<section class="card">
      <div class="card-head"><h2>ประวัติสต๊อก</h2></div>
      <div data-moves>${skeleton(3)}</div>
    </section>
    <div class="center pad"><button type="button" class="btn btn-danger-outline" data-deactivate>${icon('trash', 18)}<span>ปิดใช้งานสินค้านี้</span></button></div>` : ''}`;

  const form = view.querySelector('[data-form]');
  const f = (k) => form.querySelector(`[data-f="${k}"]`);
  const extrasEl = view.querySelector('[data-extras]');
  const rowsEl = view.querySelector('[data-rows]');

  function profitText(row) {
    const u = unitByKey(row.unitKey);
    const price = parseBahtInput(row.price, null);
    const cost = parseBahtInput(st.cost);
    if (!u || price === null || cost === null || !INT_RE.test(String(u.stand))) return '';
    const unitCost = big(cost) * BigInt(u.stand) / BigInt(u.divide || 1);
    const p = big(price) - unitCost;
    return `<span class="${p < 0n ? 'txt-red' : 'txt-green'}">กำไร ${fmtBaht(p)} ต่อ${esc(u.unitName || 'หน่วย')}</span>`;
  }

  function paintExtras() {
    extrasEl.innerHTML = st.extras.map((u) => `<div class="unit-row" data-key="${u.key}">
      <label class="field"><span>ชื่อหน่วย</span><input data-e="unitName" maxlength="40" placeholder="เช่น แพ็ค 3 ขวด" value="${esc(u.unitName)}"></label>
      <label class="field"><span>1 หน่วยนี้ = กี่<span data-uname="base">${esc(st.unitName || 'หน่วยเล็ก')}</span></span><input data-e="stand" inputmode="numeric" placeholder="เช่น 3" value="${esc(u.stand)}"></label>
      <label class="field field-code"><span>รหัส</span><input data-e="unitCode" maxlength="20" value="${esc(u.unitCode)}"></label>
      <button type="button" class="icon-btn" data-del-unit aria-label="ลบหน่วยนี้">${icon('trash', 18)}</button>
    </div>`).join('') || '<p class="muted tiny">ยังไม่มี (ไม่บังคับ)</p>';
  }

  function paintRows() {
    rowsEl.innerHTML = unitList().map((u) => {
      const rows = st.rows.filter((r) => r.unitKey === u.key);
      return `<div class="bc-group" data-unit="${u.key}">
        <div class="bc-head"><b data-uname="${u.key}">${esc(u.unitName || (u.key === 'base' ? 'หน่วยเล็กสุด' : 'หน่วยใหม่'))}</b>${u.key !== 'base' && INT_RE.test(String(u.stand)) ? `<span class="muted tiny">= ${esc(u.stand)} <span data-uname="base">${esc(st.unitName)}</span></span>` : ''}</div>
        ${rows.map((r) => `<div class="bc-row" data-key="${r.key}">
          <div class="grid-bc">
            <label class="field"><span>บาร์โค้ด</span><div class="input-btn"><input data-r="barcode" maxlength="32" inputmode="numeric" placeholder="เว้นว่าง = ระบบสร้างให้" value="${esc(r.barcode)}"><button type="button" class="btn btn-outline btn-sm" data-gen>สร้างให้</button></div></label>
            <label class="field"><span>ราคาขาย (บาท)</span><input data-r="price" class="money-input" inputmode="decimal" placeholder="0" value="${esc(r.price)}"></label>
          </div>
          <div class="bc-foot"><span data-profit>${profitText(r)}</span><button type="button" class="link txt-red" data-del-row>ลบบาร์โค้ดนี้</button></div>
          <details class="mini"><summary>ราคาเพิ่มเติม (สมาชิก / ขายส่ง)</summary>
            <div class="grid-2">
              <label class="field"><span>ราคาสมาชิก</span><input data-r="member" class="money-input" inputmode="decimal" placeholder="0" value="${esc(r.member)}"></label>
              <label class="field"><span>ราคาส่ง</span><input data-r="wholesale" class="money-input" inputmode="decimal" placeholder="0" value="${esc(r.wholesale)}"></label>
            </div>
          </details>
        </div>`).join('')}
        <button type="button" class="link" data-add-row>${rows.length ? '＋ เพิ่มบาร์โค้ดอีกอัน' : '＋ ตั้งราคาขายหน่วยนี้'}</button>
      </div>`;
    }).join('');
  }

  const refreshUnitNames = () => {
    view.querySelectorAll('[data-uname]').forEach((el) => {
      const u = unitByKey(el.dataset.uname);
      if (u) el.textContent = u.unitName || (u.key === 'base' ? 'หน่วย' : 'หน่วยใหม่');
    });
    view.querySelector('[data-basecode]').textContent = st.unitCode || '-';
  };
  const refreshProfits = () => {
    rowsEl.querySelectorAll('.bc-row').forEach((el) => {
      const r = st.rows.find((x) => x.key === el.dataset.key);
      if (r) el.querySelector('[data-profit]').innerHTML = profitText(r);
    });
  };

  // ข้อมูลหลัก
  form.addEventListener('input', (e) => {
    const k = e.target.dataset.f;
    if (!k) return;
    st[k] = e.target.value;
    if (k === 'unitName' && !st.unitManual) {
      st.unitCode = genUnitCode(st.unitName, 1, usedCodes('base'));
      f('unitCode').value = st.unitCode;
    }
    if (k === 'unitCode') { st.unitManual = true; st.unitCode = e.target.value.toUpperCase().trim(); }
    if (k === 'unitName' || k === 'unitCode') refreshUnitNames();
    if (k === 'cost' || k === 'unitName') refreshProfits();
  });

  // หน่วยใหญ่
  extrasEl.addEventListener('input', (e) => {
    const k = e.target.dataset.e;
    const row = e.target.closest('.unit-row');
    if (!k || !row) return;
    const u = st.extras.find((x) => x.key === row.dataset.key);
    u[k] = k === 'unitCode' ? e.target.value.toUpperCase().trim() : e.target.value;
    if (k === 'unitCode') u.manual = true;
    if ((k === 'unitName' || k === 'stand') && !u.manual) {
      u.unitCode = genUnitCode(u.unitName, parseInt(u.stand, 10) || 0, usedCodes(u.key));
      row.querySelector('[data-e="unitCode"]').value = u.unitCode;
    }
    if (k === 'stand') paintRows(); else refreshUnitNames();
    refreshProfits();
  });
  extrasEl.addEventListener('click', (e) => {
    if (!e.target.closest('[data-del-unit]')) return;
    const key = e.target.closest('.unit-row').dataset.key;
    st.extras = st.extras.filter((u) => u.key !== key);
    st.rows = st.rows.filter((r) => r.unitKey !== key);
    paintExtras(); paintRows();
  });
  view.querySelector('[data-add-unit]').addEventListener('click', () => {
    const k = uid();
    st.extras.push({ key: k, unitName: '', unitCode: '', manual: false, stand: '', divide: 1 });
    st.rows.push({ key: uid(), unitKey: k, barcode: '', price: '', member: '', wholesale: '' });
    paintExtras(); paintRows();
    extrasEl.querySelector(`[data-key="${k}"] input`).focus();
  });

  // บาร์โค้ด
  rowsEl.addEventListener('input', (e) => {
    const k = e.target.dataset.r;
    const el = e.target.closest('.bc-row');
    if (!k || !el) return;
    const r = st.rows.find((x) => x.key === el.dataset.key);
    r[k] = e.target.value.trim();
    if (k === 'price') el.querySelector('[data-profit]').innerHTML = profitText(r);
  });
  rowsEl.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-add-row]')) {
      st.rows.push({ key: uid(), unitKey: t.closest('.bc-group').dataset.unit, barcode: '', price: '', member: '', wholesale: '' });
      paintRows();
      return;
    }
    const el = t.closest('.bc-row');
    if (!el) return;
    const r = st.rows.find((x) => x.key === el.dataset.key);
    if (t.closest('[data-del-row]')) { st.rows = st.rows.filter((x) => x !== r); paintRows(); return; }
    const gen = t.closest('[data-gen]');
    if (gen) {
      await busy(gen, async () => {
        let code = (await api('/api/products/next-barcode' + qs({ prefix: '200' }))).barcode;
        const inForm = new Set(st.rows.filter((x) => x !== r).map((x) => x.barcode));
        let guard = 0;
        while (inForm.has(code) && guard++ < 100) code = nextEan13(code);
        r.barcode = code;
        el.querySelector('[data-r="barcode"]').value = code;
      });
    }
  });

  paintExtras();
  paintRows();

  // บันทึก
  function validate() {
    const errs = [];
    if (!st.name.trim()) errs.push('กรอกชื่อสินค้า');
    if (!st.unitName.trim()) errs.push('กรอกชื่อหน่วยเล็กสุด');
    if (!st.unitCode) st.unitCode = genUnitCode(st.unitName, 1, usedCodes('base'));
    if (!UNIT_CODE_RE.test(st.unitCode)) errs.push('รหัสหน่วยต้องเป็น A-Z หรือตัวเลข');
    const cost = parseBahtInput(st.cost);
    if (cost === null) errs.push('ต้นทุนต้องเป็นตัวเลข เช่น 120 หรือ 120.50');
    if (!id && st.opening && !INT_RE.test(st.opening.trim())) errs.push('สต๊อกเริ่มต้นต้องเป็นจำนวนเต็ม');
    if (st.minStock && !INT_RE.test(String(st.minStock).trim())) errs.push('จุดเตือนต้องเป็นจำนวนเต็ม');
    const codes = new Set([st.unitCode]);
    for (const u of st.extras) {
      if (!u.unitName.trim()) errs.push('กรอกชื่อหน่วยใหญ่ให้ครบ');
      const n = parseInt(u.stand, 10);
      if (!INT_RE.test(String(u.stand).trim()) || n < 1 || n > 100000) errs.push(`"${u.unitName || 'หน่วยใหญ่'}" ต้องบอกว่าเท่ากับกี่${st.unitName || 'หน่วยเล็ก'} (จำนวนเต็ม)`);
      if (!u.unitCode) u.unitCode = genUnitCode(u.unitName, n, codes);
      if (!UNIT_CODE_RE.test(u.unitCode)) errs.push(`รหัสหน่วย "${u.unitCode}" ใช้ได้เฉพาะ A-Z ตัวเลข - _`);
      if (codes.has(u.unitCode)) errs.push(`รหัสหน่วย "${u.unitCode}" ซ้ำกัน`);
      codes.add(u.unitCode);
    }
    const rows = st.rows.filter((r) => r.price !== '' || r.barcode !== '');
    if (!rows.length) errs.push('ตั้งราคาขายอย่างน้อย 1 หน่วย');
    const seen = new Set();
    for (const r of rows) {
      const u = unitByKey(r.unitKey);
      if (parseBahtInput(r.price, null) === null) errs.push(`ราคาขาย${u ? u.unitName : ''} ต้องเป็นตัวเลข`);
      if (parseBahtInput(r.member) === null || parseBahtInput(r.wholesale) === null) errs.push('ราคาสมาชิก/ราคาส่ง ต้องเป็นตัวเลข');
      if (r.barcode && !BARCODE_RE.test(r.barcode)) errs.push(`บาร์โค้ด "${r.barcode}" ใช้ได้เฉพาะตัวเลข/ตัวอักษร 4-32 ตัว`);
      if (r.barcode && seen.has(r.barcode)) errs.push(`บาร์โค้ด "${r.barcode}" ซ้ำกัน`);
      if (r.barcode) seen.add(r.barcode);
    }
    return { errs: [...new Set(errs)], rows, cost };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { errs, rows, cost } = validate();
    if (errs.length) { toast(errs[0], 'error'); return; }
    const body = {
      code: st.code.trim(), name: st.name.trim(),
      baseUnitCode: st.unitCode, baseUnitName: st.unitName.trim(),
      costBaseSatang: cost, minStockBase: parseInt(st.minStock, 10) || 0,
      imageUrl: product ? product.imageUrl || '' : '',
      units: st.extras.map((u) => ({ unitCode: u.unitCode, unitName: u.unitName.trim(), standValue: parseInt(u.stand, 10), divideValue: u.divide || 1 })),
      barcodes: rows.map((r) => ({
        barcode: r.barcode, unitCode: unitByKey(r.unitKey).unitCode,
        priceSatang: parseBahtInput(r.price), priceMemberSatang: parseBahtInput(r.member), priceWholesaleSatang: parseBahtInput(r.wholesale),
      })),
    };
    if (!id) body.openingStock = parseInt(st.opening, 10) || 0;
    await busy(view.querySelector('[data-save]'), async () => {
      const r = id
        ? await api(`/api/products/${encodeURIComponent(id)}`, { method: 'PUT', body })
        : await api('/api/products', { body });
      toast(id ? 'บันทึกการแก้ไขแล้ว' : `เพิ่มสินค้า ${r.product.name} แล้ว`);
      if (id) render(view, ctx); else location.hash = `#/products/${encodeURIComponent(r.product.id)}`;
    });
  });

  if (!id) { f('name').focus(); return; }

  // ---------- สต๊อก ----------
  const REASON = { OPENING: 'ยอดเริ่มต้น', RECEIVE: 'รับของเข้า', ADJUST: 'ปรับยอด', SALE: 'ขาย', CANCEL: 'ยกเลิกบิล' };
  async function loadMoves() {
    const box = view.querySelector('[data-moves]');
    try {
      const r = await api(`/api/products/${encodeURIComponent(id)}/movements`);
      if (!ctx.isActive()) return;
      box.innerHTML = r.movements.length ? `<div class="moves">${r.movements.map((m) => `<div class="move">
          <div><b>${esc(REASON[m.reason] || m.reason)}</b>${m.refBillNo ? ` <span class="muted">${esc(m.refBillNo)}</span>` : ''}<span class="muted tiny">${esc(fmtDateTime(m.createdAt))}${m.note ? ' · ' + esc(m.note) : ''}</span></div>
          <span class="mv-delta ${m.qtyBaseDelta < 0 ? 'txt-red' : 'txt-green'}">${m.qtyBaseDelta > 0 ? '+' : ''}${esc(m.qtyBaseDelta)}</span>
          <span class="mv-bal">เหลือ ${esc(m.balanceAfter)}</span>
        </div>`).join('')}</div>` : '<p class="muted pad">ยังไม่มีความเคลื่อนไหว</p>';
    } catch (e2) { renderError(box, e2, loadMoves); }
  }
  loadMoves();

  view.querySelector('[data-receive]').addEventListener('click', () => {
    const units = product.units || [];
    modal({
      title: 'รับของเข้า',
      body: `<div class="grid-2"><label class="field"><span>จำนวน</span><input data-q inputmode="numeric" placeholder="เช่น 2"></label>
        <label class="field"><span>หน่วย</span><select data-u>${units.map((u) => `<option value="${esc(u.unitCode)}">${esc(u.unitName)}</option>`).join('')}</select></label></div>
        <p class="hint" data-calc></p>
        <label class="field"><span>หมายเหตุ</span><input data-n maxlength="200" placeholder="เช่น รับจากโรงงาน"></label>`,
      actions: [{ text: 'ยกเลิก' }, {
        text: 'รับเข้าสต๊อก', cls: 'btn-primary',
        onClick: async ({ close, button, body }) => {
          const qty = body.querySelector('[data-q]').value.trim();
          const u = units.find((x) => x.unitCode === body.querySelector('[data-u]').value) || { standValue: 1, divideValue: 1 };
          if (!INT_RE.test(qty) || qty === '0') { toast('กรอกจำนวนเป็นจำนวนเต็มมากกว่า 0', 'error'); return; }
          const num = BigInt(qty) * BigInt(u.standValue);
          if (num % BigInt(u.divideValue || 1) !== 0n) { toast('จำนวนนี้แปลงเป็นหน่วยเล็กไม่ลงตัว', 'error'); return; }
          const qtyBase = Number(num / BigInt(u.divideValue || 1));
          await busy(button, async () => {
            await api(`/api/products/${encodeURIComponent(id)}/stock`, { body: { type: 'RECEIVE', qtyBase, note: body.querySelector('[data-n]').value.trim() } });
            close(); toast(`รับเข้า ${qtyBase} ${product.baseUnitName} แล้ว`); render(view, ctx);
          });
        },
      }],
    });
  });

  view.querySelector('[data-adjust]').addEventListener('click', () => {
    const m = modal({
      title: 'ปรับยอดสต๊อก',
      body: `<p class="hint">ในระบบมี ${esc(product.stockBase)} ${esc(product.baseUnitName)} — นับของจริงได้เท่าไร?</p>
        <label class="field"><span>นับได้จริง (${esc(product.baseUnitName)})</span><input data-q inputmode="numeric" placeholder="เช่น ${esc(product.stockBase)}"></label>
        <p class="hint" data-diff></p>
        <label class="field"><span>เหตุผล</span><input data-n maxlength="200" placeholder="เช่น ของเสีย / นับสต๊อกประจำเดือน"></label>`,
      actions: [{ text: 'ยกเลิก' }, {
        text: 'ปรับยอด', cls: 'btn-primary',
        onClick: async ({ close, button, body }) => {
          const v = body.querySelector('[data-q]').value.trim();
          if (!INT_RE.test(v)) { toast('กรอกจำนวนเป็นจำนวนเต็ม', 'error'); return; }
          const delta = parseInt(v, 10) - product.stockBase;
          if (delta === 0) { toast('ยอดเท่าเดิม ไม่ต้องปรับ', 'error'); return; }
          await busy(button, async () => {
            await api(`/api/products/${encodeURIComponent(id)}/stock`, { body: { type: 'ADJUST', qtyBase: delta, note: body.querySelector('[data-n]').value.trim() } });
            close(); toast('ปรับยอดแล้ว'); render(view, ctx);
          });
        },
      }],
    });
    m.body.querySelector('[data-q]').addEventListener('input', (e) => {
      const v = e.target.value.trim();
      const d = INT_RE.test(v) ? parseInt(v, 10) - product.stockBase : null;
      m.body.querySelector('[data-diff]').textContent = d === null ? '' : d === 0 ? 'ยอดเท่าเดิม' : `จะปรับ ${d > 0 ? '+' : ''}${d} ${product.baseUnitName}`;
    });
  });

  view.querySelector('[data-deactivate]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmDialog({ title: 'ปิดใช้งานสินค้า', message: `ปิดใช้งาน "${product.name}"? สินค้าจะไม่แสดงในรายการและเปิดออเดอร์ (บิลเก่ายังอยู่ครบ)`, okText: 'ปิดใช้งาน', danger: true }))) return;
    await busy(btn, async () => {
      await api(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('ปิดใช้งานสินค้าแล้ว');
      location.hash = '#/products';
    });
  });
}
