# 417 France — copie locale du site

Réplique statique complète de `417france.com`, reconstruite hors de Shopify.
Aucune dépendance npm : le générateur et le serveur n'utilisent que Node.js.

## Démarrer

```bash
node scripts/seed-store.js     # une seule fois : compte admin, stocks, démo
node scripts/upgrade-store.js  # une seule fois : contenu éditorial du site
node build.js                  # génère la boutique dans /dist
node server.js                 # sert la boutique et le back-office (port 4170)
```

Ou en une seule commande, une fois la base créée :

```bash
npm start
```

| | |
| --- | --- |
| Boutique | http://localhost:4170 |
| Back-office | http://localhost:4170/admin |
| Aperçu mobile | http://localhost:4170/preview |

En ligne, les deux mêmes adresses :

| | |
| --- | --- |
| Boutique | https://417fr-eta.vercel.app |
| Aperçu mobile | https://417fr-eta.vercel.app/preview |

L'accès en ligne demande une connexion au compte Vercel de l'équipe : la
protection s'applique aux adresses en `.vercel.app`, un domaine personnalisé
serait public. Le back-office n'est pas déployé, il reste local.

L'aperçu mobile charge le site dans un cadre de téléphone à la largeur réelle de
l'appareil choisi, iPhone 16 Pro Max par défaut : dix modèles d'iPhone, Android
et iPad, rotation paysage, mise à l'échelle automatique et sélecteur de page
alimenté par le sitemap.

L'initialisation affiche l'identifiant et un mot de passe aléatoire. Seule son
empreinte est stockée. Pour le changer :

```bash
node scripts/reset-password.js <nouveau mot de passe>
```

## Déploiement

La boutique est un site statique : `npm run build` écrit tout dans `dist/`.

```bash
npm run build      # prépare la base si besoin, puis génère dist/
```

Sur Vercel, `vercel.json` déclare déjà la commande et le dossier de sortie.
Comme `data/store.json` est exclu du dépôt, la base est recréée à chaque build
à partir du catalogue et du contenu versionnés. Deux variables d'environnement
sont utiles :

| Variable | Effet |
| --- | --- |
| `SITE_URL` | Adresse publique utilisée pour les URL canoniques, Open Graph et le sitemap. À défaut, le domaine Vercel est repris. |
| `ADMIN_PASSWORD` | Mot de passe du compte `admin` créé au build. Sans elle, un mot de passe aléatoire est généré et affiché dans le journal de build. |

**Ce qui est déployé et ce qui ne l'est pas.** Vercel sert la boutique, pas le
back-office. Celui-ci a besoin d'écrire dans `data/store.json` et de relancer la
génération, ce qu'un hébergement statique ne permet pas : le système de fichiers
y est en lecture seule. Le back-office reste donc local, sur
`node server.js`. Les modifications faites en local sont reportées en ligne en
poussant le dépôt, ce qui déclenche un nouveau build.

## Contenu généré

| Type | Nombre | URL |
| --- | --- | --- |
| Accueil | 1 | `/` |
| Produits | 19 | `/products/<handle>` |
| Collections | 6 | `/collections/<handle>` |
| Pages | 4 | `/pages/notre-histoire`, `/pages/livraison-et-retours`, `/pages/contact`, `/pages/store-locator` |
| Politiques | 8 | `/policies/<handle>` |
| Recherche | 1 | `/search` |
| Erreur | 1 | `/404.html` |

Sont également produits : `sitemap.xml` daté et hiérarchisé, `robots.txt`,
`site.webmanifest`, `favicon.ico`, et un dictionnaire de traduction par langue
dans `/assets/i18n/`.

Chaque page porte un titre et une description sous les limites d'affichage des
moteurs, une URL canonique, les balises Open Graph et Twitter en adresses
absolues, et le jeu d'icônes. Les données structurées couvrent l'organisation
et la recherche interne sur l'accueil, le fil d'Ariane partout, la fiche
produit avec son état de stock, et la FAQ de la page livraison.

## Direction artistique

