// จุดเริ่มแอป: ตรวจการเข้าสู่ระบบ → ตั้งชื่อร้าน → โครงหน้าจอ + router แบบ hash
import { api, onUnauthorized, onNoShop } from './api.js';
import { esc, icon, toast, busy } from './ui.js';
import { openAiDrawer } from './ai.js';

const root = document.getElementById('root');
export const state = { user: null, shop: null };

const NAV = [
  ['#/', 'หน้าหลัก', 'home', /^\/$/],
  ['#/orders', 'ออเดอร์', 'orders', /^\/orders(?!\/new)/],
  ['#/products', 'สินค้า', 'box', /^\/products/],
  ['#/map', 'แผนที่', 'map', /^\/map/],
  ['#/settings', 'ตั้งค่า', 'settings', /^\/settings/],
];

const ROUTES = [
  [/^\/$/, () => import('./page-home.js')],
  [/^\/orders$/, () => import('./page-orders.js')],
  [/^\/orders\/new$/, () => import('./page-order-new.js')],
  [/^\/orders\/(\d+)$/, () => import('./page-order-detail.js')],
  [/^\/products$/, () => import('./page-products.js')],
  [/^\/products\/new$/, () => import('./page-product.js')],
  [/^\/products\/(\d+)$/, () => import('./page-product.js')],
  [/^\/map$/, () => import('./page-map.js')],
  [/^\/settings$/, () => import('./page-settings.js')],
];

// ---------- เริ่มต้น ----------
onUnauthorized(() => { state.user = null; state.shop = null; renderLogin(); });
onNoShop(() => renderSetupShop());

async function boot() {
  try {
    const me = await api('/api/me', { quiet401: true });
    state.user = me.user;
    state.shop = me.shop;
    if (!state.shop) return renderSetupShop();
    renderShell();
  } catch (e) {
    if (e.status === 401) return renderLogin();
    if (e.code === 'NO_SHOP') return renderSetupShop();
    root.innerHTML = `<div class="center-screen"><div class="card auth-card"><h1>เปิดแอปไม่สำเร็จ</h1><p class="muted">${esc(e.message)}</p><button class="btn btn-primary btn-block" data-retry>ลองใหม่</button></div></div>`;
    root.querySelector('[data-retry]').addEventListener('click', boot);
  }
}

// ---------- หน้าเข้าสู่ระบบ ----------
let gisLoaded = null;
function loadGis() {
  if (!gisLoaded) {
    gisLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { gisLoaded = null; reject(new Error('โหลดปุ่ม Google ไม่สำเร็จ')); };
      document.head.appendChild(s);
    });
  }
  return gisLoaded;
}

async function startDemo(btn) {
  await busy(btn, async () => {
    await api('/api/demo/start', { method: 'POST' });
    location.hash = '#/';
    await boot();
  });
}

function renderLogin() {
  document.body.classList.remove('has-shell');
  root.innerHTML = `<div class="center-screen">
    <div class="card auth-card">
      <img src="/logo.webp" alt="MySMEBox" width="72" height="72" class="auth-logo">
      <h1>เข้าสู่ร้านของคุณ</h1>
      <p class="muted">เปิดออเดอร์ ตัดสต๊อก รู้กำไร ในมือถือเครื่องเดียว</p>
      <div class="google-slot" data-google><div class="skeleton" style="height:44px"></div></div>
      <div class="or"><span>หรือ</span></div>
      <button class="btn btn-accent btn-block btn-lg" data-demo>ทดลองใช้ฟรี ไม่ต้องสมัคร</button>
      <p class="tiny muted">ร้านทดลองมีสินค้าตัวอย่างให้ลองกดเล่น ข้อมูลจะถูกลบอัตโนมัติ</p>
      <a class="tiny" href="/">← กลับหน้าแรก</a>
    </div></div>`;
  root.querySelector('[data-demo]').addEventListener('click', (e) => startDemo(e.currentTarget));
  const slot = root.querySelector('[data-google]');
  const disabled = (msg) => {
    slot.innerHTML = `<button class="btn btn-block btn-lg btn-disabled" disabled>เข้าสู่ระบบด้วย Google</button><p class="tiny muted">${esc(msg)}</p>`;
  };
  api('/api/config').then(async (cfg) => {
    if (!cfg.googleClientId) return disabled('ยังไม่เปิดใช้งานการเข้าสู่ระบบด้วย Google');
    await loadGis();
    slot.innerHTML = '<div class="gsi-btn"></div>';
    window.google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: async (resp) => {
        try {
          await api('/api/auth/google', { body: { credential: resp.credential } });
          location.hash = '#/';
          await boot();
        } catch (e) { toast(e.message, 'error'); }
      },
    });
    window.google.accounts.id.renderButton(slot.firstElementChild, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'th', width: 300 });
  }).catch((e) => disabled(e.message));
}

// ---------- ตั้งชื่อร้านครั้งแรก ----------
function renderSetupShop() {
  document.body.classList.remove('has-shell');
  root.innerHTML = `<div class="center-screen">
    <form class="card auth-card" data-form>
      <img src="/logo.webp" alt="" width="64" height="64" class="auth-logo">
      <h1>ตั้งชื่อร้านของคุณ</h1>
      <p class="muted">ชื่อนี้จะแสดงบนใบปะหน้าพัสดุ แก้ไขภายหลังได้</p>
      <label class="field"><span>ชื่อร้าน</span><input name="name" required maxlength="100" placeholder="เช่น ร้านแนนบิวตี้"></label>
      <button class="btn btn-primary btn-block btn-lg" type="submit">เริ่มใช้งาน</button>
    </form></div>`;
  const form = root.querySelector('[data-form]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) return;
    busy(form.querySelector('button'), async () => {
      const r = await api('/api/shop', { body: { name } });
      state.shop = r.shop;
      renderShell();
    });
  });
}

