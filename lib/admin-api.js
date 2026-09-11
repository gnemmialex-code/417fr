/* =============================================================================
   Logique métier du back-office : lecture d'état, commandes de mise à jour,
   et génération du bordereau de livraison imprimable.
   ========================================================================== */
'use strict';

const path = require('path');
const { execFile } = require('child_process');
const store = require('./store');
const auth = require('./auth');

const ORDER_STATUSES = ['À préparer', 'En préparation', 'Expédiée', 'Livrée', 'Annulée', 'Remboursée'];
const SHIPMENT_STATUSES = ['Étiquette créée', 'En transit', 'En cours de livraison', 'Livré', 'Incident'];

/* Statuts internes des produits : visibles dans le back-office uniquement,
   ils ne changent rien à l'affichage de la boutique. */
const PRODUCT_STATUSES = [
  'Automatique',
  'En réapprovisionnement',
  'Bientôt disponible',
  'Nouveauté',
  'Arrêté'
];

const BADGE_WHEN = ['always', 'in-stock', 'out-of-stock'];
const BADGE_TONES = ['clair', 'sombre', 'accent'];
const CANCELLED = ['Annulée', 'Remboursée'];

/* -------------------------------------------------------------------------- */
/* Statistiques                                                                */
/* -------------------------------------------------------------------------- */

function round(value) {
  return Math.round(value * 100) / 100;
}

function orderTotal(order) {
  return round(order.total + (order.shippingCost || 0));
}

function computeStats(data) {
  const active = data.orders.filter(function (o) { return CANCELLED.indexOf(o.status) === -1; });
  const revenue = active.reduce(function (sum, o) { return sum + orderTotal(o); }, 0);

  const lowStock = data.products.filter(function (p) {
    return p.stock > 0 && p.stock <= (p.threshold || data.settings.lowStockAlert || 8);
  });
  const outOfStock = data.products.filter(function (p) { return p.stock <= 0; });
  const stockValue = data.products.reduce(function (sum, p) { return sum + p.stock * (p.cost || 0); }, 0);
  const stockUnits = data.products.reduce(function (sum, p) { return sum + p.stock; }, 0);

  /* Chiffre d'affaires des six derniers mois */
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    months.push({
      key: key,
      label: date.toLocaleDateString('fr-FR', { month: 'short' }),
      revenue: 0,
      orders: 0
    });
  }
  active.forEach(function (order) {
    const date = new Date(order.createdAt);
    const key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    const bucket = months.find(function (m) { return m.key === key; });
    if (bucket) {
      bucket.revenue = round(bucket.revenue + orderTotal(order));
      bucket.orders += 1;
    }
  });

  /* Meilleures ventes */
  const sales = {};
  active.forEach(function (order) {
    order.items.forEach(function (item) {
      if (!sales[item.handle]) sales[item.handle] = { handle: item.handle, title: item.title, quantity: 0, revenue: 0 };
      sales[item.handle].quantity += item.quantity;
      sales[item.handle].revenue = round(sales[item.handle].revenue + item.price * item.quantity);
    });
  });
  const topProducts = Object.keys(sales).map(function (k) { return sales[k]; })
    .sort(function (a, b) { return b.quantity - a.quantity; })
    .slice(0, 6);

  const byStatus = {};
  ORDER_STATUSES.forEach(function (status) {
    byStatus[status] = data.orders.filter(function (o) { return o.status === status; }).length;
  });

  return {
    revenue: round(revenue),
    orders: active.length,
    allOrders: data.orders.length,
    averageBasket: active.length ? round(revenue / active.length) : 0,
    customers: data.customers.length,
    products: data.products.length,
    lowStock: lowStock.length,
    lowStockItems: lowStock.slice(0, 8),
    outOfStock: outOfStock.length,
    outOfStockItems: outOfStock.slice(0, 8),
    stockValue: round(stockValue),
    stockUnits: stockUnits,
    toPrepare: (byStatus['À préparer'] || 0) + (byStatus['En préparation'] || 0),
    inTransit: data.shipments.filter(function (s) { return s.status !== 'Livré'; }).length,
    months: months,
    topProducts: topProducts,
    byStatus: byStatus
  };
}

