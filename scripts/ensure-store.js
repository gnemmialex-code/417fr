#!/usr/bin/env node
/* =============================================================================
   Garantit que data/store.json existe avant la génération du site.

   Avec SUPABASE_SECRET_KEY, la base de référence est celle du back-office en
   ligne : elle est téléchargée, pour que la boutique publiée montre ce qui y a
   été saisi. Si elle est injoignable, le build échoue plutôt que de publier un
   catalogue périmé ; Vercel garde alors le déploiement précédent.

   Sinon (poste neuf, pas de Supabase), la base est recréée à partir du
   catalogue et du contenu versionnés.
   ========================================================================== */
'use strict';

/* ADMIN_PASSWORD est lu dans .env.local lors de la première création. */
require('../lib/env');

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('../lib/store');
const remote = require('../lib/remote-store');

const ROOT = path.join(__dirname, '..');

function run(script, args) {
  execFileSync(process.execPath, [path.join('scripts', script)].concat(args || []), {
    cwd: ROOT,
    stdio: 'inherit'
  });
}

function prepareFromRepository() {
  if (!store.exists()) {
    console.log('data/store.json absent : création de la base à partir des données du dépôt.');
    /* Mot de passe administrateur imposé si la variable d'environnement existe,
       sinon un mot de passe aléatoire est généré et affiché. */
    const password = process.env.ADMIN_PASSWORD;
    run('seed-store.js', password ? ['--password', password] : []);
  }
  /* On complète seulement les champs qui manqueraient. */
  run('upgrade-store.js');
}

async function main() {
  if (!remote.enabled()) return prepareFromRepository();

  const online = await remote.pull();
  if (!online) {
    console.log('Base du back-office en ligne encore vide : génération à partir des données disponibles.');
    return prepareFromRepository();
  }
  fs.mkdirSync(path.dirname(store.FILE), { recursive: true });
  fs.writeFileSync(store.FILE, JSON.stringify(online, null, 2), 'utf8');
  console.log('Base du back-office téléchargée depuis Supabase.');
  run('upgrade-store.js');
}

main().catch(function (err) {
  console.error('Base du back-office injoignable : ' + err.message);
  console.error('Génération interrompue pour ne pas publier un catalogue périmé.');
  process.exit(1);
});
