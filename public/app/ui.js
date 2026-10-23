// คอมโพเนนต์ใช้ซ้ำทั้งแอป: escape, ไอคอน, toast, modal, confirm, ป้ายสถานะ, empty/loading/error state, การ์ดออเดอร์
import { fmtBaht } from './money.js';

/** escape ค่าที่มาจากผู้ใช้/เซิร์ฟเวอร์ก่อนใส่ใน HTML ทุกครั้ง */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** สร้าง element จาก HTML ที่ escape แล้ว */
export function html(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- ไอคอน (SVG เส้น, ไม่ใช้ CDN) ----------
const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  orders: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  back: '<path d="M15 18 9 12l6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  print: '<path d="M6 9V3h12v6"/><path d="M6 18H4v-7h16v7h-2"/><path d="M6 14h12v7H6z"/>',
  qr: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  truck: '<path d="M1 4h14v12H1zM15 9h4l3 3v4h-7"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/>',
  pin: '<path d="M12 22s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  barcode: '<path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  gps: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
};

export function icon(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

// ---------- ข้อความแสดงผล ----------
export const CHANNELS = [
  ['FACEBOOK', 'Facebook'], ['LINE', 'LINE'], ['TIKTOK', 'TikTok'], ['SHOPEE', 'Shopee'],
  ['LAZADA', 'Lazada'], ['STORE', 'หน้าร้าน'], ['OTHER', 'อื่นๆ'],
];
export const COURIERS = [
  ['FLASH', 'Flash Express'], ['KERRY', 'Kerry Express'], ['JT', 'J&T Express'], ['THAIPOST', 'ไปรษณีย์ไทย'],
  ['SPX', 'Shopee Express'], ['LALAMOVE', 'Lalamove'], ['PICKUP', 'ลูกค้ามารับเอง'], ['NONE', 'ยังไม่เลือก'],
];
export const PAY_METHODS = [['TRANSFER', 'โอนเงิน'], ['COD', 'เก็บเงินปลายทาง'], ['CASH', 'เงินสด']];
const toMap = (arr) => Object.fromEntries(arr);
export const CHANNEL_LABEL = toMap(CHANNELS);
export const COURIER_LABEL = toMap(COURIERS);
export const PAY_LABEL = toMap(PAY_METHODS);

export function options(list, selected) {
  return list.map(([v, t]) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(t)}</option>`).join('');
}

/** วันเวลาไทย */
export function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function badge(text, tone = 'gray') {
  return `<span class="badge badge-${tone}">${esc(text)}</span>`;
}

/** ป้ายสถานะออเดอร์ (ส่ง + เงิน) */
export function orderBadges(o) {
  if (o.status === 'CANCELLED') return badge('ยกเลิก', 'red');
  if (o.payStatus === 'PAID' && o.shipStatus === 'DELIVERED') return badge('สำเร็จ', 'green');
  const ship = {
    PENDING: ['รอแพ็ค', 'amber'], PACKED: ['แพ็คแล้ว รอส่ง', 'amber'], SHIPPED: ['ส่งแล้ว', 'blue'],
    DELIVERED: ['ลูกค้าได้รับแล้ว', 'green'], RETURNED: ['ตีกลับ', 'red'],
  }[o.shipStatus] || [o.shipStatus, 'gray'];
  let pay;
  if (o.payStatus === 'PAID') pay = badge('รับเงินแล้ว', 'green');
  else if (o.payMethod === 'COD') pay = badge('รอเก็บปลายทาง', 'purple');
  else if (o.payMethod === 'TRANSFER') pay = badge('รอโอน', 'red');
  else pay = badge('รอรับเงิน', 'red');
  return pay + badge(ship[0], ship[1]);
}

export function orderCard(o) {
  const count = o.itemCount != null ? `${o.itemCount} รายการ` : '';
  return `<a class="order-card" href="#/orders/${encodeURIComponent(o.id)}">
    <div class="oc-top"><span class="oc-bill">${esc(o.billNo)}</span><span class="money oc-total">${fmtBaht(o.totalSatang)}</span></div>
    <div class="oc-mid"><span class="oc-name">${esc(o.customerName || 'ไม่ระบุชื่อ')}</span><span class="oc-meta">${esc(CHANNEL_LABEL[o.channel] || '')}${count ? ' · ' + esc(count) : ''}</span></div>
    <div class="oc-bot"><span class="badges">${orderBadges(o)}</span><span class="oc-date">${esc(fmtDateTime(o.createdAt))}</span></div>
  </a>`;
}

// ---------- state ----------
export function skeleton(rows = 4) {
  return `<div class="skeleton-wrap" aria-busy="true" aria-label="กำลังโหลด">${'<div class="skeleton"></div>'.repeat(rows)}</div>`;
}

export function emptyState(text, actionHtml = '') {
  return `<div class="empty"><div class="empty-ic">${icon('box', 36)}</div><p>${esc(text)}</p>${actionHtml}</div>`;
}

/** แสดง error พร้อมปุ่มลองใหม่ */
export function renderError(el, err, retry) {
  el.innerHTML = `<div class="empty error-state"><p>${esc(err?.message || 'เกิดข้อผิดพลาด')}</p>${retry ? '<button class="btn btn-outline" data-retry>ลองใหม่</button>' : ''}</div>`;
  if (retry) el.querySelector('[data-retry]').addEventListener('click', retry);
}

// ---------- toast ----------
export function toast(msg, type = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  box.appendChild(t);
  while (box.children.length > 2) box.firstElementChild.remove(); // แสดงพร้อมกันไม่เกิน 2 อัน ไม่บังจอ
  setTimeout(() => t.classList.add('out'), type === 'error' ? 4200 : 2600);
  setTimeout(() => t.remove(), type === 'error' ? 4600 : 3000);
}

// ---------- modal ----------
/**
 * เปิด modal
 * @param {{title:string, body:string|Node, actions?:Array<{text:string, cls?:string, value?:any, onClick?:Function}>, wide?:boolean, onClose?:Function}} o
 * @returns {{el:HTMLElement, body:HTMLElement, close:Function}}
 */
export function modal(o) {
  const wrap = html(`<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
    <div class="modal${o.wide ? ' modal-wide' : ''}">
      <div class="modal-head"><h2>${esc(o.title)}</h2><button class="icon-btn" data-close aria-label="ปิด">${icon('close')}</button></div>
      <div class="modal-body"></div>
      <div class="modal-actions"></div>
    </div></div>`);
  const body = wrap.querySelector('.modal-body');
  if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
  const actions = wrap.querySelector('.modal-actions');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    o.onClose && o.onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  for (const a of o.actions || []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + (a.cls || 'btn-outline');
    b.textContent = a.text;
    b.addEventListener('click', () => (a.onClick ? a.onClick({ close, button: b, body }) : close()));
    actions.appendChild(b);
  }
  if (!actions.children.length) actions.remove();
  wrap.querySelector('[data-close]').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  const first = body.querySelector('input,select,textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return { el: wrap, body, close };
}

/**
 * กล่องยืนยัน; ถ้ามี input จะคืนข้อความที่กรอก, ยกเลิก → null
 * @returns {Promise<null|true|string>}
 */
export function confirmDialog({ title, message = '', okText = 'ยืนยัน', danger = false, input = null }) {
  return new Promise((resolve) => {
    let result = null;
    const body = `<p class="confirm-msg">${esc(message)}</p>${input ? `<label class="field"><span>${esc(input.label)}</span><input type="text" data-in maxlength="200" placeholder="${esc(input.placeholder || '')}"></label><p class="field-err" data-err></p>` : ''}`;
    modal({
      title, body,
      onClose: () => resolve(result),
      actions: [
        { text: 'ไม่ใช่', cls: 'btn-outline' },
        {
          text: okText, cls: danger ? 'btn-danger' : 'btn-primary',
          onClick: ({ close, body: b }) => {
            if (input) {
              const v = b.querySelector('[data-in]').value.trim();
              if (input.required && !v) { b.querySelector('[data-err]').textContent = 'กรุณากรอก' + input.label; return; }
              result = v;
            } else result = true;
            close();
          },
        },
      ],
    });
  });
}

/** ปุ่มทำงานแบบ async: disable ระหว่างรอ แสดง toast ถ้าพลาด */
export async function busy(button, fn) {
  if (button.disabled) return;
  const old = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-busy');
  try {
    return await fn();
  } catch (e) {
    toast(e.message || 'เกิดข้อผิดพลาด', 'error');
    return undefined;
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
    if (button.isConnected) button.innerHTML = old;
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('คัดลอกแล้ว');
}