function state(user) {
  const data = store.read();
  return {
    user: user ? { username: user.username, role: user.role } : null,
    settings: data.settings,
    content: data.content || {},
    products: data.products,
    customers: data.customers,
    orders: data.orders,
    shipments: data.shipments,
    activity: data.activity.slice(0, 40),
    stats: computeStats(data),
    orderStatuses: ORDER_STATUSES,
    shipmentStatuses: SHIPMENT_STATUSES,
    productStatuses: PRODUCT_STATUSES,
    lastBuild: lastBuild,
    badgeWhen: BADGE_WHEN,
    badgeTones: BADGE_TONES
  };
}

/* -------------------------------------------------------------------------- */
/* Mouvements de stock                                                         */
/* -------------------------------------------------------------------------- */

function applyStock(data, items, sign) {
  items.forEach(function (item) {
    const product = data.products.find(function (p) { return p.handle === item.handle; });
    if (!product) return;
    product.stock = Math.max(0, product.stock + sign * item.quantity);
    product.updatedAt = new Date().toISOString();
  });
}

/* -------------------------------------------------------------------------- */
/* Commandes de l'interface                                                    */
/* -------------------------------------------------------------------------- */

const actions = {

  /* ----- Produits ----- */

  'products/update': function (data, body) {
    const product = data.products.find(function (p) { return p.handle === body.handle; });
    if (!product) return { error: 'Produit introuvable.' };
    const patch = body.patch || {};

    ['title', 'sku', 'category', 'supplier', 'location', 'excerpt'].forEach(function (field) {
      if (patch[field] !== undefined) product[field] = String(patch[field]);
    });
    ['price', 'cost', 'stock', 'threshold'].forEach(function (field) {
      if (patch[field] !== undefined) product[field] = Math.max(0, Number(patch[field]) || 0);
    });
    if (patch.compareAt !== undefined) {
      const value = Number(patch.compareAt) || 0;
      product.compareAt = value > 0 ? value : null;
    }
    if (patch.visible !== undefined) product.visible = !!patch.visible;

    if (patch.status !== undefined) {
      product.status = PRODUCT_STATUSES.indexOf(patch.status) !== -1 ? patch.status : 'Automatique';
    }

    if (patch.badge) {
      const badge = product.badge || {};
      product.badge = {
        enabled: !!patch.badge.enabled,
        text: String(patch.badge.text || '').trim() || badge.text || 'Épuisé',
        when: BADGE_WHEN.indexOf(patch.badge.when) !== -1 ? patch.badge.when : 'out-of-stock',
        tone: BADGE_TONES.indexOf(patch.badge.tone) !== -1 ? patch.badge.tone : 'sombre'
      };
    }

    if (Array.isArray(patch.images)) {
      product.images = patch.images
        .map(function (i) { return { src: String(i.src || '').trim(), alt: String(i.alt || product.title) }; })
        .filter(function (i) { return i.src; });
      product.image = product.images[0] ? product.images[0].src : '';
    }
    if (Array.isArray(patch.description)) {
      product.description = patch.description
        .map(function (d) { return { title: String(d.title || '').trim(), body: String(d.body || '').trim() }; })
        .filter(function (d) { return d.body; });
    }

    product.updatedAt = new Date().toISOString();
    store.log(data, 'Produit modifié', product.title);
    return { product: product };
  },

  /* ----- Contenu du site ----- */

  /** Écrit plusieurs valeurs de contenu d'un coup, adressées par chemin
      pointé : « hero.titleTop », « about.points », « reviews »… */
  'content/patch': function (data, body) {
    if (!data.content) data.content = {};
    const values = body.values || {};
    const paths = Object.keys(values);
    if (!paths.length) return { error: 'Aucune valeur à enregistrer.' };

    paths.forEach(function (path) {
      const parts = path.split('.');
      let node = data.content;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = values[path];
    });

    store.log(data, 'Contenu modifié', body.label || paths[0]);
    return { content: data.content };
  },

  'products/adjust': function (data, body) {
    const product = data.products.find(function (p) { return p.handle === body.handle; });
    if (!product) return { error: 'Produit introuvable.' };
    const delta = Number(body.delta) || 0;
    product.stock = Math.max(0, product.stock + delta);
    product.updatedAt = new Date().toISOString();
    store.log(data, 'Stock ajusté', product.title + ' : ' + (delta > 0 ? '+' : '') + delta + ' → ' + product.stock);
    return { product: product };
  },

  'products/create': function (data, body) {
    const title = String(body.title || '').trim();
    if (!title) return { error: 'Le nom du produit est obligatoire.' };
    const handle = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || store.id('prd');
    if (data.products.some(function (p) { return p.handle === handle; })) {
      return { error: 'Un produit porte déjà ce nom.' };
    }
    const product = {
      handle: handle,
      title: title,
      sku: String(body.sku || '').trim() || '417-' + handle.slice(0, 3).toUpperCase(),
      price: Math.max(0, Number(body.price) || 0),
      cost: Math.max(0, Number(body.cost) || 0),
      stock: Math.max(0, Number(body.stock) || 0),
      threshold: Math.max(0, Number(body.threshold) || 8),
      category: String(body.category || 'Visage'),
      supplier: String(body.supplier || ''),
      location: String(body.location || ''),
      image: '',
      updatedAt: new Date().toISOString()
    };
    data.products.push(product);
    store.log(data, 'Produit créé', product.title);
    return { product: product };
  },

  'products/delete': function (data, body) {
    const index = data.products.findIndex(function (p) { return p.handle === body.handle; });
    if (index === -1) return { error: 'Produit introuvable.' };
    const removed = data.products.splice(index, 1)[0];
    store.log(data, 'Produit supprimé', removed.title);
    return { ok: true };
  },

  /* ----- Clients ----- */

  'customers/save': function (data, body) {
    const input = body.customer || {};
    if (!String(input.name || '').trim()) return { error: 'Le nom du client est obligatoire.' };

    let customer = input.id ? data.customers.find(function (c) { return c.id === input.id; }) : null;
    const isNew = !customer;
    if (isNew) {
      customer = { id: store.id('cus'), createdAt: new Date().toISOString() };
      data.customers.push(customer);
    }
    ['name', 'email', 'phone', 'address', 'zip', 'city', 'country', 'notes'].forEach(function (field) {
      if (input[field] !== undefined) customer[field] = String(input[field]).trim();
    });
    delete customer.demo;

    /* Le nom affiché sur les commandes suit la fiche client. */
    data.orders.forEach(function (order) {
      if (order.customerId === customer.id) order.customerName = customer.name;
    });
    data.shipments.forEach(function (shipment) {
      const order = data.orders.find(function (o) { return o.id === shipment.orderId; });
      if (order) shipment.customerName = order.customerName;
    });

    store.log(data, isNew ? 'Client créé' : 'Client modifié', customer.name);
    return { customer: customer };
  },

  'customers/delete': function (data, body) {
    const index = data.customers.findIndex(function (c) { return c.id === body.id; });
    if (index === -1) return { error: 'Client introuvable.' };
    if (data.orders.some(function (o) { return o.customerId === body.id; })) {
      return { error: 'Ce client a des commandes : supprimez-les d’abord.' };
    }
    const removed = data.customers.splice(index, 1)[0];
    store.log(data, 'Client supprimé', removed.name);
    return { ok: true };
  },

  /* ----- Commandes ----- */

  'orders/save': function (data, body) {
    const input = body.order || {};
    const customer = data.customers.find(function (c) { return c.id === input.customerId; });
    if (!customer) return { error: 'Sélectionnez un client.' };

    const items = (input.items || []).map(function (item) {
      const product = data.products.find(function (p) { return p.handle === item.handle; });
      if (!product) return null;
      return {
        handle: product.handle,
        title: product.title,
        sku: product.sku,
        price: product.price,
        quantity: Math.max(1, Number(item.quantity) || 1)
      };
    }).filter(Boolean);

    if (!items.length) return { error: 'Ajoutez au moins un produit.' };

    const total = round(items.reduce(function (sum, i) { return sum + i.price * i.quantity; }, 0));
    const threshold = data.settings.freeShippingThreshold || 100;
    const existing = input.id ? data.orders.find(function (o) { return o.id === input.id; }) : null;

    if (existing) {
      if (CANCELLED.indexOf(existing.status) === -1) applyStock(data, existing.items, +1);
      existing.customerId = customer.id;
      existing.customerName = customer.name;
      existing.items = items;
      existing.total = total;
      existing.shippingCost = total >= threshold ? 0 : 6.9;
      existing.note = String(input.note || '');
      delete existing.demo;
      if (CANCELLED.indexOf(existing.status) === -1) applyStock(data, items, -1);
      store.log(data, 'Commande modifiée', existing.ref);
      return { order: existing };
    }

    const order = {
      id: store.id('ord'),
      ref: store.nextOrderRef(data),
      customerId: customer.id,
      customerName: customer.name,
      items: items,
      total: total,
      shippingCost: total >= threshold ? 0 : 6.9,
      status: 'À préparer',
      payment: String(input.payment || 'En attente'),
      createdAt: new Date().toISOString(),
      note: String(input.note || '')
    };
    data.orders.unshift(order);
    applyStock(data, items, -1);
    store.log(data, 'Commande créée', order.ref + ' — ' + customer.name);
    return { order: order };
  },

  'orders/status': function (data, body) {
    const order = data.orders.find(function (o) { return o.id === body.id; });
    if (!order) return { error: 'Commande introuvable.' };
    if (ORDER_STATUSES.indexOf(body.status) === -1) return { error: 'Statut inconnu.' };

    const wasCancelled = CANCELLED.indexOf(order.status) !== -1;
    const willCancel = CANCELLED.indexOf(body.status) !== -1;
    if (!wasCancelled && willCancel) applyStock(data, order.items, +1);
    if (wasCancelled && !willCancel) applyStock(data, order.items, -1);

    order.status = body.status;
    if (body.payment) order.payment = String(body.payment);
    store.log(data, 'Statut commande', order.ref + ' → ' + body.status);
    return { order: order };
  },

  'orders/delete': function (data, body) {
    const index = data.orders.findIndex(function (o) { return o.id === body.id; });
    if (index === -1) return { error: 'Commande introuvable.' };
    const order = data.orders[index];
    if (CANCELLED.indexOf(order.status) === -1) applyStock(data, order.items, +1);
    data.shipments = data.shipments.filter(function (s) { return s.orderId !== order.id; });
    data.orders.splice(index, 1);
    store.log(data, 'Commande supprimée', order.ref);
    return { ok: true };
  },

  /* ----- Expéditions ----- */

  'shipments/save': function (data, body) {
    const input = body.shipment || {};
    const order = data.orders.find(function (o) { return o.id === input.orderId; });
    if (!order) return { error: 'Commande introuvable.' };

    let shipment = input.id ? data.shipments.find(function (s) { return s.id === input.id; }) : null;
    const isNew = !shipment;
    if (isNew) {
      shipment = { id: store.id('shp'), shippedAt: new Date().toISOString() };
      data.shipments.unshift(shipment);
    }
    shipment.orderId = order.id;
    shipment.orderRef = order.ref;
    shipment.customerName = order.customerName;
    shipment.carrier = String(input.carrier || 'Colissimo');
    shipment.tracking = String(input.tracking || '').trim();
    shipment.weight = Math.max(0, Number(input.weight) || 0);
    shipment.status = SHIPMENT_STATUSES.indexOf(input.status) !== -1 ? input.status : 'Étiquette créée';
    delete shipment.demo;

    /* La commande suit l'expédition. */
    if (shipment.status === 'Livré') order.status = 'Livrée';
    else if (CANCELLED.indexOf(order.status) === -1) order.status = 'Expédiée';

    store.log(data, isNew ? 'Expédition créée' : 'Expédition modifiée', order.ref + ' — ' + shipment.carrier);
    return { shipment: shipment };
  },

  'shipments/delete': function (data, body) {
    const index = data.shipments.findIndex(function (s) { return s.id === body.id; });
    if (index === -1) return { error: 'Expédition introuvable.' };
    const removed = data.shipments.splice(index, 1)[0];
    store.log(data, 'Expédition supprimée', removed.orderRef);
    return { ok: true };
  },

  /* ----- Réglages ----- */

  'settings/save': function (data, body) {
    const input = body.settings || {};
    ['shopName', 'legalName', 'address', 'zip', 'city', 'country', 'email', 'phone',
      'vatNumber', 'siret'].forEach(function (field) {
      if (input[field] !== undefined) data.settings[field] = String(input[field]).trim();
    });
    ['freeShippingThreshold', 'lowStockAlert', 'vatRate'].forEach(function (field) {
      if (input[field] !== undefined) data.settings[field] = Math.max(0, Number(input[field]) || 0);
    });
    store.log(data, 'Réglages enregistrés', data.settings.shopName);
    return { settings: data.settings };
  },

  'demo/clear': function (data) {
    const orders = data.orders.filter(function (o) { return o.demo; });
    orders.forEach(function (order) {
      if (CANCELLED.indexOf(order.status) === -1) applyStock(data, order.items, +1);
    });
    data.orders = data.orders.filter(function (o) { return !o.demo; });
    data.shipments = data.shipments.filter(function (s) { return !s.demo; });
    data.customers = data.customers.filter(function (c) { return !c.demo; });
    store.log(data, 'Données de démonstration supprimées', orders.length + ' commandes');
    return { ok: true };
  }
};

