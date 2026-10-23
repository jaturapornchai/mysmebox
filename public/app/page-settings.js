// ตั้งค่าร้าน: ข้อมูลร้าน ที่อยู่ พร้อมเพย์ ธนาคาร VAT ออกจากระบบ
import { api } from './api.js';
import { esc, icon, toast, busy } from './ui.js';
import { parseBahtInput, satangToInput } from './money.js';
import { createAddressPicker } from './address-picker.js';
import { createBankPicker } from './bank-picker.js';

export async function render(view, ctx) {
  ctx.setTitle('ตั้งค่า');
  let shop = ctx.state.shop;
  try { shop = (await api('/api/shop')).shop; ctx.state.shop = shop; } catch { /* ใช้ข้อมูลจาก /api/me */ }
  if (!ctx.isActive()) return;
  const user = ctx.state.user || {};
  const vatOn = Number(shop.vatRateBp || 0) > 0;

  view.innerHTML = `
    <form data-form novalidate>
      <section class="card">
        <div class="card-head"><h2>ข้อมูลร้าน</h2></div>
        <div class="grid-2">
          <label class="field"><span>ชื่อร้าน *</span><input name="name" maxlength="100" required value="${esc(shop.name)}"></label>
          <label class="field"><span>เบอร์โทรร้าน</span><input name="phone" inputmode="tel" maxlength="20" value="${esc(shop.phone || '')}"></label>
        </div>
        <h3 class="sub-h">ที่อยู่ร้าน (ใช้เป็นผู้ส่งบนใบปะหน้า)</h3>
        <div data-addr></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>รับเงิน</h2></div>
        <label class="field"><span>พร้อมเพย์ (เบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก)</span><input name="promptpayId" inputmode="numeric" maxlength="13" placeholder="08xxxxxxxx" value="${esc(shop.promptpayId || '')}"></label>
        <div class="field"><span>ธนาคาร</span><div data-bank></div></div>
        <div class="grid-2">
          <label class="field"><span>เลขบัญชี</span><input name="bankAccountNo" inputmode="numeric" maxlength="20" value="${esc(shop.bankAccountNo || '')}"></label>
          <label class="field"><span>ชื่อบัญชี</span><input name="bankAccountName" maxlength="100" value="${esc(shop.bankAccountName || '')}"></label>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2>ภาษีมูลค่าเพิ่ม (VAT)</h2></div>
        <label class="switch-row"><span><b>ร้านจดทะเบียน VAT</b><small class="muted">เปิดแล้วออเดอร์ใหม่จะบวก VAT ให้อัตโนมัติ</small></span><input type="checkbox" class="switch" name="vatOn" ${vatOn ? 'checked' : ''}></label>
        <label class="field" data-vat-rate ${vatOn ? '' : 'hidden'}><span>อัตรา VAT (%)</span><input name="vatRate" inputmode="decimal" maxlength="6" value="${esc(vatOn ? satangToInput(String(shop.vatRateBp)) : '7')}"></label>
      </section>
      <div class="form-actions"><button type="submit" class="btn btn-accent btn-lg btn-block" data-save>${icon('check')}<span>บันทึกการตั้งค่า</span></button></div>
    </form>
    <section class="card">
      <div class="card-head"><h2>บัญชีของฉัน</h2></div>
      <p>${esc(user.name || '')} <span class="muted">${esc(user.email || '')}</span>${user.isDemo ? ' <span class="badge badge-amber">ร้านทดลอง</span>' : ''}</p>
      <button class="btn btn-danger-outline" data-logout>${icon('logout', 18)}<span>ออกจากระบบ</span></button>
    </section>`;

  const form = view.querySelector('[data-form]');
  const addr = createAddressPicker(view.querySelector('[data-addr]'), { value: shop });
  const bank = createBankPicker(view.querySelector('[data-bank]'), { value: shop.bankCode || '' });
  form.vatOn.addEventListener('change', () => { view.querySelector('[data-vat-rate]').hidden = !form.vatOn.checked; });
  form.promptpayId.addEventListener('input', () => { form.promptpayId.value = form.promptpayId.value.replace(/\D/g, ''); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const pp = form.promptpayId.value.trim();
    if (!name) { toast('กรอกชื่อร้าน', 'error'); return; }
    if (pp && !/^(0\d{9}|\d{13})$/.test(pp)) { toast('พร้อมเพย์ต้องเป็นเบอร์ 10 หลักขึ้นต้น 0 หรือเลข 13 หลัก', 'error'); return; }
    let vatRateBp = 0;
    if (form.vatOn.checked) {
      const bp = parseBahtInput(form.vatRate.value, null); // ทศนิยม 2 ตำแหน่ง = basis point พอดี (7 → 700)
      if (bp === null || BigInt(bp) <= 0n || BigInt(bp) > 10000n) { toast('อัตรา VAT ต้องอยู่ระหว่าง 0.01 - 100', 'error'); return; }
      vatRateBp = Number(bp);
    }
    const body = {
      name, phone: form.phone.value.trim(), promptpayId: pp,
      bankCode: bank.getValue(), bankAccountNo: form.bankAccountNo.value.trim(), bankAccountName: form.bankAccountName.value.trim(),
      vatRateBp, ...addr.getValue(),
    };
    await busy(view.querySelector('[data-save]'), async () => {
      const r = await api('/api/shop', { method: 'PUT', body });
      ctx.state.shop = r.shop;
      ctx.updateShopName();
      toast('บันทึกการตั้งค่าแล้ว');
    });
  });

  view.querySelector('[data-logout]').addEventListener('click', (e) => busy(e.currentTarget, () => ctx.logout()));
}
