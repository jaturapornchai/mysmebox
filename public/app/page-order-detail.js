// รายละเอียดออเดอร์ + ปุ่มทำงานตามสถานะ (รับเงิน/แพ็ค/ส่ง/ได้รับ/ตีกลับ/ยกเลิก/QR/ใบปะหน้า)
import { api } from './api.js';
import { esc, icon, toast, modal, confirmDialog, busy, skeleton, renderError, orderBadges, fmtDateTime, options, copyText, CHANNEL_LABEL, COURIER_LABEL, PAY_LABEL, COURIERS } from './ui.js';
import { fmtBaht } from './money.js';
import { addressText } from './address-picker.js';

export async function render(view, ctx) {
  const id = ctx.params[0];
  ctx.setTitle('รายละเอียดออเดอร์', '#/orders');
  let order = null;

  async function load() {
    view.innerHTML = skeleton(6);
    try {
      order = (await api(`/api/orders/${encodeURIComponent(id)}`)).order;
    } catch (e) { if (ctx.isActive()) renderError(view, e, load); return; }
    if (ctx.isActive()) paint();
  }

  async function act(btn, path, body, msg) {
    await busy(btn, async () => {
      order = (await api(`/api/orders/${encodeURIComponent(id)}/${path}`, { body })).order;
      toast(msg);
      paint();
    });
  }

  function actionsHtml(o) {
    const b = (key, text, cls = 'btn-outline', ic = '') => `<button type="button" class="btn ${cls}" data-act="${key}">${ic ? icon(ic, 18) : ''}<span>${text}</span></button>`;
    const out = [];
    if (o.status !== 'CANCELLED') {
      if (o.payStatus === 'UNPAID') out.push(b('pay', 'รับเงินแล้ว', 'btn-primary', 'check'));
      if (o.shipStatus === 'PENDING') out.push(b('packed', 'แพ็คแล้ว', 'btn-primary', 'box'));
      if (o.shipStatus === 'PENDING' || o.shipStatus === 'PACKED') out.push(b('shipped', 'ส่งแล้ว', 'btn-primary', 'truck'));
      if (o.shipStatus === 'SHIPPED') {
        out.push(b('delivered', 'ลูกค้าได้รับแล้ว', 'btn-primary', 'check'));
        out.push(b('returned', 'ตีกลับ', 'btn-outline'));
      }
      if (o.payStatus === 'UNPAID') out.push(b('qr', 'QR พร้อมเพย์', 'btn-outline', 'qr'));
    }
    out.push(b('label', 'พิมพ์ใบปะหน้า', 'btn-outline', 'print'));
    if (o.status !== 'CANCELLED') out.push(b('cancel', 'ยกเลิกออเดอร์', 'btn-danger-outline'));
    return out.join('');
  }

  function paint() {
    const o = order;
    ctx.setTitle(o.billNo, '#/orders');
    const s = o.ship || {};
    const row = (t, v, cls = '') => `<div class="sum-row ${cls}"><span>${t}</span><span class="money">${v}</span></div>`;
    view.innerHTML = `
      <section class="card">
        <div class="detail-head"><div><h2 class="bill-no">${esc(o.billNo)}</h2><p class="muted">${esc(fmtDateTime(o.createdAt))} · ${esc(CHANNEL_LABEL[o.channel] || o.channel)}</p></div><div class="badges">${orderBadges(o)}</div></div>
        ${o.status === 'CANCELLED' ? `<p class="alert alert-red">ยกเลิกแล้ว${o.cancelReason ? ' — ' + esc(o.cancelReason) : ''} (คืนสต๊อกแล้ว)</p>` : ''}
        <div class="actions">${actionsHtml(o)}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>ลูกค้า</h2></div>
        <p class="big-name">${esc(o.customerName || 'ไม่ระบุชื่อ')}</p>
        ${o.customerPhone ? `<p><a class="link-inline" href="tel:${esc(o.customerPhone)}">${icon('phone', 16)} ${esc(o.customerPhone)}</a></p>` : ''}
        <p class="addr">${esc(addressText(s)) || '<span class="muted">ไม่มีที่อยู่จัดส่ง</span>'}</p>
        <div class="kv"><span>ขนส่ง</span><b>${esc(COURIER_LABEL[o.courier] || o.courier)}</b></div>
        <div class="kv"><span>เลขพัสดุ</span><b>${esc(o.trackingNo || '-')}</b></div>
        ${o.note ? `<div class="kv"><span>หมายเหตุ</span><b>${esc(o.note)}</b></div>` : ''}
      </section>
      <section class="card">
        <div class="card-head"><h2>สินค้า</h2></div>
        <div class="items">${(o.items || []).map((it) => `<div class="item-row"><div><b>${esc(it.productName)}</b><span class="muted">${esc(it.unitName)} × ${esc(it.qty)} · ${fmtBaht(it.priceSatang)}</span></div><span class="money">${fmtBaht(it.lineTotalSatang)}</span></div>`).join('')}</div>
        ${row('ค่าสินค้า', fmtBaht(o.itemsTotalSatang))}
        ${o.discountSatang !== '0' ? row('ส่วนลด', '-' + fmtBaht(o.discountSatang)) : ''}
        ${row('ค่าส่ง', fmtBaht(o.shippingSatang))}
        ${o.vatRateBp ? row('VAT', fmtBaht(o.vatSatang)) : ''}
        ${row('ยอดรวม', fmtBaht(o.totalSatang), 'sum-total')}
        ${row('ต้นทุนสินค้า', fmtBaht(o.costSatang), 'muted')}
        ${row('กำไร', fmtBaht(o.profitSatang), 'sum-profit')}
      </section>
      <section class="card">
        <div class="card-head"><h2>การชำระเงิน</h2></div>
        <div class="kv"><span>วิธีรับเงิน</span><b>${esc(PAY_LABEL[o.payMethod] || o.payMethod)}</b></div>
        <div class="kv"><span>สถานะ</span><b>${o.payStatus === 'PAID' ? 'รับเงินแล้ว ' + esc(fmtDateTime(o.paidAt)) : 'ยังไม่ได้รับเงิน'}</b></div>
      </section>`;
    view.querySelector('.actions').addEventListener('click', onAction);
  }

  async function onAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const o = order;
    switch (btn.dataset.act) {
      case 'pay':
        if (await confirmDialog({ title: 'ยืนยันรับเงิน', message: `รับเงิน ${fmtBaht(o.totalSatang)} จาก ${o.customerName || 'ลูกค้า'} แล้วใช่ไหม`, okText: 'รับเงินแล้ว' })) await act(btn, 'pay', {}, 'บันทึกรับเงินแล้ว');
        break;
      case 'packed': await act(btn, 'ship', { shipStatus: 'PACKED' }, 'บันทึกแพ็คแล้ว'); break;
      case 'shipped': openShipModal(); break;
      case 'delivered': await act(btn, 'ship', { shipStatus: 'DELIVERED' }, 'ลูกค้าได้รับของแล้ว'); break;
      case 'returned':
        if (await confirmDialog({ title: 'พัสดุตีกลับ', message: 'บันทึกว่าพัสดุนี้ถูกตีกลับใช่ไหม', okText: 'ตีกลับ', danger: true })) await act(btn, 'ship', { shipStatus: 'RETURNED' }, 'บันทึกตีกลับแล้ว');
        break;
      case 'qr': await openQr(btn); break;
      case 'label': window.open(`/app/label.html?id=${encodeURIComponent(o.id)}`, '_blank', 'noopener'); break;
      case 'cancel': {
        const reason = await confirmDialog({ title: 'ยกเลิกออเดอร์', message: `ยกเลิก ${o.billNo} และคืนสินค้าเข้าสต๊อก`, okText: 'ยกเลิกออเดอร์', danger: true, input: { label: 'เหตุผล', required: true, placeholder: 'เช่น ลูกค้าเปลี่ยนใจ' } });
        if (reason) await act(btn, 'cancel', { reason }, 'ยกเลิกออเดอร์แล้ว คืนสต๊อกเรียบร้อย');
        break;
      }
      default:
    }
  }

  function openShipModal() {
    const o = order;
    const m = modal({
      title: 'บันทึกส่งของ',
      body: `<label class="field"><span>ขนส่ง</span><select data-c>${options(COURIERS, o.courier)}</select></label>
             <label class="field"><span>เลขพัสดุ</span><input data-t maxlength="50" placeholder="เช่น TH0123456789" value="${esc(o.trackingNo || '')}"></label>`,
      actions: [
        { text: 'ยกเลิก' },
        {
          text: 'ส่งแล้ว', cls: 'btn-primary',
          onClick: async ({ close, button, body }) => {
            const courier = body.querySelector('[data-c]').value;
            const trackingNo = body.querySelector('[data-t]').value.trim();
            await busy(button, async () => {
              order = (await api(`/api/orders/${encodeURIComponent(o.id)}/ship`, { body: { shipStatus: 'SHIPPED', courier, trackingNo } })).order;
              close();
              toast('บันทึกส่งของแล้ว');
              paint();
            });
          },
        },
      ],
    });
    return m;
  }

  async function openQr(btn) {
    const o = order;
    const r = await busy(btn, () => api(`/api/orders/${encodeURIComponent(o.id)}/promptpay`));
    if (!r) return;
    const shop = ctx.state.shop || {};
    const lines = [
      `ยอดชำระ ${fmtBaht(r.amountSatang)}`,
      `เลขที่บิล ${o.billNo}`,
      `พร้อมเพย์ ${r.promptpayId}`,
      shop.bankAccountNo ? `หรือโอนบัญชี ${shop.bankAccountNo}${shop.bankAccountName ? ' (' + shop.bankAccountName + ')' : ''}` : '',
      `ร้าน ${shop.name || ''}`,
      'โอนแล้วส่งสลิปในแชทได้เลยค่ะ ขอบคุณค่ะ 🙏',
    ].filter(Boolean);
    const body = document.createElement('div');
    body.className = 'qr-box';
    body.innerHTML = `<img class="qr-img" alt="QR พร้อมเพย์ยอด ${esc(fmtBaht(r.amountSatang))}" width="240" height="240">
      <p class="qr-amount money">${esc(fmtBaht(r.amountSatang))}</p>
      <p class="muted">พร้อมเพย์ ${esc(r.promptpayId)} · ${esc(o.billNo)}</p>
      <pre class="qr-text"></pre>`;
    // แสดง SVG ผ่าน <img> เพื่อไม่ให้สคริปต์ใดๆ ใน SVG ทำงาน
    body.querySelector('.qr-img').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.qrSvg || '');
    body.querySelector('.qr-text').textContent = lines.join('\n');
    modal({
      title: 'QR พร้อมเพย์',
      body,
      actions: [{ text: 'คัดลอกข้อความแจ้งยอด', cls: 'btn-primary', onClick: () => copyText(lines.join('\n')) }],
    });
  }

  await load();
}
