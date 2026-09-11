#!/usr/bin/env node
/* =============================================================================
   Fait de data/store.json la source unique du site : enrichit les produits
   (description, images, prix barré, visibilité) et y installe tout le contenu
   éditorial, sans toucher aux comptes, clients, commandes ni expéditions.
   Usage : node scripts/upgrade-store.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const store = require('../lib/store');

const ROOT = path.join(__dirname, '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

if (!store.exists()) {
  console.error('data/store.json est absent. Lancez d’abord : node scripts/seed-store.js');
  process.exit(1);
}

/* --reimport réimporte descriptions et images depuis le catalogue Shopify,
   en écrasant les modifications faites dans le back-office. */
const reimport = process.argv.indexOf('--reimport') !== -1;

const site = readJson('site.json');
const imageMap = readJson('image-map.json');
const catalog = readJson('products.json').products;

function localImage(src) {
  if (!src) return '';
  const full = src.startsWith('//') ? 'https:' + src : src;
  const key = full.split('?')[0];
  return imageMap[key] ? '/' + imageMap[key] : full;
}

/* ---------- Découpage des descriptions Shopify ---------- */

const TEXT_FIXES = [
  [/incroyabelement/gi, 'incroyablement'], [/résulats/gi, 'résultats'],
  [/\bRESENTEZ\b/g, 'RESSENTEZ'], [/\bDescriptio\s*n\b/g, 'Description'],
  [/\brafraichie\b/gi, 'rafraîchie'], [/\bfraicheur\b/gi, 'fraîcheur'],
  [/\benvoutant\b/gi, 'envoûtant'], [/\bMinèrale\b/g, 'Minérale'],
  [/\bEquilibrante\b/g, 'Équilibrante'],
  [/L’Huile de Jojoba gent puissant/g, 'L’Huile de Jojoba : agent puissant'],
  [/\bConstater les résultats\b/g, 'Constatez les résultats'],
  [/Ingrédients-actifs/g, 'Ingrédients actifs']
];

