import crypto from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
import mongoose from 'mongoose';
import { config } from './config.js';
import { Staff, getSetting, setSetting } from './models.js';
import { clean } from './lib/gujarati.js';

/**
 * Staff accounts: everyone signs in with their own username and password.
 * The very first account is made from the sign-in screen and is an admin; admins add the others.
 * The login cookie is signed with a secret kept in the database and names the staff member,
 * so switching an account off or resetting its password signs that person out at once.
 */
export const staffAuth = express.Router();

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'sfs';
const DAYS = 30;
const MIN_PASSWORD = 6;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(String(password), Buffer.from(salt, 'hex'), 64);
  const want = Buffer.from(hash, 'hex');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

let secret = null;
async function sessionSecret() {
  if (secret) return secret;
  secret = await getSetting('sessionSecret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    await setSetting('sessionSecret', secret);
  }
  return secret;
}

const sign = (body, key) => crypto.createHmac('sha256', key).update(body).digest('hex');

async function makeCookie(s) {
  const expires = Date.now() + DAYS * 86400000;
  const body = `${s._id}.${s.sessionVersion}.${expires}`;
  return `${COOKIE}=${body}.${sign(body, await sessionSecret())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DAYS * 86400}${config.hosted ? '; Secure' : ''}`;
}

const readCookie = (req) =>
  (req.headers.cookie || '')
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);

// Signed-in staff, kept in memory for a minute so a page with many requests asks the database once.
const known = new Map();
const forget = (id) => known.delete(String(id));

async function staffFromRequest(req) {
  const raw = readCookie(req);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [id, version, expires, mac] = parts;
  const want = sign(`${id}.${version}.${expires}`, await sessionSecret());
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  if (Number(expires) < Date.now() || !mongoose.isValidObjectId(id)) return null;
  let hit = known.get(id);
  if (!hit || hit.at < Date.now() - 60000) {
    const s = await Staff.findById(id, { passwordHash: 0 }).lean();
    hit = { at: Date.now(), s };
    known.set(id, hit);
  }
  const s = hit.s;
  return s && s.active && String(s.sessionVersion) === version ? s : null;
}

export const publicStaff = (s) => ({ id: String(s._id), name: s.name, username: s.username, mobile: s.mobile || '', admin: !!s.admin, active: s.active !== false, lastLoginAt: s.lastLoginAt, createdAt: s.createdAt });

// Wrong passwords: after 5 tries for one username, wait a minute.
const failures = new Map();
const blocked = (u) => {
  const f = failures.get(u);
  return f && f.count >= 5 && Date.now() - f.at < 60000;
};
const failed = (u) => {
  const f = failures.get(u);
  failures.set(u, { count: f && Date.now() - f.at < 60000 ? f.count + 1 : 1, at: Date.now() });
};

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const username = (u) => clean(u).toLowerCase().replace(/\s+/g, '');
const validUsername = (u) => /^[a-z0-9._-]{3,30}$/.test(u);
const passwordProblem = (p) => (String(p || '').length < MIN_PASSWORD ? `The password needs at least ${MIN_PASSWORD} characters` : '');

staffAuth.get(
  '/me',
  wrap(async (req, res) => {
    const setupNeeded = (await Staff.estimatedDocumentCount()) === 0;
    const s = setupNeeded ? null : await staffFromRequest(req);
    res.json({ loginRequired: true, setupNeeded, loggedIn: !!s, user: s ? publicStaff(s) : null });
  })
);

// The first account (an admin), made from the sign-in screen. Only while there is no account at all.
staffAuth.post(
  '/setup',
  wrap(async (req, res) => {
    if ((await Staff.estimatedDocumentCount()) > 0) return res.status(400).json({ error: 'The first account has already been made. Please log in.' });
    const b = req.body || {};
    const u = username(b.username);
    if (!clean(b.name)) return res.status(400).json({ error: 'Type your name' });
    if (!validUsername(u)) return res.status(400).json({ error: 'The username needs 3 to 30 letters or numbers, without spaces' });
    const bad = passwordProblem(b.password);
    if (bad) return res.status(400).json({ error: bad });
    const s = await Staff.create({ name: clean(b.name), username: u, mobile: clean(b.mobile), passwordHash: await hashPassword(b.password), admin: true, lastLoginAt: new Date() });
    res.setHeader('Set-Cookie', await makeCookie(s));
    res.json({ ok: true });
  })
);

