/* =============================================================================
   Bordereaux d'envoi : création de l'étiquette chez le transporteur choisi
   par le client, depuis la fiche commande du back-office.

   Chaque mode de livraison correspond à un service du transporteur :
     mondial-relay                Mondial Relay, Point Relais / Locker (24R)
     chronopost-relais            Chronopost Shop2Shop (5E)
     chronopost-relais-express    Chronopost Chrono Relais 13h (86)
     chronopost-domicile-express  Chronopost Chrono 13 (01)
     colissimo-domicile           Colissimo Domicile sans signature (DOM)

   L'étiquette est facturée par le transporteur sur le compte de la boutique.
   Le PDF est rangé avec la base (Supabase Storage, ou data/labels/ en local),
   la commande reçoit le numéro de suivi et une expédition est créée.

   Tout est facultatif : un transporteur sans identifiants se traite à la
   main (étiquette créée sur son site, numéro de suivi saisi dans
   l'expédition). Le bouton d'achat n'apparaît que pour les transporteurs
   configurés.

   Variables d'environnement :
     CHRONOPOST_ACCOUNT, CHRONOPOST_PASSWORD  compte Chronopost
     MONDIAL_RELAY_LOGIN, MONDIAL_RELAY_PASSWORD, MONDIAL_RELAY_BRAND
       accès « Connect API » de Mondial Relay (espace connect.mondialrelay.com)
     MONDIAL_RELAY_SANDBOX=1   étiquettes de test Mondial Relay
     COLISSIMO_CONTRACT, COLISSIMO_PASSWORD   compte Colissimo Box / entreprise
   ========================================================================== */
'use strict';

require('./env');

const fs = require('fs');
const path = require('path');
const store = require('./store');
const remote = require('./remote-store');

const LOCAL_DIR = path.join(__dirname, '..', 'data', 'labels');
const TIMEOUT = 30000;

const SERVICES = {
  'mondial-relay': { carrier: 'Mondial Relay', api: 'mondialRelay', name: 'Point Relais / Locker' },
  'chronopost-relais': { carrier: 'Chronopost', api: 'chronopost', product: '5E', name: 'Shop2Shop' },
  'chronopost-relais-express': { carrier: 'Chronopost', api: 'chronopost', product: '86', name: 'Chrono Relais 13h' },
  'chronopost-domicile-express': { carrier: 'Chronopost', api: 'chronopost', product: '01', name: 'Chrono 13' },
  'colissimo-domicile': { carrier: 'Colissimo', api: 'colissimo', product: 'DOM', name: 'Colissimo Domicile' }
};

function env(name) {
  return String(process.env[name] || '').trim();
}

