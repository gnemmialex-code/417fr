/* =============================================================================
   Fonction Vercel : réception des formulaires de la boutique en ligne.

   Sur le site déployé, il n'y a pas de serveur Node ni de data/store.json :
   le système de fichiers est en lecture seule. Un message reçu ici part donc
   par e-mail, via Resend, vers l'adresse de la boutique.

   En local, cette fonction ne sert pas : server.js répond lui-même sur
   /api/contact et range le message dans la rubrique Messages du back-office.

   Variables d'environnement :
     RESEND_API_KEY  posée par « vercel integration add resend/resend-email »
     CONTACT_TO      destinataire (défaut : contact@417france.com)
     CONTACT_FROM    expéditeur ; doit être sur le domaine vérifié chez Resend
   ========================================================================== */
'use strict';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const KINDS = ['contact', 'newsletter'];
const LIMITS = { name: 120, email: 160, phone: 40, message: 4000 };

/* Mêmes règles que le back-office local, pour que les deux chemins acceptent
   et refusent exactement la même chose. */
function trimmed(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/* Garde-fou de débit. Fluid Compute réutilise les instances, ce compteur tient
   donc sur plusieurs requêtes — mais pas sur toutes : plusieurs instances
   peuvent tourner en parallèle. C'est un filtre, pas une barrière. Le pare-feu
   Vercel est là pour le reste. */
const WINDOW = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map();

function allowed(key) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(function (at) { return now - at < WINDOW; });
  if (hits.size > 5000) hits.clear();
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'inconnu';
}

/* Le corps arrive déjà analysé quand l'en-tête l'annonce en JSON ; sinon on le
   lit nous-mêmes. */
function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise(function (resolve) {
    let raw = '';
    req.on('data', function (chunk) {
      raw += chunk;
      if (raw.length > 100000) raw = raw.slice(0, 100000);
    });
    req.on('end', function () {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', function () { resolve({}); });
  });
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/* Corps du courriel : du texte simple, lisible dans n'importe quelle
   messagerie, et qui ne prétend pas mettre en forme ce qu'on a reçu. */
function compose(entry) {
  const lines = [
    entry.kind === 'newsletter'
      ? 'Nouvelle inscription à la newsletter.'
      : 'Nouveau message depuis le formulaire de contact.',
    '',
    'Nom      : ' + (entry.name || '(non renseigné)'),
    'E-mail   : ' + entry.email
  ];
  if (entry.phone) lines.push('Téléphone: ' + entry.phone);
  lines.push('Reçu le  : ' + new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }));
  if (entry.message) {
    lines.push('', '-----', '', entry.message);
  }
  lines.push('', '-----', 'Envoyé depuis le formulaire de 417france.com.');
  return lines.join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Méthode non autorisée.' });
  }

  /* Le même contrôle qu'en local : seul un appel fetch de même origine pose
     cet en-tête, ce qui écarte les envois depuis un formulaire hébergé
     ailleurs. */
  if (req.headers['x-requested-with'] !== 'fetch') {
    return send(res, 400, { error: 'Requête non reconnue.' });
  }

  if (!allowed(clientKey(req))) {
    return send(res, 429, { error: 'Trop d’envois. Réessayez dans quelques minutes.' });
  }

  const body = await readBody(req);

  /* Champ piège : invisible pour un visiteur, rempli par les robots qui
     remplissent tout. On répond comme si de rien n'était. */
  if (trimmed(body.website, 200)) return send(res, 200, { ok: true });

  const kind = KINDS.indexOf(body.kind || body.sujet) !== -1 ? (body.kind || body.sujet) : 'contact';
  const entry = {
    kind: kind,
    name: trimmed(body.name, LIMITS.name),
    email: trimmed(body.email, LIMITS.email),
    phone: trimmed(body.phone, LIMITS.phone),
    message: trimmed(body.message, LIMITS.message)
  };

  if (!looksLikeEmail(entry.email)) return send(res, 400, { error: 'Adresse e-mail invalide.' });
  if (kind === 'contact' && !entry.message) return send(res, 400, { error: 'Message vide.' });

  const key = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO || 'contact@417france.com';
  const from = process.env.CONTACT_FROM || 'Formulaire 417 France <contact@417france.com>';

  /* Sans clé, on ne fait pas semblant : la boutique affiche son adresse
     e-mail de repli plutôt qu'une confirmation qui n'en serait pas une. */
  if (!key) {
    return send(res, 503, { error: 'Envoi indisponible.' });
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: from,
        to: [to],
        reply_to: entry.email,
        subject: kind === 'newsletter'
          ? 'Inscription newsletter — ' + entry.email
          : 'Message de ' + (entry.name || entry.email),
        text: compose(entry)
      })
    });

    if (!response.ok) {
      /* Le détail de Resend part dans les journaux, jamais vers le visiteur. */
      console.error('Resend a refusé l’envoi', response.status, await response.text());
      return send(res, 502, { error: 'Envoi impossible pour le moment.' });
    }
  } catch (err) {
    console.error('Resend injoignable', err && err.message);
    return send(res, 502, { error: 'Envoi impossible pour le moment.' });
  }

  return send(res, 200, { ok: true });
};
