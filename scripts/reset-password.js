#!/usr/bin/env node
/* =============================================================================
   Réinitialise le mot de passe d'un compte du back-office.
   Usage : node scripts/reset-password.js <nouveau mot de passe> [identifiant]

   Avec SUPABASE_SECRET_KEY, la base de référence est celle en ligne : le
   changement y est enregistré (et recopié dans data/store.json), sans quoi il
   serait écrasé au prochain démarrage du serveur.
   ========================================================================== */
'use strict';

require('../lib/env');

const store = require('../lib/store');
const auth = require('../lib/auth');
const remote = require('../lib/remote-store');

const password = process.argv[2];
const username = (process.argv[3] || 'admin').toLowerCase();

if (!password || password.length < 8) {
  console.error('Indiquez un mot de passe d’au moins 8 caractères.');
  console.error('Usage : node scripts/reset-password.js <mot de passe> [identifiant]');
  process.exit(1);
}

async function main() {
  if (remote.enabled()) {
    const online = await remote.pull();
    if (!online) throw new Error('La base en ligne est vide : lancez d’abord « npm run dev » une fois.');
    store.useMemory(online, remote.push, { mirror: true });
  } else if (!store.exists()) {
    throw new Error('data/store.json est absent. Lancez d’abord : node scripts/seed-store.js');
  }

  const result = store.update((data) => {
    const user = data.users.find((u) => u.username === username || u.email === username);
    if (!user) return { error: 'Compte « ' + username + ' » introuvable.' };
    const next = auth.hashPassword(password);
    user.salt = next.salt;
    user.hash = next.hash;
    user.updatedAt = new Date().toISOString();
    store.log(data, 'Mot de passe réinitialisé', username);
    return { ok: true };
  });
  if (result.error) throw new Error(result.error);
  await store.flush();

  console.log('Mot de passe de « ' + username + ' » mis à jour'
    + (remote.enabled() ? ', en local et sur le site en ligne.' : '.'));
  if (!remote.enabled()) console.log('Redémarrez le serveur pour fermer les sessions ouvertes.');
}

main().catch(function (err) {
  console.error(err.message);
  process.exit(1);
});
