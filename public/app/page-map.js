// แผนที่: หมุดลูกค้า / โกดัง / จุดส่ง + เพิ่ม/แก้ไข/ลบ ลูกค้าและโกดัง
import { api } from './api.js';
import { esc, icon, toast, confirmDialog, busy, skeleton, renderError } from './ui.js';
import { fmtBaht } from './money.js';
import { createAddressPicker, addressText } from './address-picker.js';

let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/leaflet/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = '/leaflet/leaflet.js';
      s.onload = () => { window.L.Icon.Default.imagePath = '/leaflet/'; resolve(window.L); };
      s.onerror = () => { leafletPromise = null; reject(new Error('โหลดแผนที่ไม่สำเร็จ')); };
      document.head.appendChild(s);
    });
  }
  return leafletPromise;
}

const LAYERS = [
  ['customers', 'ลูกค้า', 'green'],
  ['warehouses', 'โกดัง', 'orange'],
  ['deliveries', 'จุดส่ง', 'blue'],
];
const SHIP_TEXT = { PENDING: 'รอแพ็ค', PACKED: 'แพ็คแล้ว', SHIPPED: 'กำลังส่ง', RETURNED: 'ตีกลับ' };
const hasPos = (x) => x && x.lat != null && x.lng != null;

export async function render(view, ctx) {
  ctx.setTitle('แผนที่');
  view.innerHTML = `
    <div class="layer-bar">${LAYERS.map(([k, t, c]) => `<label class="layer-chip"><input type="checkbox" data-layer="${k}" checked><span class="dot dot-${c}"></span><span>${t}</span></label>`).join('')}<span class="layer-chip legend"><span class="dot dot-red"></span><span>COD ค้างเก็บ</span></span></div>
    <div class="map-wrap"><div id="map" class="map" role="region" aria-label="แผนที่ร้าน"></div><div class="map-tip" data-tip hidden>แตะบนแผนที่เพื่อปักหมุด</div></div>
    <div class="actions"><button class="btn btn-primary" data-add="customer">${icon('plus', 18)}<span>เพิ่มลูกค้า</span></button><button class="btn btn-outline" data-add="warehouse">${icon('plus', 18)}<span>เพิ่มโกดัง</span></button></div>
    <section class="card" data-form-card hidden></section>
    <section class="card">
      <div class="tabs" role="tablist"><button class="tab is-on" data-list-tab="customers">ลูกค้า</button><button class="tab" data-list-tab="warehouses">โกดัง</button></div>
      <div data-list>${skeleton(3)}</div>
    </section>`;

  let L;
  try { L = await loadLeaflet(); } catch (e) { renderError(view.querySelector('.map-wrap'), e); return; }
  if (!ctx.isActive()) return;

  const map = L.map('map', { zoomControl: true }).setView([13.7563, 100.5018], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  const groups = { customers: L.layerGroup().addTo(map), warehouses: L.layerGroup().addTo(map), deliveries: L.layerGroup().addTo(map), shop: L.layerGroup().addTo(map) };
  const pin = (color) => L.divIcon({ className: '', html: `<span class="pin pin-${color}"></span>`, iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24] });

  let data = { customers: [], warehouses: [], deliveries: [], shop: null };
  let listTab = 'customers';
  let editing = null; // {kind, item, picker, marker}

  function popupEl(lines, link) {
    const d = document.createElement('div');
    d.className = 'popup';
    for (const [cls, text] of lines) {
      if (!text) continue;
      const p = document.createElement('div');
      p.className = cls;
      p.textContent = text;
      d.appendChild(p);
    }
    if (link) {
      const a = document.createElement('a');
      a.href = link[0]; a.textContent = link[1]; a.className = 'popup-link';
      d.appendChild(a);
    }
    return d;
  }

  function paintMarkers(fit) {
    Object.values(groups).forEach((g) => g.clearLayers());
    const pts = [];
    const add = (g, x, color, el) => { L.marker([x.lat, x.lng], { icon: pin(color) }).bindPopup(el).addTo(g); pts.push([x.lat, x.lng]); };
    if (hasPos(data.shop)) add(groups.shop, data.shop, 'navy', popupEl([['popup-title', data.shop.name], ['', 'ร้านของฉัน']]));
    data.customers.filter(hasPos).forEach((c) => add(groups.customers, c, 'green', popupEl([['popup-title', c.name], ['', c.phone], ['muted', addressText(c)]])));
    data.warehouses.filter(hasPos).forEach((w) => add(groups.warehouses, w, 'orange', popupEl([['popup-title', 'โกดัง: ' + w.name], ['', w.phone], ['muted', addressText(w)]])));
    data.deliveries.filter(hasPos).forEach((d) => {
      const codDue = d.payMethod === 'COD' && d.payStatus === 'UNPAID';
      add(groups.deliveries, d, codDue ? 'red' : 'blue', popupEl([
        ['popup-title', `${d.billNo} · ${d.customerName || ''}`],
        ['', `${SHIP_TEXT[d.shipStatus] || d.shipStatus} · ${fmtBaht(d.totalSatang)}${codDue ? ' · COD ค้างเก็บ' : ''}`],
        ['muted', d.addressText],
      ], [`#/orders/${encodeURIComponent(d.id)}`, 'เปิดออเดอร์ →']));
    });
    if (fit && pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 });
  }

  function paintList() {
    const box = view.querySelector('[data-list]');
    const items = data[listTab] || [];
    box.innerHTML = items.length ? `<ul class="list">${items.map((x, i) => `<li class="list-row">
        <span class="dot dot-${listTab === 'customers' ? 'green' : 'orange'}"></span>
        <span class="lr-main"><b>${esc(x.name)}</b><span class="muted tiny">${esc(x.phone || '')} ${esc(addressText(x))}</span></span>
        ${hasPos(x) ? `<button class="icon-btn" data-go="${i}" aria-label="ดูบนแผนที่">${icon('pin', 18)}</button>` : '<span class="badge badge-gray">ไม่มีพิกัด</span>'}
        <button class="icon-btn" data-edit="${i}" aria-label="แก้ไข">${icon('edit', 18)}</button>
        <button class="icon-btn" data-del="${i}" aria-label="ลบ">${icon('trash', 18)}</button>
      </li>`).join('')}</ul>` : `<p class="muted pad">${listTab === 'customers' ? 'ยังไม่มีลูกค้า' : 'ยังไม่มีโกดัง'}</p>`;
  }

  async function load(fit) {
    try {
      const r = await api('/api/map');
      if (!ctx.isActive()) return;
      data = { customers: r.customers || [], warehouses: r.warehouses || [], deliveries: r.deliveries || [], shop: r.shop };
      paintMarkers(fit);
      paintList();
    } catch (e) { renderError(view.querySelector('[data-list]'), e, () => load(fit)); }
  }

  // สวิตช์ชั้นหมุด
  view.querySelector('.layer-bar').addEventListener('change', (e) => {
    const k = e.target.dataset.layer;
    if (!k) return;
    if (e.target.checked) groups[k].addTo(map); else map.removeLayer(groups[k]);
  });

  // แท็บรายการ
  view.querySelectorAll('[data-list-tab]').forEach((b) => b.addEventListener('click', () => {
    listTab = b.dataset.listTab;
    view.querySelectorAll('[data-list-tab]').forEach((x) => x.classList.toggle('is-on', x === b));
    paintList();
  }));
  view.querySelector('[data-list]').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const items = data[listTab];
    if (b.dataset.go) { const x = items[+b.dataset.go]; map.setView([x.lat, x.lng], 15); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    if (b.dataset.edit) openForm(listTab === 'customers' ? 'customer' : 'warehouse', items[+b.dataset.edit]);
    if (b.dataset.del) {
      const x = items[+b.dataset.del];
      const kind = listTab === 'customers' ? 'customers' : 'warehouses';
      if (!(await confirmDialog({ title: 'ลบข้อมูล', message: `ลบ "${x.name}" ใช่ไหม`, okText: 'ลบ', danger: true }))) return;
      await busy(b, async () => { await api(`/api/${kind}/${encodeURIComponent(x.id)}`, { method: 'DELETE' }); toast('ลบแล้ว'); await load(false); });
    }
  });

  // ฟอร์มเพิ่ม/แก้ไข (อยู่ใต้แผนที่ เพื่อแตะแผนที่ปักหมุดได้)
  const formCard = view.querySelector('[data-form-card]');
  const tip = view.querySelector('[data-tip]');
  function closeForm() {
    if (editing && editing.marker) map.removeLayer(editing.marker);
    editing = null;
    formCard.hidden = true;
    formCard.innerHTML = '';
    tip.hidden = true;
  }
  function placeTemp(lat, lng, pan) {
    if (!editing) return;
    if (lat == null || lng == null) return;
    if (!editing.marker) {
      editing.marker = L.marker([lat, lng], { icon: pin('pick'), draggable: true }).addTo(map);
      editing.marker.on('dragend', () => { const p = editing.marker.getLatLng(); editing.picker.setLatLng(p.lat, p.lng); });
    } else editing.marker.setLatLng([lat, lng]);
    if (pan) map.setView([lat, lng], Math.max(map.getZoom(), 14));
  }
  map.on('click', (e) => {
    if (!editing) return;
    editing.picker.setLatLng(e.latlng.lat, e.latlng.lng);
  });

  function openForm(kind, item) {
    closeForm();
    const isCust = kind === 'customer';
    formCard.hidden = false;
    formCard.innerHTML = `<div class="card-head"><h2>${item ? 'แก้ไข' : 'เพิ่ม'}${isCust ? 'ลูกค้า' : 'โกดัง'}</h2><button class="icon-btn" data-cancel aria-label="ปิด">${icon('close')}</button></div>
      <form data-f novalidate>
        <div class="grid-2">
          <label class="field"><span>ชื่อ${isCust ? 'ลูกค้า' : 'โกดัง'} *</span><input name="name" maxlength="100" required value="${esc(item ? item.name : '')}"></label>
          <label class="field"><span>เบอร์โทร</span><input name="phone" inputmode="tel" maxlength="20" value="${esc(item ? item.phone || '' : '')}"></label>
        </div>
        ${isCust ? `<label class="field"><span>หมายเหตุ</span><input name="note" maxlength="300" value="${esc(item ? item.note || '' : '')}"></label>` : ''}
        <div data-addr></div>
        <div class="actions"><button type="button" class="btn btn-outline" data-gps>${icon('gps', 18)}<span>ใช้ตำแหน่งฉัน</span></button><span class="hint">หรือแตะบนแผนที่ด้านบนเพื่อปักหมุด</span></div>
        <div class="form-actions"><button type="submit" class="btn btn-primary btn-lg btn-block" data-save>${icon('check')}<span>บันทึก</span></button></div>
      </form>`;
    const picker = createAddressPicker(formCard.querySelector('[data-addr]'), {
      value: item || null,
      onChange: (a) => placeTemp(a.lat, a.lng, true),
    });
    editing = { kind, item, picker, marker: null };
    tip.hidden = false;
    picker.ready.then(() => { const a = picker.getValue(); placeTemp(a.lat, a.lng, false); });
    formCard.querySelector('[data-cancel]').addEventListener('click', closeForm);
    formCard.querySelector('[data-gps]').addEventListener('click', () => {
      if (!navigator.geolocation) { toast('อุปกรณ์นี้หาตำแหน่งไม่ได้', 'error'); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => { picker.setLatLng(p.coords.latitude, p.coords.longitude); toast('ปักหมุดตำแหน่งของคุณแล้ว'); },
        () => toast('ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง', 'error'),
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
    const form = formCard.querySelector('[data-f]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      if (!name) { toast('กรอกชื่อก่อน', 'error'); return; }
      const body = { name, phone: form.phone.value.trim(), ...picker.getValue() };
      if (isCust) body.note = form.note.value.trim();
      const base = isCust ? '/api/customers' : '/api/warehouses';
      await busy(formCard.querySelector('[data-save]'), async () => {
        if (item) await api(`${base}/${encodeURIComponent(item.id)}`, { method: 'PUT', body });
        else await api(base, { body });
        toast('บันทึกแล้ว');
        listTab = isCust ? 'customers' : 'warehouses';
        view.querySelectorAll('[data-list-tab]').forEach((x) => x.classList.toggle('is-on', x.dataset.listTab === listTab));
        closeForm();
        await load(false);
      });
    });
    formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  view.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openForm(b.dataset.add, null)));

  await load(true);
  setTimeout(() => map.invalidateSize(), 50);
  return () => map.remove();
}
