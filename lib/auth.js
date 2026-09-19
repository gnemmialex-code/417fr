/* =============================================================================
   Authentification du back-office : hachage scrypt et sessions signées.
   ========================================================================== */
'use strict';

const crypto = require('crypto');
const store = require('./store');

const SESSION_HOURS = 12;
const MAX_ATTEMPTS = 8;
const LOCK_MINUTES = 10;

/* Secret de signature des cookies, régénéré à chaque démarrage du serveur :
   redémarrer le serveur invalide les sessions ouvertes. */
const SECRET = crypto.randomBytes(32);

const attempts = new Map();

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, useSalt, 64).toString('hex');
  return { salt: useSalt, hash: derived };
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + mac;
}

function verify(token) {
  if (typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const parts = token.split('.');
  const body = parts[0];
  const mac = parts[1];
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!safeEqual(mac, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

/** Limite les essais par identifiant pour freiner les tentatives répétées. */
function throttle(username) {
  const entry = attempts.get(username);
  if (!entry) return null;
  if (entry.until && entry.until > Date.now()) {
    const minutes = Math.ceil((entry.until - Date.now()) / 60000);
    return 'Trop de tentatives. Réessayez dans ' + minutes + ' minute(s).';
  }
  return null;
}

function registerFailure(username) {
  const entry = attempts.get(username) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.until = Date.now() + LOCK_MINUTES * 60000;
    entry.count = 0;
  }
  attempts.set(username, entry);
}

/** L'identifiant peut être le nom du compte ou son adresse e-mail. */
function login(username, password) {
  const blocked = throttle(username);
  if (blocked) return { error: blocked };

  const data = store.read();
  const wanted = String(username || '').toLowerCase().trim();
  const user = data.users.find((u) => u.username === wanted || (u.email && u.email.toLowerCase() === wanted));
  if (!user) {
    registerFailure(username);
    return { error: 'Identifiant ou mot de passe incorrect.' };
  }

  const candidate = hashPassword(String(password || ''), user.salt);
  if (!safeEqual(candidate.hash, user.hash)) {
    registerFailure(username);
    return { error: 'Identifiant ou mot de passe incorrect.' };
  }

  attempts.delete(username);
  return issue(user);
}

/** Session du back-office pour un compte dont l'identité est déjà prouvée :
    mot de passe local vérifié, ou session Supabase sur l'adresse de la
    boutique. */
function issue(user) {
  const token = sign({
    username: user.username,
    role: user.role,
    exp: Date.now() + SESSION_HOURS * 3600 * 1000
  });
  return { token: token, user: { username: user.username, role: user.role } };
}

function changePassword(username, currentPassword, nextPassword) {
  if (String(nextPassword || '').length < 8) {
    return { error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' };
  }
  return store.update((data) => {
    const user = data.users.find((u) => u.username === username);
    if (!user) return { error: 'Compte introuvable.' };
    const candidate = hashPassword(String(currentPassword || ''), user.salt);
    if (!safeEqual(candidate.hash, user.hash)) {
      return { error: 'Mot de passe actuel incorrect.' };
    }
    const next = hashPassword(String(nextPassword));
    user.salt = next.salt;
    user.hash = next.hash;
    user.updatedAt = new Date().toISOString();
    store.log(data, 'Mot de passe modifié', username);
    return { ok: true };
  });
}

function readCookie(header, name) {
  if (!header) return null;
  const parts = header.split(';');
  for (let i = 0; i < parts.length; i += 1) {
    const pair = parts[i].trim();
    if (pair.indexOf(name + '=') === 0) return decodeURIComponent(pair.slice(name.length + 1));
  }
  return null;
}

module.exports = {
  hashPassword,
  login,
  issue,
  verify,
  changePassword,
  readCookie,
  SESSION_HOURS
};
