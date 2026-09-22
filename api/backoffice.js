/* =============================================================================
   Fonction Vercel : le back-office sur le site en ligne.

   vercel.json redirige ici les routes /api/* du back-office et de la
   boutique (paiement, points relais, webhook Stripe), sauf /api/contact, qui
   a sa propre fonction, et les bordereaux
   /admin/bordereau/…, générés à la volée. Le chemin d'origine arrive dans le
   paramètre « route ». Les étiquettes /admin/etiquette/… aussi. Les pages /admin et /admin/login sont des fichiers
   statiques (voir build.js) : elles ne contiennent aucune donnée.

   Les règles sont exactement celles du serveur local : elles vivent dans
   lib/backoffice-http.js. La base est chargée depuis Supabase Storage à
   chaque requête (lib/remote-store.js), le disque étant en lecture seule.

   Variables d'environnement (projet Vercel) :
     SUPABASE_URL          adresse du projet Supabase
     SUPABASE_SECRET_KEY   clé secrète (sb_secret_…) : lecture et écriture de
                           la base, signature des sessions. Jamais côté client.
     ADMIN_EMAILS          adresse qui ouvre le back-office depuis l'espace
                           client (défaut : contact@417france.com)
     VERCEL_DEPLOY_HOOK_URL  facultatif : republie le site après une
                           modification du catalogue ou des contenus
     STRIPE_SECRET_KEY     paiement de la boutique (/api/checkout)
     STRIPE_WEBHOOK_SECRET signature des notifications Stripe
                           (/api/stripe-webhook)
     MONDIAL_RELAY_BRAND, CHRONOPOST_ACCOUNT, CHRONOPOST_PASSWORD
                           recherche des points relais (/api/relais)
     MONDIAL_RELAY_LOGIN, MONDIAL_RELAY_PASSWORD, COLISSIMO_CONTRACT,
     COLISSIMO_PASSWORD    bordereaux d'envoi (lib/labels.js)
     RESEND_API_KEY, CONTACT_TO, CONTACT_FROM  courriels de commande
   ========================================================================== */
'use strict';

const backoffice = require('../lib/backoffice-http');

function originalPath(req) {
  let route = req.query && req.query.route;
  if (Array.isArray(route)) route = route.join('/');
  if (!route) {
    const url = new URL(req.url, 'http://localhost');
    route = url.searchParams.get('route') || url.pathname;
  }
  route = '/' + String(route).replace(/^\/+/, '');
  /* Seules ces deux familles de chemins ont affaire ici. */
  if (route === '/admin' || route.indexOf('/admin/') === 0 || route.indexOf('/api/') === 0) return route;
  return null;
}

module.exports = async function handler(req, res) {
  const pathname = originalPath(req);
  if (!pathname) return backoffice.sendJson(res, 404, { error: 'Route inconnue.' });
  try {
    await backoffice.handle(req, res, pathname, { required: true });
  } catch (err) {
    if (!res.headersSent) backoffice.sendJson(res, 500, { error: err.message });
  }
};
