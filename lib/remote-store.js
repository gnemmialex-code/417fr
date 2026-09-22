/* =============================================================================
   Base du back-office en ligne : data/store.json rangé chez Supabase Storage.

   Sur Vercel, le disque est en lecture seule et chaque requête peut tomber sur
   une instance différente : la base ne peut pas vivre dans un fichier local.
   Elle est donc conservée comme un unique fichier JSON dans un compartiment
   privé de Supabase Storage.

   Seul le serveur y accède, avec la clé secrète (SUPABASE_SECRET_KEY). Cette
   clé contourne toutes les règles d'accès de Supabase : elle ne doit jamais
   être envoyée au navigateur ni commitée.

   Écritures concurrentes : la dernière enregistrée l'emporte. Suffisant pour
   un back-office tenu par une ou deux personnes.
   ========================================================================== */
'use strict';

require('./env');

const BUCKET = 'back-office';
const OBJECT = 'store.json';

function config() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url: url, key: key };
}

function enabled() {
  const c = config();
  return Boolean(c.url && c.key);
}

function headers(extra) {
  const key = config().key;
  return Object.assign({ apikey: key, Authorization: 'Bearer ' + key }, extra || {});
}

async function explain(response) {
  const text = await response.text().catch(function () { return ''; });
  return 'Supabase Storage a répondu ' + response.status + ' : ' + text.slice(0, 200);
}

/** Crée le compartiment privé s'il n'existe pas encore. */
async function ensureBucket() {
  const c = config();
  const found = await fetch(c.url + '/storage/v1/bucket/' + BUCKET, { headers: headers() });
  if (found.ok) return { created: false };
  const created = await fetch(c.url + '/storage/v1/bucket', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false })
  });
  if (!created.ok) throw new Error(await explain(created));
  return { created: true };
}

/** Renvoie la base, ou null si elle n'a jamais été envoyée. */
async function pull() {
  const c = config();
  const response = await fetch(c.url + '/storage/v1/object/' + BUCKET + '/' + OBJECT, {
    headers: headers({ 'Cache-Control': 'no-cache' })
  });
  if (response.status === 404 || response.status === 400) {
    const text = await response.text().catch(function () { return ''; });
    if (/not.?found|does not exist/i.test(text)) return null;
    throw new Error('Supabase Storage a répondu ' + response.status + ' : ' + text.slice(0, 200));
  }
  if (!response.ok) throw new Error(await explain(response));
  return response.json();
}

/** Enregistre la base entière, en remplaçant la version précédente. */
async function push(data) {
  const c = config();
  const response = await fetch(c.url + '/storage/v1/object/' + BUCKET + '/' + OBJECT, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/json',
      'x-upsert': 'true',
      'Cache-Control': 'no-cache'
    }),
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error(await explain(response));
  return true;
}

/** Range un fichier (étiquette de transport…) dans le même compartiment privé. */
async function putFile(name, buffer, contentType) {
  const c = config();
  const response = await fetch(c.url + '/storage/v1/object/' + BUCKET + '/' + name, {
    method: 'POST',
    headers: headers({ 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true' }),
    body: buffer
  });
  if (!response.ok) throw new Error(await explain(response));
  return true;
}

/** Renvoie le contenu d'un fichier, ou null s'il n'existe pas. */
async function getFile(name) {
  const c = config();
  const response = await fetch(c.url + '/storage/v1/object/' + BUCKET + '/' + name, { headers: headers() });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) throw new Error(await explain(response));
  return Buffer.from(await response.arrayBuffer());
}

module.exports = { enabled, ensureBucket, pull, push, putFile, getFile, BUCKET, OBJECT };