Deux familles pour tout le projet, boutique et back-office compris : Fraunces
pour les titres, Jost pour les textes. Aucune troisième police n'est chargée
nulle part, pas même en monospace. Fond os chaud plutôt que blanc
pur, encre brun-noir, sable et argile, accent minéral vert-bleu repris du
packaging, or discret pour les surtitres. Photographies en pleine largeur,
coins arrondis, filets fins, pas d'ombres lourdes.

L'accueil se lit comme un magazine : visuel plein écran, bandeau de
réassurance, deux portes d'entrée visage et corps, sélection produits,
récit de la source, trois repères chiffrés sur fond encre, rituel en trois
gestes, bandeau défilant, citation, presse, boutique et engagements.

## Le back-office pilote le site

`data/store.json` est la source unique. Les pages de `/dist` en sont une
projection : produits, textes, images, vidéos et avis viennent tous de là.

Toute modification qui touche la boutique — produit, contenu, réglages —
déclenche la régénération des pages dans la foulée, en environ une demi-seconde.
Ce qui est enregistré est donc immédiatement en ligne. L'indicateur « Site à
jour » du bandeau supérieur affiche l'heure de la dernière publication, et le
bouton **Republier** force une régénération complète si besoin.

Dans **Contenu du site**, chaque bloc correspond à une section : titres,
bandeau d'annonces, bannière, cartes Visage et Corps, marque en bref, vidéos
verticales, grande vidéo, avis, rituel, chiffres, citation, engagements,
garanties, menu, boutique, newsletter et FAQ. Les listes se complètent et se
vident ligne par ligne.

Dans **Gestion des stocks**, la fiche produit permet de changer le nom, la
référence, le prix, le prix barré, le prix d'achat, le stock, le seuil, la
catégorie, le fournisseur, l'emplacement, le résumé, la visibilité, les images
et chaque section de description.

### Les trois états d'un produit

Un produit est **En stock**, **En arrivage** ou **Épuisé**. L'état se déduit et
ne se saisit pas :

| Stock | Statut | État en boutique |
| --- | --- | --- |
| au-dessus de zéro | n'importe lequel | En stock |
| zéro | Arrêté | Épuisé |
| zéro | tout autre statut | En arrivage |

Un article sans stock est donc annoncé comme à venir, ce qui est le cas
courant ; seul « Arrêté » le déclare épuisé, puisque celui-là ne reviendra pas.

Le même vocabulaire sert partout : la colonne État du tableau de stocks, le
filtre en pastilles des pages collection (Tous, Disponibles, En arrivage), la
phrase sous le prix de la fiche produit, le bouton d'achat, et la disponibilité
déclarée aux moteurs de recherche.

Deux réglages complètent la fiche :

- **Vignette** affichée en haut à gauche de la carte produit. Elle s'active ou
  se désactive, son texte est libre, et elle sort pour un seul des trois
  états : En stock, Épuisé ou En arrivage. Trois apparences : fond sombre, fond
  clair, vert minéral. Sans vignette active, une étiquette « Promotion »
  apparaît si un prix barré est renseigné.
- **Statut du produit** : Automatique, En réapprovisionnement, Bientôt
  disponible, Nouveauté ou Arrêté. Il s'affiche sous l'état dans le tableau et
  sert de filtre. Seul « Arrêté » change quelque chose en boutique.

La colonne **Visible** du tableau porte un interrupteur : un clic retire le
produit du site ou l'y remet, sans ouvrir la fiche. La ligne passe en grisé
quand le produit est masqué. Un produit masqué disparaît des collections, de la
recherche et de la page d'accueil, et sa page n'est plus générée. L'export CSV
reprend le statut interne et la visibilité.

### Vidéos

Déposez vos fichiers dans `src/media/`, ils sont servis sous `/media/`. La
bande verticale accueille quinze emplacements qui défilent en continu de droite
à gauche, en pause au survol ; la grande vidéo paysage est placée au milieu de
la page. Sans fichier, l'affiche est montrée à la place. Voir
`src/media/README.md`.

## Back-office

Accessible sur `/admin` après connexion. Session par cookie signé, valable
douze heures, mots de passe hachés en scrypt, et blocage temporaire après huit
tentatives ratées. Toutes les données vivent dans `data/store.json`.

