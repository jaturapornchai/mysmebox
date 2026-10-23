// รายการสินค้า
import { api, qs } from './api.js';
import { esc, icon, skeleton, emptyState, renderError, debounce } from './ui.js';
import { fmtBaht } from './money.js';

/** ราคาของหน่วยฐาน (ถ้าไม่มีใช้บาร์โค้ดแรก) */
export function mainPrice(p) {
  const bs = p.barcodes || [];
  const b = bs.find((x) => x.unitCode === p.baseUnitCode) || bs[0];
  if (!b) return '';
  const u = (p.units || []).find((x) => x.unitCode === b.unitCode);
  return `${fmtBaht(b.priceSatang)} / ${u ? u.unitName : b.unitCode}`;
}

export async function render(view, ctx) {
  ctx.setTitle('สินค้า');
  let q = '';
  let lowOnly = ctx.query.lowStock === '1';
  let seq = 0;
  view.innerHTML = `
    <div class="toolbar">
      <div class="input-icon grow">${icon('search', 18)}<input type="search" data-q placeholder="ค้นหาชื่อ รหัส หรือบาร์โค้ด"></div>
      <a class="btn btn-primary" href="#/products/new">${icon('plus', 18)}<span>เพิ่มสินค้า</span></a>
    </div>
    <label class="check"><input type="checkbox" data-low ${lowOnly ? 'checked' : ''}><span>แสดงเฉพาะของใกล้หมด</span></label>
    <div data-list></div>`;
  const list = view.querySelector('[data-list]');

  async function load() {
    const my = ++seq;
    list.innerHTML = skeleton(5);
    try {
      const r = await api('/api/products' + qs({ q, lowStock: lowOnly ? 1 : '' }));
      if (my !== seq || !ctx.isActive()) return;
      list.innerHTML = r.products.length
        ? `<div class="product-list">${r.products.map((p) => `<a class="product-card" href="#/products/${encodeURIComponent(p.id)}">
            <div class="pc-main"><b>${esc(p.name)}</b><span class="muted">${esc(p.code)} · ${esc(mainPrice(p))}</span></div>
            <div class="pc-stock"><span class="pc-qty">${esc(p.stockBase)}</span><span class="muted">${esc(p.baseUnitName)}</span></div>
            ${p.isLowStock ? '<span class="badge badge-red">ใกล้หมด</span>' : ''}
            ${icon('chevron', 18)}
          </a>`).join('')}</div>`
        : emptyState(q || lowOnly ? 'ไม่พบสินค้า' : 'ยังไม่มีสินค้า เพิ่มสินค้าแรกได้เลย', q || lowOnly ? '' : '<a class="btn btn-primary" href="#/products/new">เพิ่มสินค้า</a>');
    } catch (e) { if (my === seq) renderError(list, e, load); }
  }
  view.querySelector('[data-q]').addEventListener('input', debounce((e) => { q = e.target.value.trim(); load(); }, 300));
  view.querySelector('[data-low]').addEventListener('change', (e) => { lowOnly = e.target.checked; load(); });
  await load();
}
