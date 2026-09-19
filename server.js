#!/usr/bin/env node
/* =============================================================================
   417 France - serveur local : boutique statique + back-office
   Usage : node server.js [port]

   Les routes du back-office vivent dans lib/backoffice-http.js : le site en
   ligne les sert avec les mêmes règles, depuis api/backoffice.js.
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
const backoffice = require('./lib/backoffice-http');

const DIST = path.join(__dirname, 'dist');
const PREVIEW_DIR = path.join(__dirname, 'src', 'preview');
const PORT = Number(process.argv[2] || process.env.PORT || 4170);

const server = http.createServer(function (req, res) {
  const pathname = new URL(req.url, 'http://localhost:' + PORT).pathname;

  if (pathname.indexOf('/api/') === 0 || pathname === '/admin' || pathname.indexOf('/admin/') === 0) {
    backoffice.handle(req, res, pathname, { mirror: true }).catch(function (err) {
      if (!res.headersSent) backoffice.sendJson(res, 400, { error: err.message });
    });
    return;
  }

  /* Aperçu mobile : le site réel dans un cadre de téléphone. */
  if (pathname === '/preview' || pathname === '/preview/') {
    return backoffice.sendFile(res, path.join(PREVIEW_DIR, 'index.html'));
  }

  const file = backoffice.resolveStatic(DIST, pathname);
  if (!file) {
    const notFound = path.join(DIST, '404.html');
    if (fs.existsSync(notFound)) return backoffice.sendFile(res, notFound, 404);
    return backoffice.sendHtml(res, 404, 'Page introuvable');
  }
  return backoffice.sendFile(res, file);
});

server.listen(PORT, async function () {
  /* Avec SUPABASE_SECRET_KEY, la base du back-office est celle du site en
     ligne : on la récupère (ou on l'envoie si elle est encore vide) avant
     toute chose. */
  let base = { mode: 'local' };
  try {
    base = await backoffice.prepareLocal();
  } catch (err) {
    base = { mode: 'erreur', warning: 'Base en ligne injoignable : ' + err.message };
  }

  /* Le compte du back-office suit .env.local : on l'aligne avant d'annoncer
     les identifiants, pour que ce qui est affiché soit ce qui fonctionne. */
  const admin417 = adminAccount.sync();
  try {
    await store.flush();
  } catch (err) {
    admin417.warnings = (admin417.warnings || []).concat('Compte non enregistré en ligne : ' + err.message);
  }

  console.log('');
  console.log('  417 France');
  console.log('  Boutique     http://localhost:' + PORT);
  console.log('  Back-office  http://localhost:' + PORT + '/admin');
  console.log('  Aperçu mobile http://localhost:' + PORT + '/preview');
  console.log('');
  console.log('  Base du back-office : ' + (base.mode === 'online'
    ? 'en ligne (Supabase), partagée avec le site publié'
    + (base.uploaded ? ' — base locale envoyée pour la première fois' : '')
    : base.mode === 'erreur' ? 'ERREUR, voir ci-dessous' : 'locale (data/store.json)'));
  if (base.warning) console.log('  ! ' + base.warning);
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
