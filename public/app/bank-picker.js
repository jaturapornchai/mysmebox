// ตัวเลือกธนาคารแบบมีโลโก้ (ข้อมูลจาก /api/master/banks)
import { api } from './api.js';
import { esc, icon, modal } from './ui.js';

let banksPromise = null;
export function loadBanks() {
  if (!banksPromise) banksPromise = api('/api/master/banks').then((r) => r.banks || []).catch((e) => { banksPromise = null; throw e; });
  return banksPromise;
}

export function bankLogoUrl(b) {
  if (!b || !b.logo) return '';
  const l = String(b.logo);
  if (l.startsWith('/') || /^https?:\/\//.test(l)) return l;
  return '/banks/' + l;
}

function bankRow(b) {
  const logo = bankLogoUrl(b);
  return `${logo ? `<img src="${esc(logo)}" alt="" width="32" height="32" loading="lazy">` : '<span class="bank-dot"></span>'}<span class="bank-name">${esc(b.nameTh)}</span>${b.shortNameTh ? `<span class="bank-short">${esc(b.shortNameTh)}</span>` : ''}`;
}

/**
 * @param {HTMLElement} container
 * @param {{value?:string, onChange?:(code:string)=>void}} opts
 */
export function createBankPicker(container, opts = {}) {
  let value = opts.value || '';
  let banks = [];
  container.classList.add('bank-picker');
  container.innerHTML = `<button type="button" class="bank-btn" aria-haspopup="listbox"><span class="bank-sel">กำลังโหลด…</span>${icon('chevron', 18)}</button>`;
  const btn = container.querySelector('.bank-btn');
  const sel = container.querySelector('.bank-sel');

  const paint = () => {
    const b = banks.find((x) => x.code === value);
    sel.innerHTML = b ? bankRow(b) : '<span class="muted">เลือกธนาคาร</span>';
  };

  loadBanks().then((list) => { banks = list; paint(); }).catch(() => { sel.textContent = 'โหลดรายชื่อธนาคารไม่ได้'; });

  btn.addEventListener('click', () => {
    const body = document.createElement('div');
    body.innerHTML = `<div class="input-icon">${icon('search', 18)}<input type="search" placeholder="ค้นหาชื่อธนาคาร" data-q></div>
      <div class="bank-list" role="listbox">
        <button type="button" class="bank-item" data-code=""><span class="bank-dot"></span><span class="bank-name">ไม่ระบุธนาคาร</span></button>
        ${banks.map((b) => `<button type="button" class="bank-item${b.code === value ? ' is-on' : ''}" role="option" data-code="${esc(b.code)}" data-s="${esc((b.nameTh + ' ' + (b.shortNameTh || '') + ' ' + (b.nameEn || '') + ' ' + b.code).toLowerCase())}">${bankRow(b)}</button>`).join('')}
      </div>`;
    const m = modal({ title: 'เลือกธนาคาร', body });
    body.querySelector('[data-q]').addEventListener('input', (e) => {
      const t = e.target.value.trim().toLowerCase();
      body.querySelectorAll('.bank-item[data-s]').forEach((it) => { it.hidden = t && !it.dataset.s.includes(t); });
    });
    body.addEventListener('click', (e) => {
      const it = e.target.closest('.bank-item');
      if (!it) return;
      value = it.dataset.code;
      paint();
      m.close();
      opts.onChange && opts.onChange(value);
    });
  });

  return {
    getValue: () => value,
    setValue: (v) => { value = v || ''; paint(); },
  };
}
