'use strict';

// הדף לא שומר שום דבר: הפרט קיים רק בשדה ההקלדה ובזיכרון של הדף, ונמחק בלחיצה על "מחיקה",
// כשסוגרים את הדף או כשעוברים לאפליקציה אחרת.

const $ = (s) => document.querySelector(s);
const titleInput = $('#title-input');
const valueInput = $('#value-input');
const showLast = $('#show-last');
const overlay = $('#overlay');
const area = $('#o-area');
const oValue = $('#o-value');
const oLabel = $('#o-label');
const error = $('#error');

let shownValue = '';
let hiddenValue = '';

function mask(value, n) {
  const chars = [...value];
  const keep = Math.min(n, chars.length);
  return '•'.repeat(chars.length - keep) + chars.slice(chars.length - keep).join('');
}

// ---------- מחיקה ----------
function clearAll() {
  titleInput.value = '';
  valueInput.value = '';
  shownValue = '';
  hiddenValue = '';
  oValue.textContent = '';
  oLabel.textContent = '';
  area.classList.remove('revealed');
  overlay.hidden = true;
  error.textContent = '';
  setVisible(false);
}

// ---------- שדה ההקלדה ----------
valueInput.addEventListener('input', () => { error.textContent = ''; });

function setVisible(on) {
  valueInput.type = on ? 'text' : 'password';
  $('#toggle-visible').textContent = on ? 'הסתרת ההקלדה' : 'הצגת ההקלדה';
}
$('#toggle-visible').addEventListener('click', () => {
  setVisible(valueInput.type === 'password');
  valueInput.focus();
});

$('#toggle-keyboard').addEventListener('click', () => {
  const numeric = valueInput.inputMode === 'numeric';
  valueInput.inputMode = numeric ? 'text' : 'numeric';
  $('#toggle-keyboard').textContent = numeric ? 'מקלדת מספרים' : 'מקלדת אותיות';
  // החלפת המקלדת נכנסת לתוקף רק אחרי שהשדה מאבד פוקוס ומקבל אותו שוב
  valueInput.blur();
  setTimeout(() => valueInput.focus(), 50);
});

// ---------- הצגה לפקיד ----------
function hideValue() {
  oValue.textContent = hiddenValue;
  area.classList.remove('revealed');
}
function revealValue(e) {
  if (e) e.preventDefault();
  oValue.textContent = shownValue;
  area.classList.add('revealed');
}

$('#show-btn').addEventListener('click', () => {
  const value = valueInput.value.trim();
  if (!value) {
    error.textContent = 'צריך להקליד פרט לפני ההצגה.';
    valueInput.focus();
    return;
  }
  error.textContent = '';
  valueInput.blur();
  shownValue = value;
  hiddenValue = mask(value, Number(showLast.value));
  oLabel.textContent = titleInput.value.trim();
  oValue.classList.toggle('long', [...value].length > 14);
  hideValue();
  overlay.hidden = false;
});

area.addEventListener('pointerdown', revealValue);
['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach((t) => area.addEventListener(t, hideValue));
area.addEventListener('contextmenu', (e) => e.preventDefault());
area.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') revealValue(e); });
area.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') hideValue(); });

$('#o-back').addEventListener('click', () => {
  overlay.hidden = true;
  oValue.textContent = '';
  area.classList.remove('revealed');
});
$('#o-clear').addEventListener('click', clearAll);
$('#clear-btn').addEventListener('click', clearAll);

// ---------- מחיקה אוטומטית ----------
document.addEventListener('visibilitychange', () => { if (document.hidden) clearAll(); });
window.addEventListener('pagehide', clearAll);
// דפדפנים מסוימים משחזרים דף מהזיכרון כשחוזרים אליו; מוודאים שהוא נפתח ריק
window.addEventListener('pageshow', clearAll);

// ---------- הפעלה ----------
// ניקוי נתונים שהגרסה הקודמת (כרטיס קבוע עם קוד) אולי שמרה
try { localStorage.removeItem('pidc.v1'); localStorage.removeItem('pidc.fails'); } catch { /* אין גישה לאחסון */ }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
