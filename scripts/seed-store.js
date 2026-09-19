#!/usr/bin/env node
/* =============================================================================
   Initialise data/store.json : compte administrateur, catalogue avec stocks,
   réglages de la boutique et quelques enregistrements de démonstration.
   Usage : node scripts/seed-store.js [--force] [--password <mot de passe>]
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('../lib/store');
const auth = require('../lib/auth');
const supabase = require('../lib/supabase');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const force = args.indexOf('--force') !== -1;
const passwordIndex = args.indexOf('--password');
const givenPassword = passwordIndex !== -1 ? args[passwordIndex + 1] : null;

if (store.exists() && !force) {
  console.log('data/store.json existe déjà. Ajoutez --force pour le réinitialiser.');
  process.exit(0);
}

/* ---------- Mot de passe administrateur ---------- */

function randomPassword() {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(14);
  for (let i = 0; i < 14; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const password = givenPassword || randomPassword();
const credentials = auth.hashPassword(password);

/* ---------- Catalogue ---------- */

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'products.json'), 'utf8')).products;
const imageMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'image-map.json'), 'utf8'));

/** Chemin local de la vignette produit, pour un back-office utilisable hors ligne. */
function localImage(src) {
  if (!src) return '';
  const full = src.startsWith('//') ? 'https:' + src : src;
  const key = full.split('?')[0];
  return imageMap[key] ? '/' + imageMap[key] : full;
}

const TITLE_FIXES = {
  'Crème Infusion Minèrale Contour des Yeux': 'Crème Infusion Minérale Contour des Yeux',
  'Lotion Visage Hydratante & Equilibrante': 'Lotion Visage Hydratante & Équilibrante',
  'Crème hydratante pour les mains – Kiwi & Mango': 'Crème Hydratante pour les Mains – Kiwi & Mangue',
  'Crème hydratante pour les mains – Milk & Honey': 'Crème Hydratante pour les Mains – Lait & Miel',
  'Crème hydratante pour les mains – Ocean': 'Crème Hydratante pour les Mains – Ocean',
  'Crème hydratante pour les mains – Matcha': 'Crème Hydratante pour les Mains – Matcha'
};

function skuFor(handle, index) {
  const letters = handle.replace(/[^a-z]/g, '').slice(0, 3).toUpperCase() || 'PRD';
  return '417-' + letters + '-' + String(index + 1).padStart(3, '0');
}

const FACE = [
  'masque-de-boue-regenerant', 'creme-apaisante-s-o-s', 'creme-hydratante-peau-normale-a-seche',
  'serum-hydratant-mineral-aqua', 'creme-infusion-minerale-contour-des-yeux',
  'gel-moussant-visage-aux-micro-grains-de-luffa', 'masque-gommant-aux-mineraux',
  'lotion-visage-hydratante-equilibrante', 'eau-micellaire-minerale'
];

const products = catalog.map((p, index) => {
  const variant = p.variants[0] || {};
  const available = p.variants.some((v) => v.available);
  return {
    handle: p.handle,
    title: TITLE_FIXES[p.title] || p.title,
    sku: skuFor(p.handle, index),
    price: parseFloat(variant.price || '0'),
    cost: Math.round(parseFloat(variant.price || '0') * 0.38 * 100) / 100,
    stock: available ? 18 + ((index * 7) % 40) : 0,
    threshold: 8,
    category: FACE.indexOf(p.handle) !== -1 ? 'Visage' : 'Corps',
    supplier: '417 Dead Sea Cosmetics',
    location: 'Entrepôt Paris — allée ' + String.fromCharCode(65 + (index % 4)),
    image: localImage((p.images[0] || {}).src),
    updatedAt: new Date().toISOString()
  };
});

/* ---------- Données de démonstration ---------- */

const demoCustomers = [
  { name: 'Camille Rousseau', email: 'camille.rousseau@example.fr', phone: '06 12 34 56 78', address: '14 rue de Rivoli', zip: '75004', city: 'Paris', country: 'France' },
  { name: 'Julien Moreau', email: 'julien.moreau@example.fr', phone: '06 98 76 54 32', address: '8 cours Mirabeau', zip: '13100', city: 'Aix-en-Provence', country: 'France' },
  { name: 'Sofia Benali', email: 'sofia.benali@example.fr', phone: '07 45 22 11 90', address: '25 rue de la Paix', zip: '69002', city: 'Lyon', country: 'France' },
  { name: 'Marc Lefèvre', email: 'marc.lefevre@example.be', phone: '+32 470 11 22 33', address: '3 avenue Louise', zip: '1050', city: 'Bruxelles', country: 'Belgique' },
  { name: 'Élodie Garnier', email: 'elodie.garnier@example.fr', phone: '06 77 88 99 00', address: '42 rue Sainte-Catherine', zip: '33000', city: 'Bordeaux', country: 'France' }
];

function daysAgo(n) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toISOString();
}

const data = store.emptyStore();

