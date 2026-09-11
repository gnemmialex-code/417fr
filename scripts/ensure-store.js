#!/usr/bin/env node
/* =============================================================================
   Garantit que data/store.json existe avant la génération du site.
   Sur un poste neuf ou sur un hébergeur, la base est absente du dépôt : on la
   recrée à partir du catalogue et du contenu versionnés.
   ========================================================================== */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const store = require('../lib/store');

const ROOT = path.join(__dirname, '..');

function run(script, args) {
  execFileSync(process.execPath, [path.join('scripts', script)].concat(args || []), {
    cwd: ROOT,
    stdio: 'inherit'
  });
}

if (!store.exists()) {
  console.log('data/store.json absent : création de la base à partir des données du dépôt.');
  /* Mot de passe administrateur imposé si la variable d'environnement existe,
     sinon un mot de passe aléatoire est généré et affiché. */
  const password = process.env.ADMIN_PASSWORD;
  run('seed-store.js', password ? ['--password', password] : []);
  run('upgrade-store.js');
} else {
  /* Base existante : on complète seulement les champs qui manqueraient. */
  run('upgrade-store.js');
}
