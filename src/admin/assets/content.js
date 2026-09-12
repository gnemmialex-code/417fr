/* =============================================================================
   Back-office 417 France - éditeur de contenu du site
   Chargé après admin.js, il complète l'interface via window.ADMIN.
   ========================================================================== */
(function () {
  'use strict';

  var api = window.ADMIN;
  if (!api) return;

  var $ = api.$;
  var $$ = api.$$;
  var esc = api.esc;

  /* ---------- Description des sections éditables ---------- */

  var F = function (name, label, type, help) {
    return { name: name, label: label, type: type || 'text', help: help };
  };

  var SCHEMA = [
    {
      key: 'titles', title: 'Titres des sections', icon: 'Aa',
      help: 'Les intitulés affichés au-dessus de chaque bloc de la page d’accueil.',
      fields: [
        F('bestsellersTitle', 'Sélection — titre'), F('bestsellersLede', 'Sélection — accroche'),
        F('productsStripTitle', 'Ruban des soins — titre'),
        F('newTitle', 'Catalogue — titre'), F('newLede', 'Catalogue — accroche'),
        F('videosTitle', 'Vidéos — titre'), F('videosLede', 'Vidéos — accroche'),
        F('reviewsTitle', 'Avis — titre'), F('reviewsLede', 'Avis — accroche'),
        F('ritualTitle', 'Rituel — titre'), F('ritualSub', 'Rituel — accroche'),
        F('pressTitle', 'Presse — titre')
      ]
    },
    {
      key: 'announcements', title: 'Bandeau d’annonces', list: true,
      help: 'Messages qui défilent tout en haut du site.'
    },
    {
      key: 'hero', title: 'Bannière d’accueil',
      fields: [
        F('eyebrow', 'Surtitre'),
        F('titleTop', 'Titre — ligne 1'),
        F('titleBottom', 'Titre — ligne 2 (italique)'),
        F('text', 'Texte', 'textarea'),
        F('image', 'Image de fond', 'image'),
        F('primary.label', 'Bouton principal — libellé'),
        F('primary.url', 'Bouton principal — lien'),
        F('secondary.label', 'Bouton secondaire — libellé'),
        F('secondary.url', 'Bouton secondaire — lien'),
        F('phonePrimary.label', 'Téléphone — bouton 1'),
        F('phonePrimary.url', 'Téléphone — bouton 1, lien'),
        F('phoneSecondary.label', 'Téléphone — bouton 2'),
        F('phoneSecondary.url', 'Téléphone — bouton 2, lien')
      ]
    },
    {
      key: 'categories', title: 'Cartes Visage et Corps', items: true,
      item: [F('eyebrow', 'Surtitre'), F('title', 'Titre'), F('text', 'Texte', 'textarea'),
        F('cta', 'Libellé du lien'), F('url', 'Lien'), F('image', 'Image', 'image')],
      blank: { eyebrow: '', title: '', text: '', cta: 'Découvrir', url: '/collections/all', image: '' }
    },
    {
      key: 'about', title: 'La marque en bref',
      fields: [F('eyebrow', 'Surtitre'), F('title', 'Titre'), F('text', 'Texte', 'textarea'),
        F('cta', 'Libellé du lien'), F('url', 'Lien')]
    },
    {
      key: 'about.points', title: 'Les trois points de la marque', items: true,
      item: [F('title', 'Intitulé'), F('text', 'Texte', 'textarea')],
      blank: { title: '', text: '' }
    },
    {
      key: 'videos', title: 'Vidéos verticales', items: true,
      help: 'La bande défile en continu de droite à gauche. Déposez vos fichiers dans '
        + 'src/media/ puis indiquez /media/nom-du-fichier.mp4. Sans fichier, l’affiche est montrée.',
      item: [F('label', 'Légende'), F('poster', 'Affiche (image)', 'image'),
        F('src', 'Fichier vidéo', 'text', 'Exemple : /media/rituel-01.mp4'), F('url', 'Lien au clic')],
      blank: { label: 'Nouvelle vidéo', poster: '', src: '', url: '/collections/all' }
    },
    {
      key: 'feature', title: 'Grande vidéo paysage',
      help: 'Format 16/9, placée au milieu de la page d’accueil.',
      fields: [F('eyebrow', 'Surtitre'), F('title', 'Titre'), F('text', 'Texte', 'textarea'),
        F('poster', 'Affiche (image)', 'image'),
        F('src', 'Fichier vidéo', 'text', 'Exemple : /media/film-417.mp4'),
        F('cta', 'Libellé du bouton'), F('url', 'Lien du bouton')]
    },
    {
      key: 'reviews', title: 'Avis clients', items: true,
      help: 'Les avis fournis sont des exemples. Remplacez-les par vos avis réels avant la mise en ligne.',
      item: [F('name', 'Prénom et initiale'), F('city', 'Ville'), F('rating', 'Note sur 5', 'number'),
        F('product', 'Produit concerné'), F('text', 'Avis', 'textarea')],
      blank: { name: '', city: '', rating: 5, product: '', text: '' }
    },
    {
      key: 'ritual', title: 'Le rituel en trois gestes', items: true,
      item: [F('step', 'Numéro'), F('title', 'Titre'), F('text', 'Texte', 'textarea'),
        F('image', 'Image', 'image'), F('url', 'Lien')],
      blank: { step: '04', title: '', text: '', image: '', url: '' }
    },
    {
      key: 'facts', title: 'Les chiffres clés', items: true,
      item: [F('value', 'Valeur affichée'), F('label', 'Libellé'), F('text', 'Texte', 'textarea')],
      blank: { value: '', label: '', text: '' }
    },
    {
      key: 'band', title: 'Bandeau 417 (téléphone)',
      help: 'Grande image avec une phrase, sous les meilleures ventes.',
      fields: [F('title', 'Phrase'), F('image', 'Image', 'image')]
    },
    {
      key: 'storyTeaser', title: 'Bloc « Notre source »',
      fields: [F('eyebrow', 'Surtitre'), F('title', 'Titre'), F('text', 'Texte', 'textarea'),
        F('cta', 'Libellé du lien'), F('url', 'Lien'), F('image', 'Image', 'image')]
    },
    {
      key: 'quote', title: 'Citation',
      fields: [F('text', 'Citation', 'textarea'), F('author', 'Signature')]
    },
    {
      key: 'commitments', title: 'Engagements (pastilles)', list: true
    },
    {
      key: 'reassurance', title: 'Bandeau de garanties', items: true,
      item: [F('title', 'Intitulé'), F('text', 'Précision')],
      blank: { title: '', text: '' }
    },
    {
      key: 'menu', title: 'Menu principal', items: true,
      item: [F('label', 'Libellé'), F('url', 'Lien')],
      blank: { label: '', url: '/' }
    },
    {
      key: 'store', title: 'Boutique physique',
      fields: [F('eyebrow', 'Surtitre'), F('name', 'Nom'), F('address', 'Adresse'),
        F('mapUrl', 'Lien vers la carte'), F('image', 'Image', 'image')]
    },
    {
      key: 'newsletter', title: 'Newsletter',
      fields: [F('title', 'Titre'), F('text', 'Texte', 'textarea')]
    },
    {
      key: 'faq', title: 'Questions fréquentes', items: true,
      item: [F('q', 'Question'), F('a', 'Réponse', 'textarea')],
      blank: { q: '', a: '' }
    }
  ];

  /* ---------- Accès par chemin pointé ---------- */

  function getPath(root, path) {
    return path.split('.').reduce(function (node, key) {
      return node == null ? undefined : node[key];
    }, root);
  }

  /* ---------- Rendu des champs ---------- */

  function fieldId(path) { return 'c-' + path.replace(/[^a-z0-9]/gi, '-'); }

  function renderField(path, def, value) {
    var id = fieldId(path);
    var v = value == null ? '' : value;
    var input;

    if (def.type === 'textarea') {
      input = '<textarea id="' + id + '" data-path="' + esc(path) + '">' + esc(v) + '</textarea>';
    } else if (def.type === 'number') {
      input = '<input id="' + id + '" type="number" min="0" max="5" step="1" data-path="' + esc(path) + '" value="' + esc(v) + '">';
    } else {
      input = '<input id="' + id + '" type="text" data-path="' + esc(path) + '" value="' + esc(v) + '">';
    }

    var media = def.type === 'image'
      ? '<div class="field-media">' + (v ? '<img src="' + esc(v) + '" alt="">' : '<span class="field-media__empty"></span>') + input + '</div>'
      : input;

    return '<div class="field"><label for="' + id + '">' + esc(def.label) + '</label>'
      + media
      + (def.help ? '<p class="field-hint">' + esc(def.help) + '</p>' : '')
      + '</div>';
  }

  function renderCard(section, content) {
    var body = '';

    if (section.list) {
      var list = getPath(content, section.key) || [];
      body = '<div class="repeat">' + list.map(function (value, i) {
        return '<div class="repeat__row repeat__row--inline">'
          + '<input type="text" data-item="' + i + '" value="' + esc(value) + '">'
          + '<button type="button" class="icon-btn" data-remove="' + i + '" aria-label="Supprimer">&times;</button>'
          + '</div>';
      }).join('') + '</div>'
        + '<button type="button" class="btn btn--ghost btn--sm" data-add>Ajouter une ligne</button>';

    } else if (section.items) {
      var items = getPath(content, section.key) || [];
      body = '<div class="repeat">' + items.map(function (item, i) {
        return '<div class="repeat__block">'
          + '<div class="repeat__head"><span>' + (i + 1) + '</span>'
          + '<button type="button" class="icon-btn" data-remove="' + i + '" aria-label="Supprimer">&times;</button></div>'
          + '<div class="grid-2">' + section.item.map(function (def) {
            return renderField(section.key + '.' + i + '.' + def.name, def, getPath(content, section.key + '.' + i + '.' + def.name));
          }).join('') + '</div></div>';
      }).join('') + '</div>'
        + '<button type="button" class="btn btn--ghost btn--sm" data-add>Ajouter un élément</button>';

    } else {
      var prefix = section.key === 'titles' ? '' : section.key + '.';
      body = '<div class="grid-2">' + section.fields.map(function (def) {
        var path = prefix + def.name;
        return renderField(path, def, getPath(content, path));
      }).join('') + '</div>';
    }

    return '<section class="card" data-section="' + esc(section.key) + '">'
      + '<div class="card__head"><h2>' + esc(section.title) + '</h2>'
      + '<button type="button" class="btn btn--sm" data-save>Enregistrer</button></div>'
      + (section.help ? '<p class="card__sub">' + esc(section.help) + '</p>' : '')
      + body
      + '</section>';
  }

  /* ---------- Vue ---------- */

  function view() {
    var content = api.state().content || {};
    return '<div class="view">'
      + '<section class="card card--notice">'
      + '<p>Chaque bloc ci-dessous correspond à une section du site. Enregistrez, '
      + 'puis cliquez sur <strong>Publier le site</strong> en haut à droite pour régénérer les pages.</p>'
      + '</section>'
      + SCHEMA.map(function (section) { return renderCard(section, content); }).join('')
      + '</div>';
  }

  function collect(card, section, content) {
    var values = {};

    if (section.list) {
      values[section.key] = $$('[data-item]', card).map(function (input) { return input.value; })
        .filter(function (v) { return v.trim(); });

    } else if (section.items) {
      var current = getPath(content, section.key) || [];
      values[section.key] = $$('.repeat__block', card).map(function (block, i) {
        var item = Object.assign({}, current[i] || {});
        $$('[data-path]', block).forEach(function (input) {
          var name = input.getAttribute('data-path').split('.').pop();
          var def = section.item.find(function (d) { return d.name === name; });
          item[name] = def && def.type === 'number' ? Number(input.value) || 0 : input.value;
        });
        return item;
      });

    } else {
      $$('[data-path]', card).forEach(function (input) {
        values[input.getAttribute('data-path')] = input.value;
      });
    }
    return values;
  }

  function bind() {
    var content = api.state().content || {};

    $$('[data-section]').forEach(function (card) {
      var key = card.getAttribute('data-section');
      var section = SCHEMA.find(function (s) { return s.key === key; });
      if (!section) return;

      var save = $('[data-save]', card);
      if (save) {
        save.addEventListener('click', function () {
          api.send('content/patch', { values: collect(card, section, content), label: section.title },
            section.title + ' enregistré.');
        });
      }

      var add = $('[data-add]', card);
      if (add) {
        add.addEventListener('click', function () {
          var current = (getPath(content, section.key) || []).slice();
          current.push(section.list ? '' : Object.assign({}, section.blank));
          var values = {};
          values[section.key] = current;
          api.send('content/patch', { values: values, label: section.title }, 'Élément ajouté.');
        });
      }

      $$('[data-remove]', card).forEach(function (button) {
        button.addEventListener('click', function () {
          var index = Number(button.getAttribute('data-remove'));
          var current = (getPath(content, section.key) || []).slice();
          current.splice(index, 1);
          var values = {};
          values[section.key] = current;
          api.send('content/patch', { values: values, label: section.title }, 'Élément supprimé.');
        });
      });
    });
  }

  api.registerPage('contenu', {
    title: 'Contenu du site',
    sub: 'Textes, images, vidéos et avis de la boutique',
    view: view,
    bind: bind
  });
})();