function cut(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function escapeXml(value) {
  return String(value == null ? '' : value).replace(/[<>&'"]/g, function (c) {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c];
  });
}

function xml(fields) {
  return Object.keys(fields).map(function (key) {
    return '<' + key + '>' + escapeXml(fields[key]) + '</' + key + '>';
  }).join('');
}

function xmlValue(text, tag) {
  const match = text.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>'));
  return match ? match[1] : '';
}

/* « +33 6 12 34 56 78 » → « 0612345678 ». */
function nationalPhone(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  if (/^\+33\d{9}$/.test(digits)) return '0' + digits.slice(3);
  if (/^0033\d{9}$/.test(digits)) return '0' + digits.slice(4);
  return digits.replace(/\D/g, '').slice(0, 10);
}

function internationalPhone(value) {
  const national = nationalPhone(value);
  return /^0\d{9}$/.test(national) ? '+33' + national.slice(1) : national;
}

function splitName(full) {
  const parts = cut(full, 70).split(' ').filter(Boolean);
  if (parts.length < 2) return { first: '', last: parts[0] || '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT);
  try {
    return await fetch(url, Object.assign({ signal: controller.signal }, options || {}));
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Qui envoie, qui reçoit                                                      */
/* -------------------------------------------------------------------------- */

function parties(data, order) {
  const s = data.settings || {};
  const customer = data.customers.find(function (c) { return c.id === order.customerId; }) || {};
  const d = order.delivery || {};
  const home = d.address || { address: customer.address, zip: customer.zip, city: customer.city };
  return {
    shipper: {
      name: cut(s.legalName || s.shopName || '417 France', 35),
      address: cut(s.address, 35),
      zip: cut(s.zip, 10),
      city: cut(s.city, 35),
      phone: nationalPhone(s.phone),
      email: cut(s.email, 80)
    },
    recipient: {
      name: cut(d.recipient || order.customerName || customer.name, 35),
      email: cut(order.email || customer.email, 80),
      phone: nationalPhone(order.phone || customer.phone),
      address: cut(home.address, 35),
      address2: cut(String(home.address || '').slice(35), 35),
      zip: cut(home.zip, 10),
      city: cut(home.city, 35)
    },
    relay: d.relay || null
  };
}

/* -------------------------------------------------------------------------- */
/* Chronopost : ShippingServiceWS, shippingMultiParcelV5                       */
/* -------------------------------------------------------------------------- */

async function chronopost(service, order, p, weight) {
  const account = env('CHRONOPOST_ACCOUNT');
  const password = env('CHRONOPOST_PASSWORD');
  if (!account || !password) {
    throw new Error('Chronopost n’est pas configuré : ajoutez CHRONOPOST_ACCOUNT et CHRONOPOST_PASSWORD.');
  }
  const now = new Date();
  const relay = p.relay;
  if (service.product !== '01' && !relay) throw new Error('Point relais absent de la commande.');

  const recipient = relay
    ? {
      recipientAdress1: cut(relay.address, 35), recipientAdress2: '', recipientCity: cut(relay.city, 35),
      recipientContactName: p.recipient.name, recipientCountry: 'FR', recipientCountryName: 'FRANCE',
      recipientEmail: p.recipient.email, recipientMobilePhone: p.recipient.phone, recipientName: cut(relay.name, 35),
      recipientName2: p.recipient.name, recipientPhone: p.recipient.phone, recipientPreAlert: '0',
      recipientZipCode: relay.zip, recipientType: '2'
    }
    : {
      recipientAdress1: p.recipient.address, recipientAdress2: p.recipient.address2, recipientCity: p.recipient.city,
      recipientContactName: p.recipient.name, recipientCountry: 'FR', recipientCountryName: 'FRANCE',
      recipientEmail: p.recipient.email, recipientMobilePhone: p.recipient.phone, recipientName: p.recipient.name,
      recipientName2: '', recipientPhone: p.recipient.phone, recipientPreAlert: '0',
      recipientZipCode: p.recipient.zip, recipientType: '2'
    };

  const shipper = {
    Adress1: p.shipper.address, Adress2: '', City: p.shipper.city, Civility: 'M', ContactName: p.shipper.name,
    Country: 'FR', CountryName: 'FRANCE', Email: p.shipper.email, MobilePhone: '', Name: p.shipper.name,
    Name2: '', Phone: p.shipper.phone, PreAlert: '0', ZipCode: p.shipper.zip
  };
  const prefixed = function (prefix) {
    const out = {};
    Object.keys(shipper).forEach(function (k) { out[prefix + k] = shipper[k]; });
    return out;
  };

  const envelope = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
    + 'xmlns:cxf="http://cxf.shipping.soap.chronopost.fr/"><soapenv:Body><cxf:shippingMultiParcelV5>'
    + '<headerValue>' + xml({ accountNumber: account, idEmit: 'CHRFR', identWebPro: '', subAccount: '' }) + '</headerValue>'
    + '<shipperValue>' + xml(Object.assign(prefixed('shipper'), { shipperType: '1' })) + '</shipperValue>'
    + '<customerValue>' + xml(Object.assign(prefixed('customer'), { printAsSender: 'N' })) + '</customerValue>'
    + '<recipientValue>' + xml(recipient) + '</recipientValue>'
    + '<refValue>' + xml({
      customerSkybillNumber: order.ref, recipientRef: cut(p.recipient.name, 35), shipperRef: order.ref,
      idRelais: relay ? relay.id : ''
    }) + '</refValue>'
    + '<skybillValue>' + xml({
      bulkNumber: '1', codCurrency: 'EUR', codValue: '0', content1: 'Cosmetiques', customsCurrency: 'EUR',
      customsValue: '0', evtCode: 'DC', insuredCurrency: 'EUR', insuredValue: '0', objectType: 'MAR',
      portCurrency: 'EUR', portValue: '0', productCode: service.product, service: '0',
      shipDate: now.toISOString().slice(0, 19), shipHour: String(now.getHours()), skybillRank: '1',
      weight: weight.toFixed(2), weightUnit: 'KGM', height: '0', length: '0', width: '0'
    }) + '</skybillValue>'
    + '<skybillParamsValue>' + xml({ mode: 'PDF', withReservation: '0' }) + '</skybillParamsValue>'
    + xml({ password: password, modeRetour: '1', numberOfParcel: '1', version: '2.0', multiParcel: 'N' })
    + '</cxf:shippingMultiParcelV5></soapenv:Body></soapenv:Envelope>';

  const response = await fetchWithTimeout('https://ws.chronopost.fr/shipping-cxf/ShippingServiceWS', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: envelope
  });
  const text = await response.text();
  const code = xmlValue(text, 'errorCode');
  if (code !== '0') {
    throw new Error('Chronopost : ' + (xmlValue(text, 'errorMessage') || 'réponse ' + response.status) + (code ? ' (code ' + code + ')' : ''));
  }
  const pdf = xmlValue(text, 'pdfEtiquette');
  if (!pdf) throw new Error('Chronopost n’a pas renvoyé d’étiquette.');
  return {
    tracking: xmlValue(text, 'skybillNumber'),
    pdf: Buffer.from(pdf, 'base64'),
    test: false
  };
}

/* -------------------------------------------------------------------------- */
/* Mondial Relay : Connect API (création d'expédition)                         */
/* -------------------------------------------------------------------------- */

function mrAddress(a) {
  return '<Address><Title/>'
    + '<Firstname>' + escapeXml(a.first) + '</Firstname><Lastname>' + escapeXml(a.last) + '</Lastname>'
    + '<Streetname>' + escapeXml(a.street) + '</Streetname><HouseNo/>'
    + '<CountryCode>FR</CountryCode><PostCode>' + escapeXml(a.zip) + '</PostCode><City>' + escapeXml(a.city) + '</City>'
    + '<AddressAdd1>' + escapeXml(a.add1 || '') + '</AddressAdd1><AddressAdd2/><AddressAdd3/>'
    + '<PhoneNo>' + escapeXml(a.phone || '') + '</PhoneNo><MobileNo>' + escapeXml(a.mobile || '') + '</MobileNo>'
    + '<Email>' + escapeXml(a.email || '') + '</Email></Address>';
}

async function mondialRelay(service, order, p, weight) {
  const login = env('MONDIAL_RELAY_LOGIN');
  const password = env('MONDIAL_RELAY_PASSWORD');
  const brand = env('MONDIAL_RELAY_BRAND');
  if (!login || !password || !brand) {
    throw new Error('Mondial Relay n’est pas configuré : ajoutez MONDIAL_RELAY_LOGIN, MONDIAL_RELAY_PASSWORD et MONDIAL_RELAY_BRAND (accès « Connect API » de votre compte Mondial Relay).');
  }
  if (!p.relay) throw new Error('Point relais absent de la commande.');
  const sandbox = env('MONDIAL_RELAY_SANDBOX') === '1';
  const url = sandbox
    ? 'https://connect-api-sandbox.mondialrelay.com/api/shipment'
    : 'https://connect-api.mondialrelay.com/api/shipment';
  const name = splitName(p.recipient.name);

  const body = '<?xml version="1.0" encoding="utf-8"?>'
    + '<ShipmentCreationRequest xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
    + 'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.example.org/Request">'
    + '<Context><Login>' + escapeXml(login) + '</Login><Password>' + escapeXml(password) + '</Password>'
    + '<CustomerId>' + escapeXml(brand) + '</CustomerId><Culture>fr-FR</Culture><VersionAPI>1.0</VersionAPI></Context>'
    + '<OutputOptions><OutputFormat>10x15</OutputFormat><OutputType>PdfUrl</OutputType></OutputOptions>'
    + '<ShipmentsList><Shipment>'
    + '<OrderNo>' + escapeXml(order.ref.replace(/[^A-Za-z0-9]/g, '').slice(-15)) + '</OrderNo>'
    + '<CustomerNo>' + escapeXml(String(order.customerId || '').replace(/[^A-Za-z0-9]/g, '').slice(-9)) + '</CustomerNo>'
    + '<ParcelCount>1</ParcelCount>'
    + '<DeliveryMode Mode="24R" Location="FR-' + escapeXml(p.relay.id) + '"/>'
    + '<CollectionMode Mode="' + escapeXml(env('MONDIAL_RELAY_COLLECTION') || 'REL') + '" Location=""/>'
    + '<Parcels><Parcel><Content>Cosmetiques</Content><Weight Value="' + Math.round(weight * 1000) + '" Unit="gr"/></Parcel></Parcels>'
    + '<DeliveryInstruction/>'
    + '<Sender>' + mrAddress({
      first: '', last: '', street: p.shipper.address, zip: p.shipper.zip, city: p.shipper.city,
      add1: p.shipper.name, phone: internationalPhone(p.shipper.phone), email: p.shipper.email
    }) + '</Sender>'
    + '<Recipient>' + mrAddress({
      first: name.first, last: name.last, street: cut(p.recipient.address || p.relay.address, 40),
      zip: p.recipient.zip || p.relay.zip, city: p.recipient.city || p.relay.city,
      mobile: internationalPhone(p.recipient.phone), email: p.recipient.email
    }) + '</Recipient>'
    + '</Shipment></ShipmentsList></ShipmentCreationRequest>';

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', Accept: 'application/xml' },
    body: body
  });
  const text = await response.text();
  const errors = [];
  text.replace(/<Status Code="([^"]*)" Level="([^"]*)" Message="([^"]*)"/g, function (m, code, level, message) {
    if (!/info/i.test(level)) errors.push(message + ' (' + code + ')');
    return m;
  });
  const number = (text.match(/ShipmentNumber="([^"]*)"/) || [])[1];
  const output = (text.match(/<Output>([^<]*)<\/Output>/) || [])[1];
  if (!number || !output) throw new Error('Mondial Relay : ' + (errors.join(' ; ') || 'réponse ' + response.status));

  const pdfResponse = await fetchWithTimeout(output.replace(/&amp;/g, '&'));
  if (!pdfResponse.ok) throw new Error('Mondial Relay : étiquette introuvable (' + pdfResponse.status + ').');
  return { tracking: number, pdf: Buffer.from(await pdfResponse.arrayBuffer()), test: sandbox };
}