**Tableau de bord** — chiffre d'affaires, panier moyen, valeur d'inventaire,
commandes à préparer, colis en transit, alertes de stock. Courbe du chiffre
d'affaires sur six mois, meilleures ventes, et journal des actions récentes.

**Gestion des stocks** — nom, référence, catégorie, prix de vente, prix
d'achat, marge, quantité, seuil d'alerte, valeur immobilisée, fournisseur et
emplacement en entrepôt. La quantité se règle à l'unité ou se saisit
directement. Recherche, filtres par catégorie et par état, tri sur chaque
colonne, création et suppression de produits, export CSV.

**Commandes** — référence automatique en `417-ANNÉE-NNNN`, client, articles,
totaux, paiement et statut. Le statut se change depuis la liste. Créer une
commande décrémente le stock, l'annuler le recrédite. Fiche détaillée avec les
lignes, l'adresse et l'expédition liée.

**Messages** — ce que la boutique reçoit : envois du formulaire de contact et
inscriptions à la newsletter. Recherche, filtre par formulaire et par statut,
export CSV. Ouvrir un message le marque comme lu ; il passe ensuite en Traité
ou en Archivé. Le bouton **Répondre par e-mail** ouvre le client de messagerie
avec l'objet déjà rempli. Le compteur du menu indique les messages non lus.

**Clients** — fiche complète avec coordonnées, adresse de livraison et notes
internes, plus le nombre de commandes et le total dépensé. Un client rattaché à
une commande ne peut pas être supprimé par mégarde.

**Livraisons** — transporteur, numéro de suivi cliquable vers le site du
transporteur, poids et statut. Les portails Colissimo, Chronopost, Mondial
Relay, DHL et UPS sont accessibles depuis la page pour créer l'étiquette
d'affranchissement, dont le numéro se reporte ensuite dans la fiche.

**Bordereau de livraison** — généré sur `/admin/bordereau/<commande>` :
en-tête de la société, expéditeur, destinataire, lignes détaillées, totaux avec
TVA, bloc transport et zones de signature. Impression ou enregistrement en PDF
depuis le navigateur.

**Réglages** — informations légales de la boutique reprises sur les bordereaux,
seuil de livraison offerte, seuil d'alerte de stock, taux de TVA, changement de
mot de passe et suppression des données de démonstration.

## Organisation

```
api/             Fonctions servies par Vercel
  contact.js       Formulaires de la boutique en ligne, relayés par e-mail
lib/             Socle du back-office
  store.js         Base JSON, écritures atomiques
  auth.js          Hachage scrypt, sessions signées, anti-force brute
  supabase.js      Supabase Auth : configuration, vérification des sessions
  env.js           Lecture de .env.local, sans dépendance
  admin-api.js     Règles métier, statistiques, bordereau de livraison
src/admin/       Interface du back-office (connexion, tableau de bord)
data/            Données extraites de la boutique Shopify d'origine
  store.json       Base du back-office : compte, stocks, clients, commandes
  products.json    Catalogue complet (titres, prix, variantes, images)
  collections.json Collections et leurs descriptions
  collection-*.json Appartenance des produits à chaque collection
  policies/*.html  Textes légaux
  site.json        Navigation, contenu de l'accueil, coordonnées
  image-map.json   Correspondance URL Shopify → fichier local
scripts/
  fetch-images.py    Télécharge les 126 images utilisées par le site
  seed-store.js      Crée la base du back-office et le compte admin
  reset-password.js  Réinitialise un mot de passe
  check.js           Vérifie chaque lien interne et chaque image
src/assets/      Feuille de style, script front-end, images locales
build.js         Générateur : data + templates → dist
server.js        Serveur local : boutique statique, API et back-office
dist/            Site généré (régénéré à chaque build)
```

## Fonctionnalités front-end

**Navigation et achat**

- Bandeau d'annonces rotatif, en-tête transparent sur l'accueil, opaque et
  flouté au défilement, masqué quand on descend, révélé quand on remonte.
