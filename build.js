#!/usr/bin/env node
/* =============================================================================
   417 France - générateur de site statique
   Source de vérité : data/store.json (modifiable depuis le back-office).
   ========================================================================== */
'use strict';

/* SITE_URL et les autres variables viennent de .env.local. */
require('./lib/env');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const supabase = require('./lib/supabase');

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

/* Modes de livraison proposés au paiement, prix TTC tout compris. */
const shippingMethods = Array.isArray(settings.shippingMethods) ? settings.shippingMethods : [];
const shippingFrom = shippingMethods.length
  ? Math.min.apply(null, shippingMethods.map((m) => Number(m.price) || 0))
  : null;

function deliveryDelay(method) {
  const min = Number(method.minDays) || 0;
  const max = Number(method.maxDays) || min;
  if (max <= 1) return '1 jour';
  return min === max ? `${max} jours` : `${min} à ${max} jours`;
}

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

function nl2br(html) {
  if (/<(?:p|ul|ol|li|div|h[1-6]|blockquote|table|pre|hr)\b/i.test(html)) return html;
  return html.replace(/\n/g, '<br>\n');
}

/* Entoure chaque « 417 » visible d'un span .n417 (police dédiée). Ne touche
   ni aux balises et attributs, ni aux scripts et styles, ni à « 417france ». */