/* -------------------------------------------------------------------------- */
/* Colissimo : web service SLS, generateLabel                                  */
/* -------------------------------------------------------------------------- */

/* La réponse est en plusieurs parties : un JSON, puis le PDF. */
function multipart(buffer, contentType) {
  const boundary = (contentType.match(/boundary="?([^";]+)"?/) || [])[1];
  if (!boundary) return { json: JSON.parse(buffer.toString('utf8')), pdf: null };
  const marker = Buffer.from('--' + boundary);
  const parts = [];
  let at = buffer.indexOf(marker);
  while (at !== -1) {
    const next = buffer.indexOf(marker, at + marker.length);
    if (next === -1) break;
    parts.push(buffer.slice(at + marker.length, next));
    at = next;
  }
  const out = { json: null, pdf: null };
  parts.forEach(function (part) {
    const split = part.indexOf('\r\n\r\n');
    if (split === -1) return;
    const head = part.slice(0, split).toString('utf8');
    let body = part.slice(split + 4);
    if (body.slice(-2).toString() === '\r\n') body = body.slice(0, -2);
    if (/<jsonInfos>/.test(head)) out.json = JSON.parse(body.toString('utf8'));
    else if (/<label>/.test(head)) out.pdf = body;
  });
  return out;
}

async function colissimo(service, order, p, weight) {
  const contract = env('COLISSIMO_CONTRACT');
  const password = env('COLISSIMO_PASSWORD');
  if (!contract || !password) {
    throw new Error('Colissimo n’est pas configuré : ajoutez COLISSIMO_CONTRACT et COLISSIMO_PASSWORD (compte Colissimo entreprise).');
  }
  const name = splitName(p.recipient.name);
  const payload = {
    contractNumber: contract,
    password: password,
    outputFormat: { x: 0, y: 0, outputPrintingType: 'PDF_10x15_300dpi' },
    letter: {
      service: {
        productCode: service.product,
        depositDate: new Date().toISOString().slice(0, 10),
        orderNumber: order.ref,
        commercialName: p.shipper.name
      },
      parcel: { weight: Math.max(0.01, weight) },
      sender: {
        senderParcelRef: order.ref,
        address: {
          companyName: p.shipper.name, line2: p.shipper.address, countryCode: 'FR',
          city: p.shipper.city, zipCode: p.shipper.zip, phoneNumber: p.shipper.phone, email: p.shipper.email
        }
      },
      addressee: {
        addresseeParcelRef: order.ref,
        address: {
          lastName: name.last, firstName: name.first, line2: p.recipient.address, line3: p.recipient.address2,
          countryCode: 'FR', city: p.recipient.city, zipCode: p.recipient.zip,
          email: p.recipient.email, mobileNumber: p.recipient.phone
        }
      }
    }
  };
  const response = await fetchWithTimeout('https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/2.0/generateLabel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const parsed = multipart(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type') || '');
  const json = parsed.json || {};
  const errors = (json.messages || []).filter(function (m) { return m.type === 'ERROR'; });
  const parcel = json.labelV2Response && json.labelV2Response.parcelNumber;
  if (errors.length || !parcel || !parsed.pdf) {
    throw new Error('Colissimo : ' + (errors.map(function (m) { return m.messageContent + ' (' + m.id + ')'; }).join(' ; ') || 'réponse ' + response.status));
  }
  return { tracking: parcel, pdf: parsed.pdf, test: false };
}