- Panier persistant (`localStorage`) : tiroir latéral, quantités, jauge de
  livraison offerte à 100 €, confirmation visuelle sur le bouton.
- Recherche instantanée en tiroir et sur `/search`, raccourci clavier « / ».
- Barre d'achat fixe sur mobile, apparaissant dès que le bouton principal sort
  de l'écran.
- Filtres en pastilles et tri par prix ou par nom sur les collections, barre
  d'outils collante.
- Sélecteur de langue, de pays et de devise, mémorisé localement.

**Produit**

- Galerie à vignettes alignées sur l'image principale, colonne collante au
  défilement, survol pour prévisualiser.
- Visionneuse plein écran : clic sur l'image, flèches du clavier, compteur.
- Accordéons de description, carrousel de produits liés.

**Animations**

- Défilement fluide à la molette : la position réelle de la page est animée par
  interpolation, ce qui préserve les éléments collants et fixes. Un garde-fou
  repasse au défilement natif si l'environnement ne produit pas d'images.
- Parallaxe sur le visuel d'accueil, jauge de progression de lecture en haut.
- Visuel d'accueil : zoom lent de seize secondes, titre révélé ligne par ligne
  derrière un masque, indicateur de défilement animé.
- Apparition en cascade des sections et des cartes au défilement.
- Fondu des images au chargement, bandeaux défilants en pause au survol,
  boutons à remplissage progressif, bouton de retour en haut.
- Tout le mouvement est désactivé si le système demande une réduction des
  animations (`prefers-reduced-motion`).

**Accessibilité**

Focus visible sur tous les éléments interactifs, focus piégé et restitué dans
les tiroirs, fermeture à la touche « Échap », libellés masqués pour les lecteurs
d'écran, lien d'évitement vers le contenu.

## Langue et devise

À la première visite, le site choisit seul ce qu'il présente. Il lit la
configuration du navigateur — jamais l'adresse IP, aucun service tiers n'est
appelé :

1. le pays vient de la langue régionalisée du navigateur (`fr-BE`, `en-GB`),
   sinon du fuseau horaire ;
2. la langue est la première des langues du navigateur que le site sait
   parler, sinon celle du pays trouvé ;
3. la devise est celle du pays.

Le tiroir « Région et devise » affiche ce qui a été retenu et permet d'en
changer. Choisir un pays entraîne la langue qui s'y parle, jusqu'à ce que le
visiteur désigne lui-même la sienne : à partir de là, changer de pays ne touche
plus que la devise. Le choix est retenu dans le navigateur.

**Devises.** Les taux vivent dans `data/site.json`, sous `currencies`, avec la
date de leur dernier relevé dans `ratesUpdatedAt`. Ce sont des conversions
d'affichage : la commande reste facturée en euros, et le tiroir le dit. En
euros, les prix gardent la typographie du site ; dans une autre devise, c'est
le format du pays qui s'applique.

**Traductions.** `data/i18n.json` associe une chaîne française rendue dans la
page à sa traduction. Le générateur en fait un fichier par langue, chargé
seulement si le visiteur n'est pas en français. Les libellés qui portent un nom
de produit ou un nombre passent par `_patterns`, une liste d'expressions
régulières. Une chaîne absente reste en français : il n'y a pas de page à
moitié traduite, seulement des morceaux non encore couverts.

Les textes éditoriaux et les fiches produit vivent dans `data/store.json` et ne
sont pas traduits. Pour les traduire, il suffit d'ajouter leurs chaînes dans
`data/i18n.json`.

## Mesure d'audience et cookies

Aucun script de mesure n'est chargé par la page. Il n'arrive qu'après un accord
donné dans la bannière, et l'accord est redemandé au bout de six mois. Le lien
« Gestion des cookies » du pied de page rouvre la bannière à tout moment, et
`/policies/cookie-policy` détaille ce qui est conservé.

Le fournisseur se règle dans `data/site.json`, sous `analytics` :

| `provider` | Ce qu'il faut dans `id` |
| --- | --- |
| `none` | rien ; aucune bannière n'apparaît, il n'y a rien à consentir |
| `vercel` | rien ; le script vient de l'hébergeur une fois Web Analytics activé sur le projet |
| `plausible` | le domaine déclaré chez Plausible |
| `ga4` | l'identifiant de mesure `G-…` |

