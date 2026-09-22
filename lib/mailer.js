/* =============================================================================
   Courriels de commande, envoyés par Resend (le même service que les
   formulaires de la boutique, voir api/contact.js).

   Variables d'environnement :
     RESEND_API_KEY  clé Resend ; sans elle, rien ne part et la commande le
                     note (« non configuré »)
     CONTACT_TO      boîte de la boutique (défaut : contact@417france.com)
     CONTACT_FROM    expéditeur, sur le domaine vérifié chez Resend

   Stripe envoie en plus son propre reçu de paiement au client, en production
   seulement : en mode test, il n'envoie aucun courriel.
   ========================================================================== */
'use strict';

require('./env');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function config() {
  return {
    key: String(process.env.RESEND_API_KEY || '').trim(),
    to: String(process.env.CONTACT_TO || 'contact@417france.com').trim(),
    from: String(process.env.CONTACT_FROM || '417 France <contact@417france.com>').trim()
  };
}

function euros(value) {
  return (Number(value) || 0).toFixed(2).replace('.', ',') + ' €';
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* Destination de la commande, en lignes de texte. */
function destination(order) {
  const d = order.delivery || {};
  if (d.relay) {
    return ['Point relais ' + (d.carrier || '') + ' n° ' + d.relay.id, d.relay.name, d.relay.address,
      d.relay.zip + ' ' + d.relay.city];
  }
  if (d.address) {
    return [d.recipient || order.customerName, d.address.address, d.address.zip + ' ' + d.address.city, d.address.country];
  }
  return [];
}

function summary(order) {
  const d = order.delivery || {};
  const lines = order.items.map(function (i) {
    return i.quantity + ' × ' + i.title + ' — ' + euros(i.price * i.quantity);
  });
  lines.push('');
  lines.push('Sous-total : ' + euros(order.total));
  if (order.discount) lines.push('Réduction : −' + euros(order.discount));
  lines.push('Livraison (' + [d.carrier, d.label].filter(Boolean).join(' — ') + ') : '
    + (order.shippingCost ? euros(order.shippingCost) : 'offerte'));
  lines.push('Total payé : ' + euros(order.paid));
  return lines;
}

function asHtml(lines) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#17130f">'
    + lines.map(function (l) { return l ? escapeHtml(l) : '&nbsp;'; }).join('<br>') + '</div>';
}

async function send(message) {
  const c = config();
  if (!c.key) return 'non configuré';
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ from: c.from }, message))
    });
    if (!response.ok) {
      console.error('Resend a refusé le courriel de commande', response.status, await response.text());
      return 'échec (' + response.status + ')';
    }
    return 'envoyé';
  } catch (err) {
    console.error('Resend injoignable', err && err.message);
    return 'échec';
  }
}

/** Prévient la boutique et confirme au client. Renvoie l'état de chaque envoi. */
async function orderPlaced(order, origin) {
  const c = config();
  const where = destination(order);
  const test = order.livemode ? '' : ' [TEST]';

  const shopLines = ['Nouvelle commande payée en ligne' + test + ' : ' + order.ref, '']
    .concat(summary(order))
    .concat(['', 'Livraison :'], where, ['',
      'Client : ' + order.customerName,
      'E-mail : ' + (order.email || '—'),
      'Téléphone : ' + (order.phone || '—'),
      '', 'Back-office : ' + (origin ? origin + '/admin' : '/admin')]);

  const customerLines = ['Bonjour ' + order.customerName + ',', '',
    'Merci pour votre commande n° ' + order.ref + ' : votre paiement est bien reçu.', '']
    .concat(summary(order))
    .concat(['', 'Livraison :'], where, ['',
      'Votre colis part le jour même ou le lendemain (le lundi pour une commande passée le week-end). '
      + 'Vous recevrez son numéro de suivi dès l’expédition.', '',
      'Une question ? Répondez simplement à ce courriel.', '', 'L’équipe 417 France']);

  const shop = await send({
    to: [c.to],
    reply_to: order.email || undefined,
    subject: 'Nouvelle commande ' + order.ref + ' — ' + euros(order.paid) + test,
    text: shopLines.join('\n'),
    html: asHtml(shopLines)
  });
  const customer = order.email
    ? await send({
      to: [order.email],
      reply_to: c.to,
      subject: 'Votre commande 417 France n° ' + order.ref,
      text: customerLines.join('\n'),
      html: asHtml(customerLines)
    })
    : 'sans adresse';
  return { shop: shop, customer: customer, at: new Date().toISOString() };
}

module.exports = { orderPlaced };