/* -------------------------------------------------------------------------- */
/* Fichiers                                                                    */
/* -------------------------------------------------------------------------- */

function fileName(orderId) {
  return 'labels/' + String(orderId).replace(/[^A-Za-z0-9_-]/g, '') + '.pdf';
}

async function saveFile(orderId, pdf) {
  const name = fileName(orderId);
  if (remote.enabled()) {
    await remote.putFile(name, pdf, 'application/pdf');
  } else {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOCAL_DIR, path.basename(name)), pdf);
  }
  return name;
}

/** Le PDF de l'étiquette d'une commande, ou null. */
async function readFile(order) {
  if (!order || !order.label || !order.label.file) return null;
  if (remote.enabled()) return remote.getFile(order.label.file);
  const local = path.join(LOCAL_DIR, path.basename(order.label.file));
  return fs.existsSync(local) ? fs.readFileSync(local) : null;
}

/* -------------------------------------------------------------------------- */
/* Achat                                                                       */
/* -------------------------------------------------------------------------- */

const APIS = { chronopost: chronopost, mondialRelay: mondialRelay, colissimo: colissimo };

/** Transporteurs dont les identifiants sont renseignés : seuls eux proposent
    l'achat du bordereau depuis le back-office. */
function configured() {
  return {
    Chronopost: Boolean(env('CHRONOPOST_ACCOUNT') && env('CHRONOPOST_PASSWORD')),
    'Mondial Relay': Boolean(env('MONDIAL_RELAY_LOGIN') && env('MONDIAL_RELAY_PASSWORD') && env('MONDIAL_RELAY_BRAND')),
    Colissimo: Boolean(env('COLISSIMO_CONTRACT') && env('COLISSIMO_PASSWORD'))
  };
}

