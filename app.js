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
const preview = $('preview');
const previewImg = $('preview-img');
const previewInfo = $('preview-info');

const IMAGE_LIMIT = Number($('compose').dataset.imageLimit) || 0;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

const items = new Map(); // id -> { msg, el, left, blob?, url? }
let offset = 0;          // różnica zegara serwera i przeglądarki (ms)
let loaded = false;
let unread = 0;
const baseTitle = document.title;

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const canShareFiles = (() => {
  try {
    return !!navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
})();

// ---------- API ----------

async function api(action, body) {
  const opts = { cache: 'no-store', headers: { 'X-Requested-With': 'messenger' } };
  if (body instanceof Blob) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = body.type || 'application/octet-stream';
    opts.body = body;
  } else if (body !== undefined) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch('api.php?action=' + action, opts);
  if (r.status === 401) {
    location.reload();
    throw new Error('unauthorized');
  }
  if (r.status === 413) throw new Error('Obraz jest za duży dla serwera.');
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

// Chwilowo zmienia napis na przycisku (np. „Skopiowano ✓”).
function flash(btn, label, ms = 1500) {
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  btn.textContent = label;
  clearTimeout(btn.flashTimer);
  btn.flashTimer = setTimeout(() => (btn.textContent = btn.dataset.label), ms);
}

function formatSize(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' kB';
}

function addItem(msg, isNew) {
  const li = document.createElement('li');
  li.className = 'msg' + (isNew ? ' new' : '');

  const body = document.createElement('div');
  body.className = 'body';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const time = document.createElement('span');
  time.textContent = new Date(msg.created * 1000 - offset).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const left = document.createElement('span');
  left.className = 'left';
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  meta.append(time, left, spacer);

  const item = { msg, el: li, left };

  if (msg.image) {
    body.classList.add('image');
    const img = document.createElement('img');
    img.alt = 'Obraz';
    img.width = msg.image.w;
    img.height = msg.image.h;
    body.append(img);
    loadImage(item, img);

    const size = document.createElement('span');
    size.textContent = msg.image.w + '×' + msg.image.h + ' · ' + formatSize(msg.image.size);
    time.after(size);

    const copyBtn = button('Kopiuj', 'ghost', async () => {
      const ok = await copyImage(item);
      if (ok) flash(copyBtn, 'Skopiowano ✓');
      else flash(copyBtn, canShareFiles ? 'Nie da się, użyj „Udostępnij”' : 'Nie udało się', 3000);
    });
    meta.append(copyBtn);

    if (canShareFiles) {
      const shareBtn = button('Udostępnij', 'ghost', async () => {
        try {
          await navigator.share({ files: [await imageFile(item)] });
        } catch (e) {
          if (e.name !== 'AbortError') flash(shareBtn, 'Nie udało się');
        }
      });
      meta.append(shareBtn);
    }

    const dlBtn = button('Pobierz', 'ghost', async () => {
      try {
        const file = await imageFile(item);
        const a = document.createElement('a');
        a.href = item.url;
        a.download = file.name;
        document.body.append(a);
        a.click();
        a.remove();
      } catch {
        flash(dlBtn, 'Nie udało się');
      }
    });
    meta.append(dlBtn);
  } else {
    linkify(body, msg.text);
    const copyBtn = button('Kopiuj', 'ghost', async () => {
      const ok = await copyText(msg.text);
      flash(copyBtn, ok ? 'Skopiowano ✓' : 'Nie udało się');
    });
    meta.append(copyBtn);
  }

  const delBtn = button('Usuń', 'ghost danger', async () => {
    removeItem(msg.id);
    updateEmpty();
    try {
      await api('delete', { id: msg.id });
    } catch (e) {
      showError(e.message);
    }
  });
  meta.append(delBtn);

  li.append(body, meta);
  list.prepend(li);

  items.set(msg.id, item);
  updateCountdown(item);

  if (isNew && document.hidden) {
    unread++;
    document.title = '(' + unread + ') ' + baseTitle;
  }
}

// Obraz pobieramy raz jako Blob: służy do wyświetlenia, kopiowania i udostępniania.
// Dzięki temu „Udostępnij” rusza od razu po kliknięciu, bez czekania na sieć (wymóg telefonów).
function loadImage(item, img) {
  item.blobPromise = fetch('api.php?action=image&id=' + item.msg.id, { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error('Nie udało się pobrać obrazu.');
      return r.blob();
    })
    .then((blob) => {
      item.blob = blob;
      if (items.has(item.msg.id)) {
        item.url = URL.createObjectURL(blob);
        img.src = item.url;
      }
      return blob;
    });
  item.blobPromise.catch(() => img.classList.add('broken'));
}

async function imageFile(item) {
  const blob = item.blob || (await item.blobPromise);
  const ext = IMAGE_TYPES[blob.type] || 'png';
  return new File([blob], 'obraz-' + item.msg.id + '.' + ext, { type: blob.type });
}

function removeItem(id) {
  const item = items.get(id);
  if (!item) return;
  item.el.remove();
  if (item.url) URL.revokeObjectURL(item.url);
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

// ---------- Obróbka obrazów ----------

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Nie udało się przetworzyć obrazu.'))), type, quality));
}

async function decode(blob) {
  try {
    return await createImageBitmap(blob);
  } catch {
    // Starsze Safari: przez <img>.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new Error('Nieobsługiwany format obrazu.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function drawToCanvas(src, scale, background) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * scale));
  c.height = Math.max(1, Math.round(src.height * scale));
  const ctx = c.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// Za duży lub nietypowy obraz (np. HEIC, BMP) przerabiamy na PNG/JPEG mieszczący się w limicie serwera.
async function prepareImage(blob) {
  const okType = blob.type in IMAGE_TYPES;
  if (okType && (!IMAGE_LIMIT || blob.size <= IMAGE_LIMIT)) return blob;
  const src = await decode(blob);
  if (!okType) {
    const png = await canvasBlob(drawToCanvas(src, 1), 'image/png');
    if (!IMAGE_LIMIT || png.size <= IMAGE_LIMIT) return png;
  }
  let scale = Math.min(1, 4096 / Math.max(src.width, src.height));
  for (let i = 0; i < 8; i++) {
    const jpg = await canvasBlob(drawToCanvas(src, scale, '#fff'), 'image/jpeg', 0.85);
    if (!IMAGE_LIMIT || jpg.size <= IMAGE_LIMIT) return jpg;
    scale *= 0.75;
  }
  throw new Error('Obraz jest za duży.');
}

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

// Schowek przeglądarek (Chrome, Safari) przyjmuje obrazy tylko jako PNG.
async function asPng(blob) {
  if (blob.type === 'image/png') return blob;
  return canvasBlob(drawToCanvas(await decode(blob), 1), 'image/png');
}

async function copyImage(item) {
  if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') return false;
  try {
    // Safari wymaga, by write() padło od razu w obsłudze kliknięcia, więc treść podajemy jako Promise.
    const png = (item.blob ? Promise.resolve(item.blob) : item.blobPromise).then(asPng);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}

// Wyciąga obraz ze schowka lub z przeciąganych plików.
function imageFrom(dt) {
  if (!dt) return null;
  for (const it of dt.items || []) {
    if (it.kind === 'file' && it.type.startsWith('image/')) return it.getAsFile();
  }
  for (const f of dt.files || []) if (f.type.startsWith('image/')) return f;
  return null;
}

document.addEventListener('paste', (e) => {
  const dt = e.clipboardData;
  const pasted = dt ? dt.getData('text') : '';
  // Komórki z Excela czy tekst z Worda trafiają do schowka także jako obrazek: wtedy wygrywa tekst.
  const img = pasted ? null : imageFrom(dt);
  if (img) {
    e.preventDefault();
    setPending(img);
    return;
  }
  // Ctrl+V gdziekolwiek na stronie wkleja tekst do pola wiadomości.
  if (e.target === text || !pasted) return;
  e.preventDefault();
  text.value += pasted;
  text.focus();
});

document.addEventListener('dragover', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
    e.preventDefault();
    document.body.classList.add('dragging');
  }
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dragging');
});
document.addEventListener('drop', (e) => {
  document.body.classList.remove('dragging');
  const img = imageFrom(e.dataTransfer);
  if (img) {
    e.preventDefault();
    setPending(img);
  }
});

$('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) setPending(f);
  e.target.value = '';
});

// ---------- Obraz czekający na wysłanie ----------

let pending = null; // { blob, url }

function setPending(blob) {
  if (!blob.type.startsWith('image/')) {
    showError('To nie jest obraz.');
    return;
  }
  clearPending();
  pending = { blob, url: URL.createObjectURL(blob) };
  previewImg.src = pending.url;
  previewInfo.textContent = formatSize(blob.size) + ' · Enter: wyślij';
  preview.hidden = false;
  text.focus();
}

function clearPending() {
  if (pending) URL.revokeObjectURL(pending.url);
  pending = null;
  preview.hidden = true;
  previewImg.removeAttribute('src');
}

$('preview-remove').addEventListener('click', () => {
  clearPending();
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
  const hasText = value.trim() !== '';
  if ((!hasText && !pending) || sendBtn.disabled) return;
  sendBtn.disabled = true;
  try {
    if (pending) {
      const blob = await prepareImage(pending.blob);
      await api('send_image&ttl=' + encodeURIComponent(ttl.value), blob);
      clearPending();
    }
    if (hasText) {
      await api('send', { text: value, ttl: Number(ttl.value) });
      text.value = '';
    }
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
