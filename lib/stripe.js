/* =============================================================================
   Client Stripe minimal, sans dépendance : l'API REST de Stripe s'appelle
   avec fetch et des paramètres encodés comme un formulaire.

   Variables d'environnement :
     STRIPE_SECRET_KEY      clé secrète (sk_test_… / sk_live_… / rk_…)
     STRIPE_WEBHOOK_SECRET  secret de signature du webhook (whsec_…)
   Aucune des deux ne doit jamais partir vers le navigateur.
   ========================================================================== */
'use strict';

require('./env');

const crypto = require('crypto');

const API = 'https://api.stripe.com/v1';
/* Version d'API figée : le format des réponses ne change pas sous nos pieds
   quand Stripe publie une nouvelle version. */
const API_VERSION = '2025-03-31.basil';
/* Écart toléré entre l'horodatage d'une notification et l'heure du serveur. */
const WEBHOOK_TOLERANCE = 5 * 60;

function secretKey() {
  return String(process.env.STRIPE_SECRET_KEY || '').trim();
}

function enabled() {
  return /^(sk|rk)_(test|live)_/.test(secretKey());
}

function testMode() {
  return /^(sk|rk)_test_/.test(secretKey());
}

/** { a: { b: [1, 2] } } → a[b][0]=1&a[b][1]=2, la notation attendue par Stripe. */
function encode(value, prefix, pairs) {
  const out = pairs || [];
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    value.forEach(function (item, i) { encode(item, prefix + '[' + i + ']', out); });
  } else if (typeof value === 'object') {
    Object.keys(value).forEach(function (key) {
      encode(value[key], prefix ? prefix + '[' + key + ']' : key, out);
    });
  } else {
    out.push(encodeURIComponent(prefix) + '=' + encodeURIComponent(String(value)));
  }
  return out;
}

async function request(method, path, params, options) {
  if (!enabled()) throw new Error('Paiement non configuré : la variable STRIPE_SECRET_KEY manque.');
  const headers = {
    Authorization: 'Bearer ' + secretKey(),
    'Stripe-Version': API_VERSION
  };
  if (options && options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let url = API + path;
  let body;
  const query = encode(params || {}, '').join('&');
  if (method === 'GET') {
    if (query) url += '?' + query;
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = query;
  }

  const response = await fetch(url, { method: method, headers: headers, body: body });
  const payload = await response.json().catch(function () { return {}; });
  if (!response.ok) {
    const error = payload.error || {};
    const err = new Error(error.message || ('Stripe a répondu ' + response.status));
    err.status = response.status;
    err.code = error.code;
    throw err;
  }
  return payload;
}

/** Vérifie l'en-tête Stripe-Signature d'une notification et renvoie
    l'événement. Lève une erreur si la signature ne correspond pas. */
function constructEvent(rawBody, header, secret) {
  const key = String(secret || process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!key) throw new Error('STRIPE_WEBHOOK_SECRET manque.');
  const parts = String(header || '').split(',').reduce(function (acc, part) {
    const at = part.indexOf('=');
    if (at === -1) return acc;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (name === 't') acc.t = value;
    if (name === 'v1') acc.v1.push(value);
    return acc;
  }, { t: '', v1: [] });

  if (!parts.t || !parts.v1.length) throw new Error('Signature Stripe absente.');
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t));
  if (!(age <= WEBHOOK_TOLERANCE)) throw new Error('Notification Stripe trop ancienne.');

  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expected = crypto.createHmac('sha256', key)
    .update(parts.t + '.').update(raw).digest();
  const valid = parts.v1.some(function (candidate) {
    const given = Buffer.from(candidate, 'hex');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  if (!valid) throw new Error('Signature Stripe invalide.');
  return JSON.parse(raw.toString('utf8'));
}

module.exports = { enabled, testMode, request, encode, constructEvent };
