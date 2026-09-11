#!/usr/bin/env node
/* =============================================================================
   417 France - générateur de site statique
   Source de vérité : data/store.json (modifiable depuis le back-office).
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/* Adresse publique utilisée pour les URL canoniques, Open Graph et le sitemap.
   Vercel expose le domaine de production dans l'environnement. */
const SITE_URL = (
  process.env.SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : '')
  || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : '')
  || 'http://localhost:4170'
).replace(/\/+$/, '');

/* -------------------------------------------------------------------------- */
/* Données                                                                     */
/* -------------------------------------------------------------------------- */

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));

const fallback = readJson('site.json');
const storePath = path.join(DATA, 'store.json');
const store = fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, 'utf8')) : null;

if (!store || !store.content) {
  console.error('data/store.json est absent ou incomplet.');
  console.error('Lancez : node scripts/seed-store.js puis node scripts/upgrade-store.js');
  process.exit(1);
}

/* Le contenu du back-office prime, site.json sert de filet. */
const site = Object.assign({}, fallback, store.content);
const settings = store.settings || {};

const collectionMembers = {
  'tout-nos-produits': readJson('collection-tout-nos-produits.json').products.map((p) => p.handle),
  'produits-pour-le-visage': readJson('collection-produits-pour-le-visage.json').products.map((p) => p.handle),
  'produit-pour-le-visage': readJson('collection-produit-pour-le-visage.json').products.map((p) => p.handle),
  frontpage: [],
  'beauty-example-products': []
};

const COLLECTION_TITLES = {
  'tout-nos-produits': 'Tous les soins',
  'produits-pour-le-visage': 'Soins du visage',
  'produit-pour-le-visage': 'Soins du corps',
  frontpage: 'Sélection',
  'beauty-example-products': 'Exemples de produits beauté'
};

const COLLECTION_DESCRIPTIONS = {
  'tout-nos-produits': 'L’intégralité de la gamme minérale, du nettoyant au beurre corporel.',
  'produits-pour-le-visage': 'Nettoyants, sérums, masques et crèmes pour révéler l’éclat naturel de la peau.',
  'produit-pour-le-visage': 'Beurres, gommages et soins des mains pour une peau douce et nourrie.',
  frontpage: 'Notre sélection mise en avant sur la page d’accueil.',
  'beauty-example-products': 'Collection de démonstration du thème.'
};

