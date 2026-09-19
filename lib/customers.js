/* =============================================================================
   Comptes clients de la boutique : inscription, connexion, session.

   Volontairement séparé de lib/auth.js, qui gère le back-office :
   - les clients vivent dans data.customers, jamais dans data.users ;
   - les jetons sont signés avec un secret distinct et portent « kind: client »,
     pour qu'un jeton client ne puisse jamais ouvrir le back-office.

   Pas de confirmation d'adresse ni de fournisseur externe : on crée le compte
   et on connecte dans la foulée.
   ========================================================================== */
'use strict';

const crypto = require('crypto');
const store = require('./store');

const SESSION_DAYS = 30;
const MIN_PASSWORD = 8;
const MAX_ATTEMPTS = 10;
const LOCK_MINUTES = 10;

const attempts = new Map();

/* Le secret est conservé dans la base : contrairement au back-office, un
   redémarrage du serveur ne doit pas déconnecter les clients. Il vit à la
   racine, hors de « settings », qui est envoyé au back-office. */
function secret() {
  const data = store.read();
  if (!data.clientAuth || !data.clientAuth.secret) {
    store.update(function (current) {
      current.clientAuth = { secret: crypto.randomBytes(32).toString('hex') };
    });
  }
  return Buffer.from(store.read().clientAuth.secret, 'hex');
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  return { salt: useSalt, hash: crypto.scryptSync(password, useSalt, 64).toString('hex') };
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* -------------------------------------------------------------------------- */
/* Jetons de session                                                           */
/* -------------------------------------------------------------------------- */

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + mac;
}

function verify(token) {
  if (typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const parts = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(parts[0]).digest('base64url');
  if (!safeEqual(parts[1], expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    /* Un jeton du back-office n'a pas cette marque : il est rejeté ici. */
    if (payload.kind !== 'client') return null;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

function issue(customer) {
  return sign({
    kind: 'client',
    id: customer.id,
    exp: Date.now() + SESSION_DAYS * 24 * 3600 * 1000
  });
}

/* Ce que le navigateur reçoit : jamais le sel ni l'empreinte. */
function publicView(customer) {
  return {
    id: customer.id,
    name: customer.name || '',
    email: customer.email || '',
    createdAt: customer.createdAt || null
  };
}

/* -------------------------------------------------------------------------- */
/* Limitation des tentatives                                                   */
/* -------------------------------------------------------------------------- */

function throttle(key) {
  const entry = attempts.get(key);
  if (entry && entry.until && entry.until > Date.now()) {
    const minutes = Math.ceil((entry.until - Date.now()) / 60000);
    return 'Trop de tentatives. Réessayez dans ' + minutes + ' minute(s).';
  }
  return null;
}

function registerFailure(key) {
  const entry = attempts.get(key) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.until = Date.now() + LOCK_MINUTES * 60000;
    entry.count = 0;
  }
  if (attempts.size > 5000) attempts.clear();
  attempts.set(key, entry);
}

/* -------------------------------------------------------------------------- */
/* Inscription et connexion                                                    */
/* -------------------------------------------------------------------------- */

function register(input) {
  const name = String(input.name || '').trim();
  const email = normalizeEmail(input.email);
  const password = String(input.password || '');

  if (!name) return { error: 'Indiquez votre nom.' };
  if (!validEmail(email)) return { error: 'Indiquez une adresse e-mail valide.' };
  if (password.length < MIN_PASSWORD) {
    return { error: 'Le mot de passe doit contenir au moins ' + MIN_PASSWORD + ' caractères.' };
  }

  return store.update(function (data) {
    const existing = data.customers.find(function (c) { return normalizeEmail(c.email) === email; });

    /* Une fiche déjà saisie au back-office (client connu, sans mot de passe)
       devient son compte : on lui attache des identifiants au lieu de créer
       un doublon. */
    if (existing && existing.hash) {
      return { error: 'Un compte existe déjà avec cette adresse. Connectez-vous.' };
    }

    const credentials = hashPassword(password);
    let customer = existing;
    if (!customer) {
      customer = { id: store.id('cus'), createdAt: new Date().toISOString() };
      data.customers.push(customer);
    }
    customer.name = name;
    customer.email = email;
    customer.salt = credentials.salt;
    customer.hash = credentials.hash;
    customer.updatedAt = new Date().toISOString();
    delete customer.demo;

    store.log(data, existing ? 'Compte client activé' : 'Compte client créé', name + ' — ' + email);
    return { token: issue(customer), customer: publicView(customer) };
  });
}

function login(email, password) {
  const wanted = normalizeEmail(email);
  const blocked = throttle(wanted);
  if (blocked) return { error: blocked };

  const data = store.read();
  const customer = data.customers.find(function (c) { return normalizeEmail(c.email) === wanted; });

  /* Même réponse dans tous les cas : ni l'existence du compte ni l'absence de
     mot de passe ne doivent se deviner. */
  if (!customer || !customer.hash) {
    registerFailure(wanted);
    return { error: 'E-mail ou mot de passe incorrect.' };
  }

  const candidate = hashPassword(String(password || ''), customer.salt);
  if (!safeEqual(candidate.hash, customer.hash)) {
    registerFailure(wanted);
    return { error: 'E-mail ou mot de passe incorrect.' };
  }

  attempts.delete(wanted);
  return { token: issue(customer), customer: publicView(customer) };
}

/** Le client de la session en cours, ou null. */
function fromToken(token) {
  const payload = verify(token);
  if (!payload) return null;
  const customer = store.read().customers.find(function (c) { return c.id === payload.id; });
  if (!customer || !customer.hash) return null;
  return publicView(customer);
}

module.exports = {
  register,
  login,
  fromToken,
  publicView,
  normalizeEmail,
  SESSION_DAYS,
  MIN_PASSWORD
};
