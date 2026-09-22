/* =============================================================================
   Routes HTTP du back-office, partagées par les deux façons de servir le site :
   - server.js, le serveur local ;
   - api/backoffice.js, la fonction Vercel du site en ligne.

   Ce module ne sait pas d'où vient la base : c'est l'appelant qui l'a préparée
   (fichier local, ou copie chargée depuis Supabase).
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const store = require('./store');
const remote = require('./remote-store');
const adminAccount = require('./admin-account');
const auth = require('./auth');
const admin = require('./admin-api');
const checkout = require('./checkout');
const relais = require('./relais');
const stripe = require('./stripe');
const labels = require('./labels');

const ADMIN_DIR = path.join(__dirname, '..', 'src', 'admin');
const COOKIE = 'f417_session';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

/* -------------------------------------------------------------------------- */
/* Aides                                                                       */
/* -------------------------------------------------------------------------- */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': MIME['.json'],
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendFile(res, file, status) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(status || 200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store, must-revalidate',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(fs.readFileSync(file));
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': MIME['.html'],
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

/* Sur Vercel, le corps JSON arrive souvent déjà analysé dans req.body. */
function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    try {
      const raw = String(req.body);
      return Promise.resolve(raw ? JSON.parse(raw) : {});
    } catch (err) {
      return Promise.reject(new Error('JSON invalide'));
    }
  }
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(new Error('Corps de requête trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

/* Corps brut, octet pour octet : la signature d'une notification Stripe porte
   sur lui. Sur Vercel, le corps peut déjà avoir été lu et rangé dans req.body. */
function readRaw(req) {
  if (req.readableEnded) {
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    if (typeof req.body === 'string') return Promise.resolve(Buffer.from(req.body, 'utf8'));
    return Promise.reject(new Error('Corps de la notification illisible.'));
  }
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(new Error('Corps de requête trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

/* Adresse du site telle que le client la voit : Stripe y renvoie le client
   après le paiement. Un aperçu Vercel renvoie donc vers lui-même. */
function siteOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const proto = String(req.headers['x-forwarded-proto'] || (local ? 'http' : 'https')).split(',')[0].trim();
  return proto + '://' + host;
}

/* En ligne, le site est servi en HTTPS : le cookie ne doit jamais partir en
   clair. En local (http://localhost), l'attribut Secure l'empêcherait d'être
   enregistré. */
function sessionCookie(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return COOKIE + '=' + encodeURIComponent(value)
    + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + secure;
}

/* Garde-fou de débit du paiement : ouvrir une session Stripe coûte un appel
   d'API, un robot ne doit pas pouvoir en ouvrir des milliers. */
const CHECKOUT_WINDOW = 10 * 60 * 1000;
const CHECKOUT_MAX = 20;
const checkoutHits = new Map();

function checkoutAllowed(ip) {
  const now = Date.now();
  const hits = (checkoutHits.get(ip) || []).filter(function (at) { return now - at < CHECKOUT_WINDOW; });
  if (checkoutHits.size > 5000) checkoutHits.clear();
  if (hits.length >= CHECKOUT_MAX) {
    checkoutHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  checkoutHits.set(ip, hits);
  return true;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'inconnu';
}

const CONTACT_WINDOW = 10 * 60 * 1000;
const CONTACT_MAX = 5;
const contactHits = new Map();

function contactAllowed(ip) {
  const now = Date.now();
  const hits = (contactHits.get(ip) || []).filter(function (at) { return now - at < CONTACT_WINDOW; });
  /* La table ne grossit pas indéfiniment : les adresses inactives sortent. */
  if (contactHits.size > 5000) contactHits.clear();
  if (hits.length >= CONTACT_MAX) {
    contactHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  contactHits.set(ip, hits);
  return true;
}

function session(req) {
  const payload = auth.verify(auth.readCookie(req.headers.cookie, COOKIE));
  /* Une session du back-office porte toujours un rôle : exiger ce champ
     empêche qu'un jeton d'une autre origine ouvre l'administration. */
  return payload && payload.role ? payload : null;
}

function resolveStatic(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const safe = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const candidate = path.join(root, safe);
  if (!candidate.startsWith(root)) return null;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  const withIndex = path.join(candidate, 'index.html');
  if (fs.existsSync(withIndex)) return withIndex;
  const withHtml = candidate + '.html';
  if (fs.existsSync(withHtml)) return withHtml;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

async function handleApi(req, res, pathname) {
  /* Notification de paiement envoyée par Stripe : elle n'a pas l'en-tête des
     appels fetch, et c'est sa signature qui prouve son origine. */
  if (pathname === '/api/stripe-webhook' && req.method === 'POST') {
    const raw = await readRaw(req);
    let event;
    try {
      event = stripe.constructEvent(raw, req.headers['stripe-signature']);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    /* Une erreur ici répond 400 : Stripe renverra la notification plus tard. */
    const result = await checkout.handleEvent(event, siteOrigin(req));
    return sendJson(res, 200, { received: true, order: result && result.order ? result.order.ref : undefined });
  }

  /* Empêche l'envoi d'une requête depuis un formulaire tiers : seul un appel
     fetch de même origine peut poser cet en-tête. */
  if (req.method === 'POST' && req.headers['x-requested-with'] !== 'fetch') {
    return sendJson(res, 400, { error: 'Requête non reconnue.' });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const result = auth.login(body.username, body.password);
    if (result.error) return sendJson(res, 401, { error: result.error });
    res.setHeader('Set-Cookie', sessionCookie(req, result.token, auth.SESSION_HOURS * 3600));
    store.update(function (data) { store.log(data, 'Connexion', result.user.username); });
    return sendJson(res, 200, { user: result.user });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return sendJson(res, 200, { ok: true });
  }

  /* Formulaires de la boutique. Seule route ouverte sans session : c'est le
     visiteur qui écrit, il n'a pas de compte. En ligne, api/contact.js répond
     à sa place et envoie le message par e-mail. */
  if (pathname === '/api/contact' && req.method === 'POST') {
    const ip = (req.socket && req.socket.remoteAddress) || 'inconnu';
    if (!contactAllowed(ip)) {
      return sendJson(res, 429, { error: 'Trop d’envois. Réessayez dans quelques minutes.' });
    }
    const body = await readBody(req);
    /* Champ piège rempli : c'est un robot. On répond comme si de rien n'était
       plutôt que de lui apprendre ce qui l'a trahi. */
    if (String(body.website || '').trim()) return sendJson(res, 200, { ok: true });
    /* « sujet » est le nom posé par le formulaire de la boutique. */
    const result = admin.receiveMessage({
      kind: body.kind || body.sujet,
      name: body.name,
      email: body.email,
      phone: body.phone,
      message: body.message
    });
    if (result.error) return sendJson(res, 400, { error: result.error });
    return sendJson(res, 200, { ok: true });
  }

  /* ----- Boutique : points relais et paiement -----
     Ouverts sans session, comme les formulaires : c'est le visiteur qui paie. */
  if (pathname === '/api/relais' && req.method === 'GET') {
    const query = new URL(req.url, 'http://localhost').searchParams;
    try {
      const found = await relais.search(query.get('transporteur'), query.get('cp'), query.get('ville'));
      if (found.error) return sendJson(res, 400, found);
      return sendJson(res, 200, found);
    } catch (err) {
      return sendJson(res, 502, { error: 'La recherche de points relais ne répond pas. Réessayez dans un instant.' });
    }
  }

  /* Retour de Stripe sur /commande/merci : filet de sécurité si la
     notification de Stripe tarde ou se perd. */
  if (pathname === '/api/commande' && req.method === 'GET') {
    const query = new URL(req.url, 'http://localhost').searchParams;
    try {
      const result = await checkout.confirmSession(query.get('session_id'), siteOrigin(req));
      if (result.error) return sendJson(res, 400, { error: result.error });
      return sendJson(res, 200, result);
    } catch (err) {
      console.error('Confirmation de commande : ' + err.message);
      return sendJson(res, 502, { error: 'Confirmation impossible pour le moment.' });
    }
  }

  if (pathname === '/api/checkout' && req.method === 'POST') {
    if (!checkoutAllowed(clientIp(req))) {
      return sendJson(res, 429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    }
    const body = await readBody(req);
    try {
      const result = await checkout.createSession(store.read(), body, siteOrigin(req));
      if (result.error) return sendJson(res, 400, { error: result.error });
      return sendJson(res, 200, { url: result.url });
    } catch (err) {
      console.error('Paiement : ' + err.message);
      return sendJson(res, 502, { error: 'Le paiement n’a pas pu être ouvert. Réessayez dans un instant.' });
    }
  }

  /* ----- Pont espace client → back-office -----
     Les comptes clients vivent chez Supabase : la page leur parle
     directement. Seule l'adresse de la boutique passe par ici : saisie dans
     l'espace client avec le mot de passe du back-office, elle ouvre /admin.
     Elle précède le contrôle de session, puisque c'est elle qui l'ouvre. */
  if (pathname === '/api/compte/admin' && req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    if (adminAccount.adminEmails().indexOf(email) === -1) {
      return sendJson(res, 403, { error: 'Cette adresse n’ouvre pas le back-office.' });
    }
    const admis = auth.login(email, body.password);
    if (admis.error) return sendJson(res, 401, { error: admis.error });
    res.setHeader('Set-Cookie', sessionCookie(req, admis.token, auth.SESSION_HOURS * 3600));
    store.update(function (data) { store.log(data, 'Connexion', admis.user.username); });
    return sendJson(res, 200, { redirect: '/admin' });
  }

  const user = session(req);
  if (!user) return sendJson(res, 401, { error: 'Session expirée. Reconnectez-vous.' });

  if (pathname === '/api/state' && req.method === 'GET') {
    return sendJson(res, 200, admin.state(user));
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const result = await admin.command(pathname.replace('/api/', ''), body, user);
    if (!result) return sendJson(res, 404, { error: 'Action inconnue.' });
    if (result.error) return sendJson(res, 400, { error: result.error });
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: 'Route inconnue.' });
}

async function handleAdmin(req, res, pathname) {
  const user = session(req);

  if (pathname === '/admin/login') {
    if (user) return redirect(res, '/admin');
    return sendFile(res, path.join(ADMIN_DIR, 'login.html'));
  }

  if (pathname.indexOf('/admin/assets/') === 0) {
    const file = resolveStatic(ADMIN_DIR, pathname.replace('/admin/', ''));
    if (!file) return sendHtml(res, 404, 'Introuvable');
    return sendFile(res, file);
  }

  if (!user) return redirect(res, '/admin/login');

  /* Étiquette du transporteur, en PDF, telle qu'achetée. */
  if (pathname.indexOf('/admin/etiquette/') === 0) {
    const orderId = pathname.slice('/admin/etiquette/'.length);
    const order = store.read().orders.find(function (o) { return o.id === orderId; });
    const pdf = await labels.readFile(order);
    if (!pdf) return sendHtml(res, 404, 'Étiquette introuvable');
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="bordereau-' + String(order.ref).replace(/[^A-Za-z0-9-]/g, '') + '.pdf"',
      'Cache-Control': 'private, no-store',
      'Content-Length': pdf.length
    });
    return res.end(pdf);
  }

  /* Récapitulatif seul, sans l'étiquette du transporteur. */
  if (pathname.indexOf('/admin/recapitulatif/') === 0) {
    const html = admin.deliveryNote(pathname.slice('/admin/recapitulatif/'.length), { recapOnly: true });
    if (!html) return sendHtml(res, 404, 'Commande introuvable');
    return sendHtml(res, 200, html);
  }

  if (pathname.indexOf('/admin/bordereau/') === 0) {
    const orderId = pathname.slice('/admin/bordereau/'.length);
    const html = admin.deliveryNote(orderId);
    if (!html) return sendHtml(res, 404, 'Commande introuvable');
    return sendHtml(res, 200, html);
  }

  if (pathname === '/admin' || pathname === '/admin/') {
    return sendFile(res, path.join(ADMIN_DIR, 'index.html'));
  }

  return redirect(res, '/admin');
}

/* -------------------------------------------------------------------------- */
/* Point d'entrée : base locale ou base en ligne                               */
/* -------------------------------------------------------------------------- */

function unavailable(res, isApi, message) {
  if (isApi) return sendJson(res, 503, { error: message });
  return sendHtml(res, 503, '<!doctype html><meta charset="utf-8"><title>Back-office indisponible</title>'
    + '<body style="font-family:system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:0 16px;line-height:1.5">'
    + '<h1 style="font-size:1.3rem">Back-office indisponible</h1><p>' + message
    + '</p><p><a href="/">Retour à la boutique</a></p>');
}

/** Sert une requête /api/* ou /admin*.
    Avec SUPABASE_SECRET_KEY, la base est chargée depuis Supabase pour la
    durée de la requête, et la réponse ne part qu'une fois les modifications
    enregistrées : un « enregistré » affiché est un enregistrement réel.
    options.mirror    recopie aussi la base dans data/store.json (poste local)
    options.required  refuse de servir sans base en ligne (site publié) */
async function handle(req, res, pathname, options) {
  const opts = options || {};
  const isApi = pathname.indexOf('/api/') === 0;
  const route = isApi ? handleApi : handleAdmin;

  /* La recherche de points relais n'a pas besoin de la base. */
  if (pathname === '/api/relais') return handleApi(req, res, pathname);

  if (!remote.enabled()) {
    if (opts.required) {
      return unavailable(res, isApi, 'Le back-office en ligne n’est pas configuré : la variable SUPABASE_SECRET_KEY manque dans le projet Vercel.');
    }
    return route(req, res, pathname);
  }

  let data;
  try {
    data = await remote.pull();
  } catch (err) {
    return unavailable(res, isApi, 'La base du back-office est injoignable pour le moment. ' + err.message);
  }
  if (!data) {
    return unavailable(res, isApi, 'La base du back-office n’a pas encore été envoyée en ligne. Lancez une fois « npm run dev » sur le poste de gestion, avec SUPABASE_SECRET_KEY dans .env.local.');
  }
  store.useMemory(data, remote.push, { mirror: Boolean(opts.mirror) });

  /* La réponse est retenue le temps de l'enregistrement : si Supabase refuse,
     on répond par une erreur au lieu d'un succès mensonger. */
  const retenue = { status: 200, headers: undefined, body: undefined };
  const writeHead = res.writeHead;
  const end = res.end;
  res.writeHead = function (status, headers) {
    retenue.status = status;
    retenue.headers = headers;
    return res;
  };
  res.end = function (body) {
    retenue.body = body;
    return res;
  };

  try {
    await route(req, res, pathname);
  } catch (err) {
    retenue.status = 400;
    retenue.headers = { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' };
    retenue.body = JSON.stringify({ error: err.message });
  }

  try {
    await store.flush();
  } catch (err) {
    res.removeHeader('Set-Cookie');
    retenue.status = 500;
    retenue.headers = { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' };
    retenue.body = JSON.stringify({ error: 'Enregistrement impossible : ' + err.message });
  }

  res.writeHead = writeHead;
  res.end = end;
  res.writeHead(retenue.status, retenue.headers);
  res.end(retenue.body);
}

/** Démarrage du serveur local avec une base en ligne : crée le compartiment
    au besoin, envoie la base locale si la base en ligne est vide, sinon
    recopie la base en ligne dans data/store.json. */
async function prepareLocal() {
  if (!remote.enabled()) return { mode: 'local' };
  await remote.ensureBucket();
  const online = await remote.pull();
  if (!online) {
    if (!fs.existsSync(store.FILE)) {
      return { mode: 'online', warning: 'Base en ligne vide et aucune base locale à envoyer : lancez « npm run build ».' };
    }
    const local = JSON.parse(fs.readFileSync(store.FILE, 'utf8'));
    await remote.push(local);
    store.useMemory(local, remote.push, { mirror: true });
    return { mode: 'online', uploaded: true };
  }
  store.useMemory(online, remote.push, { mirror: true });
  /* Copie locale seulement : renvoyer ce qu'on vient de lire serait inutile. */
  fs.mkdirSync(path.dirname(store.FILE), { recursive: true });
  fs.writeFileSync(store.FILE, JSON.stringify(online, null, 2), 'utf8');
  return { mode: 'online', uploaded: false };
}

module.exports = {
  handle,
  prepareLocal,
  handleApi,
  handleAdmin,
  sendJson,
  sendFile,
  sendHtml,
  resolveStatic,
  MIME
};