staffAuth.post(
  '/login',
  wrap(async (req, res) => {
    const u = username(req.body?.username);
    if (blocked(u)) return res.status(429).json({ error: 'Too many wrong passwords. Wait a minute and try again.' });
    const s = u ? await Staff.findOne({ username: u }) : null;
    const ok = s && s.active && (await checkPassword(req.body?.password, s.passwordHash));
    if (!ok) {
      failed(u);
      return res.status(401).json({ error: s && !s.active ? 'This account is switched off. Ask the admin.' : 'Wrong username or password' });
    }
    failures.delete(u);
    s.lastLoginAt = new Date();
    await s.save();
    forget(s._id);
    res.setHeader('Set-Cookie', await makeCookie(s));
    res.json({ ok: true });
  })
);

staffAuth.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

// Everything after this needs a signed-in staff member; req.staff is who it is.
staffAuth.use(
  wrap(async (req, res, next) => {
    const s = await staffFromRequest(req);
    if (!s) return res.status(401).json({ error: 'Login required' });
    req.staff = s;
    next();
  })
);

// Own password.
staffAuth.post(
  '/me/password',
  wrap(async (req, res) => {
    const s = await Staff.findById(req.staff._id);
    if (!(await checkPassword(req.body?.current, s.passwordHash))) return res.status(400).json({ error: 'The current password is wrong' });
    const bad = passwordProblem(req.body?.password);
    if (bad) return res.status(400).json({ error: bad });
    s.passwordHash = await hashPassword(req.body.password);
    s.sessionVersion += 1; // signs out other devices
    await s.save();
    forget(s._id);
    res.setHeader('Set-Cookie', await makeCookie(s));
    res.json({ ok: true });
  })
);

// ---------- staff list (admins) ----------
const adminOnly = (req, res, next) => (req.staff.admin ? next() : res.status(403).json({ error: 'Only an admin can manage staff' }));
const activeAdmins = () => Staff.countDocuments({ admin: true, active: true });

staffAuth.get(
  '/staff',
  adminOnly,
  wrap(async (req, res) => res.json({ staff: (await Staff.find({}, { passwordHash: 0 }).sort({ active: -1, name: 1 }).lean()).map(publicStaff) }))
);

staffAuth.post(
  '/staff',
  adminOnly,
  wrap(async (req, res) => {
    const b = req.body || {};
    const u = username(b.username);
    if (!clean(b.name)) return res.status(400).json({ error: 'Type the name' });
    if (!validUsername(u)) return res.status(400).json({ error: 'The username needs 3 to 30 letters or numbers, without spaces' });
    if (await Staff.exists({ username: u })) return res.status(409).json({ error: `The username "${u}" is already taken` });
    const bad = passwordProblem(b.password);
    if (bad) return res.status(400).json({ error: bad });
    const s = await Staff.create({ name: clean(b.name), username: u, mobile: clean(b.mobile), passwordHash: await hashPassword(b.password), admin: !!b.admin });
    res.json({ staff: publicStaff(s) });
  })
);

staffAuth.patch(
  '/staff/:id',
  adminOnly,
  wrap(async (req, res) => {
    const s = mongoose.isValidObjectId(req.params.id) ? await Staff.findById(req.params.id) : null;
    if (!s) return res.status(404).json({ error: 'This staff member was not found' });
    const b = req.body || {};
    const self = String(s._id) === String(req.staff._id);
    if (typeof b.name === 'string' && clean(b.name)) s.name = clean(b.name);
    if (typeof b.mobile === 'string') s.mobile = clean(b.mobile);
    // There must always be one admin who can still sign in.
    const losesAdmin = (b.admin === false && s.admin) || (b.active === false && s.active && s.admin);
    if (losesAdmin && (await activeAdmins()) <= 1) return res.status(400).json({ error: 'This is the only admin. Make someone else an admin first.' });
    if (self && b.active === false) return res.status(400).json({ error: 'You cannot switch off your own account' });
    if (typeof b.admin === 'boolean') s.admin = b.admin;
    if (typeof b.active === 'boolean' && b.active !== s.active) {
      s.active = b.active;
      s.sessionVersion += 1;
    }
    if (b.password !== undefined) {
      const bad = passwordProblem(b.password);
      if (bad) return res.status(400).json({ error: bad });
      s.passwordHash = await hashPassword(b.password);
      s.sessionVersion += 1; // the old password's sign-ins end
    }
    await s.save();
    forget(s._id);
    if (self && b.password !== undefined) res.setHeader('Set-Cookie', await makeCookie(s));
    res.json({ staff: publicStaff(s) });
  })
);
