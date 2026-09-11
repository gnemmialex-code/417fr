/* =============================================================================
   417 France - comportements front-end
   Défilement fluide, animations, panier, tiroirs, galerie, visionneuse.
   ========================================================================== */
(function () {
  'use strict';

  var CART_KEY = '417france.cart';
  var REGION_KEY = '417france.region';
  var ANNOUNCE_INTERVAL = 4200;
  var SCROLL_EASE = 0.135;
  var PARALLAX = 0.08;

  var catalog = window.SITE_PRODUCTS || [];
  var config = window.SITE_CONFIG || { freeShippingThreshold: 100 };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Utilitaires ---------- */

  function $(selector, scope) { return (scope || document).querySelector(selector); }
  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function money(value) { return '€' + Number(value).toFixed(2).replace('.', ','); }

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
      toast('Ce produit est actuellement épuisé.');
      return;
    }
    var qty = quantity || 1;
    var existing = null;
    cart.forEach(function (line) { if (line.handle === handle) existing = line; });
    if (existing) existing.quantity += qty;
    else cart.push({ handle: handle, quantity: qty });

    saveCart();
    flashButton(button);
    toast(product.title + ' ajouté au panier.');
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

  function renderCart() {
    var count = cartCount();
    $$('[data-cart-count]').forEach(function (el) {
      el.textContent = String(count);
      el.hidden = count === 0;
    });
    $$('[data-cart-count-label]').forEach(function (el) {
      el.textContent = 'Nombre total d’articles dans le panier : ' + count;
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

    if (foot) {
      foot.hidden = false;
      var total = cartTotal();
      var threshold = config.freeShippingThreshold || 100;
      var remaining = Math.max(0, threshold - total);
      $('[data-cart-total]', foot).textContent = money(total);
      $('[data-cart-progress] i', foot).style.width = Math.min(100, (total / threshold) * 100) + '%';
      $('[data-cart-shipping]', foot).textContent = remaining > 0
        ? 'Plus que ' + money(remaining) + ' pour la livraison offerte.'
        : 'Livraison offerte : c’est acquis.';
    }
  }

  document.addEventListener('click', function (event) {
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

    thumbs.forEach(function (thumb, index) {
      thumb.addEventListener('click', function () { select(index); });
      thumb.addEventListener('mouseenter', function () { select(index); });
    });

    stage.addEventListener('click', function () { openLightbox(galleryIndex); });

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

  /* ---------- Bande vidéo défilante ---------- */

  function initVideoStrip() {
    var strip = $('[data-vstrip]');
    if (!strip) return;
    var track = $('[data-vstrip-track]', strip);
    if (!track) return;

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
    var chips = $$('[data-availability]');
    var countEl = $('[data-collection-count]');
    var availability = 'all';

    function apply() {
      var visible = cards.filter(function (card) {
        var available = card.getAttribute('data-available') === 'true';
        var keep = availability === 'all'
          || (availability === 'in' && available)
          || (availability === 'out' && !available);
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

      if (countEl) countEl.textContent = visible.length + (visible.length > 1 ? ' soins' : ' soin');
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
        availability = chip.getAttribute('data-availability');
        animateApply();
      });
    });

    if (sortSelect) sortSelect.addEventListener('change', animateApply);
    apply();
  }

  /* ---------- Sélecteur de région ---------- */

  function initRegion() {
    var saved = readJson(REGION_KEY, null);
    if (saved) $$('[data-region-label]').forEach(function (el) { el.textContent = saved.currency; });

    $$('[data-region]').forEach(function (button) {
      if (saved && button.getAttribute('data-region') === saved.name) button.classList.add('is-active');
      button.addEventListener('click', function () {
        var region = {
          name: button.getAttribute('data-region'),
          currency: button.getAttribute('data-currency')
        };
        writeJson(REGION_KEY, region);
        $$('[data-region]').forEach(function (b) { b.classList.remove('is-active'); });
        button.classList.add('is-active');
        $$('[data-region-label]').forEach(function (el) { el.textContent = region.currency; });
        toast('Région : ' + region.name + ' (' + region.currency + ')');
        closeAllDrawers();
      });
    });
  }

  /* ---------- Formulaires de démonstration ---------- */

  function initForms() {
    $$('[data-demo-form]').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var note = $('[data-form-note]', form) || $('[data-form-note]', form.parentNode);
        if (note) {
          note.textContent = form.getAttribute('data-success') || 'Merci, votre message a bien été envoyé.';
          note.classList.add('is-success');
        }
        form.reset();
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
  initVideoStrip();
  initCounters();
  initCarousels();
  initGallery();
  initBuyBar();
  initQuantity();
  initSearch();
  initCollection();
  initRegion();
  initForms();
  initToTop();
  renderCart();
})();
