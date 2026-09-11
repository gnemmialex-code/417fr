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

function emptyStore() {
  return {
    version: 1,
    users: [],
    settings: {},
    products: [],
    customers: [],
    orders: [],
    shipments: [],
    activity: []
  };
}

function read() {
  if (cache) return cache;
  if (!fs.existsSync(FILE)) {
    cache = emptyStore();
    return cache;
  }
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
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
