'use strict';

// ---------- הגדרות ----------
const STORE = 'pidc.v1';        // הנתונים המוצפנים
const FAILS = 'pidc.fails';     // מונה ניסיונות שגויים
const ITER = 600000;            // סבבי PBKDF2
const MIN_PIN = 6;
const IDLE_MS = 5 * 60 * 1000;  // נעילה אחרי 5 דקות בלי פעולה

const $ = (s) => document.querySelector(s);
const enc = new TextEncoder();
const dec = new TextDecoder();
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64 = (buf) => { let s = ''; for (const x of new Uint8Array(buf)) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const clone = (o) => JSON.parse(JSON.stringify(o));

// session קיים רק כשהכרטיס פתוח: { dekRaw, dek, data }
let session = null;
let draft = null;
let pinMode = 'setup';
let busyAuth = false;
let idleTimer = null;

// ---------- אחסון ----------
function load() { try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; } }
function save(st) { localStorage.setItem(STORE, JSON.stringify(st)); }
function requestPersist() { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); }

function getFails() { try { return JSON.parse(localStorage.getItem(FAILS)) || { n: 0, until: 0 }; } catch { return { n: 0, until: 0 }; } }
function addFail() {
  const f = getFails();
  f.n += 1;
  if (f.n >= 5) f.until = Date.now() + Math.min(3600e3, 30e3 * 2 ** (f.n - 5));
  localStorage.setItem(FAILS, JSON.stringify(f));
  return f;
}
function resetFails() { localStorage.removeItem(FAILS); }

// ---------- הצפנה ----------
async function kekFromPin(pin, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function kekFromPrf(prfOut) {
  const base = await crypto.subtle.importKey('raw', prfOut, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('pidc-bio-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const importDek = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

async function seal(key, bytes) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: b64(iv), ct: b64(ct) };
}
async function unseal(key, box) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct)));
}

// ---------- WebAuthn PRF (טביעת אצבע / זיהוי פנים) ----------
async function prfGet(credId, prfSalt) {
  const a = await navigator.credentials.get({ publicKey: {
    challenge: rand(32),
    allowCredentials: [{ type: 'public-key', id: credId }],
    userVerification: 'required',
    timeout: 60000,
    extensions: { prf: { eval: { first: prfSalt } } },
  } });
  const r = a.getClientExtensionResults();
  if (!r.prf || !r.prf.results || !r.prf.results.first) throw new Error('noprf');
  return r.prf.results.first;
}

async function enrollBio(prfSalt) {
  if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('noprf');
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: rand(32),
    rp: { name: 'כרטיס פרטים' },
    user: { id: rand(16), name: 'card', displayName: 'כרטיס פרטים' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
    timeout: 60000,
    extensions: { prf: { eval: { first: prfSalt } } },
  } });
  const ext = cred.getClientExtensionResults();
  if (!ext.prf || ext.prf.enabled === false) throw new Error('noprf');
  const out = (ext.prf.results && ext.prf.results.first) || await prfGet(cred.rawId, prfSalt);
  return { credId: cred.rawId, out };
}

function bioErrorText(e) {
  if (e && e.name === 'NotAllowedError') return 'הפעולה בוטלה או שעבר הזמן.';
  if (e && e.message === 'noprf') return 'הטלפון או הדפדפן לא תומכים בפתיחה ביומטרית באפליקציה הזו. אפשר להמשיך עם הקוד.';
  return 'הפתיחה הביומטרית נכשלה. אפשר לפתוח בקוד.';
}

// ---------- ממשק ----------
function show(name) {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== 'screen-' + name; });
  window.scrollTo(0, 0);
}

