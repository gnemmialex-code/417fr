#!/usr/bin/env node
/* =============================================================================
   Réinitialise le mot de passe d'un compte du back-office.
   Usage : node scripts/reset-password.js <nouveau mot de passe> [identifiant]
   ========================================================================== */
'use strict';

const store = require('../lib/store');
const auth = require('../lib/auth');

const password = process.argv[2];
const username = (process.argv[3] || 'admin').toLowerCase();

if (!password || password.length < 8) {
  console.error('Indiquez un mot de passe d’au moins 8 caractères.');
  console.error('Usage : node scripts/reset-password.js <mot de passe> [identifiant]');
  process.exit(1);
}

if (!store.exists()) {
  console.error('data/store.json est absent. Lancez d’abord : node scripts/seed-store.js');
  process.exit(1);
}

const result = store.update((data) => {
  const user = data.users.find((u) => u.username === username);
  if (!user) return { error: 'Compte « ' + username + ' » introuvable.' };
  const next = auth.hashPassword(password);
  user.salt = next.salt;
  user.hash = next.hash;
  user.updatedAt = new Date().toISOString();
  store.log(data, 'Mot de passe réinitialisé', username);
  return { ok: true };
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

console.log('Mot de passe de « ' + username + ' » mis à jour.');
console.log('Redémarrez le serveur pour fermer les sessions ouvertes.');
