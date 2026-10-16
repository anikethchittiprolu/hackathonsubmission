// Shared helpers for participant + admin pages
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The same pages serve both portals: under /vibeathon they talk to the NoCode Vibeathon server
// (/vibeathon/api/…, /vibeathon/files/…), at the root to the hackathon server.
const BASE = /^\/vibeathon(\/|$)/.test(location.pathname) ? '/vibeathon' : '';

async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body instanceof FormData) o.body = opts.body;
  else if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const r = await fetch(BASE + path, o); let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
  return j;
}

// Server clock sync so countdowns are right even if the visitor's clock is off.
let skew = 0;
const syncClock = (serverNow) => { skew = serverNow - Date.now(); };
const nowMs = () => Date.now() + skew;

let TZ = 'Asia/Kolkata';
const setTZ = (z) => { TZ = z || TZ; };
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short' });
const fmtDT = (ms) => new Date(ms).toLocaleString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });

function parts(ms) {
  ms = Math.max(0, ms); const s = Math.floor(ms / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
}
const pad = (n) => String(n).padStart(2, '0');
const human = (ms) => { const p = parts(ms); return p.d ? `${p.d}d ${p.h}h` : p.h ? `${p.h}h ${p.m}m` : `${p.m}m ${p.s}s`; };
const fmtSize = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.ceil(b / 1e3) + ' KB');

// <input type=datetime-local> values are interpreted in the browser's local zone.
const toLocalInput = (ms) => { if (!ms) return ''; const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const fromLocalInput = (v) => (v ? new Date(v).getTime() : 0);

function flash(el, msg, kind = 'ok', ms = 4000) {
  el.innerHTML = msg ? `<div class="msg ${kind === 'ok' ? 'ok' : 'err'}">${esc(msg)}</div>` : '';
  if (msg && kind === 'ok') setTimeout(() => { if (el.firstChild) el.innerHTML = ''; }, ms);
}

// Fixed "VYOM" labels (e.g. the admin header) name the vibeathon on its pages; the participant
// header (#brand) already shows the event's own name.
if (BASE) {
  const relabel = () => { for (const b of $$('.brand:not(#brand)')) b.textContent = b.textContent.replace('VYOM', 'VIBEATHON'); document.title = document.title.replace('VYOM', 'VIBEATHON'); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', relabel); else relabel();
}