function mark417(html) {
  return html
    .split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>)/)
    .map((part, i) => (i % 2 ? part : part.replace(/(^|[^\w&#])417(?!\w)/g, '$1<span class="n417">417</span>')))
    .join('');
}

/* Les crèmes pour les mains sont le cadeau : elles n'ouvrent pas droit à l'offre. */
const isHandCream = (product) => /pour les mains/i.test(product.title);

/* Une description de résultat de recherche se lit jusqu'à 160 caractères
   environ. Au-delà le moteur coupe lui-même, et souvent au milieu d'un mot. */
function metaDescription(value) {
  const text = stripTags(value).replace(/\s+/g, ' ').trim();
  if (text.length <= 160) return text;
  const cut = text.slice(0, 157);
  const space = cut.lastIndexOf(' ');
  return (space > 100 ? cut.slice(0, space) : cut).replace(/[,;:.\u2026]+$/, '') + '\u2026';
}

function stripTags(value) {
  return String(value == null ? '' : value).replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Les prix partent en euros, la devise de facturation, mais portent le
   montant brut : le navigateur les reaffiche dans la devise du visiteur sans
   avoir a deviner quoi que ce soit dans le texte. */
/* Open Graph et les moteurs veulent des adresses absolues. */
function absolute(url) {
  const value = String(url || '');
  return value.charAt(0) === '/' ? SITE_URL + value : value;
}

function money(amount) {
  const value = Number(amount || 0);
  return `<span class="money" data-amount="${value.toFixed(2)}">€${value.toFixed(2).replace('.', ',')}</span>`;
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

/* Trois etats visibles en boutique. Sans stock, un produit est annonce
   « En arrivage » : c'est le cas courant, la boutique se reapprovisionne.
   Seul le statut « Arrete » le bascule sur « Epuise », puisque celui-la ne
   reviendra pas. */
const DISCONTINUED_STATUS = 'Arrêté';

function availabilityOf(product) {
  if (Number(product.stock) > 0) return 'in-stock';
  return product.status === DISCONTINUED_STATUS ? 'out-of-stock' : 'incoming';
}

const AVAILABILITY_LABELS = {
  'in-stock': 'En stock',
  'incoming': 'En arrivage',
  'out-of-stock': 'Épuisé'
};

/* Ce que schema.org appelle les trois memes etats. */
const SCHEMA_AVAILABILITY = {
  'in-stock': 'https://schema.org/InStock',
  'incoming': 'https://schema.org/BackOrder',
  'out-of-stock': 'https://schema.org/OutOfStock'
};

/* Phrase affichee sous le prix, sur la fiche produit. */
const STOCK_NOTES = {
  'in-stock': 'En stock, expédié le jour même ou le lendemain',
  'incoming': 'En arrivage, réapprovisionnement en cours',
  'out-of-stock': 'Épuisé, bientôt de retour'
};

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
      availability: availabilityOf(p),
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
/* Langues et devises                                                          */
/* -------------------------------------------------------------------------- */

/* Le navigateur choisit seul la langue et la devise a la premiere visite ;
   ces reglages lui donnent la matiere. Les taux servent a l'affichage, la
   facturation reste dans la devise de base. */
const BASE_CURRENCY = site.baseCurrency || 'EUR';
const DEFAULT_LOCALE = site.defaultLocale || 'fr';
const LOCALES = site.locales || [{ code: DEFAULT_LOCALE, label: 'Français' }];
const CURRENCIES = site.currencies || { EUR: { symbol: '€', rate: 1, locale: 'fr-FR' } };

/* Un fichier par langue, servi separement : la page francaise ne paie pas
   le poids des traductions, et le navigateur ne telecharge la sienne qu'une
   fois. */
const translations = (() => {
  const file = path.join(DATA, 'i18n.json');
  if (!fs.existsSync(file)) return {};
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = {};
  Object.keys(raw).forEach((code) => {
    if (code.charAt(0) !== '_' && code !== DEFAULT_LOCALE) out[code] = raw[code];
  });
  return out;
})();

const I18N_VERSION = crypto.createHash('sha1')
  .update(JSON.stringify(translations)).digest('hex').slice(0, 10);

const localeConfig = {
  defaultLocale: DEFAULT_LOCALE,
  defaultCountry: site.defaultCountry || 'France',
  baseCurrency: BASE_CURRENCY,
  locales: LOCALES,
  currencies: CURRENCIES,
  countries: site.countries,
  ratesUpdatedAt: site.ratesUpdatedAt || '',
  translated: Object.keys(translations),
  version: I18N_VERSION
};

/* -------------------------------------------------------------------------- */
/* Codes de réduction                                                          */
/* -------------------------------------------------------------------------- */

/** Empreinte d'un code. Le même calcul tourne dans le navigateur : la page
    ne transporte que l'empreinte, jamais le code en clair, pour qu'un
    visiteur ne puisse pas lire la liste des codes dans le source. Ce n'est
    pas un secret cryptographique, seulement de quoi éviter cette lecture. */
function codeHash(code) {
  let hash = 5381;
  const value = String(code).toUpperCase();
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/* Seuls les codes utilisables aujourd'hui partent dans les pages : ni les
   codes programmés plus tard, ni les expirés, ni ceux déjà épuisés. */
const TODAY = new Date().toISOString().slice(0, 10);

const liveDiscounts = (store.discounts || []).filter((d) => {
  if (!d || !d.active) return false;
  if (d.startsAt && TODAY < d.startsAt) return false;
  if (d.endsAt && TODAY > d.endsAt) return false;
  if (d.maxUses && (d.used || 0) >= d.maxUses) return false;
  return true;
}).map((d) => {
  const payload = {
    auto: !!d.auto,
    type: d.type,
    value: Number(d.value) || 0,
    min: Number(d.minSubtotal) || 0,
    scope: d.scope || ''
  };
  /* Un code saisi voyage sous forme d'empreinte ; une réduction automatique
     n'a pas de code, mais son intitulé s'affiche dans le panier. */
  if (d.auto) payload.label = d.label || '';
  else payload.h = codeHash(d.code);
  return payload;
});

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
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3-5-3.5-5-1.2C7 7 9.5 7 12 7Zm0 0c1.5-3 5-3.5 5-1.2C17 7 14.5 7 12 7Z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.8 2.7 5.9 6.3.7-4.7 4.3 1.3 6.3-5.6-3.2-5.6 3.2 1.3-6.3L3 9.4l6.3-.7L12 2.8Z"/></svg>'
};

/* -------------------------------------------------------------------------- */
/* Composants                                                                  */
/* -------------------------------------------------------------------------- */

/** Vignette en haut à gauche de la carte, paramétrée depuis le back-office.
    Elle s'affiche pour un seul des trois états : en stock, épuisé ou en
    arrivage. */
function productBadge(product) {
  const config = product.badge;
  const matches = config && config.enabled && config.text
    && config.when === product.availability;
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

  const multi = product.hoverImage && product.hoverImage !== product.image ? ' data-multi' : '';

  return `<article class="card" data-card data-position="${index}" data-price="${product.price}" data-title="${escapeHtml(product.title)}" data-available="${product.available}" data-availability="${product.availability}"${reveal(index)}>
  <div class="card__top"${multi}>
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

  /* Sur telephone le bandeau devient un ruban qui defile sans jamais s'arreter.
     La version en fondu reste en place pour les grands ecrans. */
  const tickerItems = site.announcements
    .map((text) => `<span class="ticker__item">${escapeHtml(text)}</span>`)
    .join('');

  return `<header class="header">
  <div class="announce" aria-live="off">
    <div class="container announce__inner">
      ${announcements}
    </div>
    <div class="ticker" data-strip data-strip-speed="40" aria-hidden="true">
      <div class="ticker__track" data-strip-track>${tickerItems}${tickerItems}${tickerItems}${tickerItems}</div>
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
      <a class="ibtn" href="/pages/compte" aria-label="Espace client"${currentPath === '/pages/compte' ? ' aria-current="page"' : ''}>${icons.user}</a>
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
    .map((c, i) => `<li data-stagger style="--i:${i}"><button type="button" data-region="${escapeHtml(c.name)}" data-country="${escapeHtml(c.code || '')}" data-currency="${c.currency}" data-lang="${escapeHtml(c.lang || DEFAULT_LOCALE)}"><span>${escapeHtml(c.name)}</span><span>${c.currency}${c.symbol === c.currency ? '' : ` ${c.symbol}`}</span></button></li>`)
    .join('\n      ');

  const languages = LOCALES
    .map((l) => `<li><button type="button" data-lang-choice="${escapeHtml(l.code)}" lang="${escapeHtml(l.code)}">${escapeHtml(l.label)}</button></li>`)
    .join('');

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
    <form class="cart-code" data-cart-code>
      <label class="visually-hidden" for="cart-code-input">Code de réduction</label>
      <input id="cart-code-input" type="text" placeholder="Code de réduction" autocomplete="off" spellcheck="false" data-cart-code-input>
      <button type="submit" class="btn btn--outline btn--sm" data-cart-code-apply>Appliquer</button>
    </form>
    <p class="cart-note" data-cart-code-note></p>
    <div class="cart-sums" data-cart-sums></div>
    <div class="cart-total"><span>Total</span><strong data-cart-total>€0,00</strong></div>
    <a class="btn btn--block" href="/commande">Procéder au paiement</a>
    <p class="cart-note">Prix tout compris, taxes incluses. Livraison en France uniquement, à domicile ou en point relais : son prix s’affiche à l’étape suivante.</p>
  </div>
</aside>

<aside class="drawer" data-drawer="region" aria-label="Région et devise">
  <div class="drawer__head">
    <span class="drawer__title">Région et devise</span>
    <button type="button" class="ibtn" data-close-drawer aria-label="Fermer">${icons.close}</button>
  </div>
  <div class="drawer__body">
    <p class="region-auto" data-region-auto hidden></p>
    <h3 class="region-label">Langue</h3>
    <ul class="lang-list">
      ${languages}
    </ul>
    <h3 class="region-label">Pays et devise</h3>
    <ul class="region-list">
      ${regions}
    </ul>
    <p class="region-note">Les prix sont convertis à titre indicatif. La commande est facturée en ${escapeHtml(BASE_CURRENCY)}.</p>
  </div>
</aside>

<div class="lightbox" data-lightbox role="dialog" aria-modal="true" aria-label="Visionneuse d’images">
  <img class="lightbox__img" data-lightbox-img src="" alt="">
  <button type="button" class="lightbox__close" data-lightbox-close aria-label="Fermer">${icons.close}</button>
  <button type="button" class="lightbox__prev" data-lightbox-prev aria-label="Image précédente">${icons.left}</button>
  <button type="button" class="lightbox__next" data-lightbox-next aria-label="Image suivante">${icons.right}</button>
  <p class="lightbox__counter" data-lightbox-counter></p>
</div>

<button type="button" class="to-top" data-to-top aria-label="Revenir en haut">${icons.up}</button>

${consentBanner()}`;
}

/** Bandeau de consentement. Il reste caché tant que le script n'a pas vérifié
    qu'aucune réponse n'est déjà enregistrée : sans script, rien ne s'affiche
    et rien n'est mesuré non plus. */
function consentBanner() {
  return `<div class="consent" data-consent hidden role="region" aria-labelledby="consent-title">
  <div class="consent__inner">
    <div class="consent__copy">
      <p class="consent__title" id="consent-title">Cookies et mesure d’audience</p>
      <p class="consent__text">Le panier et votre choix de région sont gardés dans votre navigateur : c’est nécessaire au fonctionnement de la boutique. La mesure d’audience, elle, n’est activée qu’avec votre accord. <a href="/policies/cookie-policy">En savoir plus</a></p>
    </div>
    <div class="consent__actions">
      <button type="button" class="btn btn--outline btn--sm" data-consent-answer="denied">Refuser</button>
      <button type="button" class="btn btn--sm" data-consent-answer="granted">Accepter</button>
    </div>
  </div>
</div>`;
}

/** Champ piège anti-robot. Il n'est ni vu, ni atteignable au clavier, ni
    proposé en saisie automatique : rempli, l'envoi est ignoré. */
let honeypotCount = 0;

function honeypot() {
  honeypotCount += 1;
  const id = `website-${honeypotCount}`;
  return `<p class="visually-hidden" aria-hidden="true">
      <label for="${id}">Ne remplissez pas ce champ</label>
      <input id="${id}" type="text" name="website" tabindex="-1" autocomplete="off">
    </p>`;
}

function newsletter() {
  return `<section class="section section--sm news">
  <div class="container"${reveal(0, 'fade')}>
    <p class="eyebrow" style="color:var(--clay)">Lettre d’information</p>
    <h2 class="title title--md">${escapeHtml(site.newsletter.title)}</h2>
    <p class="lede">${escapeHtml(site.newsletter.text)}</p>
    <form class="news__form" data-site-form="newsletter" data-success="Merci, votre inscription est enregistrée.">
      <label class="visually-hidden" for="newsletter-email">E-mail</label>
      <input id="newsletter-email" type="email" name="email" placeholder="Votre adresse e-mail" required>
      ${honeypot()}
      <button type="submit" class="btn">S’inscrire</button>
      <p class="form-note" data-form-note style="flex:1 0 100%"></p>
    </form>
  </div>
</section>`;
}

/** Colonne de pied de page. Ouverte par defaut : sur telephone le script la
    replie pour raccourcir le pied de page, et sans script rien n'est cache. */
function footerGroup(title, items) {
  return `<details class="fgroup" open>
        <summary><h3>${escapeHtml(title)}</h3><span class="fgroup__sign" aria-hidden="true"></span></summary>
        <ul>${items}</ul>
      </details>`;
}

function footer() {
  const shop = site.menu.map((i) => `<li><a href="${safeUrl(i.url)}">${escapeHtml(i.label)}</a></li>`).join('');
  const help = [
    ['/pages/livraison-et-retours', 'Livraison et retours'],
    ['/pages/store-locator', 'Points de vente'],
    ['/pages/contact', 'Nous écrire'],
    ['/search', 'Rechercher']
  ].map(([url, label]) => `<li><a href="${url}">${label}</a></li>`).join('');
  const policies = site.policies.map((p) => `<li><a href="/policies/${p.handle}">${escapeHtml(p.title)}</a></li>`).join('')
    + '<li><button type="button" class="footer__link" data-consent-reopen>Gestion des cookies</button></li>';

  return `<footer class="footer">
  <div class="container footer__top">
    <div class="footer__brand">
      <img src="${site.logoLight}" alt="417 France" width="240" height="100" loading="lazy">
      <p>${escapeHtml(settings.city ? settings.address + ', ' + settings.zip + ' ' + settings.city : site.store.address)}</p>
    </div>
    <nav class="footer__cols" aria-label="Liens de pied de page">
      ${footerGroup('Boutique', shop)}
      ${footerGroup('Aide', help)}
      ${footerGroup('Légal', policies)}
    </nav>
  </div>
  <div class="container footer__bottom">
    <span>&copy; ${new Date().getFullYear()} ${escapeHtml(site.name)}</span>
    <span class="footer__tagline">Une peau propre, un esprit clair</span>
  </div>
</footer>`;
}

function layout(options) {
  const {
    title, description = site.description, body,
    currentPath = '/', hasHero = false, image = site.socialImage,
    canonical = currentPath, extraHead = '', ogType = 'website', preloadImage = '',
    robots = 'index, follow, max-image-preview:large, max-snippet:-1'
  } = options;

  const catalogJson = JSON.stringify(products.map((p) => ({
    handle: p.handle, title: p.title, price: p.price, category: p.category,
    available: p.available, availability: p.availability, image: p.image, excerpt: p.excerpt
  })));

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(metaDescription(description))}">
<link rel="canonical" href="${SITE_URL}${canonical}">
<meta name="robots" content="${robots}">
<meta property="og:site_name" content="${escapeHtml(site.name)}">
<meta property="og:type" content="${ogType}">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(metaDescription(description))}">
<meta property="og:image" content="${absolute(image)}">
<meta property="og:image:alt" content="${escapeHtml(title)}">
<meta property="og:url" content="${SITE_URL}${canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(metaDescription(description))}">
<meta name="twitter:image" content="${absolute(image)}">
<meta name="theme-color" content="#17130f">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
${preloadImage ? `<link rel="preload" as="image" href="${preloadImage}" fetchpriority="high">\n` : ''}<link rel="preconnect" href="https://fonts.googleapis.com">
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
<script>window.SITE_PRODUCTS = ${catalogJson};window.SITE_CONFIG = ${JSON.stringify({
  freeShippingThreshold: settings.freeShippingThreshold || site.freeShippingThreshold,
  shippingFrom: shippingFrom,
  shippingMethods: shippingMethods.map((m) => ({ id: m.id, type: m.type, carrier: m.carrier, label: m.label, price: Number(m.price) || 0 }))
})};window.SITE_FORMS = ${JSON.stringify({
  endpoint: (site.forms && site.forms.endpoint) || '',
  email: settings.email || ''
})};window.SITE_ANALYTICS = ${JSON.stringify(site.analytics || { provider: 'none', id: '' })};window.SITE_LOCALE = ${JSON.stringify(localeConfig)};window.SITE_DISCOUNTS = ${JSON.stringify(liveDiscounts)};</script>
<script src="/assets/js/app.js?v=${JS_VERSION}" defer></script>
</body>
</html>
`;
}

/* Les moteurs lisent le JSON-LD ; le « < » échappé évite qu'une valeur ne
   referme la balise script. */
function jsonLd(data) {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${payload}</script>`;
}

/* Le fil d'Ariane sert aussi aux moteurs : la même liste, en JSON-LD, est ce
   qui donne le chemin affiché sous le titre dans les résultats. */
function breadcrumb(items) {
  const parts = items.map((item, i) => (
    i === items.length - 1
      ? `<span aria-current="page">${escapeHtml(item.label)}</span>`
      : `<a href="${item.url}">${escapeHtml(item.label)}</a><span>/</span>`
  ));

  const trail = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => {
      const entry = { '@type': 'ListItem', position: i + 1, name: item.label };
      if (item.url) entry.item = SITE_URL + item.url;
      return entry;
    })
  });

  return `<nav class="container crumb" aria-label="Fil d’Ariane">${parts.join('')}</nav>
${trail}`;
}

function reassurance() {
  const items = site.reassurance.map((item, i) => `<div class="reassure__item" data-r="${i}">
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

/** index a null : pas d'apparition au defilement, la carte est visible tout
    de suite. C'est ce qu'il faut dans un ruban qui defile en continu. */
function reviewCard(review, index) {
  const anim = index === null ? '' : reveal(index);
  return `<article class="review"${anim}>
        ${stars(review.rating)}
        <p class="review__text">« ${escapeHtml(review.text)} »</p>
        <p class="review__meta"><strong>${escapeHtml(review.name)}</strong>${review.city ? ' · ' + escapeHtml(review.city) : ''}<br><span>${escapeHtml(review.product)}</span></p>
      </article>`;
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

  const reviews = site.reviews.map((r, i) => reviewCard(r, i));
  const reviewRibbon = site.reviews.map((r) => reviewCard(r, null)).join('\n        ');

  /* Diaporama telephone : un soin a la fois, sans prix. */
  const productSlides = products.map((p, i) => `<a class="pslide${i === 0 ? ' is-active' : ''}" href="/products/${p.handle}" data-pshow-slide>
          <span class="pslide__media"><img src="${p.image}" alt="" loading="lazy" width="900" height="900"></span>
          <span class="pslide__name">${escapeHtml(p.title)}</span>
        </a>`).join('\n        ');

  const productDots = products.map((p, i) => `<button type="button" class="pshow__dot${i === 0 ? ' is-active' : ''}" data-pshow-dot="${i}" aria-label="Voir ${escapeHtml(p.title)}"></button>`).join('');

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

  /* Meme liste, sans apparition au defilement : elle tourne en boucle. */
  const pressRibbon = site.press
    .map((p) => `<img class="img-fade" src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy" width="240" height="120">`)
    .join('');

  const tags = site.commitments.map((t, i) => `<span class="tag"${reveal(i, 'fade')}>${escapeHtml(t)}</span>`).join('\n      ');

  const marqueeItems = (text) => Array.from({ length: 10 }, () => `<span>${escapeHtml(text)}</span>`).join('');

  const story = site.storyTeaser;
  const feature = site.feature;

  const featureMedia = feature.youtube
    ? `<iframe class="feature__video" src="https://www.youtube.com/embed/${escapeHtml(feature.youtube)}?autoplay=1&mute=1&loop=1&playlist=${escapeHtml(feature.youtube)}&controls=1&rel=0&modestbranding=1" title="${escapeHtml(feature.title)}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen loading="lazy"></iframe>`
    : feature.src
      ? `<video class="feature__video" src="${escapeHtml(feature.src)}" poster="${escapeHtml(feature.poster)}" controls playsinline preload="metadata"></video>`
      : `<img class="img-fade" src="${escapeHtml(feature.poster)}" alt="${escapeHtml(feature.title)}" loading="lazy" width="1600" height="900">
       <span class="feature__play">${icons.play}</span>`;

  /* Plusieurs visuels : le hero les fait defiler. Un seul : rien ne bouge. */
  const heroSlides = (Array.isArray(hero.images) && hero.images.length ? hero.images : [
    hero.image,
    ...site.categories.map((c) => c.image),
    site.storyTeaser.image
  ]).filter(Boolean).filter((src, i, all) => all.indexOf(src) === i).slice(0, 5);

  const heroMedia = heroSlides
    .map((src, i) => `<img class="hero__slide${i === 0 ? ' is-active' : ''}" src="${src}" alt=""${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'} width="1800" height="1200">`)
    .join('\n    ');

  const body = `<section class="hero is-lit" data-hero aria-label="Mise en avant">
  <div class="hero__media" data-hero-media${heroSlides.length > 1 ? ' data-hero-slides' : ''}>
    ${heroMedia}
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
      <p class="hero__cta hero__cta--phone">
        <a class="btn btn--light" href="${safeUrl(hero.phonePrimary.url)}">${escapeHtml(hero.phonePrimary.label)}</a>
        <a class="btn btn--light btn--clear" href="${safeUrl(hero.phoneSecondary.url)}">${escapeHtml(hero.phoneSecondary.label)}</a>
      </p>
    </div>
  </div>
  <div class="hero__fade" aria-hidden="true"></div>
  <div class="hero__scroll"><span>Faire défiler</span><i></i></div>
</section>

${reassurance()}

<section class="section section--sm section--strip" aria-labelledby="topsell-title">
  <div class="container">
    <div class="head head--center"${reveal(0, 'fade')}>
      <h2 class="title title--md" id="topsell-title">${escapeHtml(site.productsStripTitle || 'Nos meilleures ventes')}</h2>
    </div>
  </div>
  <div class="pshow" data-pshow data-pshow-interval="2500">
    <div class="pshow__track" data-pshow-track>
        ${productSlides}
    </div>
    <div class="pshow__dots">${productDots}</div>
  </div>
</section>

<section class="section section--sm section--band" aria-labelledby="band-title">
  <div class="band"${reveal(0, 'scale')}>
    <img class="img-fade" src="${site.band.image}" alt="" loading="lazy" width="1200" height="1000">
    <h2 class="band__title" id="band-title">${escapeHtml(site.band.title)}</h2>
  </div>
</section>

<section class="section section--sm section--cats" aria-labelledby="cats-title">
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

${bestProducts.length ? `<section class="section section--sm section--best section--bone2" aria-labelledby="best-title">
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

<section class="section section--sm section--about about" aria-labelledby="about-title">
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

<section class="section section--sm section--story" aria-labelledby="story-title">
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

<section class="section section--sm section--facts section--ink" aria-label="Nos repères">
  <div class="container">
    <div class="facts">
      ${facts}
    </div>
  </div>
</section>

<section class="section section--sm section--videos" aria-labelledby="videos-title">
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

${moreProducts.length ? `<section class="section section--sm section--more section--bone2" aria-labelledby="more-title">
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

<section class="section section--sm section--feature" aria-labelledby="feature-title">
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

<section class="section section--sm section--reviews section--bone2" aria-labelledby="reviews-title">
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
  <div class="rstrip" data-strip data-strip-speed="8">
    <div class="rstrip__track" data-strip-track>
        ${reviewRibbon}
        ${reviewRibbon}
    </div>
  </div>
</section>

<div class="marquee marquee--ink marquee--dual" aria-hidden="true">
  <div class="marquee__track">${marqueeItems(site.marquees[0])}${marqueeItems(site.marquees[0])}</div>
  <div class="marquee__track">${marqueeItems(site.marquees[1])}${marqueeItems(site.marquees[1])}</div>
</div>

<section class="section section--sm section--press" aria-labelledby="press-title">
  <div class="container">
    <div class="head head--center"${reveal(0, 'fade')}>
      <h2 class="title title--md" id="press-title">${escapeHtml(site.pressTitle)}</h2>
    </div>
    <div class="press">
      ${press}
    </div>
  </div>
  <div class="press-strip" data-strip data-strip-speed="58">
    <div class="press-strip__track" data-strip-track>${pressRibbon}${pressRibbon}</div>
  </div>
</section>

<section class="section section--sm section--shop section--bone2" aria-labelledby="shop-title">
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

<section class="section section--sm section--tags" aria-label="Nos engagements">
  <div class="container">
    <div class="tags">
      ${tags}
    </div>
  </div>
</section>`;

  /* Identité de la boutique et recherche interne : ce sont les deux choses
     qu'un moteur attend de la page d'accueil. */
  const identity = jsonLd([
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: site.name,
      url: SITE_URL,
      logo: absolute(site.logoDark),
      description: site.description,
      address: {
        '@type': 'PostalAddress',
        streetAddress: settings.address || site.store.address,
        postalCode: settings.zip || '',
        addressLocality: settings.city || '',
        addressCountry: 'FR'
      }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.name,
      url: SITE_URL,
      inLanguage: DEFAULT_LOCALE,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
        'query-input': 'required name=search_term_string'
      }
    }
  ]);

  return layout({
    title: `417 France | ${site.tagline}`,
    description: site.description,
    body: mark417(body) + '\n' + identity,
    currentPath: '/', hasHero: true, canonical: '/',
    preloadImage: heroSlides[0] || ''
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
      <button type="button" class="chip is-active" data-filter-availability="all" aria-pressed="true">Tous</button>
      <button type="button" class="chip" data-filter-availability="in-stock" aria-pressed="false">Disponibles</button>
      <button type="button" class="chip" data-filter-availability="incoming" aria-pressed="false">En arrivage</button>
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
  <h2 class="visually-hidden">Les soins de cette sélection</h2>
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
      <div class="acc__body">${nl2br(s.body)}</div>
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
    : `<button type="button" class="btn btn--block" disabled>${AVAILABILITY_LABELS[product.availability]}</button>`;

  const productSchema = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: product.title,
    image: product.images.map((i) => SITE_URL + i.src),
    description: product.excerpt,
    brand: { '@type': 'Brand', name: site.name },
    offers: {
      '@type': 'Offer', price: product.price.toFixed(2), priceCurrency: 'EUR',
      availability: SCHEMA_AVAILABILITY[product.availability],
      url: `${SITE_URL}/products/${product.handle}`
    }
  };

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
      <p class="panel__stock${product.available ? '' : ' is-out'}">${STOCK_NOTES[product.availability]}</p>
      ${isHandCream(product) ? '' : `<p class="offer">${icons.gift}<span><strong>1 produit acheté = 1 crème pour les mains offerte</strong></span></p>`}
      <div class="buy" data-buy-anchor>
        ${buy}
      </div>
      <ul class="perks">
        <li>${icons.truck}<span>Livraison offerte dès ${settings.freeShippingThreshold || site.freeShippingThreshold} € d’achat</span></li>
        <li>${icons.shield}<span>Retour accepté sous 14 jours</span></li>
        <li>${icons.leaf}<span>Formule aux minéraux de la mer Morte</span></li>
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
    : `<button type="button" class="btn btn--sm" disabled>${AVAILABILITY_LABELS[product.availability]}</button>`}
</div>
${jsonLd(productSchema)}`;

  return layout({
    title: `${product.title} – ${site.name}`,
    description: product.excerpt || site.description,
    body,
    currentPath: `/products/${product.handle}`,
    ogType: 'product',
    canonical: `/products/${product.handle}`,
    image: product.image
  });
}

function storyPage() {
  const s = site.storyPage;
  const chapters = s.chapters.map((c, i) => `<div class="chapter${i % 2 ? ' chapter--flip' : ''}">
      <div class="chapter__media"${reveal(0, 'scale')}>
        <img class="img-fade" src="${c.image}" alt="${escapeHtml(c.title)}" loading="lazy" width="900" height="1125"${Number(c.zoom) > 0 ? ` style="transform:scale(${Number(c.zoom)})"` : ''}>
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

/* Tableau des modes de livraison, affiché sur la page Livraison et retours. */
function shippingTable() {
  if (!shippingMethods.length) return '';
  const threshold = settings.freeShippingThreshold || site.freeShippingThreshold;
  const rows = shippingMethods.map((m) => `<tr><td>${escapeHtml(m.carrier)}</td><td>${escapeHtml(m.label)}</td><td>${deliveryDelay(m)}</td><td>${money(m.price)}</td></tr>`)
    .join('\n        ');
  return `<div class="rte shipping-modes"${reveal(0, 'fade')}>
    <h2>Modes de livraison</h2>
    <table>
      <thead><tr><th>Transporteur</th><th>Livraison</th><th>Délai</th><th>Prix</th></tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <p>Livraison en France métropolitaine uniquement. Prix tout compris, taxes incluses. Tous les modes sont offerts dès ${threshold} € d’achat. Délais comptés à partir de l’expédition, qui a lieu le jour même ou le lendemain de la commande (le lundi pour une commande du week-end).</p>
  </div>`;
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
  ${shippingTable()}
  <h2 class="visually-hidden">Nos garanties</h2>
  <div class="contact-cards" style="grid-template-columns:repeat(4,1fr)">
      ${reassure}
  </div>
  <p style="text-align:center;margin-top:34px">
    <a class="btn btn--outline btn--sm" href="/pages/contact">Une autre question ? Écrivez-nous</a>
  </p>
</section>`;

  const schema = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: site.faq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a }
    }))
  });

  return layout({
    title: `Livraison et retours – ${site.name}`,
    description: 'Délais, frais de port, retours et paiement : toutes les réponses.',
    body: body + '\n' + schema,
    currentPath: '/pages/livraison-et-retours', canonical: '/pages/livraison-et-retours'
  });
}

/* Étape de livraison, avant la page de paiement de Stripe. Le panier vit dans
   le navigateur : le récapitulatif et les options sont remplis par app.js.
   Seuls les modes de livraison sont posés ici. */
function checkoutPage() {
  const options = shippingMethods.map((m, i) => `<label class="ship-option">
        <input type="radio" name="method" value="${escapeHtml(m.id)}" data-type="${m.type === 'relay' ? 'relay' : 'home'}" data-carrier="${escapeHtml(m.carrier)}" data-price="${Number(m.price) || 0}"${i === 0 ? ' checked' : ''}>
        <span class="ship-option__body">
          <span class="ship-option__name"><strong>${escapeHtml(m.carrier)}</strong> ${escapeHtml(m.label)}</span>
          <span class="ship-option__delay">${deliveryDelay(m)} après l’expédition</span>
        </span>
        <span class="ship-option__price" data-ship-price>${money(m.price)}</span>
      </label>`).join('\n      ');

  const body = `${breadcrumb([{ label: 'Accueil', url: '/' }, { label: 'Commande' }])}
<section class="container page-head">
  <h1>Livraison</h1>
  <p>Choisissez votre mode de livraison, puis réglez en toute sécurité sur la page de paiement.</p>
</section>
<section class="container checkout" data-checkout>
  <p class="checkout__empty" data-checkout-empty hidden>Votre panier est vide. <a href="/collections/tout-nos-produits">Découvrir nos soins</a></p>
  <div class="checkout__grid" data-checkout-main hidden>
    <div class="checkout__steps">
      <fieldset class="checkout__step">
        <legend>Mode de livraison</legend>
        <p class="checkout__hint">Livraison en France métropolitaine uniquement. Expédition le jour même ou le lendemain, le lundi pour une commande du week-end.</p>
        <div class="ship-options" data-ship-options>
      ${options}
        </div>
      </fieldset>

      <fieldset class="checkout__step" data-relay hidden>
        <legend>Point relais</legend>
        <form class="relay-search" data-relay-search novalidate>
          <div class="field"><label for="relay-cp">Code postal</label><input id="relay-cp" name="cp" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="5" pattern="[0-9]{5}" required></div>
          <div class="field"><label for="relay-city">Ville <span class="checkout__optional">(facultatif)</span></label><input id="relay-city" name="ville" type="text" autocomplete="address-level2" maxlength="60"></div>
          <button type="submit" class="btn btn--outline">Rechercher</button>
        </form>
        <p class="checkout__note" data-relay-note role="status"></p>
        <ul class="relay-list" data-relay-list></ul>
      </fieldset>
    </div>

    <aside class="checkout__summary" aria-label="Récapitulatif">
      <h2>Récapitulatif</h2>
      <ul class="checkout__lines" data-checkout-lines></ul>
      <div class="cart-sums" data-checkout-sums></div>
      <div class="cart-total"><span>Total</span><strong data-checkout-total></strong></div>
      <button type="button" class="btn btn--block" data-checkout-pay>Payer</button>
      <p class="checkout__note" data-checkout-note role="alert"></p>
      <p class="cart-note">Paiement sécurisé par Stripe : carte bancaire, Apple Pay, Google Pay. Vos coordonnées sont demandées à l’étape suivante. Prix tout compris, taxes incluses.</p>
    </aside>
  </div>
</section>`;

  return layout({
    title: `Livraison et paiement – ${site.name}`,
    description: 'Choisissez votre mode de livraison et réglez votre commande.',
    body, currentPath: '/commande', canonical: '/commande',
    robots: 'noindex, nofollow'
  });
}

/* Retour de Stripe après un paiement réussi. La commande est enregistrée par
   la notification de Stripe, pas par cette page : elle vide le panier et
   remercie, rien de plus. */
function thankYouPage() {
  const body = `<section class="container page-head checkout-done" data-checkout-done>
  <h1>Merci pour votre commande</h1>
  <p class="checkout-done__ref" data-order-status>Confirmation de votre commande…</p>
  <p>Vous allez recevoir une confirmation par e-mail. Votre colis part le jour même ou le lendemain (le lundi pour une commande du week-end), et nous vous envoyons son numéro de suivi dès l’expédition.</p>
  <p style="margin-top:30px"><a class="btn" href="/">Retour à la boutique</a></p>
</section>`;

  return layout({
    title: `Commande confirmée – ${site.name}`,
    description: 'Votre commande est confirmée.',
    body, currentPath: '/commande/merci', canonical: '/commande/merci',
    robots: 'noindex, nofollow'
  });
}

function contactPage() {
  const body = `${breadcrumb([{ label: 'Accueil', url: '/' }, { label: 'Contact' }])}
<section class="container page-head">
  <h1${reveal(0, 'fade')}>Nous écrire</h1>
  <p${reveal(1, 'fade')}>Une question sur un soin, une commande ou un partenariat ? Nous répondons sous 24 heures ouvrées.</p>
</section>
<section class="container" style="padding-bottom:var(--space)">
  <form class="form" data-site-form="contact" data-success="Merci, votre message a bien été transmis."${reveal(0)}>
    <div class="field"><label for="contact-name">Nom</label><input id="contact-name" name="name" type="text" autocomplete="name"></div>
    <div class="field"><label for="contact-email">E-mail <span class="req" aria-hidden="true">*</span></label><input id="contact-email" name="email" type="email" autocomplete="email" required></div>
    <div class="field"><label for="contact-phone">Téléphone</label><input id="contact-phone" name="phone" type="tel" autocomplete="tel"></div>
    <div class="field"><label for="contact-message">Votre message</label><textarea id="contact-message" name="message"></textarea></div>
    ${honeypot()}
    <button type="submit" class="btn">Envoyer</button>
    <p class="form-note" data-form-note style="color:var(--muted)"></p>
  </form>
  <h2 class="visually-hidden">Nous joindre</h2>
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

/** Espace client, porté par Supabase Auth : e-mail et mot de passe, rien
    d'autre. La page parle directement à Supabase, ce qui fonctionne aussi
    bien en local que sur le site publié, où il n'y a pas de serveur Node.
    L'adresse du projet et sa clé publique sont figées ici au moment du build :
    sans elles, la page annonce l'espace client fermé. */
function accountPage() {
  const auth = supabase.publicConfig();
  if (!auth) {
    console.warn('  ! SUPABASE_URL ou SUPABASE_PUBLISHABLE_KEY absent : l’espace client sera fermé sur ce build.');
  }
  const body = `${breadcrumb([{ label: 'Accueil', url: '/' }, { label: 'Espace client' }])}
<section class="container page-head">
  <h1>Espace client</h1>
  <p data-account-intro>Connectez-vous ou créez votre compte en quelques secondes.</p>
</section>
<section class="container account" data-account>
  <p class="account__status" data-account-loading>Chargement…</p>

  <div class="account__card" data-account-guest hidden>
    <div class="account__tabs" role="tablist" aria-label="Espace client">
      <button type="button" role="tab" id="tab-login" aria-controls="panel-login" aria-selected="true" data-account-tab="login">Se connecter</button>
      <button type="button" role="tab" id="tab-register" aria-controls="panel-register" aria-selected="false" tabindex="-1" data-account-tab="register">Créer un compte</button>
    </div>

    <form class="form account__form" id="panel-login" role="tabpanel" aria-labelledby="tab-login" data-account-form="login" novalidate>
      <div class="field"><label for="login-email">E-mail</label><input id="login-email" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="login-password">Mot de passe</label><input id="login-password" name="password" type="password" autocomplete="current-password" required></div>
      <button type="submit" class="btn btn--block">Se connecter</button>
      <p class="account__note" data-account-note role="alert"></p>
    </form>

    <form class="form account__form" id="panel-register" role="tabpanel" aria-labelledby="tab-register" data-account-form="register" novalidate hidden>
      <div class="field"><label for="register-name">Nom</label><input id="register-name" name="name" type="text" autocomplete="name" required></div>
      <div class="field"><label for="register-email">E-mail</label><input id="register-email" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="register-password">Mot de passe</label><input id="register-password" name="password" type="password" autocomplete="new-password" minlength="8" required><small class="account__hint">8 caractères au minimum.</small></div>
      <button type="submit" class="btn btn--block">Créer mon compte</button>
      <p class="account__note" data-account-note role="alert"></p>
      <p class="account__aside">En créant un compte, vous acceptez nos <a href="/policies/terms-of-service">conditions d’utilisation</a> et notre <a href="/policies/privacy-policy">politique de confidentialité</a>.</p>
    </form>
  </div>

  <div class="account__card account__card--member" data-account-member hidden>
    <p class="account__eyebrow">Connecté</p>
    <h2 class="account__name" data-account-name></h2>
    <dl class="account__details">
      <div><dt>E-mail</dt><dd data-account-email></dd></div>
      <div><dt>Client depuis</dt><dd data-account-since></dd></div>
    </dl>
    <div class="account__actions">
      <a class="btn" href="/collections/all">Voir la boutique</a>
      <button type="button" class="btn btn--outline" data-account-logout>Se déconnecter</button>
    </div>
  </div>

  <p class="account__status" data-account-offline hidden></p>
</section>`;

  /* L'adresse de la boutique est toujours transmise : elle ouvre le
     back-office même sans Supabase. Le client Supabase n'est chargé que s'il
     est configuré, et la clé transmise est la clé publique, faite pour être
     lue par le navigateur. */
  const extraHead = `<script>window.SITE_AUTH = ${JSON.stringify({ supabase: auth, adminEmails: supabase.ADMIN_EMAILS })};</script>
${auth ? '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js" defer></script>\n' : ''}`;

  return layout({
    title: `Espace client – ${site.name}`,
    description: 'Connectez-vous à votre espace client 417 France ou créez votre compte.',
    body, currentPath: '/pages/compte', canonical: '/pages/compte',
    robots: 'noindex, follow', extraHead
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
  <h2 class="visually-hidden">Trouver un point de vente</h2>
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
  const today = new Date().toISOString().slice(0, 10);
  const entries = urls.map((u) => {
    /* L'accueil passe avant les collections, elles-mêmes avant les pages
       éditoriales : c'est l'ordre dans lequel on veut être exploré. */
    const priority = u === '/' ? '1.0'
      : (u.startsWith('/collections/') || u.startsWith('/products/')) ? '0.8' : '0.5';
    return `  <url><loc>${SITE_URL}${u}</loc><lastmod>${today}</lastmod><priority>${priority}</priority></url>`;
  }).join('\n');
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
  /* Hors du plan de site : une page de connexion n'a rien à faire dans les
     résultats de recherche. */
  write(path.join('pages', 'compte', 'index.html'), accountPage());
  write(path.join('commande', 'index.html'), checkoutPage());
  write(path.join('commande', 'merci', 'index.html'), thankYouPage());
  write(path.join('pages', 'store-locator', 'index.html'), storeLocatorPage());
  urls.push('/pages/store-locator');

  site.policies.forEach((policy) => {
    write(path.join('policies', policy.handle, 'index.html'), policyPage(policy));
    urls.push(`/policies/${policy.handle}`);
  });

  write(path.join('search', 'index.html'), searchPage());
  urls.push('/search');

  Object.keys(translations).forEach((code) => {
    write(path.join('assets', 'i18n', code + '.json'), JSON.stringify(translations[code]));
  });

  write('404.html', notFoundPage());
  /* Les navigateurs anciens demandent /favicon.ico sans qu'on le déclare,
     et les mobiles lisent le manifeste pour l'icône de l'écran d'accueil. */
  const icons = path.join(SRC, 'assets', 'icons');
  if (fs.existsSync(path.join(icons, 'favicon.ico'))) {
    fs.copyFileSync(path.join(icons, 'favicon.ico'), path.join(DIST, 'favicon.ico'));
  }
  write('site.webmanifest', JSON.stringify({
    name: site.name,
    short_name: site.name,
    description: site.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f3ee',
    theme_color: '#17130f',
    lang: DEFAULT_LOCALE,
    icons: [
      { src: '/assets/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/assets/icons/favicon.svg', sizes: 'any', type: 'image/svg+xml' }
    ]
  }, null, 2));

  write('sitemap.xml', buildSitemap(urls));
  write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /preview\nDisallow: /admin\nDisallow: /commande\nSitemap: ${SITE_URL}/sitemap.xml\n`);

  copyDir(path.join(SRC, 'assets'), path.join(DIST, 'assets'));
  copyDir(path.join(SRC, 'media'), path.join(DIST, 'media'));
  /* Aperçu mobile : la même page qu'en local, publiée avec le site. */
  copyDir(path.join(SRC, 'preview'), path.join(DIST, 'preview'));
  /* Interface du back-office, publiée telle quelle pour le site en ligne :
     ces pages ne contiennent aucune donnée. Tout passe par /api, qui exige
     une session, et l'interface renvoie vers /admin/login sans elle.
     En local, server.js les sert lui-même et contrôle la session avant. */
  copyDir(path.join(SRC, 'admin'), path.join(DIST, 'admin'));

  console.log('Site généré dans /dist');
  console.log(`  ${products.length} produits, ${collections.length} collections, ${urls.length} URL`);
}

build();
