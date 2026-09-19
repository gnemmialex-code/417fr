/* -------------------------------------------------------------------------- */
/* Serveur de développement : régénère le site et rafraîchit le navigateur     */
/* à chaque modification.                                                      */
/*                                                                             */
/*   npm run dev            → http://localhost:4180                            */
/*   npm run dev -- 5000    → http://localhost:5000                            */
/*                                                                             */
/* Ce fichier ne touche ni à build.js ni à server.js : le petit script de       */
/* rechargement est ajouté aux pages de /dist après chaque génération, et       */
/* /dist est un dossier régénéré, jamais versionné.                            */
/* -------------------------------------------------------------------------- */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const PORT = Number(process.argv[2] || process.env.PORT || 4180);
const RELOAD_PORT = PORT + 1;
const MARQUEUR = '<!-- rechargement-auto -->';

/* Ce qui déclenche quoi : une page se régénère, le serveur se relance. */
const SURVEILLE_BUILD = ['src', 'data', 'build.js'];
const SURVEILLE_SERVEUR = ['server.js', 'lib'];

/* -------------------------------------------------------------------------- */
/* Canal de rechargement (SSE)                                                 */
/* -------------------------------------------------------------------------- */

let clients = [];

const reloadServer = http.createServer(function (req, res) {
  if (req.url !== '/__reload') {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(': connecté\n\n');
  clients.push(res);
  req.on('close', function () {
    clients = clients.filter(function (c) { return c !== res; });
  });
});

/* Garde les connexions ouvertes à travers les proxys et les mises en veille. */
setInterval(function () {
  clients.forEach(function (res) { res.write(': ping\n\n'); });
}, 20000).unref();

function rafraichirNavigateurs() {
  clients.forEach(function (res) { res.write('data: reload\n\n'); });
}

/* -------------------------------------------------------------------------- */
/* Injection du script de rechargement dans les pages générées                 */
/* -------------------------------------------------------------------------- */

const SNIPPET = MARQUEUR + '\n<script>\n'
  + '(function () {\n'
  + '  var source = new EventSource("http://localhost:' + RELOAD_PORT + '/__reload");\n'
  + '  source.onmessage = function () { location.reload(); };\n'
  + '  /* Le serveur redémarre : EventSource se reconnecte tout seul. */\n'
  + '  source.onerror = function () {};\n'
  + '})();\n'
  + '</script>\n';

function pagesGenerees(dir) {
  let trouvees = [];
  for (const entree of fs.readdirSync(dir, { withFileTypes: true })) {
    const complet = path.join(dir, entree.name);
    if (entree.isDirectory()) trouvees = trouvees.concat(pagesGenerees(complet));
    else if (entree.name.endsWith('.html')) trouvees.push(complet);
  }
  return trouvees;
}

function injecter() {
  if (!fs.existsSync(DIST)) return 0;
  let comptees = 0;
  for (const page of pagesGenerees(DIST)) {
    const html = fs.readFileSync(page, 'utf8');
    if (html.includes(MARQUEUR)) continue;
    const sortie = html.includes('</body>')
      ? html.replace('</body>', SNIPPET + '</body>')
      : html + SNIPPET;
    fs.writeFileSync(page, sortie);
    comptees++;
  }
  return comptees;
}

/* -------------------------------------------------------------------------- */
/* Génération et serveur du site                                               */
/* -------------------------------------------------------------------------- */

/* Une seule génération à la fois : build.js vide /dist avant de le réécrire,
   et deux générations simultanées se marchent dessus (ENOTEMPTY sous Windows).
   Un appel pendant une génération attend la fin de celle-ci. */
let generationEnCours = null;

function construire() {
  if (generationEnCours) {
    return generationEnCours.then(function () { return construire(); });
  }
  generationEnCours = new Promise(function (resolve) {
    const build = spawn(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'inherit' });
    build.on('exit', function (code) { resolve(code === 0); });
  }).then(function (ok) {
    generationEnCours = null;
    return ok;
  });
  return generationEnCours;
}

let serveur = null;

function demarrerServeur() {
  serveur = spawn(process.execPath, ['server.js', String(PORT)], { cwd: ROOT, stdio: 'inherit' });
  serveur.on('exit', function (code) {
    /* Un arrêt volontaire (relance, Ctrl+C) ne doit pas alarmer. */
    if (code !== null && code !== 0 && !enRelance) {
      console.log('\n  Le serveur s’est arrêté (code ' + code + '). Corrigez l’erreur ci-dessus :');
      console.log('  la prochaine modification de server.js ou lib/ le relancera.\n');
    }
  });
}

let enRelance = false;

function relancerServeur() {
  enRelance = true;
  if (serveur && serveur.exitCode === null) serveur.kill();
  setTimeout(function () {
    enRelance = false;
    demarrerServeur();
    setTimeout(rafraichirNavigateurs, 400);
  }, 250);
}

/* -------------------------------------------------------------------------- */
/* Surveillance des fichiers                                                   */
/* -------------------------------------------------------------------------- */

let enAttente = null;
let regenerer = false;
let relancer = false;

function planifier(raison) {
  if (raison === 'serveur') relancer = true;
  else regenerer = true;

  clearTimeout(enAttente);
  /* Un enregistrement déclenche souvent plusieurs événements : on les groupe. */
  enAttente = setTimeout(async function () {
    const besoinBuild = regenerer;
    const besoinRelance = relancer;
    regenerer = false;
    relancer = false;

    if (besoinBuild) {
      const ok = await construire();
      if (!ok) {
        console.log('\n  Génération en échec : le site affiché reste la version précédente.\n');
        return;
      }
      injecter();
    }
    if (besoinRelance) return relancerServeur();
    rafraichirNavigateurs();
  }, 200);
}

function surveiller(cible, raison) {
  const complet = path.join(ROOT, cible);
  if (!fs.existsSync(complet)) return;
  const recursif = fs.statSync(complet).isDirectory();
  fs.watch(complet, { recursive: recursif }, function (_type, nom) {
    /* Ignore les fichiers temporaires des éditeurs. */
    if (nom && /(~|\.swp|\.tmp|^\.#)$/.test(nom)) return;
    planifier(raison);
  });
}

/* -------------------------------------------------------------------------- */
/* Démarrage                                                                   */
/* -------------------------------------------------------------------------- */

async function demarrer() {
  const ok = await construire();
  if (!ok) {
    console.error('\n  La génération a échoué. Corrigez l’erreur ci-dessus puis relancez.\n');
    process.exit(1);
  }
  injecter();

  reloadServer.listen(RELOAD_PORT, function () {
    SURVEILLE_BUILD.forEach(function (c) { surveiller(c, 'build'); });
    SURVEILLE_SERVEUR.forEach(function (c) { surveiller(c, 'serveur'); });

    demarrerServeur();

    setTimeout(function () {
      console.log('\n  Mode développement');
      console.log('  Le navigateur se rafraîchit à chaque enregistrement dans');
      console.log('  src/, data/, lib/, build.js ou server.js.');
      console.log('  Ctrl+C pour tout arrêter.\n');
    }, 300);
  });
}

function arreter() {
  enRelance = true;
  if (serveur && serveur.exitCode === null) serveur.kill();
  process.exit(0);
}

process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);

demarrer();
