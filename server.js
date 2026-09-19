#!/usr/bin/env node
/* =============================================================================
   417 France - serveur local : boutique statique + back-office
   Usage : node server.js [port]
   ========================================================================== */
'use strict';

/* Charge .env.local avant tout le reste : ADMIN_EMAILS, ADMIN_PASSWORD,
   SITE_URL et les clés y sont lues. */
require('./lib/env');

const http = require('http');
const fs = require('fs');
const path = require('path');

const store = require('./lib/store');
const adminAccount = require('./lib/admin-account');
const auth = require('./lib/auth');
const admin = require('./lib/admin-api');

const DIST = path.join(__dirname, 'dist');
const ADMIN_DIR = path.join(__dirname, 'src', 'admin');
const PREVIEW_DIR = path.join(__dirname, 'src', 'preview');
const PORT = Number(process.argv[2] || process.env.PORT || 4170);
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
  fs.createReadStream(file).pipe(res);
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

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > 1024 * 1024) {
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
  /* Empêche l'envoi d'une requête depuis un formulaire tiers : seul un appel
     fetch de même origine peut poser cet en-tête. */
  if (req.method === 'POST' && req.headers['x-requested-with'] !== 'fetch') {
    return sendJson(res, 400, { error: 'Requête non reconnue.' });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const result = auth.login(body.username, body.password);
    if (result.error) return sendJson(res, 401, { error: result.error });
    res.setHeader('Set-Cookie', COOKIE + '=' + encodeURIComponent(result.token)
      + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + auth.SESSION_HOURS * 3600);
    store.update(function (data) { store.log(data, 'Connexion', result.user.username); });
    return sendJson(res, 200, { user: result.user });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  /* Formulaires de la boutique. Seule route ouverte sans session : c'est le
     visiteur qui écrit, il n'a pas de compte. */
  if (pathname === '/api/contact' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'inconnu';
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

  /* ----- Pont espace client → back-office -----
     Les comptes clients vivent chez Supabase : la page leur parle
     directement, le serveur n'y est pour rien. Seule l'adresse de la boutique
     passe par ici : saisie dans l'espace client avec le mot de passe du
     back-office, elle ouvre /admin. Cette route n'existe qu'en local ; en
     ligne, la page l'annonce. Elle précède le contrôle de session, puisque
     c'est elle qui l'ouvre. */
  if (pathname === '/api/compte/admin' && req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    if (adminAccount.adminEmails().indexOf(email) === -1) {
      return sendJson(res, 403, { error: 'Cette adresse n’ouvre pas le back-office.' });
    }
    const admis = auth.login(email, body.password);
    if (admis.error) return sendJson(res, 401, { error: admis.error });
    res.setHeader('Set-Cookie', COOKIE + '=' + encodeURIComponent(admis.token)
      + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + auth.SESSION_HOURS * 3600);
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

function handleAdmin(req, res, pathname) {
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

const server = http.createServer(function (req, res) {
  const pathname = new URL(req.url, 'http://localhost:' + PORT).pathname;

  if (pathname.indexOf('/api/') === 0) {
    handleApi(req, res, pathname).catch(function (err) {
      sendJson(res, 400, { error: err.message });
    });
    return;
  }

  if (pathname === '/admin' || pathname.indexOf('/admin/') === 0) {
    return handleAdmin(req, res, pathname);
  }

  /* Aperçu mobile : le site réel dans un cadre de téléphone. */
  if (pathname === '/preview' || pathname === '/preview/') {
    return sendFile(res, path.join(PREVIEW_DIR, 'index.html'));
  }

  const file = resolveStatic(DIST, pathname);
  if (!file) {
    const notFound = path.join(DIST, '404.html');
    if (fs.existsSync(notFound)) return sendFile(res, notFound, 404);
    return sendHtml(res, 404, 'Page introuvable');
  }
  return sendFile(res, file);
});

server.listen(PORT, function () {
  /* Le compte du back-office suit .env.local : on l'aligne avant d'annoncer
     les identifiants, pour que ce qui est affiché soit ce qui fonctionne. */
  const admin417 = adminAccount.sync();

  console.log('');
  console.log('  417 France');
  console.log('  Boutique     http://localhost:' + PORT);
  console.log('  Back-office  http://localhost:' + PORT + '/admin');
  console.log('  Aperçu mobile http://localhost:' + PORT + '/preview');
  console.log('');

  if (admin417.ready) {
    console.log('  Connexion au back-office');
    console.log('    Adresse      ' + (admin417.email || '(aucune)'));
    console.log('    Identifiant  ' + admin417.username + '  (les deux fonctionnent)');
    console.log('    Mot de passe ' + (admin417.hasPassword
      ? 'celui de ADMIN_PASSWORD dans .env.local'
      : 'aucun : lancez « npm run password -- <mot de passe> »'));
    if (admin417.changes.length) {
      console.log('    Mis à jour depuis .env.local : ' + admin417.changes.join(', ') + '.');
    }
  }

  (admin417.warnings || []).forEach(function (warning) {
    console.log('  ! ' + warning);
  });

  console.log('');
  console.log('  Ctrl+C pour arrêter le serveur.');
});