// ---------- โครงหน้าจอหลัก ----------
function demoHoursLeft() {
  const exp = state.user && state.user.expiresAt ? new Date(state.user.expiresAt).getTime() : 0;
  if (!exp) return null;
  return Math.max(0, Math.ceil((exp - Date.now()) / 3600000));
}

function renderShell() {
  document.body.classList.add('has-shell');
  const hrs = demoHoursLeft();
  root.innerHTML = `
    ${state.user && state.user.isDemo ? `<div class="demo-bar" role="note"><span>นี่คือร้านทดลอง ข้อมูลจะถูกลบใน ${hrs ?? '-'} ชม.</span><button class="btn btn-sm btn-light" data-real-login>เข้าสู่ระบบจริง</button></div>` : ''}
    <aside class="sidebar">
      <a class="brand" href="#/"><img src="/logo.webp" alt="" width="36" height="36"><span><b>MySMEBox</b><small data-shop-name>${esc(state.shop.name)}</small></span></a>
      <a class="btn btn-accent btn-block btn-lg side-new" href="#/orders/new">${icon('plus')} เปิดออเดอร์</a>
      <nav class="side-nav" aria-label="เมนูหลัก">${NAV.map(([h, t, ic]) => `<a href="${h}" data-nav="${h}">${icon(ic)}<span>${t}</span></a>`).join('')}</nav>
    </aside>
    <header class="topbar">
      <button class="icon-btn back-btn" data-back aria-label="ย้อนกลับ" hidden>${icon('back')}</button>
      <h1 class="page-title" data-title>MySMEBox</h1>
      <span class="top-shop" data-shop-name>${esc(state.shop.name)}</span>
    </header>
    <main id="view" class="view" tabindex="-1"></main>
    <a class="fab-new" href="#/orders/new" data-fab>${icon('plus')}<span>เปิดออเดอร์</span></a>
    <button class="fab-ai" data-ai aria-label="ผู้ช่วย AI">${icon('sparkle')}<span>ผู้ช่วย</span></button>
    <nav class="bottom-nav" aria-label="เมนูหลัก">${NAV.map(([h, t, ic]) => `<a href="${h}" data-nav="${h}">${icon(ic)}<span>${t}</span></a>`).join('')}</nav>`;
  const real = root.querySelector('[data-real-login]');
  real && real.addEventListener('click', () => busy(real, async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null; state.shop = null;
    renderLogin();
  }));
  root.querySelector('[data-ai]').addEventListener('click', () => openAiDrawer());
  root.querySelector('[data-back]').addEventListener('click', () => {
    if (history.length > 1) history.back(); else location.hash = backTarget || '#/';
  });
  route();
}

export function updateShopName() {
  document.querySelectorAll('[data-shop-name]').forEach((e) => { e.textContent = state.shop.name; });
}

// ---------- router ----------
let cleanup = null;
let backTarget = null;
let routeSeq = 0;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(query)) };
}

async function route() {
  if (!document.body.classList.contains('has-shell')) return;
  const view = document.getElementById('view');
  if (!view) return;
  const { path, query } = parseHash();
  const seq = ++routeSeq;
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const n = NAV.find((x) => x[0] === a.dataset.nav);
    a.classList.toggle('is-active', !!(n && n[3].test(path)));
    if (n && n[3].test(path)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // ปุ่มลอยแสดงเฉพาะหน้ารายการ ไม่ให้บังปุ่มบันทึกในหน้าฟอร์ม/แผนที่ (มือถือ)
  document.body.dataset.fabs = /^\/$|^\/orders$|^\/orders\/\d+$|^\/products$/.test(path) ? 'on' : 'off';
  const hit = ROUTES.find(([re]) => re.test(path));
  if (!hit) { location.hash = '#/'; return; }
  const params = path.match(hit[0]).slice(1);
  view.innerHTML = '';
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  try {
    const mod = await hit[1]();
    if (seq !== routeSeq) return;
    const ctx = {
      params, query, state,
      setTitle: (t, back) => setTitle(t, back),
      isActive: () => seq === routeSeq,
      updateShopName,
      logout: async () => { await api('/api/auth/logout', { method: 'POST' }); state.user = null; state.shop = null; location.hash = '#/'; renderLogin(); },
    };
    cleanup = await mod.render(view, ctx);
  } catch (e) {
    if (seq !== routeSeq) return;
    view.innerHTML = `<div class="empty error-state"><p>${esc(e.message || 'เปิดหน้านี้ไม่สำเร็จ')}</p></div>`;
  }
}

function setTitle(t, back) {
  const el = document.querySelector('[data-title]');
  if (el) el.textContent = t;
  document.title = `${t} — MySMEBox`;
  backTarget = back || null;
  const b = document.querySelector('[data-back]');
  if (b) b.hidden = !back;
}

window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => {
  const m = e.reason && e.reason.message;
  if (m && e.reason.status !== 401) toast(m, 'error');
});

boot();
