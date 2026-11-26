'use strict';

// הדף לא שומר שום דבר: הפריטים קיימים רק בזיכרון של הדף, ונמחקים בלחיצה על "מחיקה",
// כשסוגרים את הדף או כשעוברים לאפליקציה אחרת.

const $ = (s) => document.querySelector(s);
const kind = $('#kind');
const customWrap = $('#custom-wrap');
const customName = $('#custom-name');
const valueInput = $('#value-input');
const keyboardBtn = $('#toggle-keyboard');
const addBtn = $('#add-btn');
const cancelEditBtn = $('#cancel-edit');
const itemsBox = $('#items');
const listTitle = $('#list-title');
const error = $('#error');
const editScreen = $('#edit-screen');
const cardScreen = $('#card-screen');
const cardItems = $('#card-items');
const hideBtn = $('#toggle-hide');

const NAMES = { id: 'תעודת זהות', phone: 'טלפון', address: 'כתובת' };
const NUMERIC = { id: true, phone: true };

let items = [];          // [{ kind, name, value }]
let editingIndex = -1;
let valuesHidden = false;

function el(tag, attrs, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- מקלדת ----------
function setKeyboard(numeric) {
  valueInput.inputMode = numeric ? 'numeric' : 'text';
  keyboardBtn.textContent = numeric ? 'מקלדת אותיות' : 'מקלדת מספרים';
}
keyboardBtn.addEventListener('click', () => {
  setKeyboard(valueInput.inputMode !== 'numeric');
  // החלפת המקלדת נכנסת לתוקף רק אחרי שהשדה מאבד פוקוס ומקבל אותו שוב
  valueInput.blur();
  setTimeout(() => valueInput.focus(), 50);
});

// ---------- טופס ----------
function applyKind(focus) {
  const k = kind.value;
  customWrap.hidden = k !== 'other';
  setKeyboard(!!NUMERIC[k]);
  if (!focus) return;
  if (k === 'other' && !customName.value.trim()) customName.focus();
  else valueInput.focus();
}

kind.addEventListener('change', () => { error.textContent = ''; applyKind(true); });
customName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); valueInput.focus(); } });
valueInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (addOrUpdate()) { valueInput.blur(); kind.focus(); }
});
[customName, valueInput].forEach((i) => i.addEventListener('input', () => { error.textContent = ''; }));

function resetForm() {
  kind.value = '';
  customName.value = '';
  valueInput.value = '';
  customWrap.hidden = true;
  setKeyboard(false);
  editingIndex = -1;
  addBtn.textContent = 'הוספה';
  cancelEditBtn.hidden = true;
}

function formIsEmpty() {
  return !kind.value && !customName.value.trim() && !valueInput.value.trim();
}

// מחזיר את הפריט מהטופס, או null עם הודעת שגיאה
function readForm() {
  const k = kind.value;
  if (!k) { error.textContent = 'צריך לבחור שם לפריט.'; kind.focus(); return null; }
  const name = k === 'other' ? customName.value.trim() : NAMES[k];
  if (!name) { error.textContent = 'צריך להקליד שם לפריט.'; customName.focus(); return null; }
  const value = valueInput.value.trim();
  if (!value) { error.textContent = 'צריך להקליד ערך.'; valueInput.focus(); return null; }
  return { kind: k, name, value };
}

function addOrUpdate() {
  const item = readForm();
  if (!item) return false;
  if (editingIndex >= 0) items[editingIndex] = item;
  else items.push(item);
  error.textContent = '';
  resetForm();
  renderList();
  return true;
}
addBtn.addEventListener('click', () => { if (addOrUpdate()) kind.focus(); });
cancelEditBtn.addEventListener('click', () => { resetForm(); renderList(); error.textContent = ''; });

function startEdit(i) {
  const it = items[i];
  editingIndex = i;
  kind.value = it.kind;
  customName.value = it.kind === 'other' ? it.name : '';
  valueInput.value = it.value;
  applyKind(false);
  addBtn.textContent = 'שמירת שינוי';
  cancelEditBtn.hidden = false;
  error.textContent = '';
  renderList();
  window.scrollTo(0, 0);
  valueInput.focus();
}

