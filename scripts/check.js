#!/usr/bin/env node
/* Vérifie que chaque lien interne et chaque image du site généré existe. */
'use strict';

const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function resolves(target) {
  const clean = decodeURIComponent(target.split('#')[0].split('?')[0]);
  if (clean === '/') return fs.existsSync(path.join(DIST, 'index.html'));
  const base = path.join(DIST, clean);
  return fs.existsSync(base) || fs.existsSync(path.join(base, 'index.html')) || fs.existsSync(`${base}.html`);
}

const pages = walk(DIST);
const remote = new Set();
const problems = [];
let links = 0;
let assets = 0;

for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const rel = path.relative(DIST, page).replace(/\\/g, '/');

  for (const match of html.matchAll(/href="(\/[^"]*)"/g)) {
    links += 1;
    if (!resolves(match[1])) problems.push(`${rel} → lien mort ${match[1]}`);
  }
  for (const match of html.matchAll(/src="(\/[^"]*)"/g)) {
    assets += 1;
    if (!resolves(match[1])) problems.push(`${rel} → image manquante ${match[1]}`);
  }
  for (const match of html.matchAll(/src="(https?:\/\/(?!www\.google\.com)[^"]*)"/g)) {
    remote.add(match[1]);
  }
}

console.log(`${pages.length} pages, ${links} liens internes, ${assets} ressources locales`);
if (remote.size) console.log(`${remote.size} ressource(s) distante(s) référencée(s) — dépendent d'Internet.`);
if (problems.length) {
  console.log(`\n${problems.length} problème(s) :`);
  problems.slice(0, 40).forEach((p) => console.log('  - ' + p));
  process.exit(1);
}
console.log('Aucun lien mort, aucune image manquante.');
