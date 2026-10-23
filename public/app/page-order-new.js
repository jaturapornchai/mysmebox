// เปิดออเดอร์ (หน้าสำคัญที่สุด): วางแชทให้ AI กรอก → เลือกสินค้า/ยิงบาร์โค้ด → ลูกค้า+ที่อยู่ → ส่ง/รับเงิน → บันทึก
import { api, qs, uuid } from './api.js';
import { esc, icon, toast, debounce, options, CHANNELS, COURIERS, PAY_METHODS } from './ui.js';
import { big, divRoundHalfUp, fmtBaht, fmtBahtShort, parseBahtInput, satangToInput } from './money.js';
import { createAddressPicker } from './address-picker.js';

/** ปุ่มตามหน่วยขาย ของสินค้า 1 ตัว: แต่ละบาร์โค้ด = 1 ปุ่ม */
function unitButtons(p) {
  return (p.barcodes || []).map((b) => {
    const u = (p.units || []).find((x) => x.unitCode === b.unitCode) || {};
    return `<button type="button" class="unit-btn" data-pid="${esc(p.id)}" data-barcode="${esc(b.barcode)}"><span>${esc(u.unitName || b.unitCode)}</span><b class="money">${fmtBahtShort(b.priceSatang)}</b></button>`;
  }).join('');
}

