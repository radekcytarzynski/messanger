'use strict';

const POLL_MS = 2500;          // gdy karta jest widoczna
const POLL_HIDDEN_MS = 5000;   // gdy karta jest w tle

const $ = (id) => document.getElementById(id);
const list = $('list');
const text = $('text');
const ttl = $('ttl');
const sendBtn = $('send');
const statusEl = $('status');
const errorEl = $('error');

const items = new Map(); // id -> { msg, el, left }
let offset = 0;          // różnica zegara serwera i przeglądarki (ms)
let loaded = false;
let unread = 0;
const baseTitle = document.title;

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

// ---------- API ----------

async function api(action, body) {
  const opts = { cache: 'no-store', headers: { 'X-Requested-With': 'messenger' } };
  if (body !== undefined) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch('api.php?action=' + action, opts);
  if (r.status === 401) {
    location.reload();
    throw new Error('unauthorized');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Błąd serwera (' + r.status + ')');
  return data;
}

// ---------- Odpytywanie serwera ----------

let timer = null;
let inflight = false;

async function poll() {
  clearTimeout(timer);
  if (inflight) return;
  inflight = true;
  try {
    const d = await api('list');
    offset = d.now * 1000 - Date.now();
    sync(d.messages);
    setStatus(true);
  } catch {
    setStatus(false);
  } finally {
    inflight = false;
    timer = setTimeout(poll, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
  }
}

function setStatus(ok) {
  statusEl.textContent = ok ? 'online' : 'brak połączenia';
  statusEl.classList.toggle('ok', ok);
}

function sync(messages) {
  const ids = new Set(messages.map((m) => m.id));
  for (const id of [...items.keys()]) if (!ids.has(id)) removeItem(id);
  for (const m of messages) if (!items.has(m.id)) addItem(m, loaded);
  loaded = true;
  updateEmpty();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    unread = 0;
    document.title = baseTitle;
    poll();
  }
});

// ---------- Renderowanie ----------

function linkify(container, str) {
  let last = 0;
  for (const m of str.matchAll(URL_RE)) {
    let url = m[0];
    // Kropka/przecinek/nawias na końcu zwykle nie należy do linku.
    while (/[.,;:!?'")\]]$/.test(url) && !(url.endsWith(')') && url.includes('('))) url = url.slice(0, -1);
    container.append(str.slice(last, m.index));
    const a = document.createElement('a');
    a.href = url;
    a.textContent = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    container.append(a);
    last = m.index + url.length;
  }
  container.append(str.slice(last));
}

function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function addItem(msg, isNew) {
  const li = document.createElement('li');
  li.className = 'msg' + (isNew ? ' new' : '');

  const body = document.createElement('div');
  body.className = 'body';
  linkify(body, msg.text);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const time = document.createElement('span');
  time.textContent = new Date(msg.created * 1000 - offset).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const left = document.createElement('span');
  left.className = 'left';
  const spacer = document.createElement('span');
  spacer.className = 'spacer';

  const copyBtn = button('Kopiuj', 'ghost', async () => {
    const ok = await copyText(msg.text);
    copyBtn.textContent = ok ? 'Skopiowano ✓' : 'Nie udało się';
    setTimeout(() => (copyBtn.textContent = 'Kopiuj'), 1500);
  });
  const delBtn = button('Usuń', 'ghost danger', async () => {
    removeItem(msg.id);
    updateEmpty();
    try {
      await api('delete', { id: msg.id });
    } catch (e) {
      showError(e.message);
    }
  });

  meta.append(time, left, spacer, copyBtn, delBtn);
  li.append(body, meta);
  list.prepend(li);

  const item = { msg, el: li, left };
  items.set(msg.id, item);
  updateCountdown(item);

  if (isNew && document.hidden) {
    unread++;
    document.title = '(' + unread + ') ' + baseTitle;
  }
}

function removeItem(id) {
  const item = items.get(id);
  if (!item) return;
  item.el.remove();
  items.delete(id);
}

function updateEmpty() {
  $('empty').hidden = items.size > 0;
}

function updateCountdown(item) {
  const ms = item.msg.expires * 1000 - (Date.now() + offset);
  if (ms <= 0) {
    removeItem(item.msg.id);
    updateEmpty();
    return;
  }
  const s = Math.ceil(ms / 1000);
  item.left.textContent = 'znika za ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  item.el.classList.toggle('soon', s <= 30);
}

setInterval(() => {
  for (const item of [...items.values()]) updateCountdown(item);
}, 1000);

// ---------- Schowek ----------

async function copyText(str) {
  try {
    await navigator.clipboard.writeText(str);
    return true;
  } catch {
    // Zapasowo dla stron bez HTTPS.
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    return ok;
  }
}

// Ctrl+V gdziekolwiek na stronie wkleja do pola wiadomości.
document.addEventListener('paste', (e) => {
  if (e.target === text) return;
  const pasted = e.clipboardData && e.clipboardData.getData('text');
  if (!pasted) return;
  e.preventDefault();
  text.value += pasted;
  text.focus();
});

// ---------- Wysyłanie ----------

let errorTimer = null;
function showError(msg) {
  errorEl.textContent = msg;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => (errorEl.textContent = ''), 5000);
}

async function send() {
  const value = text.value;
  if (!value.trim() || sendBtn.disabled) return;
  sendBtn.disabled = true;
  try {
    await api('send', { text: value, ttl: Number(ttl.value) });
    text.value = '';
    errorEl.textContent = '';
    poll();
  } catch (e) {
    showError(e.message);
  } finally {
    sendBtn.disabled = false;
    text.focus();
  }
}

$('compose').addEventListener('submit', (e) => {
  e.preventDefault();
  send();
});

text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});

try {
  const saved = localStorage.getItem('ttl');
  if (saved && [...ttl.options].some((o) => o.value === saved)) ttl.value = saved;
} catch {}
ttl.addEventListener('change', () => {
  try {
    localStorage.setItem('ttl', ttl.value);
  } catch {}
});

$('logout').addEventListener('click', async () => {
  try {
    await api('logout', {});
  } catch {}
  location.reload();
});

poll();
