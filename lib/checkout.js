/* =============================================================================
   Paiement de la boutique avec Stripe Checkout.

   1. La page /commande envoie le panier (références et quantités seulement),
      le code de réduction, le mode de livraison et, s'il y a lieu, le point
      relais choisi.
   2. createSession() recalcule tout à partir de la base : prix, stock,
      réductions, livraison offerte. Rien de ce que le navigateur annonce comme
      prix n'est cru. Puis elle ouvre une session Stripe Checkout et renvoie
      son adresse : le client paie sur la page de Stripe.
   3. La commande payée est enregistrée dans le back-office (client, stock,
      code, point relais), puis la boutique et le client sont prévenus par
      courriel. Deux chemins y mènent, et le premier arrivé l'emporte :
      la notification signée de Stripe (webhook, handleEvent) et le retour du
      client sur /commande/merci (confirmSession), qui relit la session chez
      Stripe. Dans les deux cas, c'est Stripe qui dit si le paiement est acquis.

   Les règles de réduction sont celles du panier (src/assets/js/app.js) : les
   deux calculs doivent rester d'accord.
   ========================================================================== */
'use strict';

const stripe = require('./stripe');
const store = require('./store');
const admin = require('./admin-api');
const mailer = require('./mailer');

const MAX_QUANTITY = 99;
const DEFAULT_CATEGORY = 'Visage';

function round(value) {
  return Math.round(value * 100) / 100;
}

function cents(value) {
  return Math.round(Number(value) * 100);
}

