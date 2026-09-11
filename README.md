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

L'aperçu mobile charge le site dans un cadre de téléphone à la largeur réelle de
l'appareil choisi : huit modèles d'iPhone, Android et iPad, rotation paysage,
mise à l'échelle automatique et sélecteur de page alimenté par le sitemap.

L'initialisation affiche l'identifiant et un mot de passe aléatoire. Seule son
empreinte est stockée. Pour le changer :

```bash
node scripts/reset-password.js <nouveau mot de passe>
```

## Contenu généré

| Type | Nombre | URL |
| --- | --- | --- |
| Accueil | 1 | `/` |
| Produits | 19 | `/products/<handle>` |
| Collections | 6 | `/collections/<handle>` |
| Pages | 4 | `/pages/notre-histoire`, `/pages/livraison-et-retours`, `/pages/contact`, `/pages/store-locator` |
| Politiques | 7 | `/policies/<handle>` |
| Recherche | 1 | `/search` |
| Erreur | 1 | `/404.html` |

Un `sitemap.xml` et un `robots.txt` sont également produits.

## Direction artistique

Fraunces pour les titres, Jost pour les textes. Fond os chaud plutôt que blanc
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

Deux réglages complètent la fiche :

- **Vignette** affichée en haut à gauche de la carte produit. Elle s'active ou
  se désactive, son texte est libre, et elle s'affiche seulement en rupture,
  seulement en stock, ou dans tous les cas. Trois apparences : fond sombre,
  fond clair, vert minéral. Sans vignette active, une étiquette « Promotion »
  apparaît si un prix barré est renseigné.
- **Statut interne** : Automatique, En réapprovisionnement, Bientôt disponible,
  Nouveauté ou Arrêté. Il s'affiche dans la colonne État du tableau et sert de
  filtre, sans rien changer sur la boutique.

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
lib/             Socle du back-office
  store.js         Base JSON, écritures atomiques
  auth.js          Hachage scrypt, sessions signées, anti-force brute
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
- Sélecteur de région et de devise (10 pays), mémorisé localement.

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

Le paiement, les comptes clients et le géolocalisateur de boutiques sont des
maquettes fonctionnelles : il n'y a pas de back-office derrière.

## Mettre à jour les données

```bash
curl "https://417france.com/products.json?limit=250" -o data/products.json
python scripts/fetch-images.py
node build.js
node scripts/check.js
```
#   4 1 7 f r  
 