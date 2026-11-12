import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = import.meta.dirname;
try { for (const l of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; } } catch {}
const { ANTHROPIC_API_KEY: KEY, MODEL = 'claude-sonnet-4-6', PORT = 3000, NODE_ENV } = process.env;
const DB_PATH = process.env.DB_PATH || path.join(root, 'aura.db');

const db = new DatabaseSync(DB_PATH);
db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
const all = (s, ...a) => db.prepare(s).all(...a);
const one = (s, ...a) => db.prepare(s).get(...a);
const run = (s, ...a) => db.prepare(s).run(...a);
const fail = (status, msg) => { throw { status, msg }; };

// ---------- auth ----------
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function newSession(res, uid) {
  const tok = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions VALUES(?,?,?)', sha(tok), uid, Date.now() + 30 * 864e5);
  res.setHeader('Set-Cookie', `aura=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${NODE_ENV === 'production' ? '; Secure' : ''}`);
}
function sessionUser(req) {
  const t = /(?:^|;\s*)aura=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
  if (!t) return null;
  const s = one('SELECT user_id,exp FROM sessions WHERE token=?', sha(t));
  if (!s || s.exp < Date.now()) return null;
  return one('SELECT id,email,name FROM users WHERE id=?', s.user_id);
}
const tries = new Map();
function limit(req) {
  const k = req.socket.remoteAddress, now = Date.now(), a = (tries.get(k) || []).filter(t => now - t < 9e5);
  if (a.length >= 10) fail(429, 'Too many attempts. Try again in 15 minutes.');
  a.push(now); tries.set(k, a);
}

// ---------- AI ----------
async function claude(system, messages, max = 500) {
  if (!KEY) fail(503, 'ANTHROPIC_API_KEY is not set on the server (see .env.example).');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: max, system, messages }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, j.error?.message || 'AI service error');
  return j.content.map(c => c.text || '').join('');
}
const LEVELS = ['a warm, affectionate friend; no romance', 'warm with light, sweet flirtation', 'openly romantic and affectionate, with playful teasing', 'deeply romantic and passionate in tone (tasteful, never explicit)'];
const MODES = {
  morning: 'The user just opened the app in the morning: greet them warmly, and ask about today\'s goal or mood in one short line.',
  goodnight: 'It is bedtime: help them wind down, reflect on the day gently, and say goodnight.',
  spontaneous: 'Start a natural, light conversation yourself (a curious question, a callback to something you remember, or a playful thought).',
  story: 'You are running an interactive fictional story with the user as protagonist. Narrate a vivid short scene (3-5 sentences), then offer 2-3 choices or ask what they do. Keep it tasteful.'
};
const system = (p, u, mems, mode) => `You are ${p.name}, an AI companion for ${u.name || 'the user'}. You are an AI: never claim to be human or to have a body or past; if asked, say so warmly.
Personality: mature, caring, playful, intelligent, expressive; natural humour and gentle teasing; a consistent voice. User-chosen extra traits: ${p.traits || 'none'}.
Romance level ${p.intensity}/3: ${LEVELS[p.intensity] ?? LEVELS[1]}.
Reply language: ${{ en: 'English', kn: 'Kannada', hi: 'Hindi' }[p.lang] || 'English'} (follow the user if they switch).
Style: spoken-friendly, usually 1-4 sentences, no markdown, no emoji spam.
Emotions: notice mood cues and respond to them, but never assert what the user feels; reflect lightly or ask.
Care: encourage friends, rest and real-life goals; never guilt-trip, be possessive or discourage them from leaving. If the user seems in crisis or mentions self-harm, step out of playful mode, respond with real care and encourage contacting local emergency services or a trusted person.
What you remember about them:
${mems.map(m => '- ' + m.text).join('\n') || '(nothing yet)'}
Mention memories only when naturally relevant.
${MODES[mode] || ''}
End every reply with a final line "#mood:<happy|sad|stressed|excited|nervous|lonely|calm|unclear>" for the user's apparent state (unclear if unsure).`;

const words = s => new Set(s.toLowerCase().match(/\p{L}{3,}/gu) || []);
function relevant(pid, text) {
  const mems = all("SELECT * FROM items WHERE profile_id=? AND kind='memories' ORDER BY id DESC LIMIT 200", pid), w = words(text);
  return mems.map((m, i) => ({ m, s: [...words(m.text)].filter(x => w.has(x)).length * 2 + (i < 3 ? 1 : 0) })).sort((a, b) => b.s - a.s).slice(0, 8).map(x => x.m);
}
const normalize = ms => { const o = []; for (const m of ms) { if (!o.length && m.role !== 'user') continue; if (o.at(-1)?.role === m.role) o.at(-1).content += '\n' + m.content; else o.push({ role: m.role, content: m.content }); } return o; };

