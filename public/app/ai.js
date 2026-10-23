// ผู้ช่วย AI แบบแชท (drawer ด้านขวา/ล่าง)
import { api } from './api.js';
import { esc, icon } from './ui.js';

const history = []; // [{role, content}] เก็บล่าสุดไม่เกิน 10
let drawer = null;

/** แสดงคำตอบ AI: escape ก่อน แล้วแปลง **ตัวหนา** และหัวข้อ * / - เป็นจุด */
function renderReply(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1$2');
}

function addMsg(list, role, text) {
  const m = document.createElement('div');
  m.className = `ai-msg ai-${role}`;
  m.textContent = text;
  list.appendChild(m);
  list.scrollTop = list.scrollHeight;
  return m;
}

export function openAiDrawer() {
  if (drawer) { drawer.classList.add('open'); drawer.querySelector('textarea').focus(); return; }
  drawer = document.createElement('div');
  drawer.className = 'ai-drawer open';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', 'ผู้ช่วย AI');
  drawer.innerHTML = `
    <div class="ai-head">${icon('sparkle')}<h2>ผู้ช่วย AI</h2><button class="icon-btn" data-close aria-label="ปิด">${icon('close')}</button></div>
    <div class="ai-list" aria-live="polite">
      <div class="ai-msg ai-assistant">สวัสดีค่ะ ถามเรื่องร้านได้เลย เช่น "วันนี้ขายได้เท่าไร" "ของอะไรใกล้หมด" หรือ "ช่วยเขียนข้อความทวงโอนให้หน่อย"</div>
    </div>
    <form class="ai-form"><textarea rows="2" maxlength="2000" placeholder="พิมพ์คำถาม…" aria-label="ข้อความถึงผู้ช่วย"></textarea><button class="btn btn-primary icon-only" type="submit" aria-label="ส่ง">${icon('send')}</button></form>`;
  document.body.appendChild(drawer);
  const list = drawer.querySelector('.ai-list');
  const form = drawer.querySelector('form');
  const ta = form.querySelector('textarea');
  const btn = form.querySelector('button');
  drawer.querySelector('[data-close]').addEventListener('click', () => drawer.classList.remove('open'));
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = ta.value.trim();
    if (!message || btn.disabled) return;
    ta.value = '';
    addMsg(list, 'user', message);
    const wait = addMsg(list, 'assistant', 'กำลังคิด…');
    wait.classList.add('is-wait');
    btn.disabled = true;
    try {
      const r = await api('/api/ai/chat', { body: { message, history: history.slice(-10) } });
      wait.classList.remove('is-wait');
      wait.innerHTML = renderReply(r.reply || '-');
      history.push({ role: 'user', content: message }, { role: 'assistant', content: r.reply || '' });
      while (history.length > 10) history.shift();
    } catch (err) {
      wait.classList.remove('is-wait');
      wait.classList.add('ai-error');
      wait.textContent = err.code === 'AI_DISABLED' ? 'ผู้ช่วย AI ยังไม่เปิดใช้งาน' : err.message;
    } finally {
      btn.disabled = false;
      list.scrollTop = list.scrollHeight;
    }
  });
  ta.focus();
}