function el(tag, attrs, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function mask(value, showLast) {
  const chars = [...value];
  const n = Math.min(showLast || 0, chars.length);
  return '•'.repeat(chars.length - n) + chars.slice(chars.length - n).join('');
}

function bump() {
  clearTimeout(idleTimer);
  if (session) idleTimer = setTimeout(lock, IDLE_MS);
}

// ---------- מסך הקוד (יצירה והחלפה) ----------
function openPinScreen(mode) {
  pinMode = mode;
  $('#pin-new').value = '';
  $('#pin-confirm').value = '';
  $('#pin-error').textContent = '';
  if (mode === 'setup') {
    $('#pin-title').textContent = 'כרטיס פרטים';
    $('#pin-sub').textContent = 'בוחרים קוד שפותח את הכרטיס. הפרטים נשמרים רק בטלפון הזה, מוצפנים בקוד. אם שוכחים את הקוד, אי אפשר לשחזר אותם.';
    $('#pin-cancel').hidden = true;
  } else {
    $('#pin-title').textContent = 'החלפת קוד';
    $('#pin-sub').textContent = 'הקוד החדש יחליף את הקודם.';
    $('#pin-cancel').hidden = false;
  }
  show('pin');
}

$('#pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('#pin-new').value;
  const err = $('#pin-error');
  if (pin.length < MIN_PIN) { err.textContent = `הקוד צריך להיות באורך ${MIN_PIN} תווים לפחות.`; return; }
  if (pin !== $('#pin-confirm').value) { err.textContent = 'שני הקודים לא זהים.'; return; }
  const btn = $('#pin-submit');
  btn.disabled = true;
  err.textContent = '';
  try {
    if (pinMode === 'setup') await createVault(pin);
    else await changePin(pin);
  } catch {
    err.textContent = 'השמירה נכשלה.';
  } finally {
    btn.disabled = false;
    $('#pin-new').value = '';
    $('#pin-confirm').value = '';
  }
});
$('#pin-cancel').addEventListener('click', () => openSettings());

async function createVault(pin) {
  const dekRaw = rand(32);
  const salt = rand(16);
  const kek = await kekFromPin(pin, salt, ITER);
  const dek = await importDek(dekRaw);
  const data = { fields: [
    { label: 'תעודת זהות', value: '', showLast: 0 },
    { label: 'טלפון', value: '', showLast: 0 },
  ], notes: '' };
  const st = {
    v: 1,
    salt: b64(salt),
    iter: ITER,
    wrapPin: await seal(kek, dekRaw),
    bio: null,
    data: await seal(dek, enc.encode(JSON.stringify(data))),
  };
  save(st);
  resetFails();
  session = { dekRaw, dek, data };
  requestPersist();
  openEdit();
}

async function changePin(pin) {
  const st = load();
  const salt = rand(16);
  const kek = await kekFromPin(pin, salt, ITER);
  st.salt = b64(salt);
  st.iter = ITER;
  st.wrapPin = await seal(kek, session.dekRaw);
  save(st);
  toast('הקוד הוחלף.');
  openSettings();
}

// ---------- נעילה ופתיחה ----------
function openLock() {
  const st = load();
  $('#lock-pin').value = '';
  $('#lock-error').textContent = '';
  $('#bio-unlock').hidden = !(st && st.bio);
  show('lock');
}

function lock() {
  if (!session) return;
  session.dekRaw.fill(0);
  session = null;
  draft = null;
  clearTimeout(idleTimer);
  closeOverlay();
  $('#fields').replaceChildren();
  $('#editors').replaceChildren();
  $('#notes-input').value = '';
  openLock();
}

async function finishUnlock(st, dekRaw) {
  const dek = await importDek(dekRaw);
  const data = JSON.parse(dec.decode(await unseal(dek, st.data)));
  session = { dekRaw, dek, data };
  resetFails();
  requestPersist();
  renderCard();
}

$('#lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#lock-error');
  const f = getFails();
  if (f.until > Date.now()) {
    err.textContent = `יותר מדי ניסיונות. אפשר לנסות שוב בעוד ${Math.ceil((f.until - Date.now()) / 1000)} שניות.`;
    return;
  }
  const btn = $('#lock-submit');
  btn.disabled = true;
  err.textContent = 'פותח...';
  const pin = $('#lock-pin').value;
  $('#lock-pin').value = '';
  const st = load();
  let dekRaw = null;
  try {
    const kek = await kekFromPin(pin, unb64(st.salt), st.iter);
    dekRaw = await unseal(kek, st.wrapPin);
  } catch { /* קוד שגוי */ }
  btn.disabled = false;
  if (!dekRaw) {
    const f2 = addFail();
    err.textContent = f2.until > Date.now()
      ? `קוד שגוי. אפשר לנסות שוב בעוד ${Math.ceil((f2.until - Date.now()) / 1000)} שניות.`
      : 'קוד שגוי.';
    return;
  }
  err.textContent = '';
  await finishUnlock(st, dekRaw);
});

$('#bio-unlock').addEventListener('click', async () => {
  const st = load();
  const err = $('#lock-error');
  err.textContent = '';
  busyAuth = true;
  try {
    const out = await prfGet(unb64(st.bio.credId), unb64(st.bio.prfSalt));
    const kek = await kekFromPrf(out);
    const dekRaw = await unseal(kek, st.bio.wrap);
    await finishUnlock(st, dekRaw);
  } catch (e) {
    err.textContent = bioErrorText(e);
  } finally {
    busyAuth = false;
  }
});