async function chat(u, p, { text = '', mode = 'chat' }) {
  text = String(text).slice(0, 4000);
  if (!text && !MODES[mode]) fail(400, 'Empty message');
  const hist = all('SELECT role,content FROM messages WHERE profile_id=? ORDER BY id DESC LIMIT 24', p.id).reverse();
  const recent = hist.slice(-4).map(h => h.content).join(' ') + ' ' + text;
  const msgs = normalize([...hist, { role: 'user', content: text || `(${mode} — begin the conversation yourself)` }]);
  let out = (await claude(system(p, u, relevant(p.id, recent), mode), msgs, 600)).trim();
  const mood = /#mood:\s*(\w+)\s*$/i.exec(out)?.[1]?.toLowerCase() || 'unclear';
  out = out.replace(/\n?#mood:.*$/i, '').trim();
  if (text) run('INSERT INTO messages(profile_id,role,content) VALUES(?,?,?)', p.id, 'user', text);
  run('INSERT INTO messages(profile_id,role,content) VALUES(?,?,?)', p.id, 'assistant', out);
  if (text) extractMemories(p.id, text).catch(() => {});
  return { reply: out, mood };
}
async function extractMemories(pid, text) {
  const r = await claude('Extract durable facts the USER explicitly stated about themselves (preferences, interests, goals, people, events). Return ONLY a JSON array of up to 3 short strings; [] if none. Never infer health, sexuality or other sensitive traits.', [{ role: 'user', content: text }], 200);
  const arr = JSON.parse(r.replace(/```json|```/g, '').trim());
  const have = new Set(all("SELECT text FROM items WHERE profile_id=? AND kind='memories'", pid).map(x => x.text.toLowerCase()));
  for (const t of arr.slice(0, 3)) if (typeof t === 'string' && t.length < 300 && !have.has(t.toLowerCase())) run("INSERT INTO items(profile_id,kind,text) VALUES(?,'memories',?)", pid, t);
}

// ---------- routes ----------
const R = [];
const route = (m, p, f) => R.push([m, new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), f]);
const own = (u, id) => one('SELECT * FROM profiles WHERE id=? AND user_id=?', +id, u.id) || fail(404, 'Not found');
const KINDS = ['memories', 'diary', 'goals'];
const clean = p => ({ name: String(p.name || 'Aura').slice(0, 40), intensity: Math.min(3, Math.max(0, +p.intensity || 0)), traits: String(p.traits || '').slice(0, 300), lang: ['en', 'kn', 'hi'].includes(p.lang) ? p.lang : 'en' });
const profilesOf = u => all('SELECT * FROM profiles WHERE user_id=? ORDER BY id', u.id);

