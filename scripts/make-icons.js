#!/usr/bin/env node
/* =============================================================================
   Fabrique les icônes du site à partir d'une seule figure : une goutte claire
   sur un carré arrondi encre, reprise du vocabulaire minéral de la marque.
   Aucune dépendance : le PNG est encodé à la main avec zlib, et l'ICO n'est
   qu'un en-tête devant un PNG.

   node scripts/make-icons.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'assets', 'icons');

/* Palette du site : encre, os, vert minéral. */
const INK = [23, 19, 15];
const BONE = [247, 243, 238];
const MINERAL = [19, 120, 127];

/* ---------- La figure ---------- */

/* Carré arrondi : rayon de 22 % du côté, comme les cartes du site. */
function inRoundedSquare(x, y, size) {
  const r = size * 0.22;
  const dx = Math.min(x, size - x);
  const dy = Math.min(y, size - y);
  if (dx >= r || dy >= r) return dx >= 0 && dy >= 0;
  const cx = dx < r ? r : dx;
  const cy = dy < r ? r : dy;
  return (dx - cx) * (dx - cx) + (dy - cy) * (dy - cy) <= r * r;
}

/* Goutte : un disque surmonté d'un triangle tangent. */
function inDrop(x, y, size) {
  const cx = size / 2;
  const cy = size * 0.60;
  const r = size * 0.21;
  const apex = size * 0.20;

  const dx = x - cx;
  const dy = y - cy;
  if (dx * dx + dy * dy <= r * r) return true;
  if (y > cy) return false;

  /* Largeur du triangle décroissante entre le disque et la pointe. */
  const span = (y - apex) / (cy - apex);
  if (span < 0 || span > 1) return false;
  return Math.abs(dx) <= r * span;
}

/* Filet minéral sous la goutte : la ligne d'eau. */
function inWaterline(x, y, size) {
  const top = size * 0.775;
  const height = size * 0.035;
  const inset = size * 0.30;
  return y >= top && y <= top + height && x >= inset && x <= size - inset;
}

/* ---------- Rendu ---------- */

/* Quatre échantillons par axe : les bords restent nets sans crénelage. */
const SAMPLES = 4;

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bg = 0;
      let drop = 0;
      let line = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = px + (sx + 0.5) / SAMPLES;
          const y = py + (sy + 0.5) / SAMPLES;
          if (inRoundedSquare(x, y, size)) bg += 1;
          if (inDrop(x, y, size)) drop += 1;
          if (inWaterline(x, y, size)) line += 1;
        }
      }
      const total = SAMPLES * SAMPLES;
      const alpha = bg / total;
      let colour = INK;
      const ink = drop / total;
      const water = line / total;
      if (water > 0) colour = mix(colour, MINERAL, water);
      if (ink > 0) colour = mix(colour, BONE, ink);

      const i = (py * size + px) * 4;
      pixels[i] = colour[0];
      pixels[i + 1] = colour[1];
      pixels[i + 2] = colour[2];
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

function mix(a, b, ratio) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * ratio),
    Math.round(a[1] + (b[1] - a[1]) * ratio),
    Math.round(a[2] + (b[2] - a[2]) * ratio)
  ];
}

/* ---------- PNG ---------- */

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   /* 8 bits par canal */
  header[9] = 6;   /* RVB + alpha */

  /* Une ligne = un octet de filtre (0, aucun) puis les pixels. */
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const start = y * (size * 4 + 1);
    raw[start] = 0;
    pixels.copy(raw, start + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- ICO ---------- */

/* Un ICO accepte des PNG tels quels depuis Vista : on en glisse deux, 16 et
   32 pixels, ce qui couvre l'onglet et la barre des favoris. */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const directory = [];
  entries.forEach((entry) => {
    const dir = Buffer.alloc(16);
    dir[0] = entry.size >= 256 ? 0 : entry.size;
    dir[1] = entry.size >= 256 ? 0 : entry.size;
    dir[4] = 1;
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(entry.png.length, 8);
    dir.writeUInt32LE(offset, 12);
    directory.push(dir);
    offset += entry.png.length;
  });

  return Buffer.concat([header].concat(directory, entries.map((e) => e.png)));
}

/* ---------- SVG ---------- */

/* La même figure, en vecteur : c'est elle que servent les navigateurs
   récents, et elle reste nette à toutes les tailles. */
function svg() {
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="417 France">
  <rect width="64" height="64" rx="14" fill="${rgb(INK)}"/>
  <rect x="19.2" y="49.6" width="25.6" height="2.24" rx="1.12" fill="${rgb(MINERAL)}"/>
  <path d="M32 12.8 L45.4 38.4 A13.4 13.4 0 0 1 18.6 38.4 Z" fill="${rgb(BONE)}"/>
</svg>
`;
}

/* ---------- Écriture ---------- */

fs.mkdirSync(OUT, { recursive: true });

const png32 = encodePng(32, render(32));
const png16 = encodePng(16, render(16));

const written = [
  ['favicon.svg', Buffer.from(svg(), 'utf8')],
  ['favicon-32.png', png32],
  ['favicon.ico', encodeIco([{ size: 16, png: png16 }, { size: 32, png: png32 }])],
  ['apple-touch-icon.png', encodePng(180, render(180))],
  ['icon-192.png', encodePng(192, render(192))],
  ['icon-512.png', encodePng(512, render(512))]
];

written.forEach(([name, data]) => {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log('  ' + name + ' — ' + data.length + ' o');
});

console.log('Icônes écrites dans src/assets/icons');