function text(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

/* -------------------------------------------------------------------------- */
/* Calcul du panier                                                            */
/* -------------------------------------------------------------------------- */

const today = function () { return new Date().toISOString().slice(0, 10); };

/* Mêmes critères que les codes publiés dans les pages (build.js). */
function liveDiscounts(data) {
  const day = today();
  return (data.discounts || []).filter(function (d) {
    if (!d || !d.active) return false;
    if (d.startsAt && day < d.startsAt) return false;
    if (d.endsAt && day > d.endsAt) return false;
    if (d.maxUses && (d.used || 0) >= d.maxUses) return false;
    return true;
  });
}

function discountLabel(d) {
  if (d.label) return d.label;
  if (d.type === 'shipping') return 'Livraison offerte';
  if (d.type === 'amount') return 'Remise de ' + Number(d.value).toFixed(2).replace('.', ',') + ' €';
  return 'Remise de ' + d.value + ' %';
}

/** Recalcule une commande à partir de la base. Renvoie { error } si le panier
    ne peut pas être payé tel quel. */
function quote(data, input) {
  const wanted = new Map();
  (Array.isArray(input.items) ? input.items : []).forEach(function (item) {
    const handle = text(item && item.handle, 120);
    const quantity = Math.floor(Number(item && item.quantity) || 0);
    if (!handle || quantity < 1) return;
    wanted.set(handle, Math.min(MAX_QUANTITY, (wanted.get(handle) || 0) + quantity));
  });
  if (!wanted.size) return { error: 'Votre panier est vide.' };

  const lines = [];
  for (const [handle, quantity] of wanted) {
    const product = data.products.find(function (p) { return p.handle === handle; });
    if (!product || product.visible === false) {
      return { error: 'Un produit de votre panier n’est plus proposé. Retirez-le pour continuer.' };
    }
    const stock = Math.max(0, Number(product.stock) || 0);
    if (stock <= 0) return { error: product.title + ' est épuisé. Retirez-le du panier pour continuer.' };
    if (quantity > stock) {
      return { error: 'Il ne reste que ' + stock + ' ' + product.title + ' en stock. Ajustez la quantité.' };
    }
    lines.push({
      handle: product.handle,
      title: product.title,
      sku: product.sku || '',
      category: product.category || DEFAULT_CATEGORY,
      image: product.image || (product.images && product.images[0] && product.images[0].src) || '',
      price: round(Number(product.price) || 0),
      quantity: quantity
    });
  }

  const subtotal = round(lines.reduce(function (sum, l) { return sum + l.price * l.quantity; }, 0));
  const code = text(input.code, 60).toUpperCase();
  const matches = function (d) { return !d.auto && code && String(d.code || '').toUpperCase() === code; };
  const live = liveDiscounts(data);

  const kept = [];
  live.forEach(function (d) {
    if (!d.auto && !matches(d)) return;
    if (subtotal < (Number(d.minSubtotal) || 0)) return;
    const base = lines.reduce(function (sum, l) {
      if (d.scope && l.category !== d.scope) return sum;
      return sum + l.price * l.quantity;
    }, 0);
    if (base <= 0) return;
    let amount = 0;
    if (d.type === 'percent') amount = base * (Number(d.value) || 0) / 100;
    else if (d.type === 'amount') amount = Math.min(Number(d.value) || 0, base);
    kept.push({ discount: d, shipping: d.type === 'shipping', amount: round(amount), label: discountLabel(d) });
  });

  const discount = round(Math.min(subtotal, kept.reduce(function (sum, k) { return sum + k.amount; }, 0)));

  /* Même règle que le panier : une réduction « livraison offerte » utilisable
     remplace le seuil des réglages ; sans elle, le seuil s'applique. */
  const shippingRule = live.some(function (d) { return d.type === 'shipping' && (d.auto || matches(d)); });
  const threshold = Number(data.settings.freeShippingThreshold) || 0;
  const freeShipping = kept.some(function (k) { return k.shipping; })
    || (!shippingRule && threshold > 0 && subtotal >= threshold);

  const methods = Array.isArray(data.settings.shippingMethods) ? data.settings.shippingMethods : [];
  const method = methods.find(function (m) { return m.id === input.method; });
  if (!method) return { error: 'Choisissez un mode de livraison.' };
  const shipping = freeShipping ? 0 : round(Number(method.price) || 0);

  return {
    lines: lines,
    subtotal: subtotal,
    code: kept.some(function (k) { return matches(k.discount); }) ? code : '',
    discounts: kept,
    discount: discount,
    freeShipping: freeShipping,
    method: method,
    shipping: shipping,
    total: round(subtotal - discount + shipping)
  };
}

/* -------------------------------------------------------------------------- */
/* Session de paiement                                                         */
/* -------------------------------------------------------------------------- */

function cleanRelay(relay) {
  if (!relay || typeof relay !== 'object') return null;
  const clean = {
    id: text(relay.id, 20),
    name: text(relay.name, 80),
    address: text(relay.address, 120),
    zip: text(relay.zip, 5),
    city: text(relay.city, 60)
  };
  if (!/^[A-Za-z0-9]{2,20}$/.test(clean.id) || !clean.name || !/^\d{5}$/.test(clean.zip)) return null;
  if (/^9[78]/.test(clean.zip)) return null;
  return clean;
}

function absolute(origin, src) {
  if (!src) return null;
  if (/^https:\/\//.test(src)) return src;
  if (src.charAt(0) === '/' && /^https:\/\//.test(origin)) return origin + src;
  return null;
}

/* Délai affiché par Stripe, compté depuis la commande : l'expédition part le
   jour même ou le lendemain, d'où un jour de plus au maximum. */
function deliveryEstimate(method) {
  const min = Math.max(1, Number(method.minDays) || 1);
  const max = Math.max(min, Number(method.maxDays) || min) + 1;
  return {
    minimum: { unit: 'business_day', value: min },
    maximum: { unit: 'business_day', value: max }
  };
}

/** Ouvre une session Stripe Checkout et renvoie { url } ou { error }. */
async function createSession(data, input, origin) {
  if (!stripe.enabled()) {
    return { error: 'Le paiement en ligne n’est pas encore ouvert. Écrivez-nous pour passer commande.' };
  }
  const q = quote(data, input);
  if (q.error) return q;

  const relay = q.method.type === 'relay' ? cleanRelay(input.relay) : null;
  if (q.method.type === 'relay' && !relay) return { error: 'Choisissez un point relais.' };

  const shippingName = q.method.carrier + ' — ' + q.method.label + (relay ? ' : ' + relay.name : '');

  const params = {
    mode: 'payment',
    locale: 'fr',
    currency: 'eur',
    success_url: origin + '/commande/merci?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/commande',
    line_items: q.lines.map(function (l) {
      const image = absolute(origin, l.image);
      return {
        quantity: l.quantity,
        price_data: {
          currency: 'eur',
          unit_amount: cents(l.price),
          tax_behavior: 'inclusive',
          product_data: Object.assign({
            name: l.title,
            metadata: { handle: l.handle }
          }, image ? { images: [image] } : {})
        }
      };
    }),
    shipping_options: [{
      shipping_rate_data: {
        type: 'fixed_amount',
        display_name: shippingName.slice(0, 100),
        fixed_amount: { amount: cents(q.shipping), currency: 'eur' },
        tax_behavior: 'inclusive',
        delivery_estimate: deliveryEstimate(q.method),
        metadata: { method: q.method.id }
      }
    }],
    phone_number_collection: { enabled: true },
    custom_text: {
      submit: { message: 'Expédition le jour même ou le lendemain (le lundi pour une commande du week-end).' }
    },
    metadata: {
      method: q.method.id,
      code: q.code,
      relay_id: relay ? relay.id : '',
      relay_name: relay ? relay.name : '',
      relay_address: relay ? relay.address : '',
      relay_zip: relay ? relay.zip : '',
      relay_city: relay ? relay.city : ''
    }
  };

  /* À domicile, Stripe demande l'adresse de livraison, en France seulement.
     En point relais, l'adresse de facturation suffit à identifier le client. */
  if (relay) params.billing_address_collection = 'required';
  else params.shipping_address_collection = { allowed_countries: ['FR'] };

  /* Les réductions deviennent un bon de réduction à usage unique : Stripe
     l'applique aux articles, jamais à la livraison. */
  if (q.discount > 0) {
    const labels = q.discounts.filter(function (k) { return k.amount > 0; }).map(function (k) { return k.label; });
    const coupon = await stripe.request('POST', '/coupons', {
      amount_off: cents(q.discount),
      currency: 'eur',
      duration: 'once',
      max_redemptions: 1,
      name: (labels.join(' + ') || 'Réduction').slice(0, 40)
    });
    params.discounts = [{ coupon: coupon.id }];
  }

  const session = await stripe.request('POST', '/checkout/sessions', params);
  return { url: session.url };
}

/* -------------------------------------------------------------------------- */
/* Notifications Stripe                                                        */
/* -------------------------------------------------------------------------- */

function addressLines(address) {
  const a = address || {};
  return {
    address: [a.line1, a.line2].filter(Boolean).join(', '),
    zip: a.postal_code || '',
    city: a.city || '',
    country: a.country === 'FR' ? 'France' : (a.country || '')
  };
}

function findOrCreateCustomer(data, details, postal) {
  const email = text(details.email, 160).toLowerCase();
  let customer = email
    ? data.customers.find(function (c) { return String(c.email || '').toLowerCase() === email; })
    : null;
  if (!customer) {
    customer = { id: store.id('cus'), createdAt: new Date().toISOString(), email: email, notes: 'Créé par un paiement en ligne' };
    data.customers.push(customer);
  }
  /* Les coordonnées de la dernière commande sont les plus fraîches. */
  if (details.name) customer.name = text(details.name, 120);
  if (!customer.name) customer.name = email || 'Client en ligne';
  if (details.phone) customer.phone = text(details.phone, 40);
  if (postal && postal.address) {
    customer.address = postal.address;
    customer.zip = postal.zip;
    customer.city = postal.city;
    customer.country = postal.country;
  }
  return customer;
}

/** Crée la commande payée. Sans effet si elle existe déjà : Stripe peut
    renvoyer la même notification plusieurs fois. */
function recordOrder(data, session, lineItems) {
  const existing = data.orders.find(function (o) { return o.stripeSessionId === session.id; });
  if (existing) return { duplicate: true, order: existing };

  const meta = session.metadata || {};
  const methods = Array.isArray(data.settings.shippingMethods) ? data.settings.shippingMethods : [];
  const method = methods.find(function (m) { return m.id === meta.method; })
    || { id: meta.method, carrier: '', label: '', type: meta.relay_id ? 'relay' : 'home' };

  const items = lineItems.map(function (li) {
    const product = li.price && li.price.product && typeof li.price.product === 'object' ? li.price.product : {};
    const handle = (product.metadata && product.metadata.handle) || '';
    const known = data.products.find(function (p) { return p.handle === handle; });
    return {
      handle: handle,
      title: known ? known.title : (li.description || product.name || ''),
      sku: known ? known.sku : '',
      price: round((li.price && li.price.unit_amount ? li.price.unit_amount : 0) / 100),
      quantity: li.quantity || 1
    };
  });

  const details = session.customer_details || {};
  const collected = session.collected_information || {};
  const shippingDetails = collected.shipping_details || session.shipping_details || null;
  const totals = session.total_details || {};

  const delivery = {
    method: method.id,
    carrier: method.carrier,
    label: method.label,
    type: method.type
  };
  let postal;
  if (meta.relay_id) {
    delivery.relay = {
      id: meta.relay_id,
      name: meta.relay_name,
      address: meta.relay_address,
      zip: meta.relay_zip,
      city: meta.relay_city
    };
    postal = addressLines(details.address);
  } else if (shippingDetails) {
    postal = addressLines(shippingDetails.address);
    delivery.recipient = text(shippingDetails.name, 120);
    delivery.address = postal;
  }

  const customer = findOrCreateCustomer(data, {
    email: details.email,
    name: (shippingDetails && shippingDetails.name) || details.name,
    phone: details.phone
  }, postal);

  const notes = [];
  if (postal && /^9[78]/.test(postal.zip)) notes.push('Adresse hors France métropolitaine : à vérifier avant expédition.');

  const order = {
    id: store.id('ord'),
    ref: store.nextOrderRef(data),
    customerId: customer.id,
    customerName: customer.name,
    items: items,
    total: round(items.reduce(function (sum, i) { return sum + i.price * i.quantity; }, 0)),
    discount: round((totals.amount_discount || 0) / 100),
    shippingCost: round((totals.amount_shipping || 0) / 100),
    status: 'À préparer',
    payment: 'Payée',
    createdAt: new Date((session.created || Date.now() / 1000) * 1000).toISOString(),
    note: notes.join(' '),
    source: 'Boutique en ligne',
    email: text(details.email, 160),
    phone: text(details.phone, 40),
    delivery: delivery,
    stripeSessionId: session.id,
    stripePaymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : '',
    paid: round((session.amount_total || 0) / 100),
    livemode: Boolean(session.livemode)
  };

  data.orders.unshift(order);
  admin.applyStock(data, items, -1);

  if (meta.code) {
    const used = (data.discounts || []).find(function (d) {
      return !d.auto && String(d.code || '').toUpperCase() === String(meta.code).toUpperCase();
    });
    if (used) used.used = (used.used || 0) + 1;
  }

  store.log(data, 'Commande payée en ligne', order.ref + ' — ' + customer.name + ' — ' + order.paid.toFixed(2) + ' €');
  return { order: order };
}

function recordRefund(data, charge) {
  const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : '';
  const order = intent && data.orders.find(function (o) { return o.stripePaymentIntent === intent; });
  if (!order) return { ignored: true };
  const full = charge.amount_refunded >= charge.amount;
  if (full) {
    if (['Annulée', 'Remboursée'].indexOf(order.status) === -1) admin.applyStock(data, order.items, +1);
    order.status = 'Remboursée';
    order.payment = 'Remboursée';
  }
  order.refunded = round((charge.amount_refunded || 0) / 100);
  store.log(data, full ? 'Commande remboursée' : 'Remboursement partiel', order.ref + ' — ' + order.refunded.toFixed(2) + ' €');
  return { order: order };
}

/** Enregistre la commande d'une session payée, puis envoie les courriels.
    Deux chemins y mènent : la notification de Stripe, et le retour du client
    sur /commande/merci. Le premier arrivé crée la commande, l'autre la
    retrouve : une commande ne dépend jamais d'un seul des deux. */
async function recordPaidSession(session, origin) {
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return { pending: true };
  const lineItems = await stripe.request('GET', '/checkout/sessions/' + session.id + '/line_items', {
    limit: 100,
    expand: ['data.price.product']
  });
  const result = store.update(function (data) { return recordOrder(data, session, lineItems.data || []); });
  if (result.order && !result.duplicate) {
    const mail = await mailer.orderPlaced(result.order, origin);
    store.update(function (data) {
      const order = data.orders.find(function (o) { return o.id === result.order.id; });
      if (order) order.mail = mail;
    });
  }
  return result;
}

/** Retour du client depuis Stripe : la session est relue chez Stripe, qui seul
    fait foi, et la commande est enregistrée si le paiement est acquis. */
async function confirmSession(sessionId, origin) {
  const id = text(sessionId, 200);
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return { error: 'Session de paiement inconnue.' };
  if (!stripe.enabled()) return { error: 'Paiement non configuré.' };
  const session = await stripe.request('GET', '/checkout/sessions/' + id);
  const result = await recordPaidSession(session, origin);
  if (result.pending) return { status: 'pending' };
  return { status: 'paid', ref: result.order ? result.order.ref : '' };
}

/** Traite une notification Stripe déjà vérifiée. */
async function handleEvent(event, origin) {
  const object = event.data && event.data.object;
  if (!object) return { ignored: true };

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    return recordPaidSession(object, origin);
  }

  if (event.type === 'charge.refunded') {
    return store.update(function (data) { return recordRefund(data, object); });
  }

  return { ignored: true };
}

module.exports = { quote, createSession, confirmSession, handleEvent, recordOrder };