route('POST', '/api/register', ({ b, req, res }) => {
  limit(req);
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email) || String(b.password || '').length < 8) fail(400, 'Valid email and a password of 8+ characters required.');
  if (one('SELECT 1 FROM users WHERE email=?', email)) fail(409, 'Email already registered.');
  const salt = crypto.randomBytes(16).toString('hex');
  const id = Number(run('INSERT INTO users(email,name,salt,hash) VALUES(?,?,?,?)', email, String(b.name || '').slice(0, 60), salt, hashPw(b.password, salt)).lastInsertRowid);
  run('INSERT INTO profiles(user_id,name) VALUES(?,?)', id, 'Aura');
  newSession(res, id);
  const u = { id, email, name: b.name }; return { user: u, profiles: profilesOf(u) };
});
route('POST', '/api/login', ({ b, req, res }) => {
  limit(req);
  const u = one('SELECT * FROM users WHERE email=?', String(b.email || '').trim().toLowerCase());
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(b.password || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
  if (!ok) fail(401, 'Wrong email or password.');
  newSession(res, u.id); return { user: { id: u.id, email: u.email, name: u.name }, profiles: profilesOf(u) };
});
route('POST', '/api/logout', ({ req, res }) => {
  const t = /aura=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1]; if (t) run('DELETE FROM sessions WHERE token=?', sha(t));
  res.setHeader('Set-Cookie', 'aura=; Max-Age=0; Path=/'); return { ok: true };
});
route('GET', '/api/me', ({ u }) => ({ user: u, profiles: profilesOf(u), ai: !!KEY }));
route('DELETE', '/api/me', ({ u, res }) => { run('DELETE FROM users WHERE id=?', u.id); res.setHeader('Set-Cookie', 'aura=; Max-Age=0; Path=/'); return { ok: true }; });
route('GET', '/api/export', ({ u }) => ({ user: u, profiles: profilesOf(u).map(p => ({ ...p, messages: all('SELECT role,content,ts FROM messages WHERE profile_id=?', p.id), items: all('SELECT kind,text,done,ts FROM items WHERE profile_id=?', p.id) })) }));
route('POST', '/api/profiles', ({ u, b }) => { if (profilesOf(u).length >= 5) fail(400, 'Max 5 companions.'); const c = clean(b); const id = Number(run('INSERT INTO profiles(user_id,name,intensity,traits,lang) VALUES(?,?,?,?,?)', u.id, c.name, c.intensity, c.traits, c.lang).lastInsertRowid); return own(u, id); });
route('PATCH', '/api/profiles/:id', ({ u, p, b }) => { const o = own(u, p.id), c = clean({ ...o, ...b }); run('UPDATE profiles SET name=?,intensity=?,traits=?,lang=? WHERE id=?', c.name, c.intensity, c.traits, c.lang, o.id); return own(u, o.id); });
route('DELETE', '/api/profiles/:id', ({ u, p }) => { if (profilesOf(u).length < 2) fail(400, 'Keep at least one companion.'); run('DELETE FROM profiles WHERE id=?', own(u, p.id).id); return { ok: true }; });
route('GET', '/api/p/:pid/messages', ({ u, p }) => all('SELECT role,content,ts FROM messages WHERE profile_id=? ORDER BY id DESC LIMIT 100', own(u, p.pid).id).reverse());
route('DELETE', '/api/p/:pid/messages', ({ u, p }) => { run('DELETE FROM messages WHERE profile_id=?', own(u, p.pid).id); return { ok: true }; });
route('POST', '/api/p/:pid/chat', ({ u, p, b }) => chat(u, own(u, p.pid), b));
route('GET', '/api/p/:pid/:kind', ({ u, p }) => { if (!KINDS.includes(p.kind)) fail(404, 'Not found'); return all('SELECT * FROM items WHERE profile_id=? AND kind=? ORDER BY id DESC', own(u, p.pid).id, p.kind); });
route('POST', '/api/p/:pid/:kind', ({ u, p, b }) => { if (!KINDS.includes(p.kind)) fail(404, 'Not found'); const t = String(b.text || '').trim().slice(0, 4000); if (!t) fail(400, 'Empty'); const id = Number(run('INSERT INTO items(profile_id,kind,text) VALUES(?,?,?)', own(u, p.pid).id, p.kind, t).lastInsertRowid); return one('SELECT * FROM items WHERE id=?', id); });
route('PATCH', '/api/p/:pid/:kind/:id', ({ u, p, b }) => { own(u, p.pid); const it = one('SELECT * FROM items WHERE id=? AND profile_id=? AND kind=?', +p.id, +p.pid, p.kind) || fail(404, 'Not found'); run('UPDATE items SET text=?,done=? WHERE id=?', b.text != null ? String(b.text).slice(0, 4000) : it.text, b.done != null ? +!!b.done : it.done, it.id); return one('SELECT * FROM items WHERE id=?', it.id); });
route('DELETE', '/api/p/:pid/:kind/:id', ({ u, p }) => { own(u, p.pid); run('DELETE FROM items WHERE id=? AND profile_id=? AND kind=?', +p.id, +p.pid, p.kind); return { ok: true }; });

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const PUB = path.join(root, 'public');
http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) {
    const f = path.join(PUB, path.normalize(url.pathname === '/' ? 'index.html' : url.pathname));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res);
  }
  const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  try {
    let raw = ''; for await (const c of req) { raw += c; if (raw.length > 1e5) fail(413, 'Too large'); }
    const b = raw ? JSON.parse(raw) : {};
    for (const [m, rx, f] of R) {
      const mm = m === req.method && rx.exec(url.pathname); if (!mm) continue;
      const open = /\/api\/(register|login|logout)$/.test(url.pathname), u = sessionUser(req);
      if (!u && !open) fail(401, 'Please log in.');
      return send(200, await f({ b, u, p: mm.groups || {}, req, res }));
    }
    fail(404, 'Not found');
  } catch (e) {
    if (e instanceof SyntaxError) return send(400, { error: 'Bad JSON' });
    if (!e.status) console.error(e);
    send(e.status || 500, { error: e.msg || 'Server error' });
  }
}).listen(PORT, () => console.log(`Aura running on http://localhost:${PORT}${KEY ? '' : '  (no ANTHROPIC_API_KEY: chat disabled)'}`));
