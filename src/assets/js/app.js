/* =============================================================================
   417 France - comportements front-end
   Défilement fluide, animations, panier, tiroirs, galerie, visionneuse.
   ========================================================================== */
(function () {
  'use strict';

  var CART_KEY = '417france.cart';
  var CODE_KEY = '417france.code';
  var REGION_KEY = '417france.region';
  var ANNOUNCE_INTERVAL = 4200;
  var HERO_INTERVAL = 5200;
  var GALLERY_INTERVAL = 4200;
  var SLIDE_LEAVE = 900;
  var PHONE = '(max-width: 720px)';
  var SCROLL_EASE = 0.135;
  var PARALLAX = 0.08;

  var catalog = window.SITE_PRODUCTS || [];
  var config = window.SITE_CONFIG || { freeShippingThreshold: 100 };
  var discounts = window.SITE_DISCOUNTS || [];
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Utilitaires ---------- */

  function $(selector, scope) { return (scope || document).querySelector(selector); }
  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function readJson(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* ignoré */ }
  }

  /* ---------- Langue, pays et devise ---------- */

  /* Le site est écrit en français et facturé en euros. Ce module choisit tout
     seul, à la première visite, la langue et la devise à présenter : il lit la
     configuration du navigateur, jamais l'adresse IP, et ne contacte aucun
     service tiers. Le choix reste modifiable et se retient. */

  var localeSettings = window.SITE_LOCALE || {};
  var CURRENCIES = localeSettings.currencies || { EUR: { symbol: '€', rate: 1, locale: 'fr-FR' } };
  var COUNTRIES = localeSettings.countries || [];
  var BASE_CURRENCY = localeSettings.baseCurrency || 'EUR';
  var SOURCE_LOCALE = localeSettings.defaultLocale || 'fr';
  var LOCALES = [SOURCE_LOCALE].concat(localeSettings.translated || []);

  /* Fuseaux horaires des pays desservis. C'est le renseignement de position le
     plus fiable que donne un navigateur, et il ne coûte aucune requête. */
  var TIMEZONE_COUNTRIES = {
    'Europe/Paris': 'FR', 'Europe/Brussels': 'BE', 'Europe/Luxembourg': 'LU',
    'Europe/Zurich': 'CH', 'Europe/Busingen': 'DE', 'Europe/Berlin': 'DE',
    'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES', 'Europe/Rome': 'IT',
    'Europe/Lisbon': 'PT', 'Atlantic/Madeira': 'PT', 'Europe/London': 'GB',
    'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL'
  };

  function countryByCode(code) {
    if (!code) return null;
    for (var i = 0; i < COUNTRIES.length; i += 1) {
      if (COUNTRIES[i].code === code) return COUNTRIES[i];
    }
    return null;
  }

  function countryByName(name) {
    if (!name) return null;
    for (var i = 0; i < COUNTRIES.length; i += 1) {
      if (COUNTRIES[i].name === name) return COUNTRIES[i];
    }
    return null;
  }

  function browserLanguages() {
    var list = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ''];
    return Array.prototype.slice.call(list).filter(Boolean).map(String);
  }

  /* Le pays vient d'abord de la langue régionalisée du navigateur (fr-BE,
     en-GB), puis du fuseau horaire. Faute des deux, on ne devine pas. */
  function detectCountry() {
    var langs = browserLanguages();
    for (var i = 0; i < langs.length; i += 1) {
      var parts = langs[i].replace('_', '-').split('-');
      var area = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';
      if (area.length === 2 && countryByCode(area)) return countryByCode(area);
    }
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (TIMEZONE_COUNTRIES[zone]) return countryByCode(TIMEZONE_COUNTRIES[zone]);
    } catch (err) { /* Intl absent : on s'en passe */ }
    return null;
  }

  /* Première langue du navigateur que le site sait parler. */
  function detectLanguage() {
    var langs = browserLanguages();
    for (var i = 0; i < langs.length; i += 1) {
      var base = langs[i].slice(0, 2).toLowerCase();
      if (LOCALES.indexOf(base) !== -1) return base;
    }
    return '';
  }

  function detectRegion() {
    var country = detectCountry();
    var lang = detectLanguage() || (country && country.lang) || SOURCE_LOCALE;
    return {
      country: country ? country.name : (localeSettings.defaultCountry || ''),
      code: country ? country.code : '',
      currency: country && CURRENCIES[country.currency] ? country.currency : BASE_CURRENCY,
      lang: LOCALES.indexOf(lang) !== -1 ? lang : SOURCE_LOCALE,
      langChosen: false,
      auto: true
    };
  }

  /* Le choix enregistré prime sur la détection. Les visites d'avant ne
     retenaient qu'un nom de pays et une devise : on les complète. */
  function storedRegion() {
    var saved = readJson(REGION_KEY, null);
    if (!saved) return null;
    var name = saved.country || saved.name;
    var known = countryByName(name);
    return {
      country: known ? known.name : name,
      code: known ? known.code : (saved.code || ''),
      currency: CURRENCIES[saved.currency] ? saved.currency : BASE_CURRENCY,
      lang: LOCALES.indexOf(saved.lang) !== -1 ? saved.lang : ((known && known.lang) || SOURCE_LOCALE),
      langChosen: !!saved.langChosen,
      auto: false
    };
  }

  var region = storedRegion() || detectRegion();

  function currencyDef() {
    return CURRENCIES[region.currency] || CURRENCIES[BASE_CURRENCY]
      || { symbol: '€', rate: 1, locale: 'fr-FR' };
  }

  /* Un montant exprimé dans la devise de base, rendu dans celle du visiteur.
     En euros on garde la typographie du site, celle que le générateur a déjà
     écrite dans la page : le symbole devant, la virgule décimale. Dans une
     autre devise, c'est le format du pays qui fait foi. */
  function money(value) {
    var def = currencyDef();
    var code = CURRENCIES[region.currency] ? region.currency : BASE_CURRENCY;
    var amount = Number(value || 0) * (Number(def.rate) || 1);
    if (code === BASE_CURRENCY) return def.symbol + amount.toFixed(2).replace('.', ',');
    try {
      return new Intl.NumberFormat(def.locale, { style: 'currency', currency: code }).format(amount);
    } catch (err) {
      return def.symbol + ' ' + amount.toFixed(2).replace('.', ',');
    }
  }

  /* Les prix posés par le générateur portent leur montant en attribut : il
     suffit de les réécrire. Tant que le visiteur reste en euros, la page est
     déjà juste et on ne la touche pas. */
  var pricesRewritten = false;

  function refreshPrices(scope) {
    var base = region.currency === BASE_CURRENCY;
    if (base && !pricesRewritten) return;
    $$('[data-amount]', scope || document).forEach(function (el) {
      el.textContent = money(el.getAttribute('data-amount'));
    });
    pricesRewritten = !base;
  }

  /* ---------- Traductions ---------- */

  var TRANSLATED_ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
  var UNTRANSLATED_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1 };

  var dictionaries = {};
  var dictionary = {};
  var patterns = [];

  /* Un libellé qui contient un nom de produit ou un nombre ne peut pas tenir
     dans une table de correspondances : il passe par une expression, et les
     groupes capturés sont replacés dans la traduction. */
  function buildPatterns(data) {
    return (data._patterns || []).map(function (entry) {
      return { from: new RegExp(entry[0]), to: entry[1] };
    });
  }

  function tr(text) {
    var key = String(text);
    var value = dictionary[key];
    if (value !== undefined) return value;
    for (var i = 0; i < patterns.length; i += 1) {
      if (patterns[i].from.test(key)) return key.replace(patterns[i].from, patterns[i].to);
    }
    return text;
  }

  function loadDictionary(lang) {
    if (lang === SOURCE_LOCALE) {
      dictionary = {};
      patterns = [];
      return Promise.resolve();
    }
    if (dictionaries[lang]) {
      dictionary = dictionaries[lang];
      patterns = buildPatterns(dictionary);
      return Promise.resolve();
    }
    /* L'empreinte du dictionnaire est dans l'adresse : le navigateur peut le
       garder longtemps sans jamais servir une version perimee. */
    var stamp = localeSettings.version ? '?v=' + encodeURIComponent(localeSettings.version) : '';
    return fetch('/assets/i18n/' + encodeURIComponent(lang) + '.json' + stamp)
      .then(function (response) { return response.ok ? response.json() : {}; })
      .catch(function () { return {}; })
      .then(function (data) {
        dictionaries[lang] = data;
        dictionary = data;
        patterns = buildPatterns(data);
      });
  }

  /* Le texte français d'origine est gardé sur le nœud : revenir au français,
     ou changer de langue une deuxième fois, repart toujours de la source. */
  function translateTextNode(node) {
    if (node.i18nSource === undefined) node.i18nSource = node.nodeValue;
    var source = node.i18nSource;
    var key = source.trim();
    if (!key) return;
    var value = tr(key);
    if (value === key) {
      if (node.nodeValue !== source) node.nodeValue = source;
      return;
    }
    node.nodeValue = source.replace(key, function () { return value; });
  }

  function translateAttributes(el) {
    if (!el.i18nAttrs) {
      el.i18nAttrs = {};
      TRANSLATED_ATTRS.forEach(function (name) {
        if (el.hasAttribute(name)) el.i18nAttrs[name] = el.getAttribute(name);
      });
    }
    Object.keys(el.i18nAttrs).forEach(function (name) {
      var source = el.i18nAttrs[name];
      var translated = tr(source.trim());
      el.setAttribute(name, source.replace(source.trim(), function () { return translated; }));
    });
  }

  function translate(root) {
    var scope = root || document.body;
    if (!scope) return;
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) {
      var node = walker.currentNode;
      if (!node.parentNode || UNTRANSLATED_TAGS[node.parentNode.nodeName]) continue;
      nodes.push(node);
    }
    nodes.forEach(translateTextNode);
    $$('[aria-label],[placeholder],[title],[alt]', scope).forEach(translateAttributes);
  }

  /* Ce qui a été posé par du script plutôt que par le générateur : panier,
     résultats de recherche, compteurs. */
  var onLocaleChange = [];

  function localized(fragment) {
    if (needsTranslation()) translate(fragment);
    refreshPrices(fragment);
  }

  /* En français rien n'est remplacé : inutile de parcourir la page, sauf si
     une autre langue y est déjà passée et qu'il faut revenir à la source. */
  var translatedOnce = false;

  function needsTranslation() {
    return translatedOnce || region.lang !== SOURCE_LOCALE;
  }

  function applyLocale() {
    document.documentElement.lang = region.lang;
    return loadDictionary(region.lang).then(function () {
      if (needsTranslation()) {
        translate(document.body);
        translatedOnce = true;
      }
      refreshPrices();
      onLocaleChange.forEach(function (fn) { fn(); });
    });
  }

  /* Choisir un pays entraîne la langue qui s'y parle, tant que le visiteur
     n'a pas désigné la sienne. Une fois qu'il l'a fait, changer de pays ne
     change plus que la devise. */
  function setRegion(patch) {
    var chosen = patch.lang !== undefined;
    var lang = region.lang;
    if (chosen) lang = patch.lang;
    else if (patch.suggestedLang && !region.langChosen) lang = patch.suggestedLang;

    region = {
      country: patch.country !== undefined ? patch.country : region.country,
      code: patch.code !== undefined ? patch.code : region.code,
      currency: patch.currency !== undefined ? patch.currency : region.currency,
      lang: LOCALES.indexOf(lang) !== -1 ? lang : SOURCE_LOCALE,
      langChosen: region.langChosen || chosen,
      auto: false
    };
    writeJson(REGION_KEY, region);
    return applyLocale();
  }

  document.documentElement.style.setProperty(
    '--scrollbar-width',
    (window.innerWidth - document.documentElement.clientWidth) + 'px'
  );

  var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12.5l5 5L20 6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------- Boucle de défilement unique ---------- */

  var scrollTasks = [];
  var scrollTicking = false;

  function onScroll(task) { scrollTasks.push(task); }

  function runScrollTasks() {
    var y = window.scrollY;
    scrollTasks.forEach(function (task) { task(y); });
    scrollTicking = false;
  }

  window.addEventListener('scroll', function () {
    if (scrollTicking) return;
    scrollTicking = true;
    window.requestAnimationFrame(runScrollTasks);
  }, { passive: true });

  /* ---------- Défilement fluide à la molette ---------- */

  var smooth = null;

  function initSmoothScroll() {
    if (reduceMotion || !window.matchMedia('(pointer: fine)').matches) return;

    /* Le défilement doux du CSS entrerait en conflit avec notre boucle :
       on le désactive et c'est le JavaScript qui assure la fluidité. */
    document.documentElement.style.scrollBehavior = 'auto';

    var target = window.scrollY;
    var current = target;
    var running = false;

    function limit() {
      return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    }

    /* Laisse les conteneurs défilants (carrousels, tiroirs) gérer leur molette. */
    function insideScroller(node) {
      while (node && node !== document.body && node.nodeType === 1) {
        var style = window.getComputedStyle(node);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 2) return true;
        if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 2) return true;
        node = node.parentElement;
      }
      return false;
    }

    function step() {
      current += (target - current) * SCROLL_EASE;
      if (Math.abs(target - current) < 0.5) {
        current = target;
        running = false;
      }
      window.scrollTo(0, current);
      if (running) window.requestAnimationFrame(step);
    }

    function onWheel(event) {
      if (event.ctrlKey || event.defaultPrevented) return;
      if (document.body.classList.contains('is-locked')) return;
      if (insideScroller(event.target)) return;
      if (limit() <= 0) return;

      var factor = event.deltaMode === 1 ? 18 : (event.deltaMode === 2 ? window.innerHeight : 1);
      var before = window.scrollY;
      event.preventDefault();

      if (!running) current = window.scrollY;
      target = Math.max(0, Math.min(limit(), target + event.deltaY * factor));
      if (!running) {
        running = true;
        window.requestAnimationFrame(step);
      }
      watch(before);
    }

    /* Garde-fou : si la boucle d'animation ne tourne pas (environnement sans
       rendu), on repasse au défilement natif plutôt que de bloquer la page. */
    var watchdog = null;
    function watch(before) {
      if (watchdog) return;
      watchdog = window.setTimeout(function () {
        watchdog = null;
        if (Math.abs(window.scrollY - before) < 1 && Math.abs(target - before) > 4) {
          window.removeEventListener('wheel', onWheel, { passive: false });
          smooth = null;
          window.scrollTo(0, target);
          document.documentElement.style.scrollBehavior = '';
        }
      }, 320);
    }

    window.addEventListener('wheel', onWheel, { passive: false });

    /* Défilement clavier, ancres : on resynchronise la cible. */
    onScroll(function (y) { if (!running) target = y; });
    window.addEventListener('resize', function () { target = window.scrollY; });

    smooth = {
      to: function (value) {
        if (!running) current = window.scrollY;
        target = Math.max(0, Math.min(limit(), value));
        if (!running) {
          running = true;
          window.requestAnimationFrame(step);
        }
      }
    };
  }

  /* ---------- Barre de progression ---------- */

  function initProgress() {
    var bar = $('[data-progress]');
    if (!bar) return;
    function update(y) {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
    }
    onScroll(update);
    window.addEventListener('resize', function () { update(window.scrollY); });
    update(window.scrollY);
  }

  /* ---------- Apparition au défilement ---------- */

  function initReveal() {
    var items = $$('[data-reveal]');
    if (!items.length) return;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });

    items.forEach(function (el) {
      var delay = el.getAttribute('data-reveal-delay');
      if (delay) el.style.setProperty('--reveal-delay', delay + 'ms');
      observer.observe(el);
    });
  }

  /* ---------- Fondu des images ---------- */

  function initImageFade() {
    $$('img.img-fade').forEach(function (image) {
      if (image.complete && image.naturalWidth > 0) {
        image.classList.add('is-loaded');
        return;
      }
      image.addEventListener('load', function () { image.classList.add('is-loaded'); });
      image.addEventListener('error', function () { image.classList.add('is-loaded'); });
    });
  }

  /* ---------- En-tête ---------- */

  function initHeader() {
    var header = $('.header');
    if (!header) return;
    var lastY = window.scrollY;

    function update(y) {
      var threshold = document.body.classList.contains('has-hero') ? 56 : 8;
      header.classList.toggle('is-solid', y > threshold);
      var drawerOpen = document.body.classList.contains('is-locked');
      header.classList.toggle('is-hidden', y > lastY && y > 240 && !drawerOpen);
      lastY = y;
    }

    onScroll(update);
    update(window.scrollY);
  }

  /* ---------- Parallaxe du hero ---------- */

  function initHeroParallax() {
    var slides = $('[data-hero-media]');
    if (!slides || reduceMotion) return;
    onScroll(function (y) {
      if (y > window.innerHeight * 1.2) return;
      slides.style.setProperty('--hero-shift', (y * PARALLAX).toFixed(1) + 'px');
    });
  }

  /* ---------- Bandeau d'annonce ---------- */

  function initAnnounce() {
    var items = $$('[data-announce-item]');
    if (items.length < 2 || reduceMotion) return;
    var index = 0;
    window.setInterval(function () {
      items[index].classList.remove('is-active');
      index = (index + 1) % items.length;
      items[index].classList.add('is-active');
    }, ANNOUNCE_INTERVAL);
  }

  /* ---------- Tiroirs ---------- */

  var overlay = $('[data-overlay]');
  var lastFocused = null;

  function closeAllDrawers() {
    var wasOpen = $$('.drawer.is-open').length > 0;
    $$('.drawer').forEach(function (d) { d.classList.remove('is-open'); });
    if (overlay) overlay.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    if (wasOpen && lastFocused) {
      lastFocused.focus();
      lastFocused = null;
    }
  }

  function openDrawer(name, opener) {
    var drawer = $('[data-drawer="' + name + '"]');
    if (!drawer) return;
    closeAllDrawers();
    lastFocused = opener || null;
    drawer.classList.add('is-open');
    if (overlay) overlay.classList.add('is-open');
    document.body.classList.add('is-locked');
    var focusable = drawer.querySelector('input, button, a[href]');
    if (focusable) window.setTimeout(function () { focusable.focus(); }, 320);
  }

  function trapFocus(event) {
    var drawer = $('.drawer.is-open');
    if (!drawer || event.key !== 'Tab') return;
    var items = $$('a[href], button:not([disabled]), input, select, textarea', drawer)
      .filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('click', function (event) {
    var opener = event.target.closest('[data-open-drawer]');
    if (opener) {
      event.preventDefault();
      openDrawer(opener.getAttribute('data-open-drawer'), opener);
      return;
    }
    if (event.target.closest('[data-close-drawer]') || event.target.closest('[data-overlay]')) {
      closeAllDrawers();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeAllDrawers();
      closeLightbox();
      return;
    }
    trapFocus(event);
    if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      event.preventDefault();
      openDrawer('search', document.activeElement);
    }
  });

  /* ---------- Panier ---------- */

  var cart = readJson(CART_KEY, []);

  function productByHandle(handle) {
    for (var i = 0; i < catalog.length; i += 1) {
      if (catalog[i].handle === handle) return catalog[i];
    }
    return null;
  }

  function cartCount() {
    return cart.reduce(function (sum, line) { return sum + line.quantity; }, 0);
  }

  function cartTotal() {
    return cart.reduce(function (sum, line) {
      var product = productByHandle(line.handle);
      return sum + (product ? product.price * line.quantity : 0);
    }, 0);
  }

  function saveCart() {
    writeJson(CART_KEY, cart);
    renderCart();
  }

  /* ---------- Codes de réduction ---------- */

  /* Code saisi par le visiteur, conservé d'une visite à l'autre. */
  var appliedCode = String(readJson(CODE_KEY, '') || '').toUpperCase();

  /* Même calcul que dans le générateur : les pages ne transportent que
     l'empreinte des codes, jamais les codes eux-mêmes. */
  function codeHash(code) {
    var hash = 5381;
    var value = String(code).toUpperCase();
    for (var i = 0; i < value.length; i += 1) {
      hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  function findByCode(code) {
    if (!code) return null;
    var hash = codeHash(code);
    for (var i = 0; i < discounts.length; i += 1) {
      if (!discounts[i].auto && discounts[i].h === hash) return discounts[i];
    }
    return null;
  }

  /* Total des articles qu'une réduction peut toucher : tout le panier, ou
     seulement une gamme. */
  function scopedTotal(scope) {
    return cart.reduce(function (sum, line) {
      var product = productByHandle(line.handle);
      if (!product) return sum;
      if (scope && product.category !== scope) return sum;
      return sum + product.price * line.quantity;
    }, 0);
  }

  function discountLabel(d) {
    if (d.label) return d.label;
    if (d.type === 'shipping') return 'Livraison offerte';
    if (d.type === 'amount') return 'Remise de ' + money(d.value);
    return 'Remise de ' + d.value + ' %';
  }

  /** Réductions retenues : celles qui s'appliquent d'office, plus le code
      saisi lorsqu'il remplit ses conditions. */
  function chosenDiscounts() {
    var subtotal = cartTotal();
    var kept = [];

    discounts.forEach(function (d) {
      var manual = !d.auto && appliedCode && d.h === codeHash(appliedCode);
      if (!d.auto && !manual) return;
      if (subtotal < (d.min || 0)) return;

      var base = scopedTotal(d.scope);
      if (base <= 0) return;

      var amount = 0;
      if (d.type === 'percent') amount = base * (Number(d.value) || 0) / 100;
      else if (d.type === 'amount') amount = Math.min(Number(d.value) || 0, base);

      kept.push({
        shipping: d.type === 'shipping',
        amount: Math.round(amount * 100) / 100,
        label: discountLabel(d)
      });
    });

    return kept;
  }

  /* La règle « livraison offerte » la plus accessible parmi celles qui sont
     utilisables : automatique, ou liée au code saisi. */
  function usableShippingRule() {
    var best = null;
    discounts.forEach(function (d) {
      if (d.type !== 'shipping') return;
      var usable = d.auto || (appliedCode && d.h === codeHash(appliedCode));
      if (!usable) return;
      if (!best || (d.min || 0) < (best.min || 0)) best = d;
    });
    return best;
  }

  function shippingThreshold() {
    var rule = usableShippingRule();
    if (rule) return Number(rule.min) || 0;
    return config.freeShippingThreshold || 100;
  }

  function applyCode(raw) {
    var code = String(raw || '').trim().toUpperCase();
    if (!code) return;
    appliedCode = findByCode(code) ? code : '';
    writeJson(CODE_KEY, appliedCode);
    /* Le code refusé n'est pas retenu : il sert juste à afficher le message. */
    renderCart(code);
  }

  function clearCode() {
    appliedCode = '';
    writeJson(CODE_KEY, '');
    renderCart();
  }

  function initCartCode() {
    var form = $('[data-cart-code]');
    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var input = $('[data-cart-code-input]', form);
      applyCode(input ? input.value : '');
      if (input) input.value = '';
    });
  }

  function flashButton(button) {
    if (!button) return;
    var original = button.innerHTML;
    button.classList.add('is-done');
    button.innerHTML = ICON_CHECK + '<span>Ajouté</span>';
    window.setTimeout(function () {
      button.classList.remove('is-done');
      button.innerHTML = original;
    }, 1800);
  }

  function addToCart(handle, quantity, button) {
    var product = productByHandle(handle);
    if (!product) return;
    if (!product.available) {
      toast(tr('Ce produit est actuellement épuisé.'));
      return;
    }
    var qty = quantity || 1;
    var existing = null;
    cart.forEach(function (line) { if (line.handle === handle) existing = line; });
    if (existing) existing.quantity += qty;
    else cart.push({ handle: handle, quantity: qty });

    saveCart();
    flashButton(button);
    toast(product.title + tr(' ajouté au panier.'));
    window.setTimeout(function () { openDrawer('cart', button); }, 280);
  }

  function setQuantity(handle, quantity) {
    cart = cart.filter(function (line) {
      if (line.handle !== handle) return true;
      line.quantity = quantity;
      return quantity > 0;
    });
    saveCart();
  }

  function renderCart(attempted) {
    var count = cartCount();
    $$('[data-cart-count]').forEach(function (el) {
      el.textContent = String(count);
      el.hidden = count === 0;
    });
    $$('[data-cart-count-label]').forEach(function (el) {
      el.textContent = tr('Nombre total d’articles dans le panier :') + ' ' + count;
    });

    var body = $('[data-cart-body]');
    var foot = $('[data-cart-foot]');
    if (!body) return;

    if (!cart.length) {
      body.innerHTML = '<div class="cart-empty">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">'
        + '<path d="M5 7h14l-1 13H6L5 7Z"/><path d="M9 7V5.5a3 3 0 0 1 6 0V7" stroke-linecap="round"/></svg>'
        + '<p>Votre panier est vide</p>'
        + '<a class="btn btn--outline" href="/collections/tout-nos-produits">Découvrir nos soins</a>'
        + '</div>';
      localized(body);
      if (foot) foot.hidden = true;
      return;
    }

    var html = '<ul class="cart-lines">';
    cart.forEach(function (line, index) {
      var product = productByHandle(line.handle);
      if (!product) return;
      html += '<li class="cart-line" data-stagger style="--i:' + index + '">'
        + '<a href="/products/' + product.handle + '"><img src="' + product.image + '" alt="' + escapeHtml(product.title) + '" loading="lazy"></a>'
        + '<div>'
        + '<a class="cart-line__title" href="/products/' + product.handle + '">' + escapeHtml(product.title) + '</a>'
        + '<p class="cart-line__meta">' + money(product.price) + '</p>'
        + '<div class="cart-line__row">'
        + '<span class="cart-line__qty">'
        + '<button type="button" data-cart-minus="' + product.handle + '" aria-label="Diminuer la quantité">&minus;</button>'
        + '<span>' + line.quantity + '</span>'
        + '<button type="button" data-cart-plus="' + product.handle + '" aria-label="Augmenter la quantité">+</button>'
        + '</span>'
        + '<button type="button" class="cart-line__remove" data-cart-remove="' + product.handle + '">Retirer</button>'
        + '</div></div></li>';
    });
    html += '</ul>';
    body.innerHTML = html;
    localized(body);

    if (foot) {
      foot.hidden = false;

      var subtotal = cartTotal();
      var kept = chosenDiscounts();
      var saved = kept.reduce(function (sum, d) { return sum + d.amount; }, 0);
      var goods = Math.max(0, Math.round((subtotal - saved) * 100) / 100);

      var threshold = shippingThreshold();
      var remaining = Math.max(0, threshold - subtotal);

      /* Sans règle utilisable, on retombe sur le seuil des réglages : la
         boutique se comporte comme avant que les codes existent. */
      var rule = usableShippingRule();
      var freeShipping = kept.some(function (d) { return d.shipping; })
        || (!rule && subtotal >= (config.freeShippingThreshold || 0));

      var shippingCost = Number(config.shippingCost) || 0;
      var shippingDue = freeShipping ? 0 : shippingCost;
      var total = Math.round((goods + shippingDue) * 100) / 100;

      $('[data-cart-total]', foot).textContent = money(total);
      $('[data-cart-progress] i', foot).style.width =
        Math.min(100, threshold ? (subtotal / threshold) * 100 : 100) + '%';
      $('[data-cart-shipping]', foot).textContent = freeShipping || remaining <= 0
        ? tr('Livraison offerte : c’est acquis.')
        : tr('Plus que') + ' ' + money(remaining) + ' ' + tr('pour la livraison offerte.');

      /* Détail : sous-total, puis une ligne par réduction retenue. */
      var sums = $('[data-cart-sums]', foot);
      if (sums) {
        var rows = '<div class="cart-sum"><span>' + escapeHtml(tr('Sous-total')) + '</span><span>'
          + money(subtotal) + '</span></div>';

        /* Une ligne par remise chiffrée. */
        kept.forEach(function (d) {
          if (d.shipping) return;
          rows += '<div class="cart-sum cart-sum--off"><span>' + escapeHtml(d.label) + '</span>'
            + '<span>&minus;' + money(d.amount) + '</span></div>';
        });

        /* La livraison figure toujours : c'est ce qui rend la réduction
           « livraison offerte » lisible dans le prix final. */
        rows += '<div class="cart-sum' + (freeShipping ? ' cart-sum--off' : '') + '">'
          + '<span>' + escapeHtml(tr('Livraison')) + '</span><span>'
          + (freeShipping ? escapeHtml(tr('Offerte')) : money(shippingCost)) + '</span></div>';

        sums.innerHTML = rows;
      }

      /* Message du champ de code. */
      var note = $('[data-cart-code-note]', foot);
      if (note) {
        var found = findByCode(appliedCode);
        note.classList.remove('is-ok');
        if (attempted && !findByCode(attempted)) {
          note.innerHTML = escapeHtml(tr('Code inconnu ou plus valable.'));
        } else if (appliedCode && found && subtotal < (found.min || 0)) {
          note.innerHTML = 'Code ' + escapeHtml(appliedCode) + ' enregistré : il s’applique dès '
            + money(found.min) + ' d’achat.';
        } else if (appliedCode && found) {
          note.classList.add('is-ok');
          note.innerHTML = 'Code ' + escapeHtml(appliedCode) + ' appliqué. '
            + '<button type="button" class="cart-code__drop" data-cart-code-drop>Retirer</button>';
        } else {
          note.innerHTML = '';
        }
      }
    }
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-cart-code-drop]')) {
      clearCode();
      return;
    }
    var add = event.target.closest('[data-add-to-cart]');
    if (add) {
      event.preventDefault();
      var source = add.getAttribute('data-qty-source');
      var input = source ? $(source) : null;
      addToCart(add.getAttribute('data-add-to-cart'), input ? parseInt(input.value, 10) || 1 : 1, add);
      return;
    }
    var minus = event.target.closest('[data-cart-minus]');
    if (minus) {
      var handleMinus = minus.getAttribute('data-cart-minus');
      cart.forEach(function (line) {
        if (line.handle === handleMinus) setQuantity(handleMinus, line.quantity - 1);
      });
      return;
    }
    var plus = event.target.closest('[data-cart-plus]');
    if (plus) {
      var handlePlus = plus.getAttribute('data-cart-plus');
      cart.forEach(function (line) {
        if (line.handle === handlePlus) setQuantity(handlePlus, line.quantity + 1);
      });
      return;
    }
    var remove = event.target.closest('[data-cart-remove]');
    if (remove) setQuantity(remove.getAttribute('data-cart-remove'), 0);
  });

  /* ---------- Notification ---------- */

  var toastEl = null;
  var toastTimer = null;

  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = ICON_CHECK + '<span>' + escapeHtml(message) + '</span>';
    toastEl.classList.add('is-open');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toastEl.classList.remove('is-open'); }, 2800);
  }

  /* ---------- Sélecteur de quantité ---------- */

  function initQuantity() {
    $$('[data-qty]').forEach(function (widget) {
      var input = $('input', widget);
      $$('button', widget).forEach(function (button) {
        button.addEventListener('click', function () {
          var step = button.getAttribute('data-step') === 'up' ? 1 : -1;
          input.value = Math.max(1, (parseInt(input.value, 10) || 1) + step);
        });
      });
    });
  }

  /* ---------- Galerie produit et visionneuse ---------- */

  var lightbox = $('[data-lightbox]');
  var lightboxImg = lightbox ? $('[data-lightbox-img]', lightbox) : null;
  var lightboxCounter = lightbox ? $('[data-lightbox-counter]', lightbox) : null;
  var galleryImages = [];
  var galleryIndex = 0;

  function showLightbox(index) {
    if (!lightbox || !galleryImages.length) return;
    galleryIndex = (index + galleryImages.length) % galleryImages.length;
    lightboxImg.src = galleryImages[galleryIndex].src;
    lightboxImg.alt = galleryImages[galleryIndex].alt;
    if (lightboxCounter) lightboxCounter.textContent = (galleryIndex + 1) + ' / ' + galleryImages.length;
  }

  function openLightbox(index) {
    if (!lightbox) return;
    showLightbox(index);
    lightbox.classList.add('is-open');
    document.body.classList.add('is-locked');
  }

  function closeLightbox() {
    if (!lightbox || !lightbox.classList.contains('is-open')) return;
    lightbox.classList.remove('is-open');
    if (!$('.drawer.is-open')) document.body.classList.remove('is-locked');
  }

  function initGallery() {
    var gallery = $('[data-gallery]');
    if (!gallery) return;

    var stage = $('[data-gallery-stage]', gallery);
    var stageImg = $('img', stage);
    var thumbs = $$('[data-gallery-thumb]', gallery);

    galleryImages = thumbs.map(function (thumb) {
      return { src: thumb.getAttribute('data-full'), alt: thumb.getAttribute('data-alt') || '' };
    });

    function select(index) {
      galleryIndex = index;
      thumbs.forEach(function (t, i) { t.classList.toggle('is-active', i === index); });
      stage.classList.add('is-swapping');
      window.setTimeout(function () {
        stageImg.src = galleryImages[index].src;
        stageImg.alt = galleryImages[index].alt;
        stage.classList.remove('is-swapping');
      }, reduceMotion ? 0 : 220);
    }

    /* Plusieurs visuels : ils défilent seuls au format téléphone, jusqu'à la
       première action du visiteur. Un seul visuel : rien ne bouge. */
    var autoTimer = null;

    function stopAuto() {
      if (!autoTimer) return;
      window.clearInterval(autoTimer);
      autoTimer = null;
    }

    function startAuto() {
      if (reduceMotion || galleryImages.length < 2) return;
      if (!window.matchMedia(PHONE).matches) return;
      autoTimer = window.setInterval(function () {
        select((galleryIndex + 1) % galleryImages.length);
      }, GALLERY_INTERVAL);
    }

    thumbs.forEach(function (thumb, index) {
      thumb.addEventListener('click', function () { stopAuto(); select(index); });
      thumb.addEventListener('mouseenter', function () { select(index); });
    });

    stage.addEventListener('click', function () { stopAuto(); openLightbox(galleryIndex); });
    startAuto();

    if (lightbox) {
      $('[data-lightbox-close]', lightbox).addEventListener('click', closeLightbox);
      $('[data-lightbox-prev]', lightbox).addEventListener('click', function () { showLightbox(galleryIndex - 1); });
      $('[data-lightbox-next]', lightbox).addEventListener('click', function () { showLightbox(galleryIndex + 1); });
      lightbox.addEventListener('click', function (event) {
        if (event.target === lightbox) closeLightbox();
      });
      document.addEventListener('keydown', function (event) {
        if (!lightbox.classList.contains('is-open')) return;
        if (event.key === 'ArrowLeft') showLightbox(galleryIndex - 1);
        if (event.key === 'ArrowRight') showLightbox(galleryIndex + 1);
      });
    }
  }

  /* ---------- Barre d'achat mobile ---------- */

  function initBuyBar() {
    var bar = $('[data-buy-bar]');
    var anchor = $('[data-buy-anchor]');
    if (!bar || !anchor || !('IntersectionObserver' in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        bar.classList.toggle('is-visible', !entry.isIntersecting && entry.boundingClientRect.top < 0);
      });
    }, { threshold: 0 });

    observer.observe(anchor);
  }

  /* ---------- Rubans qui défilent en continu ---------- */

  /* Bandeau d'annonces, ruban des soins, ruban des avis : la piste contient
     deux copies du contenu et glisse de la moitié de sa largeur. La durée est
     calculée pour que la vitesse reste la même quel que soit le nombre
     d'éléments. */
  function initStrips() {
    $$('[data-strip]').forEach(function (strip) {
      var track = $('[data-strip-track]', strip);
      if (!track) return;

      if (reduceMotion) {
        track.style.animation = 'none';
        return;
      }

      var speed = parseFloat(strip.getAttribute('data-strip-speed')) || 44;

      function sync() {
        var width = track.scrollWidth / 2;
        if (!width) return;
        strip.style.setProperty('--strip-duration', Math.max(12, Math.round(width / speed)) + 's');
      }

      sync();
      window.addEventListener('resize', sync);
      window.addEventListener('load', sync);
    });
  }

  /* ---------- Visuels du hero ---------- */

  /* Plusieurs visuels : ils défilent, mais seulement au format téléphone.
     Un seul visuel : rien ne bouge. */
  function initHeroSlides() {
    var media = $('[data-hero-slides]');
    if (!media) return;

    var slides = $$('.hero__slide', media);
    if (slides.length < 2 || reduceMotion) return;

    var query = window.matchMedia(PHONE);
    var index = 0;
    var timer = null;

    function show(next) {
      slides[index].classList.remove('is-active');
      index = (next + slides.length) % slides.length;
      slides[index].classList.add('is-active');
    }

    function apply() {
      if (query.matches) {
        if (!timer) timer = window.setInterval(function () { show(index + 1); }, HERO_INTERVAL);
        return;
      }
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
      if (index !== 0) show(0);
    }

    apply();
    if (query.addEventListener) query.addEventListener('change', apply);
    else if (query.addListener) query.addListener(apply);
  }

  /* ---------- Diaporama des meilleures ventes ---------- */

  /* Un soin à la fois, changement automatique. Un appui sur une pastille
     reprend la main et relance le compte à rebours. Comme le diaporama
     n'existe qu'au format téléphone, rien ne tourne ailleurs. */
  function initProductShow() {
    var show = $('[data-pshow]');
    if (!show) return;

    var slides = $$('[data-pshow-slide]', show);
    var dots = $$('[data-pshow-dot]', show);
    if (slides.length < 2) return;

    var delay = parseInt(show.getAttribute('data-pshow-interval'), 10) || 3000;
    var query = window.matchMedia(PHONE);
    var index = 0;
    var timer = null;

    var leaveTimer = null;

    function select(next) {
      var previous = slides[index];
      previous.classList.remove('is-active');
      if (dots[index]) dots[index].classList.remove('is-active');

      index = (next + slides.length) % slides.length;
      slides[index].classList.add('is-active');
      if (dots[index]) dots[index].classList.add('is-active');

      /* Le soin qui sort poursuit sa course vers la droite, puis retrouve sa
         place à gauche pour pouvoir entrer à nouveau. */
      if (previous === slides[index]) return;
      previous.classList.add('is-leaving');
      if (leaveTimer) window.clearTimeout(leaveTimer);
      leaveTimer = window.setTimeout(function () {
        slides.forEach(function (slide) {
          if (!slide.classList.contains('is-active')) slide.classList.remove('is-leaving');
        });
      }, SLIDE_LEAVE);
    }

    function stop() {
      if (!timer) return;
      window.clearInterval(timer);
      timer = null;
    }

    function start() {
      stop();
      if (reduceMotion || !query.matches) return;
      timer = window.setInterval(function () { select(index + 1); }, delay);
    }

    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        select(i);
        start();
      });
    });

    function apply() {
      if (query.matches) {
        start();
        return;
      }
      stop();
      if (index !== 0) select(0);
    }

    apply();
    if (query.addEventListener) query.addEventListener('change', apply);
    else if (query.addListener) query.addListener(apply);
  }

  /* ---------- Colonnes du pied de page ---------- */

  /* Elles arrivent ouvertes : au format téléphone on les replie pour
     raccourcir le pied de page, ailleurs elles restent dépliées. */
  function initFooterGroups() {
    var groups = $$('.fgroup');
    if (!groups.length) return;

    var query = window.matchMedia(PHONE);

    function apply() {
      groups.forEach(function (group) { group.open = !query.matches; });
    }

    apply();
    if (query.addEventListener) query.addEventListener('change', apply);
    else if (query.addListener) query.addListener(apply);
  }

  /* ---------- Bande vidéo défilante ---------- */

  function initVideoStrip() {
    var strip = $('[data-vstrip]');
    if (!strip) return;
    var track = $('[data-vstrip-track]', strip);
    if (!track) return;

    /* La piste porte deux copies de la liste : moins de deux vidéos par copie,
       il n'y a rien à faire défiler. */
    if (track.children.length < 4) {
      track.style.animation = 'none';
      return;
    }

    /* Vitesse constante quel que soit le nombre de vidéos : environ 48 px/s. */
    function sync() {
      var width = track.scrollWidth / 2;
      strip.style.setProperty('--vstrip-duration', Math.max(24, Math.round(width / 48)) + 's');
    }
    window.addEventListener('resize', sync);
    window.addEventListener('load', sync);
    sync();

    if (reduceMotion) {
      track.style.animation = 'none';
      return;
    }

    /* Les vidéos ne tournent que lorsqu'elles sont à l'écran. */
    var videos = $$('video', track);
    if (videos.length && 'IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var playing = entry.target.play();
            if (playing && playing.catch) playing.catch(function () {});
          } else {
            entry.target.pause();
          }
        });
      }, { threshold: 0.2 });
      videos.forEach(function (video) {
        video.muted = true;
        video.playsInline = true;
        observer.observe(video);
      });
    }
  }

  /* ---------- Compteurs animés ---------- */

  function initCounters() {
    var nodes = $$('[data-count]');
    if (!nodes.length || reduceMotion || !('IntersectionObserver' in window)) return;

    function run(node) {
      var original = node.textContent.trim();
      var parts = original.match(/^(\D*?)(\d[\d.,]*)(.*)$/);
      if (!parts) return;
      var prefix = parts[1];
      var suffix = parts[3];
      var target = parseFloat(parts[2].replace(/[\s,]/g, ''));
      if (!isFinite(target)) return;

      var start = null;
      var duration = 1100;
      node.textContent = prefix + '0' + suffix;

      function tick(now) {
        if (start === null) start = now;
        var t = Math.min(1, (now - start) / duration);
        var eased = 1 - Math.pow(1 - t, 3);
        node.textContent = prefix + Math.round(target * eased) + suffix;
        if (t < 1) window.requestAnimationFrame(tick);
        else node.textContent = original;
      }
      window.requestAnimationFrame(tick);
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        run(entry.target);
      });
    }, { threshold: 0.5 });

    nodes.forEach(function (node) { observer.observe(node); });
  }

  /* ---------- Carrousels ---------- */

  function initCarousels() {
    $$('[data-carousel]').forEach(function (carousel) {
      var viewport = $('[data-carousel-view]', carousel);
      var prev = $('[data-carousel-prev]', carousel);
      var next = $('[data-carousel-next]', carousel);
      if (!viewport) return;

      function step() {
        var first = viewport.firstElementChild;
        return first ? first.getBoundingClientRect().width + 20 : 320;
      }

      function sync() {
        var max = viewport.scrollWidth - viewport.clientWidth - 4;
        if (prev) prev.disabled = viewport.scrollLeft <= 4;
        if (next) next.disabled = viewport.scrollLeft >= max;
      }

      if (prev) prev.addEventListener('click', function () { viewport.scrollBy({ left: -step() }); });
      if (next) next.addEventListener('click', function () { viewport.scrollBy({ left: step() }); });
      viewport.addEventListener('scroll', sync, { passive: true });
      window.addEventListener('resize', sync);
      sync();
    });
  }

  /* ---------- Recherche ---------- */

  function renderResults(container, term) {
    var query = term.trim().toLowerCase();
    if (query.length < 2) {
      container.innerHTML = '';
      return;
    }
    var matches = catalog.filter(function (product) {
      return product.title.toLowerCase().indexOf(query) !== -1
        || (product.excerpt || '').toLowerCase().indexOf(query) !== -1;
    }).slice(0, 8);

    if (!matches.length) {
      container.innerHTML = '<li class="empty-state">Aucun résultat pour « ' + escapeHtml(term) + ' ».</li>';
      return;
    }
    container.innerHTML = matches.map(function (product) {
      return '<li><a href="/products/' + product.handle + '">'
        + '<img src="' + product.image + '" alt="" loading="lazy">'
        + '<span><strong>' + escapeHtml(product.title) + '</strong>'
        + '<em>' + (product.available ? 'En stock' : 'Épuisé') + '</em></span>'
        + '<span>' + money(product.price) + '</span>'
        + '</a></li>';
    }).join('');
  }

  function initSearch() {
    $$('[data-search-input]').forEach(function (input) {
      /* chaque champ écrit dans la liste de résultats de son propre contexte */
      var scope = input.closest('[data-drawer]') || document;
      var results = $('[data-search-results]', scope);
      if (!results) return;

      input.addEventListener('input', function () { renderResults(results, input.value); });
      var form = input.closest('form');
      if (form) {
        form.addEventListener('submit', function (event) {
          event.preventDefault();
          renderResults(results, input.value);
        });
      }
    });
  }

  /* ---------- Filtres et tri de collection ---------- */

  function initCollection() {
    var grid = $('[data-collection-grid]');
    if (!grid) return;

    var cards = $$('[data-card]', grid);
    var sortSelect = $('[data-sort]');
    var chips = $$('[data-filter-availability]');
    var countEl = $('[data-collection-count]');
    var availability = 'all';

    function apply() {
      var visible = cards.filter(function (card) {
        var state = card.getAttribute('data-availability') || 'out-of-stock';
        var keep = availability === 'all' || availability === state;
        card.hidden = !keep;
        return keep;
      });

      var sort = sortSelect ? sortSelect.value : 'manual';
      var sorted = visible.slice();
      if (sort === 'price-asc' || sort === 'price-desc') {
        sorted.sort(function (a, b) {
          var diff = parseFloat(a.getAttribute('data-price')) - parseFloat(b.getAttribute('data-price'));
          return sort === 'price-asc' ? diff : -diff;
        });
      } else if (sort === 'title-asc' || sort === 'title-desc') {
        sorted.sort(function (a, b) {
          var diff = a.getAttribute('data-title').localeCompare(b.getAttribute('data-title'), 'fr');
          return sort === 'title-asc' ? diff : -diff;
        });
      } else {
        sorted.sort(function (a, b) {
          return parseInt(a.getAttribute('data-position'), 10) - parseInt(b.getAttribute('data-position'), 10);
        });
      }
      sorted.forEach(function (card) { grid.appendChild(card); });

      if (countEl) {
        countEl.textContent = visible.length + ' ' + tr(visible.length > 1 ? 'soins' : 'soin');
      }
      var empty = $('[data-collection-empty]');
      if (empty) empty.hidden = visible.length > 0;
    }

    function animateApply() {
      if (reduceMotion) {
        apply();
        return;
      }
      grid.classList.add('is-filtering');
      window.setTimeout(function () {
        apply();
        grid.classList.remove('is-filtering');
      }, 180);
    }

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.classList.remove('is-active'); c.setAttribute('aria-pressed', 'false'); });
        chip.classList.add('is-active');
        chip.setAttribute('aria-pressed', 'true');
        availability = chip.getAttribute('data-filter-availability');
        animateApply();
      });
    });

    if (sortSelect) sortSelect.addEventListener('change', animateApply);
    onLocaleChange.push(apply);
    apply();
  }

  /* ---------- Sélecteur de région ---------- */

  function initRegion() {
    onLocaleChange.push(renderCart);

    function paint() {
      $$('[data-region-label]').forEach(function (el) { el.textContent = region.currency; });

      $$('[data-region]').forEach(function (button) {
        var on = button.getAttribute('data-region') === region.country;
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      $$('[data-lang-choice]').forEach(function (button) {
        var on = button.getAttribute('data-lang-choice') === region.lang;
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      /* Dit au visiteur ce qui a été choisi pour lui, et que rien n'est figé. */
      $$('[data-region-auto]').forEach(function (el) {
        el.hidden = !region.auto;
        if (region.auto) {
          el.textContent = tr('Choisi d’après les réglages de votre navigateur. Vous pouvez en changer.');
        }
      });
    }

    $$('[data-region]').forEach(function (button) {
      button.addEventListener('click', function () {
        setRegion({
          country: button.getAttribute('data-region'),
          code: button.getAttribute('data-country'),
          currency: button.getAttribute('data-currency'),
          suggestedLang: button.getAttribute('data-lang')
        }).then(function () {
          paint();
          toast(region.country + ' · ' + region.currency);
          closeAllDrawers();
        });
      });
    });

    $$('[data-lang-choice]').forEach(function (button) {
      button.addEventListener('click', function () {
        setRegion({ lang: button.getAttribute('data-lang-choice') }).then(paint);
      });
    });

    onLocaleChange.push(paint);
    applyLocale().then(paint);
  }

  /* ---------- Consentement et mesure d'audience ---------- */

  /* Aucun script de mesure n'est chargé par la page. Il n'arrive qu'après un
     accord explicite, et l'accord est redemandé au bout de six mois. */

  var CONSENT_KEY = '417france.consent';
  var CONSENT_MAX_AGE = 6 * 30 * 24 * 60 * 60 * 1000;

  function storedConsent() {
    var saved = readJson(CONSENT_KEY, null);
    if (!saved || !saved.state || !saved.at) return null;
    if (Date.now() - saved.at > CONSENT_MAX_AGE) return null;
    return saved.state;
  }

  var analyticsStarted = false;

  /* Chaque fournisseur a sa façon de démarrer. Sans réglage exploitable, on ne
     charge rien du tout plutôt que de poser un script inerte. */
  function startAnalytics() {
    if (analyticsStarted) return;
    var settings = window.SITE_ANALYTICS || {};
    var src = '';
    var attributes = {};
    var after = null;

    if (settings.provider === 'vercel') {
      src = '/_vercel/insights/script.js';
    } else if (settings.provider === 'plausible' && settings.id) {
      src = 'https://plausible.io/js/script.js';
      attributes['data-domain'] = settings.id;
    } else if (settings.provider === 'ga4' && settings.id) {
      src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(settings.id);
      after = function () {
        window.dataLayer = window.dataLayer || [];
        function gtag() { window.dataLayer.push(arguments); }
        gtag('js', new Date());
        gtag('config', settings.id, { anonymize_ip: true });
      };
    }

    if (!src) return;
    analyticsStarted = true;

    var script = document.createElement('script');
    script.defer = true;
    script.src = src;
    Object.keys(attributes).forEach(function (name) {
      script.setAttribute(name, attributes[name]);
    });
    if (after) script.addEventListener('load', after);
    document.head.appendChild(script);
  }

  function initConsent() {
    var banner = $('[data-consent]');
    var settings = window.SITE_ANALYTICS || {};
    var measurable = settings.provider && settings.provider !== 'none';
    var state = storedConsent();

    if (state === 'granted') startAnalytics();

    function show() {
      if (!banner) return;
      banner.hidden = false;
      var accept = $('[data-consent-answer="granted"]', banner);
      if (accept) accept.focus();
    }

    function answer(next) {
      writeJson(CONSENT_KEY, { state: next, at: Date.now() });
      if (next === 'granted') startAnalytics();
      if (banner) banner.hidden = true;
      toast(next === 'granted'
        ? tr('Mesure d’audience activée.')
        : tr('Mesure d’audience désactivée.'));
    }

    if (banner) {
      $$('[data-consent-answer]', banner).forEach(function (button) {
        button.addEventListener('click', function () {
          answer(button.getAttribute('data-consent-answer'));
        });
      });
    }

    /* Le lien du pied de page rouvre la bannière, que la réponse date d'hier
       ou de six mois. */
    $$('[data-consent-reopen]').forEach(function (button) {
      button.addEventListener('click', show);
    });

    /* Rien à mesurer, rien à demander. */
    if (measurable && state === null) show();
  }

  /* ---------- Formulaires ---------- */

  /* Newsletter et page Contact. Avec un point de collecte configuré, la
     saisie y est postée et le visiteur voit ce qui s'est réellement passé.
     Sans configuration, on ne prétend pas avoir transmis quoi que ce soit :
     on donne l'adresse à laquelle écrire. */

  function initForms() {
    var forms = window.SITE_FORMS || {};

    $$('[data-site-form]').forEach(function (form) {
      var note = $('[data-form-note]', form) || $('[data-form-note]', form.parentNode);
      var submit = form.querySelector('[type="submit"]');

      function say(message, ok) {
        if (!note) return;
        note.textContent = message;
        note.classList.toggle('is-success', !!ok);
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        if (!forms.endpoint) {
          say(forms.email
            ? tr('Formulaire non relié pour l’instant. Écrivez-nous à') + ' ' + forms.email
            : tr('Formulaire non relié pour l’instant.'), false);
          return;
        }

        var payload = { sujet: form.getAttribute('data-site-form') };
        $$('input, textarea, select', form).forEach(function (field) {
          if (field.name) payload[field.name] = field.value;
        });

        if (submit) submit.disabled = true;
        say(tr('Envoi en cours…'), false);

        fetch(forms.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
          body: JSON.stringify(payload)
        }).then(function (response) {
          if (!response.ok) throw new Error(response.status);
          say(form.getAttribute('data-success') || tr('Merci, c’est enregistré.'), true);
          form.reset();
        }).catch(function () {
          say(forms.email
            ? tr('L’envoi a échoué. Écrivez-nous à') + ' ' + forms.email
            : tr('L’envoi a échoué. Merci de réessayer.'), false);
        }).then(function () {
          if (submit) submit.disabled = false;
        });
      });
    });
  }

  /* ---------- Retour en haut ---------- */

  function initToTop() {
    var button = $('[data-to-top]');
    if (!button) return;
    button.addEventListener('click', function () {
      if (smooth) smooth.to(0);
      else window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
    onScroll(function (y) { button.classList.toggle('is-visible', y > 620); });
  }

  /* ---------- Démarrage ---------- */

  initSmoothScroll();
  initProgress();
  initReveal();
  initImageFade();
  initHeader();
  initHeroParallax();
  initAnnounce();
  initStrips();
  initHeroSlides();
  initProductShow();
  initFooterGroups();
  initVideoStrip();
  initCounters();
  initCarousels();
  initGallery();
  initBuyBar();
  initQuantity();
  initSearch();
  initCollection();
  initRegion();
  initConsent();
  initForms();
  initToTop();
  initCartCode();
  renderCart();
})();
