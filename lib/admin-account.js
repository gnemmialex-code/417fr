/* =============================================================================
   Aligne le compte du back-office sur .env.local au démarrage du serveur.

   ADMIN_EMAILS  : la première adresse devient l'identifiant du compte, pour
                   qu'elle ouvre le back-office.
   ADMIN_PASSWORD: devient le mot de passe du compte.

   Le mot de passe n'est réappliqué que s'il a changé dans .env.local : une
   empreinte de la dernière valeur appliquée est conservée. Un mot de passe
   modifié depuis le back-office n'est donc pas écrasé au redémarrage suivant.
   ========================================================================== */
'use strict';

require('./env');

const crypto = require('crypto');
const store = require('./store');
const auth = require('./auth');

const MIN_PASSWORD = 8;

/* Même valeur par défaut que lib/supabase.js, qui la transmet à la page :
   sans elle, la page reconnaîtrait l'adresse de la boutique et le serveur
   la refuserait (cas du site en ligne, où ADMIN_EMAILS n'est pas défini). */
function adminEmails() {
  return String(process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || 'contact@417france.com')
    .split(',')
    .map(function (email) { return email.trim().toLowerCase(); })
    .filter(Boolean);
}

function sameFingerprint(password, fingerprint) {
  if (!fingerprint || !fingerprint.salt || !fingerprint.hash) return false;
  const candidate = auth.hashPassword(password, fingerprint.salt).hash;
  const a = Buffer.from(candidate);
  const b = Buffer.from(String(fingerprint.hash));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Applique .env.local au compte du back-office. Renvoie de quoi informer
    l'utilisateur au démarrage : identifiants valides et avertissements. */
function sync() {
  if (!store.exists()) {
    return { ready: false, warnings: ['data/store.json est absent : lancez « npm run build ».'] };
  }

  const emails = adminEmails();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const warnings = [];

  if (password && password.length < MIN_PASSWORD) {
    warnings.push('ADMIN_PASSWORD fait moins de ' + MIN_PASSWORD + ' caractères : il est ignoré.');
  }

  const result = store.update(function (data) {
    const user = data.users.find(function (u) { return u.username === 'admin'; }) || data.users[0];
    if (!user) return { ready: false, missing: true };

    const changes = [];

    if (emails.length && user.email !== emails[0]) {
      user.email = emails[0];
      user.updatedAt = new Date().toISOString();
      changes.push('adresse');
    }

    if (password && password.length >= MIN_PASSWORD) {
      if (!data.adminEnv) data.adminEnv = {};
      if (!sameFingerprint(password, data.adminEnv.passwordFingerprint)) {
        const next = auth.hashPassword(password);
        user.salt = next.salt;
        user.hash = next.hash;
        user.updatedAt = new Date().toISOString();
        /* Empreinte de la valeur appliquée, pour ne pas la réappliquer tant
           que .env.local ne change pas. */
        data.adminEnv.passwordFingerprint = auth.hashPassword(password);
        changes.push('mot de passe');
      }
    }

    if (changes.length) {
      store.log(data, 'Compte back-office aligné sur .env.local', changes.join(' et '));
    }

    return {
      ready: true,
      username: user.username,
      email: user.email || '',
      hasPassword: Boolean(user.hash),
      changes: changes
    };
  });

  if (result.missing) {
    return { ready: false, warnings: ['Aucun compte administrateur dans data/store.json.'] };
  }

  if (!password && !result.changes.length) {
    warnings.push('ADMIN_PASSWORD est vide dans .env.local : le mot de passe enregistré est conservé.');
  }

  return Object.assign(result, { warnings: warnings });
}

module.exports = { sync, adminEmails, MIN_PASSWORD };
