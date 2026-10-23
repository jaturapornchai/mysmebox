// หน้าหลัก: ตัวเลขวันนี้ + งานค้าง + ของใกล้หมด + ออเดอร์ล่าสุด
import { api } from './api.js';
import { esc, icon, skeleton, emptyState, renderError, orderCard } from './ui.js';
import { fmtBaht } from './money.js';

export async function render(view, ctx) {
  ctx.setTitle('หน้าหลัก');
  view.innerHTML = skeleton(5);
  const load = async () => {
    view.innerHTML = skeleton(5);
    let d;
    try { d = await api('/api/dashboard'); } catch (e) { if (ctx.isActive()) renderError(view, e, load); return; }
    if (!ctx.isActive()) return;
    const card = (href, label, value, sub, tone) => `<a class="stat stat-${tone}" href="${href}"><span class="stat-label">${esc(label)}</span><span class="stat-value money">${value}</span><span class="stat-sub">${esc(sub)}</span></a>`;
    view.innerHTML = `
      <section class="stats" aria-label="สรุปวันนี้">
        ${card('#/orders', 'ยอดขายวันนี้', fmtBaht(d.today.salesSatang), `${d.today.orderCount} ออเดอร์`, 'navy')}
        ${card('#/orders', 'กำไรวันนี้', fmtBaht(d.today.profitSatang), 'หลังหักต้นทุนสินค้า', 'green')}
        ${card('#/orders?status=AWAIT_PAY', 'รอโอน', fmtBaht(d.awaitingTransfer.amountSatang), `${d.awaitingTransfer.count} ออเดอร์`, 'red')}
        ${card('#/orders?status=AWAIT_PAY', 'รอเก็บเงินปลายทาง', fmtBaht(d.awaitingCod.amountSatang), `${d.awaitingCod.count} ออเดอร์`, 'purple')}
        ${card('#/orders?status=TO_SHIP', 'รอแพ็ค / รอส่ง', `${d.toShip.count}`, 'ออเดอร์', 'amber')}
      </section>
      <section class="card">
        <div class="card-head"><h2>ของใกล้หมด</h2><a class="link" href="#/products">ดูสินค้าทั้งหมด</a></div>
        ${d.lowStock.length ? `<ul class="list">${d.lowStock.map((p) => `<li><a class="list-row" href="#/products/${encodeURIComponent(p.id)}"><span class="lr-main">${esc(p.name)}</span><span class="badge badge-red">เหลือ ${esc(p.stockBase)} ${esc(p.baseUnitName)}</span>${icon('chevron', 18)}</a></li>`).join('')}</ul>` : '<p class="muted pad">สต๊อกยังพอทุกตัว 👍</p>'}
      </section>
      <section class="card">
        <div class="card-head"><h2>ออเดอร์ล่าสุด</h2><a class="link" href="#/orders">ดูทั้งหมด</a></div>
        ${d.recentOrders.length ? `<div class="order-list">${d.recentOrders.map(orderCard).join('')}</div>` : emptyState('ยังไม่มีออเดอร์ เริ่มเปิดออเดอร์แรกได้เลย', '<a class="btn btn-primary" href="#/orders/new">เปิดออเดอร์</a>')}
      </section>`;
  };
  await load();
}