$('#forgot').addEventListener('click', () => wipe());
$('#lock-now').addEventListener('click', () => lock());

// ---------- המסך הראשי ----------
function renderCard() {
  const list = $('#fields');
  list.replaceChildren();
  const fields = session.data.fields.filter((f) => f.value);
  if (!fields.length && !session.data.notes) {
    list.append(el('p', { class: 'empty' }, 'עדיין אין פרטים. לוחצים על "עריכה" כדי להוסיף.'));
  }
  for (const f of fields) {
    const b = el('button', { type: 'button', class: 'field-card' });
    b.append(el('div', { class: 'label' }, f.label || 'פרט'), el('div', { class: 'value', dir: 'ltr' }, mask(f.value, f.showLast)));
    b.addEventListener('click', () => openOverlay(f.label || 'פרט', f.value, mask(f.value, f.showLast), false));
    list.append(b);
  }
  if (session.data.notes) {
    const b = el('button', { type: 'button', class: 'field-card' });
    b.append(el('div', { class: 'label' }, 'פתק'), el('div', { class: 'value' }, '••••••'));
    b.addEventListener('click', () => openOverlay('פתק', session.data.notes, '••••••', true));
    list.append(b);
  }
  show('card');
  bump();
}

// ---------- הצגה לפקיד ----------
const overlayState = { value: '', hiddenText: '' };

function openOverlay(label, value, hiddenText, isText) {
  overlayState.value = value;
  overlayState.hiddenText = hiddenText;
  $('#o-label').textContent = label;
  const v = $('#o-value');
  v.classList.toggle('text', isText);
  v.dir = isText ? 'auto' : 'ltr';
  hideValue();
  $('#overlay').hidden = false;
}
function closeOverlay() {
  overlayState.value = '';
  overlayState.hiddenText = '';
  $('#o-value').textContent = '';
  $('#o-area').classList.remove('revealed');
  $('#overlay').hidden = true;
}
function revealValue(e) {
  if (e) e.preventDefault();
  $('#o-value').textContent = overlayState.value;
  $('#o-area').classList.add('revealed');
}
function hideValue() {
  $('#o-value').textContent = overlayState.hiddenText;
  $('#o-area').classList.remove('revealed');
}