## Formulaires

La newsletter et la page Contact postent leur contenu en JSON à l'adresse
indiquée dans `data/site.json`, sous `forms.endpoint`. Par défaut c'est
`/api/contact`, la route du serveur local : l'envoi atterrit dans la rubrique
**Messages** du back-office.

**La même adresse répond aux deux endroits, différemment.** En local,
`server.js` traite la route et range le message dans la rubrique Messages. En
ligne, c'est `api/contact.js`, une fonction Vercel, qui la traite et relaie le
message par e-mail : le système de fichiers y est en lecture seule, il n'y a
donc rien à ranger.

C'est la seule route ouverte sans session — c'est le visiteur qui écrit, il n'a
pas de compte. Les deux chemins appliquent les mêmes règles : en-tête
`X-Requested-With` exigé, ce qui écarte les envois venus d'un formulaire
hébergé ailleurs ; champ piège invisible qui fait taire les robots ; adresse
e-mail vérifiée ; champs coupés à une longueur raisonnable ; cinq envois par
adresse IP toutes les dix minutes. En local s'ajoute une protection contre le
double envoi. Le texte reçu est rangé tel quel et affiché comme du texte,
jamais interprété.

Si `forms.endpoint` est vide, **rien n'est envoyé** : le formulaire le dit et
renvoie vers l'adresse e-mail de la boutique plutôt que d'afficher une
confirmation qui n'en serait pas une. Il en va de même si la clé Resend
manque : la fonction répond une erreur franche, jamais un faux succès.

### Mettre l'envoi en ligne en service

Resend n'accepte d'envoyer que depuis un domaine que vous possédez et dont vous
pouvez modifier les DNS.

```bash
vercel integration add resend/resend-email --plan free \
  -m domain=417france.com -m region=eu-west-1
```

Resend donne ensuite des enregistrements SPF et DKIM à poser sur le domaine.
Tant qu'ils ne sont pas vérifiés, l'envoi est refusé.

| Variable | Rôle |
| --- | --- |
| `RESEND_API_KEY` | Posée par la commande ci-dessus. Sans elle, la fonction répond 503 et la boutique affiche son adresse de repli. |
| `CONTACT_TO` | Destinataire. À défaut, `contact@417france.com`. |
| `CONTACT_FROM` | Expéditeur. **Doit être sur le domaine vérifié.** À défaut, `Formulaire 417 France <contact@417france.com>`. |

```bash
vercel env add CONTACT_TO production
vercel env add CONTACT_FROM production
```

Le courriel part en texte simple, avec le nom, l'adresse, le téléphone et le
message. Son champ `reply_to` porte l'adresse du visiteur : répondre depuis la
messagerie lui écrit directement.

**La rubrique Messages du back-office ne se remplit qu'en local.** En ligne les
messages arrivent dans la boîte mail, pas dans `data/store.json`.

## Espace client

L'icône en forme de personne de l'en-tête, entre la recherche et le panier,
mène à `/pages/compte`. Les comptes sont gérés par **Supabase Auth** : le site
ne stocke aucun mot de passe client. Le visiteur peut :

- continuer avec **Google** ;
- créer un compte avec son nom, son e-mail et un mot de passe de huit
  caractères au moins, puis confirmer son adresse par le lien reçu ;
- se connecter, se déconnecter, et recevoir un lien **Mot de passe oublié**
  qui le ramène sur la page pour en choisir un nouveau.

La page est exclue du plan de site et marquée `noindex`. Le client Supabase
(`@supabase/supabase-js` depuis jsDelivr) n'est chargé que sur elle et sur la
connexion du back-office. Sans configuration, la page annonce que l'espace
client n'est pas encore ouvert.

### Configuration

Tout se règle dans `.env.local`, non versionné ; `.env.example` en est le
modèle. `build.js` et `server.js` le lisent au démarrage, sans dépendance.

