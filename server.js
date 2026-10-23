'use strict';

// Mousejutsu Shenanigans online account/friends web server.
// Uses Node.js built-ins only; no npm dependencies are required.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(48).toString('hex');
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY = 16 * 1024;
const attempts = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}', { mode: 0o600 });

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch (err) { console.error('Could not read users database:', err); return {}; }
}
function saveUsers(users) {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
}
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(payload);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > MAX_BODY) { reject(new Error('Request body too large.')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (_) { reject(new Error('Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}
function tokenFor(username) {
  const payload = Buffer.from(JSON.stringify({ sub: username, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function usernameFromToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) return null;
  const parts = match[1].split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(parts[0]).digest();
  let actual;
  try { actual = Buffer.from(parts[1], 'base64url'); } catch (_) { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub;
  } catch (_) { return null; }
}
function rateLimited(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, start: now };
  if (now - entry.start > 60_000) { entry.count = 0; entry.start = now; }
  entry.count++;
  attempts.set(ip, entry);
  return entry.count > 40;
}
async function passwordHash(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return { salt: salt.toString('hex'), hash: derived.toString('hex') };
}
async function verifyPassword(password, user) {
  const result = await passwordHash(password, user.salt);
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = Buffer.from(result.hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function safeUser(users, key) {
  const user = users[key];
  if (!user) return null;
  return { username: user.username, friends: (user.friends || []).map(friendKey => users[friendKey]).filter(Boolean).map(friend => ({ username: friend.username })) };
}
function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' })[ext] || 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/') && rateLimited(req)) return sendJson(res, 429, { error: 'Too many requests. Please wait a minute and try again.' });

    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, service: 'Mousejutsu Shenanigans' });

    if (req.method === 'POST' && (url.pathname === '/api/register' || url.pathname === '/api/login')) {
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return sendJson(res, 400, { error: 'Use 3–20 letters, numbers, or underscores for your username.' });
      if (password.length < 6 || password.length > 200) return sendJson(res, 400, { error: 'Password must be between 6 and 200 characters.' });
      const key = username.toLowerCase();
      const users = loadUsers();
      if (url.pathname === '/api/register') {
        if (users[key]) return sendJson(res, 409, { error: 'That username already exists. Try signing in.' });
        const credentials = await passwordHash(password);
        users[key] = { username, salt: credentials.salt, passwordHash: credentials.hash, friends: [], createdAt: new Date().toISOString() };
        saveUsers(users);
      } else {
        const user = users[key];
        if (!user || !(await verifyPassword(password, user))) return sendJson(res, 401, { error: 'Incorrect username or password.' });
      }
      return sendJson(res, 200, { token: tokenFor(key), user: safeUser(users, key) });
    }

    if (req.method === 'GET' && url.pathname === '/api/me') {
      const key = usernameFromToken(req);
      const users = loadUsers();
      if (!key || !users[key]) return sendJson(res, 401, { error: 'Your session expired. Please sign in again.' });
      return sendJson(res, 200, { user: safeUser(users, key) });
    }

    if (url.pathname === '/api/friends') {
      const key = usernameFromToken(req);
      const users = loadUsers();
      if (!key || !users[key]) return sendJson(res, 401, { error: 'Please sign in again.' });
      if (req.method === 'GET') return sendJson(res, 200, { friends: safeUser(users, key).friends });
      if (req.method === 'POST') {
        const body = await readBody(req);
        const targetName = String(body.username || '').trim();
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(targetName)) return sendJson(res, 400, { error: 'Enter a valid username (3–20 letters, numbers, or underscores).' });
        const target = targetName.toLowerCase();
        if (target === key) return sendJson(res, 400, { error: 'You cannot add yourself.' });
        if (!users[target]) return sendJson(res, 404, { error: 'No account with that username exists yet.' });
        users[key].friends = Array.isArray(users[key].friends) ? users[key].friends : [];
        users[target].friends = Array.isArray(users[target].friends) ? users[target].friends : [];
        if (users[key].friends.includes(target)) return sendJson(res, 409, { error: 'That player is already your friend.' });
        users[key].friends.push(target);
        users[target].friends.push(key);
        saveUsers(users);
        return sendJson(res, 200, { message: 'Friend added!', friends: safeUser(users, key).friends });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 404, { error: 'Not found.' });
    let requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const fullPath = path.resolve(PUBLIC_DIR, '.' + requested);
    if (!fullPath.startsWith(PUBLIC_DIR + path.sep) && fullPath !== path.join(PUBLIC_DIR, 'index.html')) return sendJson(res, 403, { error: 'Forbidden.' });
    fs.readFile(fullPath, (err, content) => {
      if (err) return sendJson(res, 404, { error: 'File not found.' });
      res.writeHead(200, { 'Content-Type': contentType(fullPath), 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
      res.end(req.method === 'HEAD' ? undefined : content);
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error. Please try again.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Mousejutsu Shenanigans server running at http://localhost:${PORT}`);
  console.log('For public online access, deploy this folder to a Node.js host and set TOKEN_SECRET to a long random secret.');
});