/** Crée l'étiquette de la commande chez son transporteur. */
async function purchase(orderId, options) {
  const data = store.read();
  const order = data.orders.find(function (o) { return o.id === orderId; });
  if (!order) return { error: 'Commande introuvable.' };
  if (['Annulée', 'Remboursée'].indexOf(order.status) !== -1) return { error: 'Commande annulée : pas de bordereau.' };
  if (order.label) return { error: 'Le bordereau de cette commande existe déjà.' };
  const service = SERVICES[order.delivery && order.delivery.method];
  if (!service) return { error: 'Cette commande n’a pas de mode de livraison en ligne : créez l’expédition à la main.' };

  const weight = Math.min(30, Math.max(0.05, Number(options && options.weight) || Number(data.settings.parcelWeight) || 0.5));
  const p = parties(data, order);
  if (!p.shipper.address || !p.shipper.zip || !p.shipper.city) {
    return { error: 'Adresse de la boutique incomplète : renseignez-la dans Réglages.' };
  }
  if (!p.relay && (!p.recipient.address || !p.recipient.zip)) {
    return { error: 'Adresse de livraison du client incomplète.' };
  }

  let created;
  try {
    created = await APIS[service.api](service, order, p, weight);
  } catch (err) {
    return { error: err.message };
  }
  const file = await saveFile(order.id, created.pdf);

  return store.update(function (fresh) {
    const target = fresh.orders.find(function (o) { return o.id === orderId; });
    if (!target) return { error: 'Commande introuvable.' };
    target.label = {
      carrier: service.carrier,
      service: service.name,
      tracking: created.tracking,
      weight: weight,
      file: file,
      test: Boolean(created.test),
      createdAt: new Date().toISOString()
    };
    if (target.status === 'À préparer') target.status = 'En préparation';

    let shipment = fresh.shipments.find(function (s) { return s.orderId === target.id; });
    if (!shipment) {
      shipment = { id: store.id('shp'), shippedAt: new Date().toISOString() };
      fresh.shipments.unshift(shipment);
    }
    Object.assign(shipment, {
      orderId: target.id,
      orderRef: target.ref,
      customerName: target.customerName,
      carrier: service.carrier,
      tracking: created.tracking,
      weight: weight,
      status: 'Étiquette créée'
    });
    store.log(fresh, 'Bordereau créé', target.ref + ' — ' + service.carrier + ' ' + created.tracking + (created.test ? ' (test)' : ''));
    return { order: target };
  });
}

module.exports = { purchase, readFile, configured, SERVICES };
