// VYOM Hackathon Submission Portal — zero-dependency Node server (Node 22+).
// Run: node server.js   (optionally ADMIN_PASSWORD=... PORT=3000 node server.js)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const PUBLIC = path.join(ROOT, 'public');
fs.mkdirSync(UPLOADS, { recursive: true });

const PORT = Number(process.env.PORT || 3000);
const BEHIND_PROXY = process.env.TRUST_PROXY === '1'; // set when running behind Caddy/nginx/Cloudflare/PaaS (HTTPS)
// A second portal (e.g. the NoCode Vibeathon at /vibeathon) runs as its own instance on the same domain:
// its own cookie names keep the two sign-ins apart, and its own team ID prefix (VIBE-001…).
const COOKIE_PREFIX = (process.env.COOKIE_PREFIX || '').replace(/[^A-Za-z0-9_]/g, '');
const SID = COOKIE_PREFIX + 'sid', ADMIN_SID = COOKIE_PREFIX + 'admin_sid';
const LOGIN_PREFIX = (process.env.LOGIN_PREFIX || 'VYOM').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'VYOM';
const MAX_UPLOAD = 25 * 1024 * 1024; // per request
const MAX_FILES_PER_TEAM = 8;
const ALLOWED_EXT = new Set(['.pdf', '.ppt', '.pptx', '.doc', '.docx', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov', '.md', '.txt']);

// ---------- admin password ----------
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const pwFile = path.join(DATA, 'admin_password.txt');
if (!ADMIN_PASSWORD) {
  if (fs.existsSync(pwFile)) ADMIN_PASSWORD = fs.readFileSync(pwFile, 'utf8').trim();
  else { ADMIN_PASSWORD = crypto.randomBytes(6).toString('base64url'); fs.writeFileSync(pwFile, ADMIN_PASSWORD, { mode: 0o600 }); }
}

// ---------- database ----------
const db = new DatabaseSync(path.join(DATA, 'vyom.db'));
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT DEFAULT '',
  pw_hash TEXT NOT NULL, members TEXT DEFAULT '[]', college TEXT DEFAULT '', created_at INTEGER NOT NULL,
  checked_in INTEGER DEFAULT 0, table_no TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS perk_links (id INTEGER PRIMARY KEY, perk TEXT NOT NULL, url TEXT NOT NULL, team_id INTEGER, claimed_at INTEGER);
CREATE TABLE IF NOT EXISTS perk_accounts (perk TEXT NOT NULL, login TEXT NOT NULL COLLATE NOCASE, username TEXT NOT NULL, password TEXT NOT NULL, claimed_at INTEGER, PRIMARY KEY (perk, login));
CREATE TABLE IF NOT EXISTS submissions (
  team_id INTEGER PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT DEFAULT '', track TEXT DEFAULT '', tagline TEXT DEFAULT '', description TEXT DEFAULT '',
  github TEXT DEFAULT '', demo TEXT DEFAULT '', video TEXT DEFAULT '', deck TEXT DEFAULT '', docs TEXT DEFAULT '', extra TEXT DEFAULT '',
  tech TEXT DEFAULT '', final INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', admin_note TEXT DEFAULT '',
  updated_at INTEGER, submitted_at INTEGER);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  orig_name TEXT NOT NULL, stored TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, kind TEXT NOT NULL, team_id INTEGER, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS schedule (id INTEGER PRIMARY KEY, start INTEGER NOT NULL, end INTEGER, title TEXT NOT NULL, location TEXT DEFAULT '', kind TEXT DEFAULT 'event');
CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY, body TEXT NOT NULL, pinned INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS scores (team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE, judge TEXT NOT NULL, scores TEXT NOT NULL, comment TEXT DEFAULT '', PRIMARY KEY (team_id, judge));
`);
db.exec('PRAGMA foreign_keys=ON');
for (const col of ["ps TEXT DEFAULT ''", 'ps_changes INTEGER DEFAULT 0', 'jury_visited INTEGER DEFAULT 0']) { try { db.exec('ALTER TABLE teams ADD COLUMN ' + col); } catch {} }
try { db.exec("ALTER TABLE files ADD COLUMN kind TEXT DEFAULT 'other'"); } catch {}

const H = 3600e3;
function getKV(k, fallback) { const r = db.prepare('SELECT v FROM kv WHERE k=?').get(k); return r ? JSON.parse(r.v) : fallback; }
function setKV(k, v) { db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, JSON.stringify(v)); }

const EVENT_DEFAULTS = {
  college: 'MVSR Engineering College', collegeNote: 'UGC Autonomous Institution · Approved by AICTE · Accredited by NBA & NAAC',
  subtitle: "Sangamam '26 · Department of CSE presents Shourya '26", venue: 'MVSR Engineering College, Hyderabad',
  tagline: 'Imagine it. Engineer it. Build it.', mission: ['Imagine it', 'Engineer it', 'Build it'], format: '24-hour hackathon',
  tracks: ['Space & Defense', 'Cybersecurity', 'Open Innovation'], prize: '₹4 Lakhs+ worth',
  highlights: ['Internship opportunities', 'Food and refreshments provided', 'Free pro subscriptions', 'Surprise entertainment'],
  partners: [{ group: 'Exclusive partners', name: 'Hackers Daddy' }, { group: 'Exclusive partners', name: 'Student Forge' }, { group: 'Community partners', name: 'Studlyf' }, { group: 'Community partners', name: 'CodeQuesters' }, { group: 'Community partners', name: 'TG10X' }, { group: 'Community partners', name: 'Ground Zero' }, { group: 'Outreach partner', name: 'LinkedInspire' }, { group: 'Partner', name: 'Nova' }],
  contacts: [{ name: 'Sana', phone: '9100903450' }, { name: 'Aniketh', phone: '8309012359' }],
};
if (!getKV('event')) {
  const s = Date.UTC(2026, 9, 16, 4, 30); // 10:00 IST, 16 Oct 2026
  const e = Date.UTC(2026, 9, 17, 4, 30); // 10:00 IST, 17 Oct 2026
  setKV('event', {
    name: 'VYOM', tagline: 'Build something that leaves the atmosphere.', timezone: 'Asia/Kolkata',
    start: s, end: e, deadline: e, registrationOpen: true, minTeam: 2, maxTeam: 4, maxPsChanges: 3,
    problems: [{ title: 'Problem statement 1 (placeholder)', desc: 'Admin: replace this in the Problem statements tab.', track: 'Space & Defense' }, { title: 'Open innovation', desc: 'Solve a problem of your own choosing.', track: 'Open Innovation' }],
    rubric: [{ name: 'Innovation', max: 10 }, { name: 'Technical depth', max: 10 }, { name: 'Impact', max: 10 }, { name: 'Design & UX', max: 10 }, { name: 'Presentation', max: 10 }],
    judges: ['Judge 1', 'Judge 2', 'Judge 3'],
    perks: ['Canva', 'Miro', 'Surprise AI subscription'], perksPerTeam: 1, perkUrls: { Canva: 'https://canva.com/abc' },
    rules: 'Teams of 2–4. Start building after the opening ceremony. Use your own code; credit any libraries or AI tools. Final submission needs a GitHub repo and a pitch deck (Canva recommended, any format accepted).',
    faq: [{ q: 'Where do I find my table?', a: 'It is shown on your team card once the organisers assign it at check-in.' },
          { q: 'How do I claim my team perk?', a: 'Once the organisers check your team in at the venue, the Perks section unlocks. Pick one and open the link.' },
          { q: 'Can I edit after submitting?', a: 'Yes, until the deadline. Re-open the submission, change it, and mark it final again.' }],
  });
  const H = 3600e3, ins = db.prepare('INSERT INTO schedule(start,end,title,location,kind) VALUES(?,?,?,?,?)');
  [
    [-1, 1, 'Check-in & table allotment', 'Registration desk', 'event'], [0, 0.5, 'Opening ceremony', 'Auditorium', 'event'],
    [0.5, 0, 'Hacking begins', 'Everywhere', 'milestone'], [3, 1, 'Lunch', 'Cafeteria', 'meal'],
    [8, 1, 'Mentor round', 'Labs', 'event'], [10, 1, 'Dinner', 'Cafeteria', 'meal'],
    [18, 1, 'Midnight snacks', 'Cafeteria', 'meal'], [22, 1, 'Breakfast', 'Cafeteria', 'meal'],
    [24, 0, 'Hacking ends · submissions close', 'Portal', 'deadline'], [24.5, 3, 'Live demos at tables (jury)', 'Your tables', 'event'],
  ].forEach(([o, d, t, l, k]) => ins.run(s + o * H, d ? s + (o + d) * H : null, t, l, k));
  db.prepare('INSERT INTO announcements(body,pinned,created_at) VALUES(?,?,?)').run('Welcome to VYOM! Sign in with the team ID and password you received, then keep this page open — the timetable and countdown update live.', 1, Date.now());
}

{ const cur = getKV('event'); if (!cur.college) setKV('event', { ...EVENT_DEFAULTS, ...cur, tagline: EVENT_DEFAULTS.tagline, tracks: EVENT_DEFAULTS.tracks }); }

// ---------- helpers ----------
const now = () => Date.now();
const hashPw = (pw) => { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 32).toString('hex'); };
const checkPw = (pw, stored) => {
  const [s, h] = stored.split(':'); const a = Buffer.from(h, 'hex'); const b = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const safeEq = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };

function parseCookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
function newSession(res, kind, teamId) {
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(token, kind, teamId ?? null, now() + 7 * 24 * H);
  const c = `${kind === 'admin' ? ADMIN_SID : SID}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 86400}${BEHIND_PROXY ? '; Secure' : ''}`;
  const prev = res.getHeader('Set-Cookie') || []; res.setHeader('Set-Cookie', [].concat(prev, c));
}
function auth(req) {
  const c = parseCookies(req); const out = {};
  for (const [name, kind] of [[SID, 'team'], [ADMIN_SID, 'admin']]) {
    if (!c[name]) continue;
    const s = db.prepare('SELECT * FROM sessions WHERE token=? AND kind=? AND expires>?').get(c[name], kind, now());
    if (s) out[kind] = s;
  }
  return out;
}
const clearCookie = (res, name) => { const prev = res.getHeader('Set-Cookie') || []; res.setHeader('Set-Cookie', [].concat(prev, `${name}=; HttpOnly; Path=/; Max-Age=0`)); };

// rate limit for login/register
const hits = new Map();
function limited(ip, key, max = 10, win = 60e3) {
  const k = key + ip, t = now(); const arr = (hits.get(k) || []).filter((x) => t - x < win);
  arr.push(t); hits.set(k, arr); return arr.length > max;
}

const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(b); };
const fail = (res, code, msg) => send(res, code, { error: msg });

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJSON(req) { const b = await readBody(req); try { return b.length ? JSON.parse(b.toString()) : {}; } catch { throw Object.assign(new Error('Bad JSON'), { status: 400 }); } }

function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || ''); if (!m) throw Object.assign(new Error('No boundary'), { status: 400 });
  const boundary = Buffer.from('--' + (m[1] || m[2])); const parts = []; let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const next = buf.indexOf(boundary, pos + boundary.length); if (next === -1) break;
    const part = buf.subarray(pos + boundary.length + 2, next - 2); // strip CRLF
    const he = part.indexOf('\r\n\r\n'); if (he !== -1) {
      const head = part.subarray(0, he).toString(); const cd = /filename="([^"]*)"/i.exec(head);
      if (cd) parts.push({ filename: cd[1], data: part.subarray(he + 4) });
    }
    pos = next;
  }
  return parts;
}

const clip = (s, n) => String(s ?? '').trim().slice(0, n);
function cleanUrl(u, hostHint, label) {
  u = clip(u, 500); if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  let x; try { x = new URL(u); } catch { throw Object.assign(new Error(`Invalid URL: ${u}`), { status: 400 }); }
  if (!/^https?:$/.test(x.protocol)) throw Object.assign(new Error('Only http(s) links allowed'), { status: 400 });
  if (hostHint && !hostHint.test(x.hostname)) throw Object.assign(new Error(`That link should be on ${label}`), { status: 400 });
  return x.toString();
}

function eventInfo() { return { maxPsChanges: 3, minTeam: 2, maxTeam: 4, perkUrls: {}, ...EVENT_DEFAULTS, ...getKV('event'), loginPrefix: LOGIN_PREFIX }; }
const deadlinePassed = () => now() > eventInfo().deadline;

function submissionFor(teamId) {
  const s = { ...(db.prepare('SELECT * FROM submissions WHERE team_id=?').get(teamId) || {}), track: db.prepare('SELECT ps FROM teams WHERE id=?').get(teamId)?.ps || '' };
  const files = db.prepare('SELECT id,orig_name,size,created_at,kind FROM files WHERE team_id=? ORDER BY id').all(teamId);
  return { ...s, final: !!s.final, files };
}
function completeness(sub, files = []) {
  const miss = []; if (!sub.title) miss.push('Project title'); if (!sub.track) miss.push('Problem statement'); if (!sub.description || sub.description.length < 40) miss.push('Description (40+ chars)');
  if (!sub.github) miss.push('GitHub repository'); if (sub.__teamIncomplete) miss.push('Team name & members (2–4) in Team details'); if (!sub.deck && !files.some((f) => f.kind === 'deck')) miss.push('Pitch deck (link or uploaded file)'); return miss;
}
function cleanMembers(list, ev) {
  if (!Array.isArray(list)) throw Object.assign(new Error('Team members required'), { status: 400 });
  const out = list.map((m) => ({ name: clip(m?.name, 60), email: clip(m?.email, 120).toLowerCase() })).filter((m) => m.name || m.email);
  if (out.length < ev.minTeam || out.length > ev.maxTeam) throw Object.assign(new Error(`Team must have ${ev.minTeam}–${ev.maxTeam} members`), { status: 400 });
  for (const m of out) if (!m.name || (m.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email))) throw Object.assign(new Error('Every member needs a name (email, if given, must be valid)'), { status: 400 });
  return out;
}
function teamIncomplete(id) {
  return false; // team name/members are set by organisers in admin, not required from participants

  const t = db.prepare('SELECT name,members FROM teams WHERE id=?').get(id), ev = eventInfo();
  try { const n = JSON.parse(t.members || '[]').length; return !t.name || n < ev.minTeam || n > ev.maxTeam; } catch { return true; }
}
const perksUnlocked = (teamId) => !!db.prepare('SELECT checked_in FROM teams WHERE id=?').get(teamId)?.checked_in;

// ---------- routes ----------
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  const ip = (BEHIND_PROXY && String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  const a = auth(req);

  if (p === '/api/public' && m === 'GET') {
    return send(res, 200, {
      now: now(), event: eventInfo(),
      schedule: db.prepare('SELECT * FROM schedule ORDER BY start').all(),
      announcements: db.prepare('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC LIMIT 20').all(),
    });
  }

  if (p === '/api/login' && m === 'POST') {
    if (limited(ip, 'login', 10)) return fail(res, 429, 'Too many attempts, wait a minute');
    const b = await readJSON(req); const t = db.prepare('SELECT * FROM teams WHERE login=?').get(clip(b.login, 40));
    if (!t || !checkPw(String(b.password || '').trim(), t.pw_hash)) return fail(res, 401, 'Wrong team ID or password');
    newSession(res, 'team', t.id); return send(res, 200, { ok: true });
  }
  if (p === '/api/logout' && m === 'POST') {
    const c = parseCookies(req); if (c[SID]) db.prepare('DELETE FROM sessions WHERE token=?').run(c[SID]); clearCookie(res, SID); return send(res, 200, { ok: true });
  }

  if (p === '/api/me' && m === 'GET') {
    if (!a.team) return fail(res, 401, 'Not signed in');
    const t = db.prepare('SELECT id,login,name,members,college,checked_in,table_no,ps,ps_changes,jury_visited FROM teams WHERE id=?').get(a.team.team_id);
    t.members = JSON.parse(t.members || '[]'); t.checked_in = !!t.checked_in; t.jury_visited = !!t.jury_visited; t.psChangesLeft = Math.max(0, eventInfo().maxPsChanges - t.ps_changes);
    const sub = submissionFor(t.id); return send(res, 200, { team: t, submission: sub, missing: completeness({ ...sub, __teamIncomplete: teamIncomplete(a.team.team_id) }, sub.files), locked: deadlinePassed() });
  }


  if (p === '/api/submission' && m === 'PUT') {
    if (!a.team) return fail(res, 401, 'Not signed in');
    if (deadlinePassed()) return fail(res, 403, 'Submissions are closed');
    const b = await readJSON(req); const ev = eventInfo();
    const track = db.prepare('SELECT ps FROM teams WHERE id=?').get(a.team.team_id).ps || '';
    const row = {
      title: clip(b.title, 100), track, tagline: clip(b.tagline, 140), description: clip(b.description, 4000), tech: clip(b.tech, 300),
      github: cleanUrl(b.github, /(^|\.)(github\.com|gitlab\.com|bitbucket\.org)$/i, 'GitHub, GitLab or Bitbucket'), demo: cleanUrl(b.demo), video: cleanUrl(b.video),
      deck: cleanUrl(b.deck), docs: cleanUrl(b.docs), extra: clip(b.extra, 1000),
    };
    const wantFinal = b.final ? 1 : 0;
    if (wantFinal) { const miss = completeness({ ...row, __teamIncomplete: teamIncomplete(a.team.team_id) }, submissionFor(a.team.team_id).files); if (miss.length) return fail(res, 400, 'Cannot finalize — missing: ' + miss.join(', ')); }
    const prev = db.prepare('SELECT final, submitted_at FROM submissions WHERE team_id=?').get(a.team.team_id);
    const submittedAt = wantFinal ? (prev?.final ? prev.submitted_at : now()) : null;
    db.prepare(`INSERT INTO submissions(team_id,title,track,tagline,description,tech,github,demo,video,deck,docs,extra,final,updated_at,submitted_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(team_id) DO UPDATE SET title=excluded.title,track=excluded.track,tagline=excluded.tagline,
      description=excluded.description,tech=excluded.tech,github=excluded.github,demo=excluded.demo,video=excluded.video,deck=excluded.deck,docs=excluded.docs,
      extra=excluded.extra,final=excluded.final,updated_at=excluded.updated_at,submitted_at=excluded.submitted_at`)
      .run(a.team.team_id, row.title, row.track, row.tagline, row.description, row.tech, row.github, row.demo, row.video, row.deck, row.docs, row.extra, wantFinal, now(), submittedAt);
    const sub = submissionFor(a.team.team_id); return send(res, 200, { ok: true, submission: sub, missing: completeness({ ...sub, __teamIncomplete: teamIncomplete(a.team.team_id) }, sub.files) });
  }

  if (p === '/api/submission/files' && m === 'POST') {
    if (!a.team) return fail(res, 401, 'Not signed in'); if (deadlinePassed()) return fail(res, 403, 'Submissions are closed');
    const kind = url.searchParams.get('kind') === 'deck' ? 'deck' : 'other';
    const parts = parseMultipart(await readBody(req, MAX_UPLOAD + 1e6), req.headers['content-type']);
    if (!parts.length) return fail(res, 400, 'No file received');
    if (kind === 'deck') {
      if (parts.length !== 1) return fail(res, 400, 'Upload one presentation file');
      const ext = path.extname(parts[0].filename).toLowerCase(); if (!['.ppt', '.pptx', '.pdf'].includes(ext)) return fail(res, 400, 'Presentation must be .ppt, .pptx or .pdf');
      for (const old of db.prepare("SELECT id,stored FROM files WHERE team_id=? AND kind='deck'").all(a.team.team_id)) { db.prepare('DELETE FROM files WHERE id=?').run(old.id); fs.rmSync(path.join(UPLOADS, old.stored), { force: true }); }
    } else {
      const have = db.prepare("SELECT COUNT(*) c FROM files WHERE team_id=? AND kind='other'").get(a.team.team_id).c;
      if (have + parts.length > MAX_FILES_PER_TEAM) return fail(res, 400, `Max ${MAX_FILES_PER_TEAM} other files per team`);
      for (const f of parts) { const ext = path.extname(f.filename).toLowerCase(); if (!ALLOWED_EXT.has(ext)) return fail(res, 400, `File type ${ext || '(none)'} not allowed`); }
    }
    for (const f of parts) {
      const ext = path.extname(f.filename).toLowerCase(), stored = crypto.randomBytes(16).toString('hex') + ext;
      fs.writeFileSync(path.join(UPLOADS, stored), f.data);
      db.prepare('INSERT INTO files(team_id,orig_name,stored,size,created_at,kind) VALUES(?,?,?,?,?,?)').run(a.team.team_id, path.basename(f.filename).slice(0, 120), stored, f.data.length, now(), kind);
    }
    return send(res, 200, { ok: true, files: submissionFor(a.team.team_id).files });
  }

  let mm;
  if ((mm = /^\/api\/submission\/files\/(\d+)$/.exec(p)) && m === 'DELETE') {
    if (!a.team) return fail(res, 401, 'Not signed in'); if (deadlinePassed()) return fail(res, 403, 'Submissions are closed');
    const f = db.prepare('SELECT * FROM files WHERE id=? AND team_id=?').get(mm[1], a.team.team_id); if (!f) return fail(res, 404, 'Not found');
    db.prepare('DELETE FROM files WHERE id=?').run(f.id); fs.rmSync(path.join(UPLOADS, f.stored), { force: true }); return send(res, 200, { ok: true });
  }
  if ((mm = /^\/files\/(\d+)$/.exec(p)) && m === 'GET') {
    const f = db.prepare('SELECT * FROM files WHERE id=?').get(mm[1]);
    if (!f || !((a.team && a.team.team_id === f.team_id) || a.admin)) return fail(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${encodeURIComponent(f.orig_name)}"`, 'X-Content-Type-Options': 'nosniff' });
    return fs.createReadStream(path.join(UPLOADS, f.stored)).pipe(res);
  }

  if (p === '/api/problem' && m === 'POST') {
    if (!a.team) return fail(res, 401, 'Not signed in'); const ev = eventInfo(), b = await readJSON(req), title = clip(b.title, 120);
    const t = db.prepare('SELECT ps,ps_changes,jury_visited FROM teams WHERE id=?').get(a.team.team_id);
    if (!ev.problems.some((x) => x.title === title)) return fail(res, 400, 'Unknown problem statement');
    if (t.jury_visited) return fail(res, 403, 'Locked — the jury has already visited your table');
    if (t.ps === title) return send(res, 200, { ok: true, ps: t.ps, changesLeft: Math.max(0, ev.maxPsChanges - t.ps_changes) });
    if (t.ps && t.ps_changes >= ev.maxPsChanges) return fail(res, 403, `You have used all ${ev.maxPsChanges} changes`);
    const used = t.ps ? t.ps_changes + 1 : 0;
    db.prepare('UPDATE teams SET ps=?, ps_changes=? WHERE id=?').run(title, used, a.team.team_id);
    return send(res, 200, { ok: true, ps: title, changesLeft: Math.max(0, ev.maxPsChanges - used) });
  }
  const teamPerks = (teamId) => {
    const ev = eventInfo(), login = db.prepare('SELECT login FROM teams WHERE id=?').get(teamId).login;
    const links = db.prepare('SELECT perk,url,claimed_at FROM perk_links WHERE team_id=?').all(teamId).map((l) => ({ kind: 'link', perk: l.perk, url: l.url, claimed_at: l.claimed_at }));
    const accts = db.prepare('SELECT perk,username,password,claimed_at FROM perk_accounts WHERE login=? AND claimed_at IS NOT NULL').all(login)
      .map((x) => ({ kind: 'account', perk: x.perk, url: ev.perkUrls?.[x.perk] || '', name: login, username: x.username, password: x.password, claimed_at: x.claimed_at }));
    return { login, ev, claimed: [...links, ...accts].sort((x, y) => x.claimed_at - y.claimed_at) };
  };
  if (p === '/api/perks' && m === 'GET') {
    if (!a.team) return fail(res, 401, 'Not signed in'); const { login, ev, claimed } = teamPerks(a.team.team_id);
    const avail = Object.fromEntries(ev.perks.map((k) => [k, db.prepare('SELECT COUNT(*) c FROM perk_accounts WHERE perk=?').get(k).c
      ? db.prepare('SELECT COUNT(*) c FROM perk_accounts WHERE perk=? AND login=? AND claimed_at IS NULL').get(k, login).c
      : db.prepare('SELECT COUNT(*) c FROM perk_links WHERE perk=? AND team_id IS NULL').get(k).c]));
    return send(res, 200, { unlocked: perksUnlocked(a.team.team_id), perks: ev.perks, perksPerTeam: ev.perksPerTeam, claimed, available: avail });
  }
  if (p === '/api/perks/claim' && m === 'POST') {
    if (!a.team) return fail(res, 401, 'Not signed in'); const b = await readJSON(req), perk = clip(b.perk, 60);
    const { login, ev, claimed } = teamPerks(a.team.team_id);
    if (!ev.perks.includes(perk)) return fail(res, 400, 'Unknown perk'); if (!perksUnlocked(a.team.team_id)) return fail(res, 403, 'Perks unlock after you check in at the venue');
    db.exec('BEGIN IMMEDIATE');
    try {
      const n = teamPerks(a.team.team_id).claimed;
      if (n.length >= ev.perksPerTeam) { db.exec('ROLLBACK'); return fail(res, 409, 'Your team has already claimed its perk'); }
      if (n.some((x) => x.perk === perk)) { db.exec('ROLLBACK'); return fail(res, 409, 'Already claimed'); }
      if (db.prepare('SELECT 1 FROM perk_accounts WHERE perk=? LIMIT 1').get(perk)) {
        const acct = db.prepare('SELECT * FROM perk_accounts WHERE perk=? AND login=? AND claimed_at IS NULL').get(perk, login);
        if (!acct) { db.exec('ROLLBACK'); return fail(res, 410, `No ${perk} account is assigned to your team — ask an organiser`); }
        db.prepare('UPDATE perk_accounts SET claimed_at=? WHERE perk=? AND login=?').run(now(), perk, login); db.exec('COMMIT');
        return send(res, 200, { ok: true, perk });
      }
      const l = db.prepare('SELECT * FROM perk_links WHERE perk=? AND team_id IS NULL ORDER BY id LIMIT 1').get(perk);
      if (!l) { db.exec('ROLLBACK'); return fail(res, 410, `${perk} is out of stock — ask an organiser`); }
      db.prepare('UPDATE perk_links SET team_id=?, claimed_at=? WHERE id=?').run(a.team.team_id, now(), l.id); db.exec('COMMIT');
      return send(res, 200, { ok: true, perk });
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  }

  // ---------- admin ----------
  if (p === '/api/admin/login' && m === 'POST') {
    if (limited(ip, 'alogin', 6)) return fail(res, 429, 'Too many attempts, wait a minute');
    const b = await readJSON(req); if (!safeEq(b.password || '', ADMIN_PASSWORD)) return fail(res, 401, 'Wrong password');
    newSession(res, 'admin'); return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/logout' && m === 'POST') {
    const c = parseCookies(req); if (c[ADMIN_SID]) db.prepare('DELETE FROM sessions WHERE token=?').run(c[ADMIN_SID]); clearCookie(res, ADMIN_SID); return send(res, 200, { ok: true });
  }
  if (p.startsWith('/api/admin/')) {
    if (!a.admin) return fail(res, 401, 'Admin sign-in required');

    if (p === '/api/admin/state' && m === 'GET') {
      const teams = db.prepare(`SELECT t.id,t.login,t.name,t.members,t.college,t.created_at,t.checked_in,t.table_no, t.ps AS track,t.ps_changes,t.jury_visited,s.title,s.tagline,s.description,s.tech,s.github,s.demo,s.video,s.deck,s.docs,s.extra,
        s.final,s.status,s.admin_note,s.updated_at,s.submitted_at FROM teams t LEFT JOIN submissions s ON s.team_id=t.id ORDER BY t.id`).all();
      const files = db.prepare('SELECT id,team_id,orig_name,size,kind FROM files ORDER BY id').all();
      const scores = db.prepare('SELECT * FROM scores').all();
            const perkLinks = db.prepare('SELECT l.id,l.perk,l.url,l.team_id,l.claimed_at,t.name team FROM perk_links l LEFT JOIN teams t ON t.id=l.team_id ORDER BY l.id').all();
      const perkAccounts = db.prepare('SELECT a.perk,a.login,a.username,a.claimed_at,t.name team FROM perk_accounts a LEFT JOIN teams t ON t.login=a.login ORDER BY a.perk,a.login').all();
      return send(res, 200, { now: now(), event: eventInfo(), perkLinks, perkAccounts, teams: teams.map((t) => ({ ...t, checked_in: !!t.checked_in, jury_visited: !!t.jury_visited, members: JSON.parse(t.members || '[]'), final: !!t.final, files: files.filter((f) => f.team_id === t.id) })), scores,
        schedule: db.prepare('SELECT * FROM schedule ORDER BY start').all(), announcements: db.prepare('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC').all() });
    }
    if (p === '/api/admin/event' && m === 'PUT') {
      const b = await readJSON(req), cur = eventInfo();
      const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
      const next = {
        ...cur, name: clip(b.name, 60) || cur.name, tagline: clip(b.tagline, 160), timezone: clip(b.timezone, 60) || cur.timezone,
        start: num(b.start, cur.start), end: num(b.end, cur.end), deadline: num(b.deadline, cur.deadline), registrationOpen: cur.registrationOpen,
        maxPsChanges: Number.isFinite(Number(b.maxPsChanges)) && b.maxPsChanges !== '' ? Math.max(0, Number(b.maxPsChanges)) : cur.maxPsChanges, minTeam: num(b.minTeam, cur.minTeam), maxTeam: num(b.maxTeam, cur.maxTeam), perksPerTeam: num(b.perksPerTeam, cur.perksPerTeam),
        tracks: (b.tracks || cur.tracks).map((x) => clip(x, 60)).filter(Boolean),
        college: clip(b.college ?? cur.college, 120), subtitle: clip(b.subtitle ?? cur.subtitle, 160), venue: clip(b.venue ?? cur.venue, 160), prize: clip(b.prize ?? cur.prize, 60), format: clip(b.format ?? cur.format, 60),
        mission: (b.mission || cur.mission).map((x) => clip(x, 30)).filter(Boolean), highlights: (b.highlights || cur.highlights).map((x) => clip(x, 100)).filter(Boolean),
        partners: (b.partners || cur.partners).map((x) => ({ group: clip(x.group, 40), name: clip(x.name, 60) })).filter((x) => x.name),
        contacts: (b.contacts || cur.contacts).map((x) => ({ name: clip(x.name, 40), phone: clip(x.phone, 20) })).filter((x) => x.name),
        perks: (b.perks || cur.perks).map((x) => clip(x, 60)).filter(Boolean), rules: clip(b.rules ?? cur.rules, 3000),
        faq: (b.faq || cur.faq).map((f) => ({ q: clip(f.q, 200), a: clip(f.a, 1000) })).filter((f) => f.q),
        rubric: (b.rubric || cur.rubric).map((r) => ({ name: clip(r.name, 40), max: num(r.max, 10) })).filter((r) => r.name),
        judges: (b.judges || cur.judges).map((x) => clip(x, 40)).filter(Boolean),
      };
      try { new Intl.DateTimeFormat('en', { timeZone: next.timezone }); } catch { return fail(res, 400, 'Invalid timezone'); }
      setKV('event', next); return send(res, 200, { ok: true, event: next });
    }
    if (p === '/api/admin/problems' && m === 'PUT') {
      const b = await readJSON(req); if (!Array.isArray(b.problems)) return fail(res, 400, 'problems required');
      const tr = eventInfo().tracks; const problems = b.problems.map((x) => ({ title: clip(x.title, 120), desc: clip(x.desc, 3000), track: tr.includes(x.track) ? x.track : '' })).filter((x) => x.title);
      if (new Set(problems.map((x) => x.title)).size !== problems.length) return fail(res, 400, 'Problem titles must be unique');
      setKV('event', { ...eventInfo(), problems }); return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/schedule' && m === 'PUT') {
      const b = await readJSON(req); if (!Array.isArray(b.items)) return fail(res, 400, 'items required');
      db.exec('BEGIN'); try {
        db.exec('DELETE FROM schedule'); const ins = db.prepare('INSERT INTO schedule(start,end,title,location,kind) VALUES(?,?,?,?,?)');
        for (const i of b.items) { if (!clip(i.title, 120) || !Number(i.start)) continue; ins.run(Number(i.start), Number(i.end) || null, clip(i.title, 120), clip(i.location, 80), ['event', 'meal', 'milestone', 'deadline'].includes(i.kind) ? i.kind : 'event'); }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/announcements' && m === 'POST') {
      const b = await readJSON(req); if (!clip(b.body, 1000)) return fail(res, 400, 'Message required');
      db.prepare('INSERT INTO announcements(body,pinned,created_at) VALUES(?,?,?)').run(clip(b.body, 1000), b.pinned ? 1 : 0, now()); return send(res, 200, { ok: true });
    }
    if ((mm = /^\/api\/admin\/announcements\/(\d+)$/.exec(p)) && m === 'DELETE') { db.prepare('DELETE FROM announcements WHERE id=?').run(mm[1]); return send(res, 200, { ok: true }); }
    if ((mm = /^\/api\/admin\/teams\/(\d+)$/.exec(p))) {
      const id = Number(mm[1]);
      if (m === 'DELETE') {
        for (const f of db.prepare('SELECT stored FROM files WHERE team_id=?').all(id)) fs.rmSync(path.join(UPLOADS, f.stored), { force: true });
        db.prepare('DELETE FROM teams WHERE id=?').run(id); return send(res, 200, { ok: true });
      }
      if (m === 'PUT') {
        const b = await readJSON(req); db.prepare('INSERT OR IGNORE INTO submissions(team_id) VALUES(?)').run(id);
        const st = ['pending', 'accepted', 'flagged', 'disqualified'].includes(b.status) ? b.status : 'pending';
        db.prepare('UPDATE submissions SET status=?, admin_note=?, final=COALESCE(?,final) WHERE team_id=?').run(st, clip(b.admin_note, 500), b.final === undefined ? null : (b.final ? 1 : 0), id);
        if (b.name !== undefined) db.prepare('UPDATE teams SET name=? WHERE id=?').run(clip(b.name, 60), id);
        if (b.college !== undefined) db.prepare('UPDATE teams SET college=? WHERE id=?').run(clip(b.college, 120), id);
        if (b.members !== undefined) { const ev = eventInfo(); db.prepare('UPDATE teams SET members=? WHERE id=?').run(JSON.stringify(cleanMembers(b.members, { minTeam: 0, maxTeam: Math.max(ev.maxTeam, 8) })), id); }
        if (b.table_no !== undefined) db.prepare('UPDATE teams SET table_no=? WHERE id=?').run(clip(b.table_no, 20), id);
        if (b.jury_visited !== undefined) db.prepare('UPDATE teams SET jury_visited=? WHERE id=?').run(b.jury_visited ? 1 : 0, id);
        if (b.reset_ps_changes) db.prepare('UPDATE teams SET ps_changes=0 WHERE id=?').run(id);
        if (b.checked_in !== undefined) db.prepare('UPDATE teams SET checked_in=? WHERE id=?').run(b.checked_in ? 1 : 0, id);
        return send(res, 200, { ok: true });
      }
    }
    if (p === '/api/admin/teams/generate' && m === 'POST') {
      // body: { count, rows?: [{name, college}] }  → creates predefined logins; passwords are returned ONCE here.
      const b = await readJSON(req), rows = Array.isArray(b.rows) ? b.rows : [];
      const n = Math.max(1, Math.min(500, rows.length || Number(b.count) || 1)), alpha = 'abcdefghjkmnpqrstuvwxyz23456789';
      let next = (db.prepare('SELECT MAX(CAST(SUBSTR(login,?) AS INTEGER)) m FROM teams WHERE login LIKE ?').get(LOGIN_PREFIX.length + 2, LOGIN_PREFIX + '-%').m || 0) + 1; const out = [];
      const ins = db.prepare('INSERT INTO teams(login,name,pw_hash,college,created_at) VALUES(?,?,?,?,?)');
      db.exec('BEGIN'); try {
        for (let k = 0; k < n; k++, next++) {
          const login = LOGIN_PREFIX + '-' + String(next).padStart(3, '0');
          const pw = Array.from(crypto.randomBytes(4), (x) => alpha[x % alpha.length]).join('') + '-' + Array.from(crypto.randomBytes(4), (x) => alpha[x % alpha.length]).join('');
          ins.run(login, clip(rows[k]?.name, 60), hashPw(pw), clip(rows[k]?.college, 120), now()); out.push({ login, password: pw, name: clip(rows[k]?.name, 60) });
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return send(res, 200, { ok: true, credentials: out });
    }
    if ((mm = /^\/api\/admin\/teams\/(\d+)\/reset$/.exec(p)) && m === 'POST') {
      const t = db.prepare('SELECT login FROM teams WHERE id=?').get(mm[1]); if (!t) return fail(res, 404, 'No such team');
      const alpha = 'abcdefghjkmnpqrstuvwxyz23456789', pw = Array.from(crypto.randomBytes(4), (x) => alpha[x % alpha.length]).join('') + '-' + Array.from(crypto.randomBytes(4), (x) => alpha[x % alpha.length]).join('');
      db.prepare('UPDATE teams SET pw_hash=? WHERE id=?').run(hashPw(pw), mm[1]); db.prepare("DELETE FROM sessions WHERE kind='team' AND team_id=?").run(mm[1]);
      return send(res, 200, { ok: true, login: t.login, password: pw });
    }
    if (p === '/api/admin/perks/accounts' && m === 'POST') {
      const b = await readJSON(req), ev = eventInfo(), perk = clip(b.perk, 60); if (!ev.perks.includes(perk)) return fail(res, 400, 'Unknown perk (add it in Settings first)');
      if (b.url !== undefined) setKV('event', { ...ev, perkUrls: { ...(ev.perkUrls || {}), [perk]: clip(b.url, 300) } });
      let added = 0, skipped = [], claimed = 0;
      const up = db.prepare('INSERT INTO perk_accounts(perk,login,username,password) VALUES(?,?,?,?) ON CONFLICT(perk,login) DO UPDATE SET username=excluded.username, password=excluded.password');
      db.exec('BEGIN'); try {
        for (const line of String(b.text || '').split('\n')) {
          const c = line.trim().split(/[\t,]+|\s{2,}/).map((x) => x.trim()).filter(Boolean); if (c.length < 3 || /^name$/i.test(c[0])) continue;
          const login = c[0].toUpperCase(), t = db.prepare('SELECT 1 FROM teams WHERE login=?').get(login); if (!t) { skipped.push(c[0]); continue; }
          if (db.prepare('SELECT 1 FROM perk_accounts WHERE perk=? AND login=? AND claimed_at IS NOT NULL').get(perk, login)) { claimed++; continue; }
          up.run(perk, login, clip(c[1], 120), clip(c[2], 120)); added++;
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return send(res, 200, { ok: true, added, skipped, alreadyClaimed: claimed });
    }
    if (p === '/api/admin/perks/accounts/release' && m === 'POST') {
      const b = await readJSON(req); db.prepare('UPDATE perk_accounts SET claimed_at=NULL WHERE perk=? AND login=?').run(clip(b.perk, 60), clip(b.login, 40)); return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/perks/add' && m === 'POST') {
      const b = await readJSON(req), perk = clip(b.perk, 60); if (!eventInfo().perks.includes(perk)) return fail(res, 400, 'Unknown perk (add it in Settings first)');
      const urls = String(b.text || '').split(/\s+/).map((x) => x.trim()).filter(Boolean); let n = 0;
      const have = new Set(db.prepare('SELECT url FROM perk_links').all().map((r) => r.url)); const ins = db.prepare('INSERT INTO perk_links(perk,url) VALUES(?,?)');
      for (const u of urls) { if (have.has(u) || u.length > 500) continue; ins.run(perk, u); have.add(u); n++; }
      return send(res, 200, { ok: true, added: n, skipped: urls.length - n });
    }
    if ((mm = /^\/api\/admin\/perks\/(\d+)$/.exec(p)) && m === 'DELETE') {
      // body-less: unassigns a claimed link (returns to pool) if ?release=1, else deletes the link
      if (url.searchParams.get('release')) db.prepare('UPDATE perk_links SET team_id=NULL, claimed_at=NULL WHERE id=?').run(mm[1]); else db.prepare('DELETE FROM perk_links WHERE id=? AND team_id IS NULL').run(mm[1]);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/scores' && m === 'PUT') {
      // body: { rows: [{team_id, judge, scores:[n,...], comment}] }
      const b = await readJSON(req), rub = eventInfo().rubric; if (!Array.isArray(b.rows)) return fail(res, 400, 'rows required');
      const up = db.prepare('INSERT INTO scores(team_id,judge,scores,comment) VALUES(?,?,?,?) ON CONFLICT(team_id,judge) DO UPDATE SET scores=excluded.scores, comment=excluded.comment');
      const del = db.prepare('DELETE FROM scores WHERE team_id=? AND judge=?'); let n = 0;
      db.exec('BEGIN'); try {
        for (const r of b.rows) {
          if (!db.prepare('SELECT 1 FROM teams WHERE id=?').get(r.team_id)) continue;
          const judge = clip(r.judge, 40); if (!judge) continue;
          const vals = rub.map((c, i) => { const v = r.scores?.[i]; return v === '' || v == null ? null : Math.max(0, Math.min(c.max, Number(v) || 0)); });
          if (vals.every((v) => v === null)) { del.run(r.team_id, judge); continue; }
          up.run(r.team_id, judge, JSON.stringify(vals), clip(r.comment, 300)); n++;
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return send(res, 200, { ok: true, saved: n });
    }
    if (p === '/api/admin/export.csv' && m === 'GET') {
      const rows = db.prepare(`SELECT t.login,t.name,t.members,t.college,t.table_no,t.checked_in,t.jury_visited,t.ps AS track,t.ps_changes,s.title,s.tagline,s.github,s.demo,s.video,s.deck,s.docs,s.final,s.status,s.submitted_at FROM teams t LEFT JOIN submissions s ON s.team_id=t.id ORDER BY t.id`).all();
      const cols = ['login', 'name', 'members', 'college', 'table_no', 'checked_in', 'jury_visited', 'track', 'ps_changes', 'title', 'tagline', 'github', 'demo', 'video', 'deck', 'docs', 'final', 'status', 'submitted_at'];
      const esc = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      rows.forEach((r) => { try { r.members = JSON.parse(r.members || '[]').map((x) => `${x.name} <${x.email}>`).join('; '); } catch {} });
      const out = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(c === 'submitted_at' && r[c] ? new Date(r[c]).toISOString() : r[c])).join(','))].join('\n');
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="vyom-submissions.csv"' }); return res.end(out);
    }
  }
  return fail(res, 404, 'Not found');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
  try {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) return await api(req, res, url);
    let f = url.pathname === '/' ? '/index.html' : url.pathname === '/admin' ? '/admin.html' : url.pathname;
    const full = path.normalize(path.join(PUBLIC, f));
    if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : 'Server error'); else res.end();
    if (!e.status) console.error(e);
  }
}).listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`\n  VYOM portal running → http://localhost:${PORT}\n  Admin portal        → http://localhost:${PORT}/admin\n  Admin password      → ${ADMIN_PASSWORD}  (set ADMIN_PASSWORD env to change)\n`);
});

setInterval(() => db.prepare('DELETE FROM sessions WHERE expires<?').run(now()), 3600e3).unref();
