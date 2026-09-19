/* =============================================================================
   Supabase Auth : configuration de l'espace client.

   Les comptes clients vivent chez Supabase : e-mail et mot de passe, sans
   fournisseur externe. La page parle directement à Supabase ; le site ne
   stocke aucun mot de passe client. build.js fige ici l'adresse du projet et
   sa clé publique dans la page, ce qui fonctionne sur le site publié.

   L'adresse de la boutique (ADMIN_EMAILS) n'a pas de compte client : elle
   ouvre le back-office avec le mot de passe local, via server.js.
   ========================================================================== */
'use strict';

require('./env');

const URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();

/* Adresses qui ouvrent le back-office, séparées par des virgules. */
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || 'contact@417france.com')
  .split(',')
  .map(function (email) { return email.trim().toLowerCase(); })
  .filter(Boolean);

function configured() {
  return Boolean(URL && KEY);
}

/** Ce que le navigateur reçoit : l'adresse du projet et sa clé publique.
    Les deux sont faites pour être publiques, la sécurité tient aux règles
    de Supabase et non au secret de cette clé. */
function publicConfig() {
  return configured() ? { url: URL, key: KEY } : null;
}

function isAdminEmail(email) {
  return ADMIN_EMAILS.indexOf(String(email || '').trim().toLowerCase()) !== -1;
}

/** Renvoie l'utilisateur Supabase derrière un jeton d'accès, ou null.
    C'est Supabase qui tranche : un jeton expiré, révoqué ou venu d'un autre
    projet est refusé. */
async function userFromToken(token) {
  if (!configured() || typeof token !== 'string' || !token) return null;
  const response = await fetch(URL + '/auth/v1/user', {
    headers: { apikey: KEY, Authorization: 'Bearer ' + token }
  });
  if (!response.ok) return null;
  return response.json();
}

/** Seule une adresse dont Supabase a vérifié la propriété ouvre le
    back-office : lien de confirmation cliqué, ou compte Google. */
function confirmedEmail(user) {
  if (!user || !user.email) return null;
  if (!user.email_confirmed_at && !user.confirmed_at) return null;
  return user.email.toLowerCase();
}

module.exports = { configured, publicConfig, isAdminEmail, userFromToken, confirmedEmail, ADMIN_EMAILS };