/* -------------------------------------------------------------------------- */
/* Utilitaires                                                                 */
/* -------------------------------------------------------------------------- */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stripTags(value) {
  return String(value == null ? '' : value).replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function money(amount) {
  return `€${Number(amount || 0).toFixed(2).replace('.', ',')}`;
}

function write(relPath, contents) {
  const target = path.join(DIST, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function fingerprint(relPath) {
  return crypto.createHash('sha1').update(fs.readFileSync(path.join(SRC, relPath))).digest('hex').slice(0, 10);
}

const CSS_VERSION = fingerprint('assets/css/styles.css');
const JS_VERSION = fingerprint('assets/js/app.js');

function reveal(index = 0, variant = '') {
  const delay = Math.min(index, 8) * 65;
  return ` data-reveal="${variant}"${delay ? ` data-reveal-delay="${delay}"` : ''}`;
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                   */
/* -------------------------------------------------------------------------- */

const products = store.products
  .filter((p) => p.visible !== false)
  .map((p, index) => {
    const images = (p.images && p.images.length ? p.images : [{ src: p.image || '', alt: p.title }])
      .filter((i) => i && i.src);
    return {
      handle: p.handle,
      title: p.title,
      vendor: p.supplier || site.name,
      category: p.category || 'Visage',
      price: Number(p.price) || 0,
      compareAt: p.compareAt && Number(p.compareAt) > Number(p.price) ? Number(p.compareAt) : null,
      available: Number(p.stock) > 0,
      stock: Number(p.stock) || 0,
      images,
      image: images[0] ? images[0].src : '',
      hoverImage: images[1] ? images[1].src : (images[0] ? images[0].src : ''),
      badge: p.badge || null,
      sections: (p.description || []).filter((s) => s && s.body),
      excerpt: p.excerpt || '',
      position: index
    };
  });

const byHandle = new Map(products.map((p) => [p.handle, p]));

const collections = Object.keys(collectionMembers).map((handle) => ({
  handle,
  title: COLLECTION_TITLES[handle] || handle,
  description: COLLECTION_DESCRIPTIONS[handle] || '',
  products: collectionMembers[handle].map((h) => byHandle.get(h)).filter(Boolean)
}));

collections.push({
  handle: 'all',
  title: 'Tout le catalogue',
  description: 'L’ensemble des soins 417 France, du visage au corps.',
  products: products.slice()
});

const pick = (handles) => (handles || []).map((h) => byHandle.get(h)).filter(Boolean);

/** Un lien vers un produit masqué renvoie vers le catalogue plutôt que vers
    une page qui n'existe plus. */
function safeUrl(url) {
  const value = String(url || '').trim();
  const match = value.match(/^\/products\/([^/?#]+)/);
  if (match && !byHandle.has(match[1])) return '/collections/all';
  return value || '/';
}

/** Complète une sélection avec d'autres produits du catalogue : une section
    ne se vide jamais parce que les articles choisis ont été masqués. */
function pickFilled(handles, count, exclude) {
  const chosen = pick(handles);
  const taken = new Set(chosen.map((p) => p.handle).concat(exclude || []));
  for (const product of products) {
    if (chosen.length >= count) break;
    if (taken.has(product.handle)) continue;
    chosen.push(product);
    taken.add(product.handle);
  }
  return chosen.slice(0, count);
}

/* -------------------------------------------------------------------------- */
/* Icônes                                                                      */
/* -------------------------------------------------------------------------- */

const icons = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5" stroke-linecap="round"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" stroke-linecap="round"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M5 7h14l-1 13H6L5 7Z"/><path d="M9 7V5.5a3 3 0 0 1 6 0V7" stroke-linecap="round"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 8h16M4 16h16" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M12 19V6M6 12l6-6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5Z"/></svg>',
  zoom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M11 8v6M8 11h6" stroke-linecap="round"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z"/><circle cx="6" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M20 4C10 4 4 9 4 16c0 2 1 4 1 4s6-1 10-5 5-11 5-11Z"/><path d="M5 20c4-6 8-9 12-11" stroke-linecap="round"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.8 2.7 5.9 6.3.7-4.7 4.3 1.3 6.3-5.6-3.2-5.6 3.2 1.3-6.3L3 9.4l6.3-.7L12 2.8Z"/></svg>'
};

/* -------------------------------------------------------------------------- */
/* Composants                                                                  */
/* -------------------------------------------------------------------------- */

/** Vignette en haut à gauche de la carte, paramétrée depuis le back-office. */
function productBadge(product) {
  const config = product.badge;
  const matches = config && config.enabled && config.text && (
    config.when === 'always'
    || (config.when === 'in-stock' && product.available)
    || (config.when === 'out-of-stock' && !product.available)
  );
  if (matches) {
    const tone = config.tone === 'clair' ? '' : ` card__badge--${config.tone === 'accent' ? 'accent' : 'dark'}`;
    return `<span class="card__badge${tone}">${escapeHtml(config.text)}</span>`;
  }
  return product.compareAt ? '<span class="card__badge">Promotion</span>' : '';
}

function productCard(product, index = 0) {
  const badge = productBadge(product);

  const price = product.compareAt
    ? `<s>${money(product.compareAt)}</s>${money(product.price)}`
    : money(product.price);

  const add = product.available
    ? `<button type="button" class="card__add" data-add-to-cart="${product.handle}" aria-label="Ajouter ${escapeHtml(product.title)} au panier">${icons.plus}</button>`
    : '';

  return `<article class="card" data-card data-position="${index}" data-price="${product.price}" data-title="${escapeHtml(product.title)}" data-available="${product.available}"${reveal(index)}>
  <div class="card__top">
    <a class="card__media" href="/products/${product.handle}" aria-label="${escapeHtml(product.title)}">
      ${badge}
      <img class="is-main img-fade" src="${product.image}" alt="${escapeHtml(product.title)}" loading="lazy" width="600" height="750">
      <img class="is-hover img-fade" src="${product.hoverImage}" alt="" aria-hidden="true" loading="lazy" width="600" height="750">
    </a>
    ${add}
  </div>
  <div class="card__body">
    <p class="card__cat">${escapeHtml(product.category)}</p>
    <h3 class="card__title"><a href="/products/${product.handle}">${escapeHtml(product.title)}</a></h3>
    <p class="card__price">${price}</p>
  </div>
</article>`;
}

function carousel(id, items) {
  return `<div class="carousel" data-carousel>
  <button type="button" class="carousel__nav carousel__nav--prev" data-carousel-prev aria-label="Précédent">${icons.left}</button>
  <div class="carousel__view" data-carousel-view id="${id}">${items.join('\n')}</div>
  <button type="button" class="carousel__nav carousel__nav--next" data-carousel-next aria-label="Suivant">${icons.right}</button>
</div>`;
}

function header(currentPath) {
  const nav = site.menu.map((item) => {
    const current = item.url === currentPath ? ' aria-current="page"' : '';
    return `<a href="${safeUrl(item.url)}"${current}>${escapeHtml(item.label)}</a>`;
  }).join('\n        ');

  const announcements = site.announcements
    .map((text, i) => `<span class="announce__item${i === 0 ? ' is-active' : ''}" data-announce-item>${escapeHtml(text)}</span>`)
    .join('\n      ');

  return `<header class="header">
  <div class="announce" aria-live="off">
    <div class="container announce__inner">
      ${announcements}
    </div>
  </div>
  <div class="container header__inner">
    <nav class="nav" aria-label="Navigation principale">
        ${nav}
    </nav>
    <button type="button" class="ibtn burger" data-open-drawer="menu" aria-label="Ouvrir le menu">${icons.menu}</button>
    <a class="header__logo" href="/" aria-label="417 France, retour à l’accueil">
      <img class="logo--light" src="${site.logoLight}" alt="417 France" width="240" height="100">
      <img class="logo--dark" src="${site.logoDark}" alt="417 France" width="240" height="100">
    </a>
    <div class="header__tools">
      <button type="button" class="ibtn ibtn--text" data-open-drawer="region" aria-label="Région et devise"><span data-region-label>EUR</span></button>
      <button type="button" class="ibtn" data-open-drawer="search" aria-label="Rechercher">${icons.search}</button>
      <a class="ibtn" href="/pages/contact" aria-label="Nous contacter">${icons.user}</a>
      <button type="button" class="ibtn" data-open-drawer="cart" aria-label="Ouvrir le panier">
        ${icons.bag}<span class="cart-count" data-cart-count hidden>0</span>
      </button>
    </div>
  </div>
</header>`;
}

function drawers() {
  const menu = site.menu
    .map((item, i) => `<li data-stagger style="--i:${i}"><a href="${safeUrl(item.url)}">${escapeHtml(item.label)}${icons.right}</a></li>`)
    .join('\n      ');

  const regions = site.countries
    .map((c, i) => `<li data-stagger style="--i:${i}"><button type="button" data-region="${escapeHtml(c.name)}" data-currency="${c.currency}"><span>${escapeHtml(c.name)}</span><span>${c.currency}${c.symbol === c.currency ? '' : ` ${c.symbol}`}</span></button></li>`)
    .join('\n      ');

  return `<div class="overlay" data-overlay></div>

<aside class="drawer drawer--left" data-drawer="menu" aria-label="Menu">
  <div class="drawer__head">
    <span class="drawer__title">Menu</span>
    <button type="button" class="ibtn" data-close-drawer aria-label="Fermer">${icons.close}</button>
  </div>
  <div class="drawer__body">
    <ul class="dnav">
      ${menu}
    </ul>
  </div>
  <div class="drawer__foot">
    <a class="btn btn--outline btn--block" href="/collections/all">Tout le catalogue</a>
  </div>
</aside>

<aside class="drawer drawer--top" data-drawer="search" aria-label="Recherche">
  <div class="drawer__head">
    <span class="drawer__title">Rechercher</span>
    <button type="button" class="ibtn" data-close-drawer aria-label="Fermer">${icons.close}</button>
  </div>
  <div class="drawer__body">
    <div class="container container--narrow">
      <form class="search-form" role="search">
        <label class="visually-hidden" for="search-input">Rechercher un produit</label>
        <input id="search-input" type="search" placeholder="Sérum, masque, beurre corporel…" data-search-input autocomplete="off">
        <button type="submit" class="btn">Rechercher</button>
      </form>
      <p class="search-hint">Astuce : la touche « / » ouvre la recherche, « Échap » la ferme.</p>
      <ul class="search-results" data-search-results></ul>
    </div>
  </div>
</aside>

<aside class="drawer" data-drawer="cart" aria-label="Panier">
  <div class="drawer__head">
    <span class="drawer__title">Panier</span>
    <button type="button" class="ibtn" data-close-drawer aria-label="Fermer">${icons.close}</button>
  </div>
  <p class="visually-hidden" data-cart-count-label>Nombre total d’articles dans le panier : 0</p>
  <div class="drawer__body" data-cart-body></div>
  <div class="drawer__foot" data-cart-foot hidden>
    <div class="cart-progress" data-cart-progress><i></i></div>
    <p class="cart-note" data-cart-shipping></p>
    <div class="cart-total"><span>Total</span><strong data-cart-total>€0,00</strong></div>
    <button type="button" class="btn btn--block">Procéder au paiement</button>
    <p class="cart-note">Taxes incluses. Frais d’expédition calculés à l’étape suivante.</p>
  </div>
</aside>

<aside class="drawer" data-drawer="region" aria-label="Région et devise">
  <div class="drawer__head">
    <span class="drawer__title">Région et devise</span>
    <button type="button" class="ibtn" data-close-drawer aria-label="Fermer">${icons.close}</button>
  </div>
  <div class="drawer__body">
    <ul class="region-list">
      ${regions}
    </ul>
  </div>
</aside>

<div class="lightbox" data-lightbox role="dialog" aria-modal="true" aria-label="Visionneuse d’images">
  <img class="lightbox__img" data-lightbox-img src="" alt="">
  <button type="button" class="lightbox__close" data-lightbox-close aria-label="Fermer">${icons.close}</button>
  <button type="button" class="lightbox__prev" data-lightbox-prev aria-label="Image précédente">${icons.left}</button>
  <button type="button" class="lightbox__next" data-lightbox-next aria-label="Image suivante">${icons.right}</button>
  <p class="lightbox__counter" data-lightbox-counter></p>
</div>

<button type="button" class="to-top" data-to-top aria-label="Revenir en haut">${icons.up}</button>`;
}

function newsletter() {
  return `<section class="section section--sm news">
  <div class="container"${reveal(0, 'fade')}>
    <p class="eyebrow" style="color:var(--clay)">Newsletter</p>
    <h2 class="title title--md">${escapeHtml(site.newsletter.title)}</h2>
    <p class="lede">${escapeHtml(site.newsletter.text)}</p>
    <form class="news__form" data-demo-form data-success="Merci, votre inscription est enregistrée.">
      <label class="visually-hidden" for="newsletter-email">E-mail</label>
      <input id="newsletter-email" type="email" name="email" placeholder="Votre adresse e-mail" required>
      <button type="submit" class="btn">S’inscrire</button>
      <p class="form-note" data-form-note style="flex:1 0 100%"></p>
    </form>
  </div>
</section>`;
}

function footer() {
  const shop = site.menu.map((i) => `<li><a href="${safeUrl(i.url)}">${escapeHtml(i.label)}</a></li>`).join('');
  const help = [
    ['/pages/livraison-et-retours', 'Livraison et retours'],
    ['/pages/store-locator', 'Points de vente'],
    ['/pages/contact', 'Nous écrire'],
    ['/search', 'Rechercher']
  ].map(([url, label]) => `<li><a href="${url}">${label}</a></li>`).join('');
  const policies = site.policies.map((p) => `<li><a href="/policies/${p.handle}">${escapeHtml(p.title)}</a></li>`).join('');

  return `<footer class="footer">
  <div class="container footer__top">
    <div class="footer__brand">
      <img src="${site.logoMark}" alt="417 France" width="160" height="64">
      <p>${escapeHtml(settings.city ? settings.address + ', ' + settings.zip + ' ' + settings.city : site.store.address)}</p>
    </div>
    <nav class="footer__cols" aria-label="Liens de pied de page">
      <div><h4>Boutique</h4><ul>${shop}</ul></div>
      <div><h4>Aide</h4><ul>${help}</ul></div>
      <div><h4>Légal</h4><ul>${policies}</ul></div>
    </nav>
  </div>
  <div class="container footer__bottom">
    <span>&copy; ${new Date().getFullYear()} ${escapeHtml(site.name)}</span>
    <span>Une peau propre, un esprit clair</span>
  </div>
</footer>`;
}

function layout(options) {
  const {
    title, description = site.description, body,
    currentPath = '/', hasHero = false, image = site.socialImage,
    canonical = currentPath, extraHead = ''
  } = options;

  const catalogJson = JSON.stringify(products.map((p) => ({
    handle: p.handle, title: p.title, price: p.price,
    available: p.available, image: p.image, excerpt: p.excerpt
  })));

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${SITE_URL}${canonical}">
<meta property="og:site_name" content="${escapeHtml(site.name)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${SITE_URL}${canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#17130f">
<link rel="icon" href="${site.logoDark}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${site.fonts}">
<link rel="stylesheet" href="/assets/css/styles.css?v=${CSS_VERSION}">
${extraHead}</head>
<body class="${hasHero ? 'has-hero' : ''}">
<a class="skip-link" href="#main">Ignorer et passer au contenu</a>
<div class="progress" data-progress aria-hidden="true"></div>
${header(currentPath)}
<main id="main">
${body}
</main>
${newsletter()}
${footer()}
${drawers()}
<script>window.SITE_PRODUCTS = ${catalogJson};window.SITE_CONFIG = ${JSON.stringify({ freeShippingThreshold: settings.freeShippingThreshold || site.freeShippingThreshold })};</script>
<script src="/assets/js/app.js?v=${JS_VERSION}" defer></script>
</body>
</html>
`;
}

function breadcrumb(items) {
  const parts = items.map((item, i) => (
    i === items.length - 1
      ? `<span aria-current="page">${escapeHtml(item.label)}</span>`
      : `<a href="${item.url}">${escapeHtml(item.label)}</a><span>/</span>`
  ));
  return `<nav class="container crumb" aria-label="Fil d’Ariane">${parts.join('')}</nav>`;
}

function reassurance() {
  const items = site.reassurance.map((item) => `<div class="reassure__item">
        <strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span>
      </div>`).join('\n      ');
  return `<section class="reassure" aria-label="Nos garanties">
  <div class="container">
    <div class="reassure__grid">
      ${items}
    </div>
  </div>
</section>`;
}

function videoCard(video, index) {
  const media = video.src
    ? `<video src="${escapeHtml(video.src)}" poster="${escapeHtml(video.poster)}" muted loop playsinline preload="metadata"></video>`
    : `<img src="${escapeHtml(video.poster)}" alt="${escapeHtml(video.label)}" loading="lazy" width="360" height="640">`;

  return `<a class="vcard" href="${escapeHtml(safeUrl(video.url))}" aria-label="${escapeHtml(video.label)}">
        <span class="vcard__media">${media}<span class="vcard__play">${icons.play}</span></span>
        <span class="vcard__label">${escapeHtml(video.label)}</span>
      </a>`;
}

function stars(rating) {
  return `<span class="stars" aria-label="${rating} étoiles sur 5">${
    Array.from({ length: 5 }, (_, i) => `<i class="${i < rating ? 'is-on' : ''}">${icons.star}</i>`).join('')
  }</span>`;
}

/* -------------------------------------------------------------------------- */
/* Pages                                                                       */
/* -------------------------------------------------------------------------- */

function homePage() {
  const hero = site.hero;

  const cats = site.categories.map((c, i) => `<a class="cat" href="${safeUrl(c.url)}"${reveal(i, 'scale')}>
        <img class="img-fade" src="${c.image}" alt="${escapeHtml(c.title)}" loading="lazy" width="900" height="1125">
        <span class="cat__body">
          <span class="eyebrow">${escapeHtml(c.eyebrow)}</span>
          <h3>${escapeHtml(c.title)}</h3>
          <p>${escapeHtml(c.text)}</p>
          <span class="link">${escapeHtml(c.cta)} ${icons.right}</span>
        </span>
      </a>`).join('\n      ');

  const bestProducts = pickFilled(site.bestsellers, 8);
  const moreProducts = pickFilled(site.newProducts, 8, bestProducts.map((p) => p.handle));
  const best = bestProducts.map((p, i) => productCard(p, i));
  const more = moreProducts.map((p, i) => productCard(p, i));

  const aboutPoints = site.about.points.map((p, i) => `<li${reveal(i, 'fade')}>
          <strong>${escapeHtml(p.title)}</strong>
          <span>${escapeHtml(p.text)}</span>
        </li>`).join('\n        ');

  const videos = site.videos.map(videoCard).join('\n      ');

  const reviews = site.reviews.map((r, i) => `<article class="review"${reveal(i)}>
        ${stars(r.rating)}
        <p class="review__text">« ${escapeHtml(r.text)} »</p>
        <p class="review__meta"><strong>${escapeHtml(r.name)}</strong>${r.city ? ' · ' + escapeHtml(r.city) : ''}<br><span>${escapeHtml(r.product)}</span></p>
      </article>`);

  const facts = site.facts.map((f, i) => `<div class="fact"${reveal(i)}>
        <p class="fact__value" data-count>${escapeHtml(f.value)}</p>
        <p class="fact__label">${escapeHtml(f.label)}</p>
        <p class="fact__text">${escapeHtml(f.text)}</p>
      </div>`).join('\n      ');

  const ritual = site.ritual.map((item, i) => `<a class="ritual__card" href="${safeUrl(item.url)}"${reveal(i)}>
        <span class="ritual__num">${escapeHtml(item.step)}</span>
        <span class="ritual__media"><img class="img-fade" src="${item.image}" alt="${escapeHtml(item.title)}" loading="lazy" width="600" height="600"></span>
        <span class="ritual__body">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.text)}</p>
          <span class="link">Découvrir ${icons.right}</span>
        </span>
      </a>`).join('\n      ');

  const press = site.press.map((p, i) => `<img class="img-fade" src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy" width="240" height="120"${reveal(i, 'fade')}>`).join('\n      ');

  const tags = site.commitments.map((t, i) => `<span class="tag"${reveal(i, 'fade')}>${escapeHtml(t)}</span>`).join('\n      ');

  const marqueeItems = (text) => Array.from({ length: 10 }, () => `<span>${escapeHtml(text)}</span>`).join('');

  const story = site.storyTeaser;
  const feature = site.feature;

  const featureMedia = feature.src
    ? `<video class="feature__video" src="${escapeHtml(feature.src)}" poster="${escapeHtml(feature.poster)}" controls playsinline preload="metadata"></video>`
    : `<img class="img-fade" src="${escapeHtml(feature.poster)}" alt="${escapeHtml(feature.title)}" loading="lazy" width="1600" height="900">
       <span class="feature__play">${icons.play}</span>`;

  const body = `<section class="hero is-lit" data-hero aria-label="Mise en avant">
  <div class="hero__media" data-hero-media>
    <img src="${hero.image}" alt="" fetchpriority="high" width="1800" height="1200">
  </div>
  <div class="hero__inner">
    <div class="container">
      <p class="hero__eyebrow">${escapeHtml(hero.eyebrow)}</p>
      <h1 class="hero__title">
        <span class="line-mask"><span>${escapeHtml(hero.titleTop)}</span></span>
        <span class="line-mask" style="--line-delay:110ms"><span>${escapeHtml(hero.titleBottom)}</span></span>
      </h1>
      <p class="hero__text">${escapeHtml(hero.text)}</p>
      <p class="hero__cta">
        <a class="btn btn--light" href="${safeUrl(hero.primary.url)}">${escapeHtml(hero.primary.label)}</a>
        <a class="btn btn--light btn--clear" href="${safeUrl(hero.secondary.url)}">${escapeHtml(hero.secondary.label)}</a>
      </p>
    </div>
  </div>
  <div class="hero__scroll"><span>Faire défiler</span><i></i></div>
</section>

${reassurance()}

<section class="section section--sm" aria-labelledby="cats-title">
  <div class="container">
    <div class="head head--center"${reveal(0, 'fade')}>
      <p class="eyebrow">Par besoin</p>
      <h2 class="title" id="cats-title">Deux gammes, une même source</h2>
    </div>
    <div class="cats">
      ${cats}
    </div>
  </div>
</section>

${bestProducts.length ? `<section class="section section--sm section--bone2" aria-labelledby="best-title">
  <div class="container">
    <div class="head"${reveal(0, 'fade')}>
      <div class="head__row">
        <div>
          <p class="eyebrow">Sélection</p>
          <h2 class="title" id="best-title">${escapeHtml(site.bestsellersTitle)}</h2>
          <p class="lede">${escapeHtml(site.bestsellersLede)}</p>
        </div>
        <a class="link" href="/collections/tout-nos-produits">Tout le catalogue ${icons.right}</a>
      </div>
    </div>
    ${carousel('best-carousel', best)}
  </div>
</section>` : ''}

<section class="section section--sm about" aria-labelledby="about-title">
  <div class="container about__grid">
    <div${reveal(0)}>
      <p class="eyebrow">${escapeHtml(site.about.eyebrow)}</p>
      <h2 class="title title--md" id="about-title">${escapeHtml(site.about.title)}</h2>
      <p class="lede">${escapeHtml(site.about.text)}</p>
      <a class="link" href="${safeUrl(site.about.url)}" style="margin-top:22px">${escapeHtml(site.about.cta)} ${icons.right}</a>
    </div>
    <ul class="about__points">
        ${aboutPoints}
    </ul>
  </div>
</section>

<section class="section section--sm" aria-labelledby="videos-title">
  <div class="container">
    <div class="head"${reveal(0, 'fade')}>
      <div class="head__row">
        <div>
          <p class="eyebrow">Vidéos</p>
          <h2 class="title title--md" id="videos-title">${escapeHtml(site.videosTitle)}</h2>
          <p class="lede">${escapeHtml(site.videosLede)}</p>
        </div>
      </div>
    </div>
  </div>
  <div class="vstrip" data-vstrip>
    <div class="vstrip__track" data-vstrip-track>
      ${videos}
      ${videos}
    </div>
  </div>
</section>

${moreProducts.length ? `<section class="section section--sm section--bone2" aria-labelledby="more-title">
  <div class="container">
    <div class="head"${reveal(0, 'fade')}>
      <div class="head__row">
        <div>
          <p class="eyebrow">Catalogue</p>
          <h2 class="title title--md" id="more-title">${escapeHtml(site.newTitle)}</h2>
          <p class="lede">${escapeHtml(site.newLede)}</p>
        </div>
        <a class="link" href="/collections/all">Voir les ${products.length} soins ${icons.right}</a>
      </div>
    </div>
    <div class="grid">
      ${more.join('\n      ')}
    </div>
  </div>
</section>` : ''}

<section class="section section--sm" aria-labelledby="story-title">
  <div class="container story">
    <div class="story__media"${reveal(0, 'scale')}>
      <img class="img-fade" src="${story.image}" alt="La mer Morte" loading="lazy" width="900" height="1125">
    </div>
    <div class="story__body"${reveal(1)}>
      <p class="eyebrow">${escapeHtml(story.eyebrow)}</p>
      <h2 class="title" id="story-title">${escapeHtml(story.title)}</h2>
      <p>${escapeHtml(story.text)}</p>
      <a class="link" href="${safeUrl(story.url)}">${escapeHtml(story.cta)} ${icons.right}</a>
    </div>
  </div>
</section>

<section class="section section--sm section--ink" aria-label="Nos repères">
  <div class="container">
    <div class="facts">
      ${facts}
    </div>
  </div>
</section>

<section class="section section--sm" aria-labelledby="feature-title">
  <div class="container">
    <div class="feature"${reveal(0, 'scale')}>
      <div class="feature__media" data-feature>
        ${featureMedia}
      </div>
      <div class="feature__body">
        <p class="eyebrow">${escapeHtml(feature.eyebrow)}</p>
        <h2 class="title title--md" id="feature-title">${escapeHtml(feature.title)}</h2>
        <p>${escapeHtml(feature.text)}</p>
        <a class="btn btn--outline btn--sm" href="${safeUrl(feature.url)}">${escapeHtml(feature.cta)}</a>
      </div>
    </div>
  </div>
</section>

<section class="section section--sm section--ritual" aria-labelledby="ritual-title">
  <div class="container">
    <div class="head head--center"${reveal(0, 'fade')}>
      <p class="eyebrow">Rituel</p>
      <h2 class="title title--md" id="ritual-title">${escapeHtml(site.ritualTitle)}</h2>
      <p class="lede">${escapeHtml(site.ritualSub)}</p>
    </div>
    <div class="ritual">
      ${ritual}
    </div>
  </div>
</section>

<section class="section section--sm section--bone2" aria-labelledby="reviews-title">
  <div class="container">
    <div class="head"${reveal(0, 'fade')}>
      <div class="head__row">
        <div>
          <p class="eyebrow">Avis</p>
          <h2 class="title title--md" id="reviews-title">${escapeHtml(site.reviewsTitle)}</h2>
          <p class="lede">${escapeHtml(site.reviewsLede)}</p>
        </div>
        <a class="link" href="/collections/tout-nos-produits">Voir les soins ${icons.right}</a>
      </div>
    </div>
    ${carousel('reviews-carousel', reviews)}
  </div>
</section>

<div class="marquee marquee--ink" aria-hidden="true"><div class="marquee__track">${marqueeItems(site.marquees[0])}${marqueeItems(site.marquees[0])}</div></div>

<section class="section section--sm" aria-labelledby="press-title">
  <div class="container">
    <div class="head head--center"${reveal(0, 'fade')}>
      <h2 class="title title--md" id="press-title">${escapeHtml(site.pressTitle)}</h2>
    </div>
    <div class="press">
      ${press}
    </div>
  </div>
</section>

<section class="section section--sm section--bone2" aria-labelledby="shop-title">
  <div class="container shop">
    <div class="shop__media"${reveal(0, 'scale')}>
      <img class="img-fade" src="${site.store.image}" alt="${escapeHtml(site.store.name)}" loading="lazy" width="900" height="675">
    </div>
    <div class="shop__body"${reveal(1)}>
      <p class="eyebrow">${escapeHtml(site.store.eyebrow)}</p>
      <h2 class="title title--md" id="shop-title">${escapeHtml(site.store.name)}</h2>
      <p>${escapeHtml(site.store.address)}</p>
      <p><a class="btn btn--outline btn--sm" href="${site.store.mapUrl}" target="_blank" rel="noopener">Voir sur la carte</a></p>
    </div>
  </div>
</section>

<section class="section section--sm" aria-label="Nos engagements">
  <div class="container">
    <div class="tags">
      ${tags}
    </div>
  </div>
</section>`;

  return layout({
    title: `417 France | ${site.tagline}`,
    description: site.description,
    body, currentPath: '/', hasHero: true, canonical: '/'
  });
}

function collectionPage(collection) {
  const cards = collection.products.map((p, i) => productCard(p, i)).join('\n      ');
  const count = collection.products.length;

  const body = `${breadcrumb([{ label: 'Accueil', url: '/' }, { label: collection.title }])}
<section class="container collection-hero">
  <h1${reveal(0, 'fade')}>${escapeHtml(collection.title)}</h1>
  <p${reveal(1, 'fade')}>${escapeHtml(collection.description)}</p>
</section>
<section class="container" style="padding-bottom:var(--space)">
  <div class="toolbar">
    <p class="toolbar__count"><span data-collection-count>${count} ${count > 1 ? 'soins' : 'soin'}</span></p>
    <div class="filters">
      <button type="button" class="chip is-active" data-availability="all" aria-pressed="true">Tous</button>
      <button type="button" class="chip" data-availability="in" aria-pressed="false">Disponibles</button>
      <button type="button" class="chip" data-availability="out" aria-pressed="false">Épuisés</button>
      <label class="visually-hidden" for="sort">Trier</label>
      <select id="sort" data-sort>
        <option value="manual">Tri : sélection</option>
        <option value="price-asc">Prix croissant</option>
        <option value="price-desc">Prix décroissant</option>
        <option value="title-asc">Nom A-Z</option>
        <option value="title-desc">Nom Z-A</option>
      </select>
    </div>
  </div>
  <div class="grid" data-collection-grid>
      ${cards}
  </div>
  <p class="empty" data-collection-empty${count ? ' hidden' : ''}>Aucun soin ne correspond à votre sélection.</p>
</section>`;

  return layout({
    title: `${collection.title} – ${site.name}`,
    description: collection.description || site.description,
    body,
    currentPath: `/collections/${collection.handle}`,
    canonical: `/collections/${collection.handle}`,
    image: collection.products[0] ? collection.products[0].image : site.socialImage
  });
}

function productPage(product) {
  const thumbs = product.images.map((image, i) => `<button type="button" data-gallery-thumb class="${i === 0 ? 'is-active' : ''}" data-full="${image.src}" data-alt="${escapeHtml(image.alt || product.title)}" aria-label="Voir l’image ${i + 1}">
        <img src="${image.src}" alt="" loading="lazy" width="160" height="160">
      </button>`).join('\n      ');

  const price = product.compareAt
    ? `<s>${money(product.compareAt)}</s><span>${money(product.price)}</span>`
    : `<span>${money(product.price)}</span>`;

  const sections = product.sections.map((s, i) => `<details${i === 0 ? ' open' : ''}>
      <summary>${escapeHtml(s.title)}</summary>
      <div class="acc__body">${s.body}</div>
    </details>`).join('\n    ');

  const others = products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.handle !== product.handle)
    .sort((a, b) => {
      const rank = (x) => (x.i - product.position + products.length) % products.length;
      if (a.p.available !== b.p.available) return a.p.available ? -1 : 1;
      return rank(a) - rank(b);
    })
    .map(({ p }) => p);

  const related = others.slice(0, 8).map((p, i) => productCard(p, i));

  const buy = product.available
    ? `<div class="qty" data-qty>
        <button type="button" data-step="down" aria-label="Diminuer la quantité">&minus;</button>
        <label class="visually-hidden" for="qty-${product.handle}">Quantité</label>
        <input id="qty-${product.handle}" type="number" min="1" value="1" inputmode="numeric">
        <button type="button" data-step="up" aria-label="Augmenter la quantité">+</button>
      </div>
      <button type="button" class="btn" data-add-to-cart="${product.handle}" data-qty-source="#qty-${product.handle}">Ajouter au panier</button>`
    : '<button type="button" class="btn btn--block" disabled>Épuisé</button>';

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    name: product.title,
    image: product.images.map((i) => SITE_URL + i.src),
    description: product.excerpt,
    brand: { '@type': 'Brand', name: site.name },
    offers: {
      '@type': 'Offer', price: product.price.toFixed(2), priceCurrency: 'EUR',
      availability: product.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${SITE_URL}/products/${product.handle}`
    }
  });

  const body = `${breadcrumb([
    { label: 'Accueil', url: '/' },
    { label: product.category === 'Visage' ? 'Soins du visage' : 'Soins du corps',
      url: product.category === 'Visage' ? '/collections/produits-pour-le-visage' : '/collections/produit-pour-le-visage' },
    { label: product.title }
  ])}
<section class="container section section--sm">
  <div class="product">
    <div class="gallery" data-gallery${reveal(0, 'fade')}>
      <div class="gallery__thumbs">
      ${thumbs}
      </div>
      <div class="gallery__stage" data-gallery-stage title="Cliquer pour agrandir">
        <img src="${product.image}" alt="${escapeHtml(product.title)}" width="900" height="1125" fetchpriority="high">
        <span class="gallery__zoom">${icons.zoom}</span>
      </div>
    </div>
    <div class="panel"${reveal(1)}>
      <p class="panel__vendor">${escapeHtml(product.category)} &middot; ${escapeHtml(site.name)}</p>
      <h1>${escapeHtml(product.title)}</h1>
      <p class="panel__price">${price}</p>
      <p class="panel__stock${product.available ? '' : ' is-out'}">${product.available ? 'En stock, expédié sous 24 h' : 'Épuisé, bientôt de retour'}</p>
      <div class="buy" data-buy-anchor>
        ${buy}
      </div>
      <ul class="perks">
        <li>${icons.truck}<span>Livraison offerte dès ${settings.freeShippingThreshold || site.freeShippingThreshold} € d’achat</span></li>
        <li>${icons.shield}<span>Retour accepté sous 14 jours</span></li>
        <li>${icons.leaf}<span>Formule vegan aux minéraux de la mer Morte</span></li>
      </ul>
      <div class="acc">
    ${sections}
      </div>
    </div>
  </div>
</section>

<section class="section section--sm section--bone2" aria-labelledby="related-title">
  <div class="container">
    <div class="head"${reveal(0, 'fade')}>
      <div class="head__row">
        <div>
          <p class="eyebrow">À découvrir</p>
          <h2 class="title title--md" id="related-title">Compléter le rituel</h2>
        </div>
        <a class="link" href="/collections/tout-nos-produits">Tout voir ${icons.right}</a>
      </div>
    </div>
    ${carousel(`related-${product.handle}`, related)}
  </div>
</section>

<div class="buybar" data-buy-bar>
  <div class="buybar__info">
    <p class="buybar__title">${escapeHtml(product.title)}</p>
    <p class="buybar__price">${money(product.price)}</p>
  </div>
  ${product.available
    ? `<button type="button" class="btn btn--sm" data-add-to-cart="${product.handle}">Ajouter</button>`
    : '<button type="button" class="btn btn--sm" disabled>Épuisé</button>'}
</div>
<script type="application/ld+json">${jsonLd}</script>`;

  return layout({
    title: `${product.title} – ${site.name}`,
    description: product.excerpt || site.description,
    body,
    currentPath: `/products/${product.handle}`,
    canonical: `/products/${product.handle}`,
    image: product.image
  });
}

function storyPage() {
  const s = site.storyPage;
  const chapters = s.chapters.map((c, i) => `<div class="chapter${i % 2 ? ' chapter--flip' : ''}">
      <div class="chapter__media"${reveal(0, 'scale')}>
        <img class="img-fade" src="${c.image}" alt="${escapeHtml(c.title)}" loading="lazy" width="900" height="1125">
      </div>
      <div class="chapter__body"${reveal(1)}>
        <p class="eyebrow">${escapeHtml(c.eyebrow)}</p>
        <h2 class="title title--md">${escapeHtml(c.title)}</h2>
        <p>${escapeHtml(c.text)}</p>
      </div>
    </div>`).join('\n    ');

  const facts = site.facts.map((f, i) => `<div class="fact"${reveal(i)}>
        <p class="fact__value" data-count>${escapeHtml(f.value)}</p>
        <p class="fact__label">${escapeHtml(f.label)}</p>
        <p class="fact__text">${escapeHtml(f.text)}</p>
      </div>`).join('\n      ');

  const body = `<section class="page-hero">
  <img src="${s.hero}" alt="" width="1800" height="1000">
  <div class="page-hero__inner">
    <div class="container">
      <h1>${escapeHtml(s.title)}</h1>
      <p>${escapeHtml(s.lead)}</p>
    </div>
  </div>
</section>

<section class="section section--sm">
  <div class="container">
    ${chapters}
  </div>
</section>

<section class="section section--sm section--ink" aria-label="Nos repères">
  <div class="container">
    <div class="facts">
      ${facts}
    </div>
  </div>
</section>

<section class="section section--sm">
  <div class="container" style="text-align:center"${reveal(0, 'fade')}>
    <h2 class="title title--md">Commencer le rituel</h2>
    <p class="lede" style="margin-inline:auto">Trouvez le soin qui correspond à votre peau, ou parcourez l’ensemble de la gamme.</p>
    <p style="margin-top:24px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <a class="btn btn--sm" href="/collections/produits-pour-le-visage">Soins du visage</a>
      <a class="btn btn--outline btn--sm" href="/collections/produit-pour-le-visage">Soins du corps</a>
    </p>
  </div>
</section>`;

  return layout({
    title: `Notre histoire – ${site.name}`,
    description: s.lead,
    body, currentPath: '/pages/notre-histoire', canonical: '/pages/notre-histoire', image: s.hero
  });
}

function faqPage() {
  const items = site.faq.map((item, i) => `<details${i === 0 ? ' open' : ''}>
      <summary>${escapeHtml(item.q)}</summary>
      <div class="acc__body"><p>${escapeHtml(item.a)}</p></div>
    </details>`).join('\n    ');

  const reassure = site.reassurance.map((item, i) => `<div${reveal(i)}>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.text)}</p>
      </div>`).join('\n      ');

  const body = `${breadcrumb([{ label: 'Accueil', url: '/' }, { label: 'Livraison et retours' }])}
<section class="container page-head">
  <h1${reveal(0, 'fade')}>Livraison et retours</h1>
  <p${reveal(1, 'fade')}>Tout ce qu’il faut savoir avant et après la commande.</p>
</section>
<section class="container" style="padding-bottom:var(--space)">
  <div class="acc faq"${reveal(0, 'fade')}>
    ${items}
  </div>
  <div class="contact-cards" style="grid-template-columns:repeat(4,1fr)">
      ${reassure}
  </div>
  <p style="text-align:center;margin-top:34px">
    <a class="btn btn--outline btn--sm" href="/pages/contact">Une autre question ? Écrivez-nous</a>
  </p>
</section>`;

  return layout({
    title: `Livraison et retours – ${site.name}`,
    description: 'Délais, frais de port, retours et paiement : toutes les réponses.',
    body, currentPath: '/pages/livraison-et-retours', canonical: '/pages/livraison-et-retours'
  });
}

function contactPage() {
  const body = `${breadcrumb([{ label: 'Accueil', url: '/' }, { label: 'Contact' }])}
<section class="container page-head">
  <h1${reveal(0, 'fade')}>Nous écrire</h1>
  <p${reveal(1, 'fade')}>Une question sur un soin, une commande ou un partenariat ? Nous répondons sous 24 heures ouvrées.</p>
</section>
<section class="container" style="padding-bottom:var(--space)">
  <form class="form" data-demo-form data-success="Merci, votre message a bien été transmis."${reveal(0)}>
    <div class="field"><label for="contact-name">Nom</label><input id="contact-name" name="name" type="text" autocomplete="name"></div>
    <div class="field"><label for="contact-email">E-mail <span class="req" aria-hidden="true">*</span></label><input id="contact-email" name="email" type="email" autocomplete="email" required></div>
    <div class="field"><label for="contact-phone">Téléphone</label><input id="contact-phone" name="phone" type="tel" autocomplete="tel"></div>
    <div class="field"><label for="contact-message">Votre message</label><textarea id="contact-message" name="message"></textarea></div>
    <button type="submit" class="btn">Envoyer</button>
    <p class="form-note" data-form-note style="color:var(--muted)"></p>
  </form>
  <div class="contact-cards">
    <div${reveal(0)}><h3>Boutique</h3><p>${escapeHtml(site.store.name)}<br>${escapeHtml(site.store.address)}</p></div>
    <div${reveal(1)}><h3>Service client</h3><p>Réponse sous 24 h ouvrées</p></div>
    <div${reveal(2)}><h3>Livraison</h3><p>Offerte dès ${settings.freeShippingThreshold || site.freeShippingThreshold} € d’achat</p></div>
  </div>
</section>`;

  return layout({
    title: `Contact – ${site.name}`,
    description: 'Contactez l’équipe 417 France.',
    body, currentPath: '/pages/contact', canonical: '/pages/contact'
  });
}

function storeLocatorPage() {
  const mapSrc = 'https://www.google.com/maps?q=88+Bd+de+Courcelles,+75017+Paris&output=embed';
  const body = `${breadcrumb([{ label: 'Accueil', url: '/' }, { label: 'Points de vente' }])}
<section class="container page-head">
  <h1${reveal(0, 'fade')}>Nos points de vente</h1>
  <p${reveal(1, 'fade')}>Retrouvez les soins 417 France près de chez vous.</p>
</section>
<section class="container" style="padding-bottom:var(--space)">
  <div class="locator">
    <div class="locator__panel"${reveal(0)}>
      <div class="field"><label for="locator-search">Ville ou code postal</label><input id="locator-search" type="search" placeholder="Paris, 75017…"></div>
      <div class="field"><label for="locator-radius">Rayon</label><select id="locator-radius"><option>10 km</option><option>50 km</option><option selected>100 km</option></select></div>
      <ul class="store-list">
        <li>
          <h3>${escapeHtml(site.store.name)}</h3>
          <p>${escapeHtml(site.store.address)}</p><p>France</p>
          <a class="link" href="${site.store.mapUrl}" target="_blank" rel="noopener">Itinéraire ${icons.right}</a>
        </li>
      </ul>
    </div>
    <div class="locator__map"${reveal(1, 'fade')}>
      <iframe title="Carte de nos points de vente" src="${mapSrc}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
    </div>
  </div>
</section>`;

  return layout({
    title: `Points de vente – ${site.name}`,
    description: 'Trouvez un point de vente 417 France près de chez vous.',
    body, currentPath: '/pages/store-locator', canonical: '/pages/store-locator'
  });
}

function policyPage(policy) {
  const content = fs.readFileSync(path.join(DATA, 'policies', `${policy.handle}.html`), 'utf8')
    .replace(/^<div class="rte"[^>]*>/i, '').replace(/<\/div>\s*$/i, '').trim();

  const body = `${breadcrumb([{ label: 'Accueil', url: '/' }, { label: policy.title }])}
<section class="container page-head">
  <h1${reveal(0, 'fade')}>${escapeHtml(policy.title)}</h1>
</section>
<section class="container" style="padding-bottom:var(--space)">
  <div class="rte"${reveal(0, 'fade')}>${content}</div>
</section>`;

  return layout({
    title: `${policy.title} – ${site.name}`,
    description: `${policy.title} de ${site.name}.`,
    body, currentPath: `/policies/${policy.handle}`, canonical: `/policies/${policy.handle}`
  });
}

function searchPage() {
  const body = `${breadcrumb([{ label: 'Accueil', url: '/' }, { label: 'Recherche' }])}
<section class="container page-head">
  <h1${reveal(0, 'fade')}>Rechercher</h1>
  <p${reveal(1, 'fade')}>Trouvez un soin par son nom ou par ses ingrédients.</p>
</section>
<section class="container container--narrow" style="padding-bottom:var(--space)">
  <form class="search-form" role="search"${reveal(0)}>
    <label class="visually-hidden" for="page-search">Rechercher un produit</label>
    <input id="page-search" type="search" placeholder="Sérum, masque, beurre corporel…" data-search-input autocomplete="off">
    <button type="submit" class="btn">Rechercher</button>
  </form>
  <ul class="search-results" data-search-results></ul>
</section>`;

  return layout({
    title: `Recherche – ${site.name}`,
    description: 'Recherchez un soin dans le catalogue 417 France.',
    body, currentPath: '/search', canonical: '/search'
  });
}

function notFoundPage() {
  const body = `<section class="container notfound">
  <h1${reveal(0, 'fade')}>404</h1>
  <p${reveal(1, 'fade')}>Cette page est introuvable. Le lien est peut-être incorrect ou la page a été déplacée.</p>
  <a class="btn btn--sm" href="/"${reveal(2, 'fade')}>Retour à l’accueil</a>
</section>`;

  return layout({
    title: `Page introuvable – ${site.name}`,
    description: 'La page demandée est introuvable.',
    body, currentPath: '/404', canonical: '/404'
  });
}

/* -------------------------------------------------------------------------- */
/* Génération                                                                  */
/* -------------------------------------------------------------------------- */

function buildSitemap(urls) {
  const entries = urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const urls = [];

  write('index.html', homePage());
  urls.push('/');

  collections.forEach((collection) => {
    write(path.join('collections', collection.handle, 'index.html'), collectionPage(collection));
    urls.push(`/collections/${collection.handle}`);
  });

  products.forEach((product) => {
    write(path.join('products', product.handle, 'index.html'), productPage(product));
    urls.push(`/products/${product.handle}`);
  });

  write(path.join('pages', 'notre-histoire', 'index.html'), storyPage());
  urls.push('/pages/notre-histoire');
  write(path.join('pages', 'livraison-et-retours', 'index.html'), faqPage());
  urls.push('/pages/livraison-et-retours');
  write(path.join('pages', 'contact', 'index.html'), contactPage());
  urls.push('/pages/contact');
  write(path.join('pages', 'store-locator', 'index.html'), storeLocatorPage());
  urls.push('/pages/store-locator');

  site.policies.forEach((policy) => {
    write(path.join('policies', policy.handle, 'index.html'), policyPage(policy));
    urls.push(`/policies/${policy.handle}`);
  });

  write(path.join('search', 'index.html'), searchPage());
  urls.push('/search');

  write('404.html', notFoundPage());
  write('sitemap.xml', buildSitemap(urls));
  write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);

  copyDir(path.join(SRC, 'assets'), path.join(DIST, 'assets'));
  copyDir(path.join(SRC, 'media'), path.join(DIST, 'media'));

  console.log('Site généré dans /dist');
  console.log(`  ${products.length} produits, ${collections.length} collections, ${urls.length} URL`);
}

build();