const area = $('#o-area');
area.addEventListener('pointerdown', revealValue);
['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach((t) => area.addEventListener(t, hideValue));
area.addEventListener('contextmenu', (e) => e.preventDefault());
area.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') revealValue(e); });
area.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') hideValue(); });
$('#o-close').addEventListener('click', closeOverlay);

// ---------- עריכה ----------
function openEdit() {
  draft = clone(session.data);
  if (!draft.fields.length) draft.fields.push({ label: '', value: '', showLast: 0 });
  renderEditors();
  $('#notes-input').value = draft.notes || '';
  show('edit');
  bump();
}

function renderEditors() {
  const box = $('#editors');
  box.replaceChildren();
  draft.fields.forEach((f, i) => {
    const wrap = el('div', { class: 'editor' });

    const labelId = `f-label-${i}`;
    const valueId = `f-value-${i}`;
    const showId = `f-show-${i}`;

    const labelInput = el('input', { id: labelId, type: 'text', autocomplete: 'off', placeholder: 'למשל: תעודת זהות' });
    labelInput.value = f.label;
    labelInput.addEventListener('input', () => { f.label = labelInput.value; });

    const valueInput = el('input', { id: valueId, type: 'text', dir: 'ltr', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    valueInput.value = f.value;
    valueInput.addEventListener('input', () => { f.value = valueInput.value; });

    const sel = el('select', { id: showId, 'aria-label': 'כמה ספרות להציג' });
    [[0, 'הכול מוסתר'], [2, '2 אחרונות גלויות'], [3, '3 אחרונות גלויות'], [4, '4 אחרונות גלויות']].forEach(([v, t]) => {
      const o = el('option', { value: String(v) }, t);
      if ((f.showLast || 0) === v) o.selected = true;
      sel.append(o);
    });
    sel.addEventListener('change', () => { f.showLast = Number(sel.value); });

    const del = el('button', { type: 'button', class: 'danger' }, 'הסרה');
    del.addEventListener('click', () => { draft.fields.splice(i, 1); renderEditors(); });

    const row = el('div', { class: 'row' });
    row.append(sel, del);

    wrap.append(
      el('label', { for: labelId }, 'שם הפרט'), labelInput,
      el('label', { for: valueId }, 'הערך'), valueInput,
      row);
    box.append(wrap);
  });
}

$('#add-field').addEventListener('click', () => {
  draft.fields.push({ label: '', value: '', showLast: 0 });
  renderEditors();
  const inputs = document.querySelectorAll('#editors input[id^="f-label-"]');
  inputs[inputs.length - 1].focus();
});

$('#save-edit').addEventListener('click', async () => {
  draft.notes = $('#notes-input').value.trim();
  draft.fields = draft.fields
    .map((f) => ({ label: f.label.trim(), value: f.value.trim(), showLast: f.showLast || 0 }))
    .filter((f) => f.label || f.value);
  const st = load();
  st.data = await seal(session.dek, enc.encode(JSON.stringify(draft)));
  save(st);
  session.data = draft;
  draft = null;
  toast('נשמר.');
  renderCard();
});
$('#cancel-edit').addEventListener('click', () => { draft = null; renderCard(); });
$('#edit-open').addEventListener('click', () => openEdit());

// ---------- הגדרות ----------
function openSettings() {
  const st = load();
  const supported = !!(window.PublicKeyCredential && navigator.credentials);
  const status = $('#bio-status');
  const btn = $('#bio-toggle');
  if (st.bio) {
    status.textContent = 'פעילה. אפשר לפתוח את הכרטיס גם בטביעת אצבע או בזיהוי פנים.';
    btn.textContent = 'ביטול הפתיחה הביומטרית';
    btn.className = 'secondary wide';
    btn.hidden = false;
  } else if (supported) {
    status.textContent = 'לא פעילה. הקוד ימשיך לעבוד גם אחרי ההפעלה.';
    btn.textContent = 'הפעלת פתיחה ביומטרית';
    btn.className = 'wide';
    btn.hidden = false;
  } else {
    status.textContent = 'הדפדפן הזה לא תומך בפתיחה ביומטרית.';
    btn.hidden = true;
  }
  show('settings');
  bump();
}

$('#bio-toggle').addEventListener('click', async () => {
  const st = load();
  if (st.bio) {
    st.bio = null;
    save(st);
    toast('הפתיחה הביומטרית בוטלה.');
    openSettings();
    return;
  }
  const btn = $('#bio-toggle');
  btn.disabled = true;
  busyAuth = true;
  try {
    const prfSalt = rand(32);
    const { credId, out } = await enrollBio(prfSalt);
    const kek = await kekFromPrf(out);
    const st2 = load();
    st2.bio = { credId: b64(credId), prfSalt: b64(prfSalt), wrap: await seal(kek, session.dekRaw) };
    save(st2);
    toast('הפתיחה הביומטרית הופעלה.');
  } catch (e) {
    toast(bioErrorText(e));
  } finally {
    busyAuth = false;
    btn.disabled = false;
    if (session) openSettings();
  }
});

$('#pin-change').addEventListener('click', () => openPinScreen('change'));
$('#wipe').addEventListener('click', () => wipe());
$('#settings-open').addEventListener('click', () => openSettings());
$('#settings-back').addEventListener('click', () => renderCard());

function wipe() {
  if (!confirm('למחוק את כל הפרטים מהטלפון הזה? אי אפשר לשחזר אותם.')) return;
  localStorage.removeItem(STORE);
  resetFails();
  if (session) session.dekRaw.fill(0);
  session = null;
  draft = null;
  closeOverlay();
  $('#fields').replaceChildren();
  $('#editors').replaceChildren();
  openPinScreen('setup');
}

// ---------- נעילה אוטומטית ----------
document.addEventListener('visibilitychange', () => { if (document.hidden && !busyAuth) lock(); });
window.addEventListener('pagehide', () => { if (!busyAuth) lock(); });
['pointerdown', 'keydown', 'input'].forEach((t) => document.addEventListener(t, bump, { passive: true }));

// ---------- הפעלה ----------
function init() {
  if (!window.crypto || !crypto.subtle) {
    $('#fatal-text').textContent = 'הדפדפן לא מאפשר הצפנה בכתובת הזו. צריך לפתוח את האפליקציה בכתובת שמתחילה ב-https.';
    show('fatal');
    return;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (load()) openLock(); else openPinScreen('setup');
}

init();
