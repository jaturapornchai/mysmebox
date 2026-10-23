// ใบปะหน้าพัสดุ 100×150 มม.
import { api } from './api.js';
import { esc, COURIER_LABEL } from './ui.js';
import { fmtBaht } from './money.js';
import { addressText } from './address-picker.js';

const out = document.getElementById('out');
document.getElementById('print').addEventListener('click', () => window.print());

async function main() {
  const id = new URLSearchParams(location.search).get('id') || '';
  if (!/^\d+$/.test(id)) { out.innerHTML = '<p class="msg">ไม่พบเลขออเดอร์</p>'; return; }
  try {
    const [{ order: o }, { shop }] = await Promise.all([api(`/api/orders/${id}`, { quiet401: true }), api('/api/shop', { quiet401: true })]);
    const s = o.ship || {};
    const isCod = o.payMethod === 'COD' && o.payStatus !== 'PAID';
    const items = o.items || [];
    const shown = items.slice(0, 8);
    document.title = `ใบปะหน้า ${o.billNo}`;
    out.innerHTML = `<div class="sheet">
      <div class="row"><span class="bill">${esc(o.billNo)}</span><span class="meta">${esc(COURIER_LABEL[o.courier] || '')}${o.trackingNo ? ' · ' + esc(o.trackingNo) : ''}</span></div>
      <div class="box from"><div class="lbl">ผู้ส่ง</div><b>${esc(shop.name)}</b>${shop.phone ? ' โทร ' + esc(shop.phone) : ''}<br>${esc(addressText(shop))}</div>
      <div class="box">
        <div class="lbl">ผู้รับ</div>
        <div class="to-name">${esc(o.customerName || '-')}</div>
        ${o.customerPhone ? `<div class="to-phone">โทร ${esc(o.customerPhone)}</div>` : ''}
        <div class="to-addr">${esc(addressText({ ...s, zip: '' }))}</div>
        <div class="zip">${esc(s.zip || '')}</div>
      </div>
      ${isCod ? `<div class="cod"><span>เก็บเงินปลายทาง (COD)</span><b>${esc(fmtBaht(o.totalSatang))}</b></div>` : '<div class="paid">ชำระแล้ว / ไม่ต้องเก็บเงิน</div>'}
      <ol class="items">${shown.map((it) => `<li>${esc(it.productName)} — ${esc(it.unitName)} × ${esc(it.qty)}</li>`).join('')}${items.length > shown.length ? `<li>และอีก ${items.length - shown.length} รายการ</li>` : ''}</ol>
    </div>`;
  } catch (e) {
    out.innerHTML = `<p class="msg">${esc(e.status === 401 ? 'กรุณาเข้าสู่ระบบก่อน' : e.message)}</p>`;
  }
}
main();