/* Actions dont le resultat change les pages publiees. */
const SITE_ACTIONS = /^(products\/|content\/|settings\/save|demo\/clear)/;

let building = false;
let queued = false;
let lastBuild = null;

/** Reconstruit le site, en regroupant les demandes qui arrivent pendant un build. */
function rebuild() {
  if (building) {
    queued = true;
    return Promise.resolve(lastBuild || { ok: true });
  }
  building = true;
  return publish().then(function (result) {
    building = false;
    lastBuild = {
      at: new Date().toISOString(),
      ok: !result.error,
      message: result.error || result.output || ''
    };
    if (queued) {
      queued = false;
      return rebuild();
    }
    return result;
  }).catch(function (error) {
    building = false;
    lastBuild = { at: new Date().toISOString(), ok: false, message: String(error.message || error) };
    return { error: lastBuild.message };
  });
}

/** Relance la génération du site statique. */
function publish() {
  return new Promise(function (resolve) {
    const root = path.join(__dirname, '..');
    execFile(process.execPath, ['build.js'], { cwd: root, timeout: 120000 },
      function (error, stdout, stderr) {
        if (error) resolve({ error: 'Publication impossible : ' + (stderr || error.message).slice(0, 300) });
        else resolve({ ok: true, output: String(stdout).trim() });
      });
  });
}