function removeItem(i) {
  items.splice(i, 1);
  if (editingIndex === i) resetForm();
  else if (editingIndex > i) editingIndex -= 1;
  renderList();
}

function renderList() {
  itemsBox.replaceChildren();
  listTitle.hidden = items.length === 0;
  items.forEach((it, i) => {
    const row = el('div', { class: 'item' + (i === editingIndex ? ' editing' : '') });
    const text = el('div', { class: 'text' });
    text.append(el('div', { class: 'name' }, it.name), el('div', { class: 'value', dir: 'auto' }, it.value));
    const edit = el('button', { type: 'button', class: 'secondary' }, 'עריכה');
    edit.addEventListener('click', () => startEdit(i));
    const del = el('button', { type: 'button', class: 'danger' }, 'הסרה');
    del.addEventListener('click', () => removeItem(i));
    row.append(text, edit, del);
    itemsBox.append(row);
  });
}

// ---------- הכרטיס ----------
function renderCard() {
  cardItems.replaceChildren();
  for (const it of items) {
    const box = el('div', { class: 'c-item' });
    const shown = valuesHidden ? '•'.repeat([...it.value].length) : it.value;
    box.append(el('div', { class: 'c-label' }, it.name), el('div', { class: 'c-value', dir: 'auto' }, shown));
    cardItems.append(box);
  }
  hideBtn.textContent = valuesHidden ? 'הצגה' : 'הסתרה';
  fitCard();
}

// מגדיל את הטקסט כמה שאפשר בלי לחרוג מהכרטיס
function fitCard() {
  if (cardScreen.hidden) return;
  const h = cardItems.clientHeight;
  const w = cardItems.clientWidth;
  let size = Math.max(14, Math.min(h / (items.length * 2), w / 7, 110));
  cardItems.style.setProperty('--v', size + 'px');
  for (let i = 0; i < 80 && size > 12 && (cardItems.scrollHeight > h + 1 || cardItems.scrollWidth > w + 1); i++) {
    size *= 0.94;
    cardItems.style.setProperty('--v', size + 'px');
  }
}

$('#show-card').addEventListener('click', () => {
  // אם יש בטופס פריט מלא שעוד לא נוסף, מוסיפים אותו קודם
  if (!formIsEmpty() && !addOrUpdate()) return;
  if (!items.length) { error.textContent = 'צריך להוסיף לפחות פריט אחד.'; return; }
  error.textContent = '';
  if (document.activeElement) document.activeElement.blur();
  valuesHidden = false;
  editScreen.hidden = true;
  cardScreen.hidden = false;
  requestAnimationFrame(renderCard);
});

hideBtn.addEventListener('click', () => { valuesHidden = !valuesHidden; renderCard(); });

$('#back-btn').addEventListener('click', () => {
  cardScreen.hidden = true;
  cardItems.replaceChildren();
  editScreen.hidden = false;
  renderList();
});

window.addEventListener('resize', () => requestAnimationFrame(fitCard));

// ---------- מחיקה ----------
function clearAll() {
  items = [];
  valuesHidden = false;
  resetForm();
  renderList();
  cardItems.replaceChildren();
  cardScreen.hidden = true;
  editScreen.hidden = false;
  error.textContent = '';
}
$('#clear-btn').addEventListener('click', clearAll);
$('#card-clear').addEventListener('click', clearAll);

document.addEventListener('visibilitychange', () => { if (document.hidden) clearAll(); });
window.addEventListener('pagehide', clearAll);
// דפדפנים מסוימים משחזרים דף מהזיכרון כשחוזרים אליו; מוודאים שהוא נפתח ריק
window.addEventListener('pageshow', clearAll);

// ---------- הפעלה ----------
// ניקוי נתונים שהגרסה הראשונה (כרטיס קבוע עם קוד) אולי שמרה
try { localStorage.removeItem('pidc.v1'); localStorage.removeItem('pidc.fails'); } catch { /* אין גישה לאחסון */ }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