| Variable | Rôle |
| --- | --- |
| `SUPABASE_URL` | Adresse du projet, `https://<ref>.supabase.co`. |
| `SUPABASE_PUBLISHABLE_KEY` | Clé publique (`sb_publishable_…` ou ancienne clé `anon`). Jamais la clé secrète. `SUPABASE_ANON_KEY` est aussi lue. |
| `ADMIN_EMAILS` | Adresses qui ouvrent le back-office, séparées par des virgules. Par défaut `contact@417france.com`. |

La configuration est écrite dans la page au moment du build : **en ligne, les
mêmes variables doivent être déclarées dans Vercel**, puis le site redéployé.

Côté Supabase, trois réglages, rappelés en fin de `.env.local` :

1. **Authentication → URL Configuration** : Site URL de production, et dans
   Redirect URLs `http://localhost:4170/**` et l'adresse en ligne suivie de `/**`.
2. **Providers → Email** : activé, avec **Confirm email**. C'est lui qui
   garantit que l'adresse de la boutique appartient bien à la boutique.
3. **Providers → Google** : Client ID et Client Secret créés dans Google Cloud
   Console, avec `https://<ref>.supabase.co/auth/v1/callback` comme URI de
   redirection autorisée.

### Connexion au back-office

Trois chemins mènent à `/admin`, tous en local :

- **Depuis l'espace client**, avec `contact@417france.com` : e-mail et mot de
  passe Supabase, ou Google si l'adresse est un compte Google Workspace. La
  page présente son jeton à `/api/admin-session` ; le serveur le fait vérifier
  par Supabase, exige une adresse confirmée et présente dans `ADMIN_EMAILS`,
  puis ouvre la session du back-office.
- **Depuis `/admin/login`**, bouton Google ou e-mail et mot de passe Supabase,
  par la même vérification.
- **Depuis `/admin/login`**, identifiant `admin` ou `contact@417france.com` avec
  le mot de passe local de `data/store.json`. Il reste le recours si Supabase
  est injoignable.

Pour créer le compte Supabase de la boutique : dans l'espace client, onglet
**Créer un compte** avec `contact@417france.com`, puis cliquer le lien de
confirmation reçu dans cette boîte.

En ligne, le back-office n'étant pas déployé, l'adresse de la boutique se
connecte comme un client et la page explique où ouvrir le back-office.

## Icônes

`node scripts/make-icons.js` dessine le jeu complet dans `src/assets/icons` :
favicon vectoriel, `favicon.ico` à deux tailles, icône iOS et icônes 192 et 512
pour le manifeste. Tout est calculé, sans dépendance ni fichier source à
maintenir : la figure et les couleurs sont dans le script.

## Écarts assumés par rapport au site d'origine

Le site Shopify sert de référence pour la structure, les textes et les visuels.
Quatre écarts sont volontaires :

1. **Fautes corrigées** dans les fiches produits : `incroyabelement`,
   `résulats`, `RESENTEZ`, `rafraichie`, `fraicheur`, `envoutant`,
   `Descriptio n`, ainsi qu'une phrase amputée sur l'huile de jojoba.
2. **Titres corrigés** : « Crème Infusion Minérale Contour des Yeux » (au lieu
   de *Minèrale*) et « Lotion Visage Hydratante & Équilibrante ». Les crèmes
   mains adoptent les noms français déjà utilisés pour les beurres corporels
   (Kiwi & Mangue, Lait & Miel).
3. **Doublon supprimé** dans « Nos produits du moment » : la variante Ocean
   apparaissait deux fois, remplacée par la variante Matcha.
4. **Collection renommée** : le handle `produit-pour-le-visage` contient en
   réalité les soins du corps ; elle s'intitule ici « Produits pour le corps ».

Le paiement et le géolocalisateur de boutiques sont des
maquettes fonctionnelles : il n'y a pas de back-office derrière.

Les textes légaux repris de Shopify décrivent encore Shopify comme hébergeur et
sous-traitant. Ils ne correspondent plus à l'installation et demandent une
relecture juridique.

## Mettre à jour les données

```bash
curl "https://417france.com/products.json?limit=250" -o data/products.json
python scripts/fetch-images.py
node build.js
node scripts/check.js
```
# 417fr