function command(action, body, user) {
  if (action === 'password') {
    return auth.changePassword(user.username, body.current, body.next);
  }
  if (action === 'site/publish') {
    return rebuild().then(function (result) {
      if (result && result.error) return result;
      store.update(function (data) {
        store.log(data, 'Site publié', 'republication manuelle');
      });
      return Object.assign({ state: state(user) }, result || {});
    });
  }

  const handler = actions[action];
  if (!handler) return null;

  const result = store.update(function (data) { return handler(data, body || {}); });
  if (result && result.error) return result;

  /* Le site est regenere dans la foulee : ce qui est enregistre est en ligne. */
  if (SITE_ACTIONS.test(action)) {
    return rebuild().then(function () {
      return Object.assign({ state: state(user) }, result || {});
    });
  }

  return Object.assign({ state: state(user) }, result || {});
}

/* -------------------------------------------------------------------------- */
/* Bordereau de livraison                                                      */
/* -------------------------------------------------------------------------- */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money(value) {
  return Number(value).toFixed(2).replace('.', ',') + ' €';
}

function deliveryNote(orderId) {
  const data = store.read();
  const order = data.orders.find(function (o) { return o.id === orderId; });
  if (!order) return null;

  const customer = data.customers.find(function (c) { return c.id === order.customerId; }) || {};
  const shipment = data.shipments.find(function (s) { return s.orderId === order.id; });
  const shop = data.settings;
  const date = new Date(order.createdAt).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  const rows = order.items.map(function (item) {
    return '<tr>'
      + '<td>' + escapeHtml(item.sku) + '</td>'
      + '<td>' + escapeHtml(item.title) + '</td>'
      + '<td class="num">' + item.quantity + '</td>'
      + '<td class="num">' + money(item.price) + '</td>'
      + '<td class="num">' + money(item.price * item.quantity) + '</td>'
      + '</tr>';
  }).join('');

  const units = order.items.reduce(function (sum, i) { return sum + i.quantity; }, 0);
  const grand = orderTotal(order);
  const vatRate = shop.vatRate || 20;
  const ht = round(grand / (1 + vatRate / 100));

  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
    + '<title>Bordereau ' + escapeHtml(order.ref) + '</title>'
    + '<style>'
    + '*{box-sizing:border-box}'
    + 'body{margin:0;padding:32px;font:13px/1.6 "Helvetica Neue",Arial,sans-serif;color:#150a02;background:#f4f1ee}'
    + '.sheet{max-width:820px;margin:auto;background:#fff;padding:44px;box-shadow:0 10px 40px rgba(0,0,0,.08)}'
    + 'header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #150a02;padding-bottom:22px}'
    + 'h1{font-size:24px;margin:0 0 6px;letter-spacing:.04em}'
    + '.meta{text-align:right;font-size:12px;color:#6e6459}'
    + '.meta strong{display:block;font-size:16px;color:#150a02}'
    + '.parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:26px 0}'
    + '.party{border:1px solid #e5ded8;padding:16px}'
    + '.party h2{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#b08d6a;margin:0 0 10px}'
    + 'table{width:100%;border-collapse:collapse;margin-top:10px}'
    + 'th{font-size:10px;letter-spacing:.14em;text-transform:uppercase;text-align:left;'
    + 'border-bottom:1px solid #150a02;padding:8px 6px;color:#6e6459}'
    + 'td{padding:10px 6px;border-bottom:1px solid #efeae6}'
    + '.num{text-align:right;white-space:nowrap}'
    + '.totals{margin-top:18px;margin-left:auto;width:280px}'
    + '.totals div{display:flex;justify-content:space-between;padding:6px 0}'
    + '.totals .grand{border-top:2px solid #150a02;margin-top:6px;padding-top:10px;font-size:16px;font-weight:700}'
    + '.ship{margin-top:26px;border:1px solid #e5ded8;padding:16px;font-size:12px}'
    + '.ship h2{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#b08d6a;margin:0 0 10px}'
    + '.sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:34px;font-size:11px;color:#6e6459}'
    + '.sign div{border-top:1px solid #d9d0c8;padding-top:8px;min-height:74px}'
    + 'footer{margin-top:28px;border-top:1px solid #efeae6;padding-top:14px;font-size:10px;color:#9c928a;text-align:center}'
    + '.actions{max-width:820px;margin:0 auto 16px;display:flex;gap:10px;justify-content:flex-end}'
    + '.actions button,.actions a{font:inherit;font-size:12px;padding:10px 18px;border:1px solid #150a02;'
    + 'background:#150a02;color:#fff;cursor:pointer;text-decoration:none;border-radius:999px}'
    + '.actions a{background:#fff;color:#150a02}'
    + '@media print{body{background:#fff;padding:0}.sheet{box-shadow:none;padding:0;max-width:none}.actions{display:none}}'
    + '</style></head><body>'
    + '<div class="actions">'
    + '<a href="/admin">Retour au back-office</a>'
    + '<button onclick="window.print()">Imprimer ou enregistrer en PDF</button>'
    + '</div>'
    + '<div class="sheet">'
    + '<header><div><h1>' + escapeHtml(shop.shopName || '417 France') + '</h1>'
    + escapeHtml(shop.legalName || '') + '<br>' + escapeHtml(shop.address || '') + '<br>'
    + escapeHtml((shop.zip || '') + ' ' + (shop.city || '')) + '<br>' + escapeHtml(shop.country || '') + '<br>'
    + escapeHtml(shop.email || '') + ' &middot; ' + escapeHtml(shop.phone || '')
    + '</div><div class="meta"><strong>Bordereau de livraison</strong>'
    + 'N° ' + escapeHtml(order.ref) + '<br>Date : ' + escapeHtml(date) + '<br>'
    + 'SIRET : ' + escapeHtml(shop.siret || '—') + '<br>TVA : ' + escapeHtml(shop.vatNumber || '—')
    + '</div></header>'
    + '<div class="parties">'
    + '<div class="party"><h2>Expéditeur</h2>' + escapeHtml(shop.legalName || shop.shopName) + '<br>'
    + escapeHtml(shop.address || '') + '<br>' + escapeHtml((shop.zip || '') + ' ' + (shop.city || '')) + '<br>'
    + escapeHtml(shop.country || '') + '</div>'
    + '<div class="party"><h2>Destinataire</h2><strong>' + escapeHtml(customer.name || order.customerName) + '</strong><br>'
    + escapeHtml(customer.address || '') + '<br>' + escapeHtml((customer.zip || '') + ' ' + (customer.city || '')) + '<br>'
    + escapeHtml(customer.country || '') + '<br>' + escapeHtml(customer.phone || '') + '<br>'
    + escapeHtml(customer.email || '') + '</div>'
    + '</div>'
    + '<table><thead><tr><th>Référence</th><th>Désignation</th><th class="num">Qté</th>'
    + '<th class="num">P.U. TTC</th><th class="num">Total TTC</th></tr></thead><tbody>'
    + rows + '</tbody></table>'
    + '<div class="totals">'
    + '<div><span>Articles</span><span>' + units + '</span></div>'
    + '<div><span>Sous-total</span><span>' + money(order.total) + '</span></div>'
    + '<div><span>Livraison</span><span>' + (order.shippingCost ? money(order.shippingCost) : 'Offerte') + '</span></div>'
    + '<div><span>Dont TVA ' + vatRate + ' %</span><span>' + money(grand - ht) + '</span></div>'
    + '<div class="grand"><span>Total TTC</span><span>' + money(grand) + '</span></div>'
    + '</div>'
    + '<div class="ship"><h2>Transport</h2>'
    + 'Transporteur : ' + escapeHtml(shipment ? shipment.carrier : 'à définir') + '<br>'
    + 'N° de suivi : ' + escapeHtml(shipment && shipment.tracking ? shipment.tracking : '—') + '<br>'
    + 'Poids : ' + (shipment && shipment.weight ? shipment.weight.toFixed(2) + ' kg' : '—') + '<br>'
    + 'Statut : ' + escapeHtml(shipment ? shipment.status : order.status)
    + (order.note ? '<br>Note : ' + escapeHtml(order.note) : '')
    + '</div>'
    + '<div class="sign"><div>Signature de l’expéditeur</div>'
    + '<div>Signature du destinataire, précédée de la mention « reçu conforme »</div></div>'
    + '<footer>Marchandises voyageant aux risques et périls du destinataire. '
    + 'Toute réserve doit être formulée auprès du transporteur dans les trois jours suivant la réception.</footer>'
    + '</div></body></html>';
}

module.exports = { state, command, deliveryNote, publish, ORDER_STATUSES, SHIPMENT_STATUSES, PRODUCT_STATUSES };
