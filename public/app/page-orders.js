// รายการออเดอร์: แท็บกรองสถานะ + ค้นหา + โหลดเพิ่ม
import { api, qs } from './api.js';
import { esc, icon, skeleton, emptyState, renderError, orderCard, debounce } from './ui.js';

const TABS = [
  ['ALL', 'ทั้งหมด'], ['AWAIT_PAY', 'รอชำระ'], ['TO_SHIP', 'รอส่ง'],
  ['SHIPPED', 'ส่งแล้ว'], ['DONE', 'สำเร็จ'], ['CANCELLED', 'ยกเลิก'],
];

export async function render(view, ctx) {
  ctx.setTitle('ออเดอร์');
  let status = TABS.some((t) => t[0] === ctx.query.status) ? ctx.query.status : 'ALL';
  let q = ctx.query.q || '';
  let nextBefore = null;
  let reqSeq = 0;

  view.innerHTML = `
    <div class="tabs" role="tablist">${TABS.map(([k, t]) => `<button role="tab" class="tab${k === status ? ' is-on' : ''}" data-tab="${k}" aria-selected="${k === status}">${t}</button>`).join('')}</div>
    <div class="toolbar"><div class="input-icon grow">${icon('search', 18)}<input type="search" data-q placeholder="ค้นหาเลขบิล ชื่อ เบอร์ หรือเลขพัสดุ" value="${esc(q)}"></div></div>
    <div data-list></div>
    <div class="center pad"><button class="btn btn-outline" data-more hidden>โหลดเพิ่ม</button></div>`;
  const list = view.querySelector('[data-list]');
  const more = view.querySelector('[data-more]');

  async function load(append) {
    const my = ++reqSeq;
    if (!append) { list.innerHTML = skeleton(5); more.hidden = true; }
    more.disabled = true;
    try {
      const r = await api('/api/orders' + qs({ status, q, limit: 30, before: append ? nextBefore : '' }));
      if (my !== reqSeq || !ctx.isActive()) return;
      nextBefore = r.nextBefore;
      const htmlRows = r.orders.map(orderCard).join('');
      if (append) list.querySelector('.order-list').insertAdjacentHTML('beforeend', htmlRows);
      else list.innerHTML = r.orders.length ? `<div class="order-list">${htmlRows}</div>` : emptyState(q ? 'ไม่พบออเดอร์ที่ค้นหา' : 'ยังไม่มีออเดอร์ในหมวดนี้', status === 'ALL' && !q ? '<a class="btn btn-primary" href="#/orders/new">เปิดออเดอร์</a>' : '');
      more.hidden = !nextBefore;
    } catch (e) {
      if (my !== reqSeq) return;
      if (append) more.hidden = false; else renderError(list, e, () => load(false));
    } finally { more.disabled = false; }
  }

  view.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    status = b.dataset.tab;
    view.querySelectorAll('[data-tab]').forEach((x) => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', on); });
    history.replaceState(null, '', '#/orders' + qs({ status: status === 'ALL' ? '' : status }));
    load(false);
  });
  view.querySelector('[data-q]').addEventListener('input', debounce((e) => { q = e.target.value.trim(); load(false); }, 300));
  more.addEventListener('click', () => load(true));
  await load(false);
}