export async function render(view, ctx) {
  ctx.setTitle('เปิดออเดอร์', '#/orders');
  const shop = ctx.state.shop;
  const vatBp = BigInt(shop.vatRateBp || 0);
  const productCache = new Map(); // id → product
  /** @type {Array<{barcode:string, productId:string, productName:string, unitName:string, standValue:number, divideValue:number, priceSatang:string, costBaseSatang:string, stockBase:number, qty:number}>} */
  const cart = [];
  let customerId = null;
  let idemKey = null;
  let idemSig = '';
  let saving = false;

  view.innerHTML = `
  <form class="order-form" data-form novalidate>
    <details class="card ai-paste">
      <summary>${icon('sparkle')}<span>วางข้อความแชทลูกค้า ให้ AI กรอกให้</span></summary>
      <textarea data-chat rows="4" maxlength="3000" placeholder="วางข้อความจากแชท เช่น&#10;คุณแนน 0819992233 เอาเซรั่ม 2 ขวด ส่ง 88/9 จตุจักร กทม 10900 เก็บปลายทาง"></textarea>
      <button type="button" class="btn btn-primary" data-ai>${icon('sparkle', 18)} ให้ AI กรอกให้</button>
    </details>

    <section class="card">
      <div class="card-head"><h2>1. สินค้า</h2></div>
      <div class="input-icon">${icon('barcode', 18)}<input type="search" data-find autocomplete="off" enterkeyhint="search" placeholder="ค้นหาชื่อสินค้า หรือยิงบาร์โค้ดแล้วกด Enter"></div>
      <div class="pick-list" data-picks></div>
      <div class="cart" data-cart></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>2. ลูกค้า</h2></div>
      <div class="field ap-search-wrap">
        <span>ค้นหาลูกค้าเดิม</span>
        <div class="input-icon">${icon('search', 18)}<input type="search" data-cq autocomplete="off" placeholder="พิมพ์ชื่อหรือเบอร์โทร"></div>
        <div class="ap-results" data-cres hidden></div>
      </div>
      <div class="chip-line" data-cchip hidden></div>
      <div class="grid-2">
        <label class="field"><span>ชื่อลูกค้า</span><input data-cname maxlength="100" placeholder="เช่น คุณแนน"></label>
        <label class="field"><span>เบอร์โทร</span><input data-cphone inputmode="tel" maxlength="20" placeholder="08xxxxxxxx"></label>
      </div>
      <div data-addr></div>
      <label class="check" data-save-wrap><input type="checkbox" data-save checked><span>บันทึกเป็นลูกค้าประจำ</span></label>
    </section>

    <section class="card">
      <div class="card-head"><h2>3. ส่งของและรับเงิน</h2></div>
      <div class="field"><span>ขายผ่านช่องทาง</span><div class="seg seg-wrap" data-channel>${CHANNELS.map(([v, t], i) => `<button type="button" class="seg-btn${i === 0 ? ' is-on' : ''}" data-v="${v}">${esc(t)}</button>`).join('')}</div></div>
      <div class="grid-3">
        <label class="field"><span>ขนส่ง</span><select data-courier>${options(COURIERS, 'FLASH')}</select></label>
        <label class="field"><span>ค่าส่ง (บาท)</span><input data-shipping inputmode="decimal" placeholder="0" class="money-input"></label>
        <label class="field"><span>ส่วนลด (บาท)</span><input data-discount inputmode="decimal" placeholder="0" class="money-input"></label>
      </div>
      <div class="field"><span>วิธีรับเงิน</span><div class="seg" data-pay>${PAY_METHODS.map(([v, t], i) => `<button type="button" class="seg-btn${i === 0 ? ' is-on' : ''}" data-v="${v}">${esc(t)}</button>`).join('')}</div></div>
      <label class="check" data-paid-wrap><input type="checkbox" data-paid><span>รับเงินแล้ว</span></label>
      <label class="field"><span>หมายเหตุ</span><input data-note maxlength="500" placeholder="เช่น ห่อของขวัญ"></label>
    </section>

    <section class="card summary" data-summary></section>
    <div class="save-bar"><div class="save-total"><span>ยอดรวม</span><b class="money" data-total>฿0.00</b></div><button type="submit" class="btn btn-accent btn-lg" data-submit>${icon('check')} บันทึกออเดอร์</button></div>
  </form>`;

  const $ = (s) => view.querySelector(s);
  const form = $('[data-form]');
  const find = $('[data-find]');
  const picks = $('[data-picks]');
  const cartEl = $('[data-cart]');
  const shippingIn = $('[data-shipping]');
  const discountIn = $('[data-discount]');
  const addr = createAddressPicker($('[data-addr]'), { lineLabel: 'ที่อยู่จัดส่ง (บ้านเลขที่ / ถนน / ซอย)' });

  const segValue = (sel) => view.querySelector(`${sel} .seg-btn.is-on`)?.dataset.v;
  const setSeg = (sel, v) => {
    const btns = view.querySelectorAll(`${sel} .seg-btn`);
    if (![...btns].some((b) => b.dataset.v === v)) return;
    btns.forEach((b) => b.classList.toggle('is-on', b.dataset.v === v));
  };
  for (const sel of ['[data-channel]', '[data-pay]']) {
    $(sel).addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      setSeg(sel, b.dataset.v);
      if (sel === '[data-pay]') syncPaid();
    });
  }
  function syncPaid() {
    const cod = segValue('[data-pay]') === 'COD';
    $('[data-paid-wrap]').hidden = cod;
    if (cod) $('[data-paid]').checked = false;
  }
  syncPaid();

  // ---------- สินค้า ----------
  function remember(products) { products.forEach((p) => productCache.set(String(p.id), p)); }

  function showPicks(products, emptyText) {
    remember(products);
    picks.innerHTML = products.length
      ? products.map((p) => `<div class="pick"><div class="pick-info"><b>${esc(p.name)}</b><span class="muted">เหลือ ${esc(p.stockBase)} ${esc(p.baseUnitName)}${p.isLowStock ? ' · <span class="txt-red">ใกล้หมด</span>' : ''}</span></div><div class="unit-btns">${unitButtons(p)}</div></div>`).join('')
      : `<p class="muted pad">${esc(emptyText || 'ไม่พบสินค้า')}</p>`;
  }

  let searchSeq = 0;
  async function search(text) {
    const my = ++searchSeq;
    picks.innerHTML = '<p class="muted pad">กำลังค้นหา…</p>';
    try {
      const r = await api('/api/products' + qs({ q: text }));
      if (my !== searchSeq) return;
      showPicks(r.products.slice(0, 30), text ? 'ไม่พบสินค้าที่ค้นหา' : 'ยังไม่มีสินค้า เพิ่มสินค้าที่เมนู "สินค้า" ก่อน');
    } catch (e) { if (my === searchSeq) picks.innerHTML = `<p class="txt-red pad">${esc(e.message)}</p>`; }
  }

  function addToCart(p, barcode, qty = 1) {
    const b = (p.barcodes || []).find((x) => x.barcode === barcode);
    if (!b) return;
    const u = (p.units || []).find((x) => x.unitCode === b.unitCode) || { unitName: b.unitCode, standValue: 1, divideValue: 1 };
    const line = cart.find((c) => c.barcode === barcode);
    if (line) line.qty += qty;
    else cart.push({
      barcode, productId: String(p.id), productName: p.name, unitName: u.unitName, standValue: u.standValue || 1, divideValue: u.divideValue || 1,
      priceSatang: b.priceSatang, costBaseSatang: p.costBaseSatang, stockBase: p.stockBase, baseUnitName: p.baseUnitName, qty,
    });
    renderCart();
  }

  async function lookupBarcode(code) {
    try {
      const r = await api('/api/products/lookup' + qs({ barcode: code }));
      remember([r.product]);
      addToCart(r.product, r.barcode.barcode || code);
      toast(`เพิ่ม ${r.product.name} แล้ว`);
      return true;
    } catch (e) {
      if (e.status !== 404) toast(e.message, 'error');
      return false;
    }
  }

  find.addEventListener('input', debounce(() => search(find.value.trim()), 250));
  find.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = find.value.trim();
    if (!code) return;
    if (await lookupBarcode(code)) { find.value = ''; find.focus(); search(''); }
    else search(code);
  });
  picks.addEventListener('click', (e) => {
    const b = e.target.closest('.unit-btn');
    if (!b) return;
    const p = productCache.get(b.dataset.pid);
    if (p) addToCart(p, b.dataset.barcode);
  });

  function lineQtyBase(c) { return (BigInt(c.qty) * BigInt(c.standValue)) / BigInt(c.divideValue); }

  function renderCart() {
    if (!cart.length) {
      cartEl.innerHTML = '<p class="cart-empty">ยังไม่ได้เลือกสินค้า — แตะปุ่มหน่วยขายด้านบน</p>';
    } else {
      cartEl.innerHTML = `<h3 class="cart-title">ในตะกร้า (${cart.length})</h3>` + cart.map((c, i) => {
        const needBase = lineQtyBase(c);
        const over = needBase > BigInt(c.stockBase ?? 0);
        return `<div class="cart-line">
          <div class="cl-info"><b>${esc(c.productName)}</b><span class="muted">${esc(c.unitName)} · ${fmtBaht(c.priceSatang)}</span>${over ? `<span class="txt-red tiny">สต๊อกไม่พอ (เหลือ ${esc(c.stockBase)} ${esc(c.baseUnitName)})</span>` : ''}</div>
          <div class="qty"><button type="button" class="qty-btn" data-dec="${i}" aria-label="ลดจำนวน">${icon('minus', 18)}</button><input class="qty-in" data-qty="${i}" inputmode="numeric" value="${c.qty}" aria-label="จำนวน"><button type="button" class="qty-btn" data-inc="${i}" aria-label="เพิ่มจำนวน">${icon('plus', 18)}</button></div>
          <b class="money cl-total">${fmtBaht(big(c.priceSatang) * BigInt(c.qty))}</b>
          <button type="button" class="icon-btn" data-del="${i}" aria-label="ลบรายการ">${icon('trash', 18)}</button>
        </div>`;
      }).join('');
    }
    renderSummary();
  }
  cartEl.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.inc) cart[+t.dataset.inc].qty += 1;
    else if (t.dataset.dec) { const c = cart[+t.dataset.dec]; c.qty = Math.max(1, c.qty - 1); }
    else if (t.dataset.del) cart.splice(+t.dataset.del, 1);
    else return;
    renderCart();
  });
  cartEl.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.dataset.qty) return;
    const n = /^\d{1,6}$/.test(t.value.trim()) ? parseInt(t.value.trim(), 10) : 0;
    cart[+t.dataset.qty].qty = Math.min(100000, Math.max(1, n || 1));
    renderCart();
  });

  // ---------- สรุปยอด (สูตรเดียวกับ server, BigInt) ----------
  function compute() {
    const shipping = parseBahtInput(shippingIn.value);
    const discount = parseBahtInput(discountIn.value);
    let items = 0n, cost = 0n;
    for (const c of cart) {
      items += big(c.priceSatang) * BigInt(c.qty);
      cost += big(c.costBaseSatang) * lineQtyBase(c);
    }
    const ship = big(shipping ?? '0');
    const disc = big(discount ?? '0');
    const beforeVat = items - disc + ship;
    const vat = vatBp > 0n ? divRoundHalfUp(beforeVat * vatBp, 10000n) : 0n;
    return { items, ship, disc, vat, total: beforeVat + vat, profit: items - disc - cost, shippingOk: shipping !== null, discountOk: discount !== null && disc <= items };
  }

  function renderSummary() {
    const s = compute();
    shippingIn.classList.toggle('is-invalid', !s.shippingOk);
    discountIn.classList.toggle('is-invalid', !s.discountOk);
    const row = (t, v, cls = '') => `<div class="sum-row ${cls}"><span>${t}</span><span class="money">${v}</span></div>`;
    $('[data-summary]').innerHTML = `<div class="card-head"><h2>สรุปยอด</h2></div>
      ${row('ค่าสินค้า', fmtBaht(s.items))}
      ${s.disc ? row('ส่วนลด', '-' + fmtBaht(s.disc)) : ''}
      ${row('ค่าส่ง', fmtBaht(s.ship))}
      ${vatBp > 0n ? row(`VAT ${esc(satangToInput(vatBp.toString()))}%`, fmtBaht(s.vat)) : ''}
      ${row('ยอดที่ลูกค้าต้องจ่าย', fmtBaht(s.total), 'sum-total')}
      ${row('กำไรโดยประมาณ', fmtBaht(s.profit), 'sum-profit')}
      ${!s.shippingOk ? '<p class="txt-red tiny">ค่าส่งต้องเป็นตัวเลข เช่น 40 หรือ 40.50</p>' : ''}
      ${!s.discountOk ? '<p class="txt-red tiny">ส่วนลดต้องเป็นตัวเลข และไม่เกินค่าสินค้า</p>' : ''}`;
    $('[data-total]').textContent = fmtBaht(s.total);
  }
  shippingIn.addEventListener('input', renderSummary);
  discountIn.addEventListener('input', renderSummary);

  // ---------- ลูกค้า ----------
  const cq = $('[data-cq]'), cres = $('[data-cres]'), cchip = $('[data-cchip]');
  let customers = [];
  const setCustomer = async (c) => {
    customerId = c ? String(c.id) : null;
    cres.hidden = true;
    cq.value = '';
    cchip.hidden = !c;
    $('[data-save-wrap]').hidden = !!c;
    if (c) {
      cchip.innerHTML = `<span class="chip">${icon('check', 16)} ลูกค้าเดิม: ${esc(c.name)}</span><button type="button" class="link" data-clear>เปลี่ยนเป็นลูกค้าใหม่</button>`;
      $('[data-cname]').value = c.name || '';
      $('[data-cphone]').value = c.phone || '';
      await addr.setValue(c);
    }
  };
  cchip.addEventListener('click', (e) => { if (e.target.closest('[data-clear]')) setCustomer(null); });
  cq.addEventListener('input', debounce(async () => {
    const t = cq.value.trim();
    if (!t) { cres.hidden = true; return; }
    try {
      const r = await api('/api/customers' + qs({ q: t }));
      customers = r.customers || [];
      cres.innerHTML = customers.length
        ? customers.slice(0, 20).map((c, i) => `<button type="button" class="ap-item" data-i="${i}"><b>${esc(c.name)}</b> <span>${esc(c.phone || '')}</span> <span class="ap-zip">${esc(c.provinceName || '')}</span></button>`).join('')
        : '<div class="ap-none">ไม่พบ — กรอกเป็นลูกค้าใหม่ด้านล่างได้เลย</div>';
      cres.hidden = false;
    } catch (e) { cres.innerHTML = `<div class="ap-none">${esc(e.message)}</div>`; cres.hidden = false; }
  }, 250));
  cres.addEventListener('click', (e) => { const b = e.target.closest('.ap-item'); if (b) setCustomer(customers[+b.dataset.i]); });

  // ---------- AI แกะแชท ----------
  $('[data-ai]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const text = $('[data-chat]').value.trim();
    if (!text) { toast('วางข้อความแชทก่อน', 'error'); return; }
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.textContent = 'AI กำลังอ่านแชท…';
    try {
      const { draft } = await api('/api/ai/parse-order', { body: { text } });
      if (draft.customerName) $('[data-cname]').value = draft.customerName;
      if (draft.customerPhone) $('[data-cphone]').value = draft.customerPhone;
      if (draft.channel) setSeg('[data-channel]', draft.channel);
      if (draft.courier) $('[data-courier]').value = COURIERS.some((c) => c[0] === draft.courier) ? draft.courier : $('[data-courier]').value;
      if (draft.payMethod) { setSeg('[data-pay]', draft.payMethod); syncPaid(); }
      if (draft.shippingSatang && /^\d+$/.test(String(draft.shippingSatang))) shippingIn.value = satangToInput(draft.shippingSatang);
      if (draft.note) $('[data-note]').value = draft.note;
      if (draft.addressText) addr.setLine(draft.addressText);
      if (draft.zipCode) await addr.searchAndPick(String(draft.zipCode));
      let added = 0;
      for (const it of draft.items || []) {
        try {
          const r = await api('/api/products/lookup' + qs({ barcode: it.barcode }));
          remember([r.product]);
          addToCart(r.product, r.barcode.barcode || it.barcode, Math.max(1, parseInt(it.qty, 10) || 1));
          added++;
        } catch { /* สินค้าที่หาไม่เจอข้ามไป */ }
      }
      renderSummary();
      toast(`AI กรอกให้แล้ว (${added} รายการสินค้า) ตรวจสอบก่อนบันทึกนะ`);
    } catch (err) {
      toast(err.code === 'AI_DISABLED' ? 'ผู้ช่วย AI ยังไม่เปิดใช้งาน' : err.message, 'error');
    } finally { btn.disabled = false; btn.innerHTML = old; }
  });

  // ---------- บันทึก ----------
  function buildPayload() {
    const s = compute();
    const a = addr.getValue();
    const pay = segValue('[data-pay]');
    return {
      customerId,
      saveCustomer: !customerId && $('[data-save]').checked,
      customerName: $('[data-cname]').value.trim(),
      customerPhone: $('[data-cphone]').value.trim(),
      ship: a,
      channel: segValue('[data-channel]'),
      courier: $('[data-courier]').value,
      payMethod: pay,
      paid: pay !== 'COD' && $('[data-paid]').checked,
      payBankCode: '', slipUrl: '',
      discountSatang: s.disc.toString(),
      shippingSatang: s.ship.toString(),
      note: $('[data-note]').value.trim(),
      items: cart.map((c) => ({ barcode: c.barcode, qty: c.qty, priceSatang: c.priceSatang })),
    };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    const s = compute();
    if (!cart.length) { toast('ยังไม่ได้เลือกสินค้า', 'error'); find.focus(); return; }
    if (!s.shippingOk || !s.discountOk) { toast('ตรวจค่าส่ง/ส่วนลดอีกครั้ง', 'error'); return; }
    const payload = buildPayload();
    const sig = JSON.stringify(payload);
    if (sig !== idemSig) { idemSig = sig; idemKey = uuid(); } // ฟอร์มชุดเดิม = key เดิม กันบิลซ้ำ
    saving = true;
    const btn = $('[data-submit]');
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก…';
    try {
      const r = await api('/api/orders', { body: payload, headers: { 'Idempotency-Key': idemKey } });
      toast(`บันทึกออเดอร์ ${r.order.billNo} แล้ว`);
      location.hash = `#/orders/${encodeURIComponent(r.order.id)}`;
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = `${icon('check')} บันทึกออเดอร์`;
    } finally { saving = false; }
  });

  renderCart();
  search('');
  find.focus({ preventScroll: true });
}
