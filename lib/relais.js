/* =============================================================================
   Recherche de points relais, Mondial Relay et Chronopost, par code postal.

   Mondial Relay : service public du module « Parcelshop Picker ». Il ne
   demande que le code enseigne (MONDIAL_RELAY_BRAND). Les points renvoyés sont
   réels quel que soit le code ; le vôtre sert surtout au suivi chez Mondial
   Relay.

   Chronopost : service web « PointRelaisServiceWS », qui demande un numéro de
   compte et son mot de passe (CHRONOPOST_ACCOUNT, CHRONOPOST_PASSWORD).

   Sans variable, les identifiants de test publics des deux transporteurs sont
   utilisés : la recherche fonctionne, mais renseignez les vôtres dès que vos
   contrats sont ouverts.

   Les deux réponses sont ramenées à un même format :
     { id, name, address, zip, city, lat, lng, distance, hours }
   ========================================================================== */
'use strict';

require('./env');

const TEST = {
  mondialRelayBrand: 'BDTEST  ',
  chronopostAccount: '19869502',
  chronopostPassword: '255562'
};

const MAX_RESULTS = 10;
const TIMEOUT = 12000;
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function env(name, fallback) {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function number(value) {
  const n = parseFloat(String(value || '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/* Mondial Relay double parfois les apostrophes : « D''Eau ». */
function clean(value) {
  return String(value == null ? '' : value).replace(/'{2,}/g, '’').replace(/\s+/g, ' ').trim();
}

/* Majuscules du transporteur → casse lisible : « RUE DE DOUAI » → « Rue De Douai ». */
function title(value) {
  return clean(value).toLowerCase().replace(/(^|[\s'’(-])([a-zà-ÿ])/g, function (m, sep, c) {
    return sep + c.toUpperCase();
  });
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

/* ---------- Mondial Relay ---------- */

/* « <tr><th>Lundi</th><td>09h00-12h00</td><td>14h00-19h00</td></tr> » → une
   ligne par jour ouvert. */
function mondialRelayHours(html) {
  const rows = String(html || '').match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  return rows.map(function (row) {
    const day = (row.match(/<th[^>]*>([^<]*)<\/th>/) || [])[1];
    const slots = (row.match(/<td[^>]*>([^<]*)<\/td>/g) || [])
      .map(function (td) { return td.replace(/<[^>]+>/g, '').trim(); })
      .filter(function (slot) { return slot && slot !== '-'; });
    if (!day) return null;
    return { day: clean(day), slots: slots.map(function (s) { return s.replace(/h/g, ':'); }) };
  }).filter(Boolean);
}

async function mondialRelay(zip, city) {
  const params = new URLSearchParams({
    Brand: env('MONDIAL_RELAY_BRAND', TEST.mondialRelayBrand).padEnd(8, ' '),
    Country: 'FR',
    PostCode: zip,
    City: city || '',
    ColLivMod: '24R',
    NbResults: String(MAX_RESULTS),
    SearchFar: '75',
    SearchDelay: '',
    VacationBefore: '',
    VacationAfter: '',
    Service: '',
    Weight: '',
    Latitude: '',
    Longitude: ''
  });
  const response = await fetchWithTimeout(
    'https://widget.mondialrelay.com/parcelshop-picker/v4_0/services/parcelshop-picker.svc/SearchPR?' + params
  );
  if (!response.ok) throw new Error('Mondial Relay ne répond pas (' + response.status + ').');
  const payload = await response.json();
  /* Aucun point autour de ce code postal : le service le dit par un message
     d'erreur, une liste vide suffit. */
  if (!payload.PRList || !payload.PRList.length) return [];
  return (payload.PRList || []).filter(function (p) { return p.Available !== false; }).map(function (p) {
    return {
      id: clean(p.ID),
      name: title(p.Nom),
      address: title([p.Adresse1, p.Adresse2].filter(Boolean).join(' ')),
      zip: clean(p.CP),
      city: title(p.Ville),
      lat: number(p.Lat),
      lng: number(p.Long),
      distance: number(p.Distance),
      locker: /locker|consigne/i.test(p.Nom || ''),
      hours: mondialRelayHours(p.HoursHtmlTable)
    };
  });
}

/* ---------- Chronopost ---------- */

function xmlValue(xml, tag) {
  const match = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
  return match ? decodeXml(match[1]) : '';
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, function (c) {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c];
  });
}

/* Chaque jour arrive sous la forme
   <horairesAsString>09:00-12:30 14:00-19:00</horairesAsString><jour>1</jour>,
   le lundi valant 1. */
function chronopostHours(xml) {
  const days = [];
  const pattern = /<horairesAsString>([^<]*)<\/horairesAsString>\s*<jour>(\d)<\/jour>/g;
  let match;
  while ((match = pattern.exec(xml))) {
    const day = Number(match[2]);
    const slots = decodeXml(match[1]).split(/\s+/).filter(function (s) { return s && s !== '00:00-00:00'; });
    if (day >= 1 && day <= 7 && slots.length) days.push({ order: day, day: DAYS[day - 1], slots: slots });
  }
  return days.sort(function (a, b) { return a.order - b.order; }).map(function (d) {
    return { day: d.day, slots: d.slots };
  });
}

/* Chronopost exige la ville : on la déduit du code postal, via le référentiel
   officiel des communes, quand le client ne l'a pas saisie. */
async function cityOf(zip) {
  try {
    const response = await fetchWithTimeout('https://geo.api.gouv.fr/communes?codePostal=' + zip + '&fields=nom&format=json');
    if (!response.ok) return '';
    const communes = await response.json();
    return communes && communes[0] ? clean(communes[0].nom) : '';
  } catch (err) {
    return '';
  }
}

async function chronopost(zip, city) {
  const town = city || await cityOf(zip);
  if (!town) return [];
  const today = new Date();
  const date = String(today.getDate()).padStart(2, '0') + '/'
    + String(today.getMonth() + 1).padStart(2, '0') + '/' + today.getFullYear();
  const params = {
    accountNumber: env('CHRONOPOST_ACCOUNT', TEST.chronopostAccount),
    password: env('CHRONOPOST_PASSWORD', TEST.chronopostPassword),
    address: '',
    zipCode: zip,
    city: town,
    countryCode: 'FR',
    type: 'P',
    productCode: '86',
    service: 'L',
    weight: '1',
    shippingDate: date,
    maxPointChronopost: String(MAX_RESULTS),
    maxDistanceSearch: '15',
    holidayTolerant: '1',
    language: 'FR',
    version: '2.0'
  };
  const fields = Object.keys(params).map(function (key) {
    return '<' + key + '>' + escapeXml(params[key]) + '</' + key + '>';
  }).join('');
  const envelope = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
    + 'xmlns:cxf="http://cxf.rechercheBt.soap.chronopost.fr/"><soapenv:Body>'
    + '<cxf:recherchePointChronopostInter>' + fields + '</cxf:recherchePointChronopostInter>'
    + '</soapenv:Body></soapenv:Envelope>';

  const response = await fetchWithTimeout('https://ws.chronopost.fr/recherchebt-ws-cxf/PointRelaisServiceWS', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: envelope
  });
  const xml = await response.text();
  if (!response.ok) throw new Error('Chronopost ne répond pas (' + response.status + ').');
  const code = xmlValue(xml, 'errorCode');
  /* Code 0 : points trouvés. Les autres codes signalent un code postal
     inconnu ou une zone sans point : une liste vide suffit. */
  if (code && code !== '0') return [];

  const points = xml.match(/<listePointRelais>[\s\S]*?<\/listePointRelais>/g) || [];
  return points.filter(function (p) { return xmlValue(p, 'actif') !== 'false'; }).map(function (p) {
    const name = xmlValue(p, 'nom');
    return {
      id: clean(xmlValue(p, 'identifiant')),
      name: title(name),
      address: title([xmlValue(p, 'adresse1'), xmlValue(p, 'adresse2'), xmlValue(p, 'adresse3')].filter(Boolean).join(' ')),
      zip: clean(xmlValue(p, 'codePostal')),
      city: title(xmlValue(p, 'localite')),
      lat: number(xmlValue(p, 'coordGeolocalisationLatitude')),
      lng: number(xmlValue(p, 'coordGeolocalisationLongitude')),
      distance: number(xmlValue(p, 'distanceEnMetre')) != null ? number(xmlValue(p, 'distanceEnMetre')) / 1000 : null,
      locker: /consigne|locker|pickup station/i.test(name),
      hours: chronopostHours(p)
    };
  });
}

/* ---------- Point d'entrée ---------- */

const CARRIERS = { 'Mondial Relay': mondialRelay, Chronopost: chronopost };

/** Points relais d'un transporteur autour d'un code postal français. */
async function search(carrier, zip, city) {
  const find = CARRIERS[carrier];
  if (!find) return { error: 'Transporteur sans point relais.' };
  const postcode = String(zip || '').replace(/\s+/g, '');
  if (!/^\d{5}$/.test(postcode)) return { error: 'Indiquez un code postal à 5 chiffres.' };
  if (/^9[78]/.test(postcode)) return { error: 'Nous livrons uniquement en France métropolitaine.' };
  const points = await find(postcode, clean(city).slice(0, 60));
  return {
    points: points
      .filter(function (p) { return p.id && p.name; })
      .sort(function (a, b) { return (a.distance == null ? 1e9 : a.distance) - (b.distance == null ? 1e9 : b.distance); })
      .slice(0, MAX_RESULTS)
  };
}

module.exports = { search, CARRIERS };