function typography(html) {
  return String(html).split(/(<[^>]+>)/g).map((chunk) => {
    if (chunk.startsWith('<')) return chunk;
    let text = chunk.replace(/'/g, '’');
    TEXT_FIXES.forEach(([r, v]) => { text = text.replace(r, v); });
    return text;
  }).join('');
}

function stripTags(v) {
  return String(v).replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanFragment(fragment) {
  let body = String(fragment)
    .replace(/<\/?(?:span|font)[^>]*>/gi, '').replace(/<\/?div[^>]*>/gi, '\n')
    .replace(/&nbsp;/g, ' ').trim();
  if (!/<p[\s>]|<ul[\s>]|<ol[\s>]|<h[2-6][\s>]/i.test(body)) {
    body = body.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${l}</p>`).join('\n');
  }
  return body.replace(/<p>\s*<\/p>/gi, '').replace(/\n{2,}/g, '\n').trim();
}

const EMOJI = [
  [/ingr[ée]dients?\s*-?\s*actifs?/i, '🌿 '],
  [/utiliser|utilisation|mode d’emploi/i, '🧴 '],
  [/description/i, '📖 ']
];

function decorate(title) {
  if (/^\p{Extended_Pictographic}/u.test(title)) return title;
  const found = EMOJI.find(([r]) => r.test(title));
  return found ? found[1] + title : title;
}

function splitOnHeadings(section) {
  if (!/<h2[\s>]/i.test(section.body)) return [section];
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const out = [];
  let cursor = 0;
  let current = { title: section.title, chunks: [] };
  let m;
  while ((m = re.exec(section.body)) !== null) {
    current.chunks.push(section.body.slice(cursor, m.index));
    out.push(current);
    current = { title: decorate(typography(stripTags(m[1]))), chunks: [] };
    cursor = m.index + m[0].length;
  }
  current.chunks.push(section.body.slice(cursor));
  out.push(current);
  return out.map((p) => ({ title: p.title, body: p.chunks.join('\n').trim() })).filter((p) => p.body);
}

function mergeDescriptions(acc, section) {
  const prev = acc[acc.length - 1];
  if (/description/i.test(section.title) && prev && /description/i.test(prev.title)) {
    prev.body += '\n' + section.body;
    return acc;
  }
  acc.push({ title: section.title, body: section.body });
  return acc;
}

function parseSections(bodyHtml) {
  const html = String(bodyHtml || '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const sections = [];
  const re = /<details[^>]*>([\s\S]*?)<\/details>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const inner = m[1];
    const summary = inner.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    const title = typography(summary ? stripTags(summary[1]) : 'Description');
    const body = typography(cleanFragment(inner.replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, '')));
    if (body) sections.push({ title, body });
  }
  if (!sections.length) {
    const body = typography(cleanFragment(html));
    if (body) sections.push({ title: '📖 Description', body });
  }
  return sections.flatMap(splitOnHeadings).reduce(mergeDescriptions, []);
}

/* ---------- Contenu éditorial ---------- */

const CDN = 'https://cdn.shopify.com/s/files/1/0944/6044/5005/files/';

function posterFor(handle, index) {
  const source = catalog.find((c) => c.handle === handle);
  const images = source ? source.images : [];
  return localImage((images[Math.min(index, images.length - 1)] || images[0] || {}).src);
}

const VIDEO_SOURCES = [
  ['gel-moussant-visage-aux-micro-grains-de-luffa', 1, 'Le geste du nettoyage'],
  ['creme-apaisante-s-o-s', 1, 'Apaiser une peau réactive'],
  ['masque-de-boue-regenerant', 1, 'Le masque de boue, pas à pas'],
  ['beurre-corporel-aromatique-kiwi-mangue', 1, 'Texture du beurre corporel'],
  ['anti-oxidant-hand-moisturizer-milk-honey', 1, 'Mains douces en trente secondes'],
  ['anti-oxidant-hand-moisturizer-ocean', 1, 'Parfum Ocean'],
  ['anti-oxidant-hand-moisturizer-matcha', 1, 'Parfum Matcha'],
  ['anti-oxidant-hand-moisturizer-kiwi-mango', 1, 'Parfum Kiwi & Mangue'],
  ['serum-hydratant-mineral-aqua', 1, 'Le sérum minéral'],
  ['creme-hydratante-peau-normale-a-seche', 1, 'Hydrater le matin'],
  ['masque-gommant-aux-mineraux', 1, 'Le masque peel-off'],
  ['lotion-visage-hydratante-equilibrante', 2, 'La lotion équilibrante'],
  ['eau-micellaire-minerale', 1, 'Démaquiller en douceur'],
  ['gommage-corporel-aromatique-kiwi-mangue', 1, 'Gommage sous la douche'],
  ['beurre-corporel-aromatique-lait-miel', 1, 'Lait & Miel']
];

const content = {
  menu: site.menu,
  announcements: site.announcements,
  marquees: site.marquees,

  hero: site.heroSingle,
  reassurance: site.reassurance,
  categories: site.categories,

  bestsellersTitle: site.bestsellersTitle,
  bestsellersLede: site.bestsellersLede,
  bestsellers: site.moment,

  newTitle: 'Le reste de la gamme',
  newLede: 'Sérums, lotions, masques et gommages : la collection complète.',
  newProducts: [
    'serum-hydratant-mineral-aqua', 'creme-infusion-minerale-contour-des-yeux',
    'creme-hydratante-peau-normale-a-seche', 'masque-gommant-aux-mineraux',
    'lotion-visage-hydratante-equilibrante', 'eau-micellaire-minerale',
    'gommage-corporel-aromatique-kiwi-mangue', 'beurre-corporel-aromatique-lait-miel'
  ],

  about: {
    eyebrow: 'La marque',
    title: '417, en trois phrases',
    text: 'Nous puisons à 417 mètres sous le niveau de la mer, là où la mer Morte concentre les minéraux les plus rares. Nous les associons à des huiles végétales et à rien d’autre. Le résultat tient en trois gestes quotidiens et des textures qui ne pèsent pas.',
    points: [
      { title: 'Une source', text: 'L’eau de la mer Morte, infusée directement dans chaque formule.' },
      { title: 'Une exigence', text: 'Vegan, sans cortisone, jamais testé sur les animaux.' },
      { title: 'Un usage', text: 'Nettoyer, traiter, nourrir. Trois minutes, matin et soir.' }
    ],
    cta: 'Lire notre histoire',
    url: '/pages/notre-histoire'
  },

  videosTitle: 'En mouvement',
  videosLede: 'Textures, gestes et coulisses, en vidéo.',
  videos: VIDEO_SOURCES.map(([handle, index, label], i) => ({
    id: 'vid' + (i + 1),
    label,
    poster: posterFor(handle, index),
    src: '',
    url: '/products/' + handle
  })),

  feature: {
    eyebrow: 'Film',
    title: 'La fabrique d’un soin',
    text: 'De l’eau prélevée au produit fini : trois minutes pour comprendre ce qui distingue une formule minérale d’une crème ordinaire.',
    poster: localImage(CDN + 'KIK03022_2_ret_2.jpg'),
    src: '',
    cta: 'Découvrir la gamme',
    url: '/collections/tout-nos-produits'
  },

  reviewsTitle: 'Ce qu’en disent nos clientes',
  reviewsLede: 'Avis publiés après achat vérifié.',
  reviews: [
    { name: 'Camille R.', city: 'Paris', rating: 5, product: 'Crème Apaisante S.O.S', text: 'Ma peau réagit à tout. C’est le premier soin qui calme les rougeurs en une nuit sans me laisser un film gras.', demo: true },
    { name: 'Julien M.', city: 'Aix-en-Provence', rating: 5, product: 'Gel Moussant Visage', text: 'Les micro-grains de luffa nettoient sans agresser. J’ai arrêté mon ancien gel après deux utilisations.', demo: true },
    { name: 'Sofia B.', city: 'Lyon', rating: 4, product: 'Masque de Boue Régénérant', text: 'Le prix pique, mais le pot dure des mois et le teint après application est vraiment différent.', demo: true },
    { name: 'Élodie G.', city: 'Bordeaux', rating: 5, product: 'Beurre Corporel Kiwi & Mangue', text: 'Le parfum tient toute la journée sans être entêtant, et la peau reste souple même en hiver.', demo: true },
    { name: 'Marc L.', city: 'Bruxelles', rating: 5, product: 'Crème Hydratante pour les Mains', text: 'Je travaille dehors, mes mains gerçaient tout l’hiver. Plus rien depuis que j’en ai un tube dans la veste.', demo: true },
    { name: 'Naïma T.', city: 'Toulouse', rating: 4, product: 'Sérum Hydratant Minéral Aqua', text: 'Texture très légère, pénètre vite. Je l’utilise sous ma crème du matin, le maquillage tient mieux.', demo: true }
  ],

  ritualTitle: site.ritualTitle,
  ritualSub: site.ritualSub,
  ritual: site.ritual,
  facts: site.facts,
  storyTeaser: site.storyTeaser,
  storyPage: site.storyPage,
  quote: site.quote,
  pressTitle: site.pressTitle,
  press: site.press,
  commitments: site.commitments,
  newsletter: site.newsletter,
  store: site.store,
  faqTitle: site.faqTitle,
  faq: site.faq,
  policies: site.policies,
  fonts: site.fonts,
  logoDark: site.logoDark,
  logoLight: site.logoLight,
  logoMark: site.logoMark,
  socialImage: site.socialImage,
  name: site.name,
  tagline: site.tagline,
  description: site.description,
  freeShippingThreshold: site.freeShippingThreshold,
  countries: site.countries
};

/* ---------- Application ---------- */

/* Toute image du contenu éditorial pointe vers un fichier local du dépôt. */
function localizeDeep(node) {
  if (Array.isArray(node)) return node.map(localizeDeep);
  if (node && typeof node === 'object') {
    Object.keys(node).forEach((key) => { node[key] = localizeDeep(node[key]); });
    return node;
  }
  return typeof node === 'string' ? localImage(node) : node;
}

localizeDeep(content);

const result = store.update((data) => {
  let enriched = 0;

  data.products.forEach((product) => {
    const source = catalog.find((c) => c.handle === product.handle);
    if (!source) return;
    const variant = source.variants[0] || {};
    const compareAt = variant.compare_at_price ? parseFloat(variant.compare_at_price) : null;

    if (reimport || !product.images) {
      product.images = (source.images || []).map((i) => ({
        src: localImage(i.src),
        alt: product.title
      }));
    }
    if (reimport || !product.description) product.description = parseSections(source.body_html);
    if (product.compareAt === undefined) {
      product.compareAt = compareAt && compareAt > product.price ? compareAt : null;
    }
    if (product.visible === undefined) product.visible = true;

    /* Vignette affichée en haut à gauche de la carte produit.
       Par défaut on reproduit le comportement d'origine : « Épuisé » en rupture. */
    if (!product.badge) {
      product.badge = { enabled: true, text: 'Épuisé', when: 'out-of-stock', tone: 'sombre' };
    }
    /* Statut interne, visible uniquement dans le back-office. */
    if (!product.status) product.status = 'Automatique';
    if (reimport || !product.excerpt) {
      product.excerpt = product.description.length ? stripTags(product.description[0].body).slice(0, 180) : '';
    }
    product.image = product.images[0] ? product.images[0].src : product.image;
    enriched += 1;
  });

  if (!data.content) data.content = content;
  else Object.keys(content).forEach((key) => {
    if (data.content[key] === undefined) data.content[key] = content[key];
  });

  store.log(data, 'Contenu du site importé', enriched + ' produits enrichis');
  return { enriched };
});

console.log('');
console.log('  ' + result.enriched + ' produits enrichis (description, images, prix barré, visibilité).');
console.log('  Contenu éditorial installé dans data/store.json → rubrique « Contenu » du back-office.');
console.log('');