data.users = [{
  username: 'admin',
  email: supabase.ADMIN_EMAILS[0],
  salt: credentials.salt,
  hash: credentials.hash,
  role: 'Administrateur',
  createdAt: new Date().toISOString()
}];

data.settings = {
  shopName: '417 France',
  legalName: '417 France SAS',
  address: '88 Bd de Courcelles',
  zip: '75017',
  city: 'Paris',
  country: 'France',
  email: 'contact@417france.com',
  phone: '+33 1 00 00 00 00',
  vatNumber: 'FR00 000 000 000',
  siret: '000 000 000 00000',
  currency: 'EUR',
  freeShippingThreshold: 100,
  lowStockAlert: 8,
  vatRate: 20,
  carriers: [
    { name: 'Colissimo', portal: 'https://www.laposte.fr/professionnel/colissimo', tracking: 'https://www.laposte.fr/outils/suivre-vos-envois?code=' },
    { name: 'Chronopost', portal: 'https://www.chronopost.fr/expedier', tracking: 'https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=' },
    { name: 'Mondial Relay', portal: 'https://www.mondialrelay.fr/envoi-de-colis/', tracking: 'https://www.mondialrelay.fr/suivi-de-colis?numeroExpedition=' },
    { name: 'DHL Express', portal: 'https://mydhl.express.dhl/fr/fr/home.html', tracking: 'https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=' },
    { name: 'UPS', portal: 'https://www.ups.com/ship', tracking: 'https://www.ups.com/track?loc=fr_FR&tracknum=' }
  ]
};

data.customers = demoCustomers.map((c, i) => Object.assign({
  id: store.id('cus'),
  createdAt: daysAgo(60 - i * 9),
  notes: '',
  demo: true
}, c));

const orderPlans = [
  { customer: 0, days: 2, status: 'En préparation', items: [['masque-de-boue-regenerant', 1], ['creme-apaisante-s-o-s', 2]] },
  { customer: 1, days: 5, status: 'Expédiée', items: [['gel-moussant-visage-aux-micro-grains-de-luffa', 2]] },
  { customer: 2, days: 9, status: 'Livrée', items: [['beurre-corporel-aromatique-kiwi-mangue', 1], ['anti-oxidant-hand-moisturizer-matcha', 3]] },
  { customer: 3, days: 14, status: 'Livrée', items: [['creme-apaisante-s-o-s', 1]] },
  { customer: 4, days: 1, status: 'À préparer', items: [['anti-oxidant-hand-moisturizer-ocean', 2], ['masque-de-boue-regenerant', 1]] },
  { customer: 0, days: 21, status: 'Livrée', items: [['gel-moussant-visage-aux-micro-grains-de-luffa', 1], ['creme-apaisante-s-o-s', 1]] }
];

data.orders = orderPlans.map((plan) => {
  const customer = data.customers[plan.customer];
  const items = plan.items.map((entry) => {
    const product = products.find((p) => p.handle === entry[0]);
    return {
      handle: product.handle,
      title: product.title,
      sku: product.sku,
      price: product.price,
      quantity: entry[1]
    };
  });
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  return {
    id: store.id('ord'),
    ref: '',
    customerId: customer.id,
    customerName: customer.name,
    items: items,
    total: Math.round(total * 100) / 100,
    shippingCost: total >= 100 ? 0 : 6.9,
    status: plan.status,
    payment: 'Payée',
    createdAt: daysAgo(plan.days),
    note: '',
    demo: true
  };
});

/* Numérotation chronologique */
data.orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
data.orders.forEach((order, i) => {
  order.ref = '417-' + new Date(order.createdAt).getFullYear() + '-' + String(i + 1).padStart(4, '0');
});
data.orders.reverse();

data.shipments = data.orders
  .filter((o) => o.status === 'Expédiée' || o.status === 'Livrée')
  .map((order, i) => ({
    id: store.id('shp'),
    orderId: order.id,
    orderRef: order.ref,
    customerName: order.customerName,
    carrier: ['Colissimo', 'Chronopost', 'Mondial Relay'][i % 3],
    tracking: 'CO' + crypto.randomBytes(4).toString('hex').toUpperCase() + 'FR',
    weight: 0.4 + i * 0.2,
    status: order.status === 'Livrée' ? 'Livré' : 'En transit',
    shippedAt: order.createdAt,
    demo: true
  }));

data.products = products;

store.log(data, 'Base initialisée', products.length + ' produits, ' + data.customers.length + ' clients');
store.write(data);

console.log('');
console.log('  Back-office 417 France — base initialisée');
console.log('  ------------------------------------------------');
console.log('  Adresse        http://localhost:4170/admin');
console.log('  Identifiant    admin');
console.log('  Mot de passe   ' + password);
console.log('  ------------------------------------------------');
console.log('  ' + products.length + ' produits, ' + data.customers.length + ' clients, '
  + data.orders.length + ' commandes, ' + data.shipments.length + ' expéditions.');
console.log('  Notez ce mot de passe : il n’est pas stocké en clair.');
console.log('');
