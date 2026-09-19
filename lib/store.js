/* =============================================================================
   Base de données JSON du back-office.
   Lecture/écriture atomiques dans data/store.json, sans dépendance externe.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'store.json');

let cache = null;
/* Empreinte du fichier au moment de la lecture en cache. Le serveur n'est pas
   seul à écrire : les scripts (reset-password, seed, upgrade) tournent dans
   un autre processus. Sans cette vérification, le serveur réécrirait sa
   version périmée à l'action suivante et annulerait leur travail. */
let empreinte = '';

function empreinteFichier() {
  try {
    const info = fs.statSync(FILE);
    return info.mtimeMs + ':' + info.size;
  } catch (err) {
    return '';
  }
}

function emptyStore() {
  return {
    version: 1,
    users: [],
    settings: {},
    products: [],
    customers: [],
    orders: [],
    shipments: [],
    discounts: [],
    messages: [],
    activity: []
  };
}

function read() {
  if (!fs.existsSync(FILE)) {
    if (!cache) cache = emptyStore();
    return cache;
  }
  /* Le cache ne sert que tant que le fichier n'a pas bougé sous nos pieds. */
  const actuelle = empreinteFichier();
  if (cache && actuelle === empreinte) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    empreinte = actuelle;
  } catch (err) {
    throw new Error('data/store.json est illisible : ' + err.message);
  }
  return cache;
}

/** Écriture atomique : fichier temporaire puis renommage. */
function write(data) {
  cache = data;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const temp = FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, FILE);
  empreinte = empreinteFichier();
  return data;
}

/** Applique une modification et enregistre dans la foulée. */
function update(mutator) {
  const data = read();
  const result = mutator(data);
  write(data);
  return result;
}

function exists() {
  return fs.existsSync(FILE);
}

function id(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

/** Numéro de commande lisible : 417-2026-0001 */
function nextOrderRef(data) {
  const year = new Date().getFullYear();
  const prefix = '417-' + year + '-';
  const numbers = data.orders
    .filter((o) => typeof o.ref === 'string' && o.ref.startsWith(prefix))
    .map((o) => parseInt(o.ref.slice(prefix.length), 10))
    .filter((n) => !Number.isNaN(n));
  const next = (numbers.length ? Math.max.apply(null, numbers) : 0) + 1;
  return prefix + String(next).padStart(4, '0');
}

function log(data, action, detail) {
  data.activity.unshift({
    id: id('act'),
    at: new Date().toISOString(),
    action,
    detail
  });
  data.activity = data.activity.slice(0, 400);
}

module.exports = { read, write, update, exists, id, nextOrderRef, log, emptyStore, FILE };
