/* =============================================================================
   Back-office 417 France - interface
   ========================================================================== */
(function () {
  'use strict';

  var state = null;
  var filters = {
    stock: { search: '', category: 'all', status: 'all', internal: 'all', sort: 'title', dir: 1 },
    orders: { search: '', status: 'all' },
    customers: { search: '' },
    messages: { search: '', status: 'all', kind: 'all' },
    shipments: { search: '', status: 'all' }
  };

  var $ = function (sel, scope) { return (scope || document).querySelector(sel); };
  var $$ = function (sel, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(sel));
  };

  var content = $('#content');
  var modal = $('#modal');
  var toastEl = $('#toast');
  var toastTimer = null;

  /* ---------- Utilitaires ---------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(value) {
    return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  function date(value) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function dateTime(value) {
    return new Date(value).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function normalize(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.classList.toggle('is-error', !!isError);
    window.requestAnimationFrame(function () { toastEl.classList.add('is-open'); });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastEl.classList.remove('is-open');
      window.setTimeout(function () { toastEl.hidden = true; }, 320);
    }, 3000);
  }

  function api(action, body) {
    return fetch('/api/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify(body || {})
    }).then(function (response) {
      if (response.status === 401) {
        window.location.href = '/admin/login';
        throw new Error('Session expirée.');
      }
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.error || 'Erreur inattendue.');
        return data;
      });
    });
  }

  function send(action, body, message) {
    return api(action, body).then(function (result) {
      if (result.state) {
        state = result.state;
        render();
      }
      if (message) toast(message);
      return result;
    }).catch(function (err) {
      toast(err.message, true);
      throw err;
    });
  }

  function download(filename, rows) {
    var csv = rows.map(function (row) {
      return row.map(function (cell) {
        var value = String(cell == null ? '' : cell).replace(/"/g, '""');
        return '"' + value + '"';
      }).join(';');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    toast('Export « ' + filename +' » téléchargé.');
  }

  /* ---------- Fenêtre modale ---------- */

  function openModal(options) {
    $('#modal-title').textContent = options.title;
    $('#modal-body').innerHTML = options.body;
    $('#modal-foot').innerHTML = options.foot || '';
    $('.modal__panel').classList.toggle('modal__panel--wide', !!options.wide);
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (options.onOpen) options.onOpen();
    var first = $('#modal-body input, #modal-body select, #modal-body textarea');
    if (first) window.setTimeout(function () { first.focus(); }, 80);
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  modal.addEventListener('click', function (event) {
    if (event.target.closest('[data-close-modal]')) closeModal();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });

  function confirmAction(message, label, onConfirm) {
    openModal({
      title: 'Confirmation',
      body: '<p style="margin:0">' + esc(message) + '</p>',
      foot: '<button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>'
        + '<button type="button" class="btn btn--danger" id="confirm-yes">' + esc(label) + '</button>',
      onOpen: function () {
        $('#confirm-yes').addEventListener('click', function () {
          closeModal();
          onConfirm();
        });
      }
    });
  }

  /* ---------- Fragments réutilisables ---------- */

  /* Les trois etats d'un produit en boutique. Le meme vocabulaire sert au
     filtre des pages collection et a la condition d'affichage de la vignette. */
  var AVAILABILITY_LABELS = {
    'in-stock': 'En stock',
    'out-of-stock': 'Épuisé',
    'incoming': 'En arrivage'
  };

  var AVAILABILITY_TONES = {
    'in-stock': 'tag--ok',
    'out-of-stock': 'tag--danger',
    'incoming': 'tag--info'
  };

  function availabilityOf(product) {
    return product.availability || (product.stock > 0 ? 'in-stock' : 'out-of-stock');
  }

  /* Ce que le tableau ajoute sous l'etat boutique : l'alerte de stock et le
     statut interne, quand ils apportent une information de plus. */
  function stockNote(product) {
    var notes = [];
    if (product.stock > 0 && product.stock <= product.threshold) notes.push('stock faible');
    if (product.status && product.status !== 'Automatique') notes.push(product.status.toLowerCase());
    if (!notes.length) return '';
    return '<br><span class="cell-sub">' + esc(notes.join(' · ')) + '</span>';
  }

  function availabilityTag(product) {
    var state = availabilityOf(product);
    return '<span class="tag ' + (AVAILABILITY_TONES[state] || 'tag--neutral') + '">'
      + esc(AVAILABILITY_LABELS[state] || state) + '</span>';
  }

  function badgeSummary(product) {
    var badge = product.badge;
    if (!badge || !badge.enabled || !badge.text) return '<span class="cell-sub">Vignette masquee</span>';
    var when = AVAILABILITY_LABELS[badge.when] || AVAILABILITY_LABELS['out-of-stock'];
    return '<span class="cell-sub" title="Affichée quand le produit est ' + esc(when.toLowerCase())
      + '">Vignette : ' + esc(badge.text) + '</span>';
  }

  function orderTag(status) {
    var map = {
      'À préparer': 'tag--warn',
      'En préparation': 'tag--info',
      'Expédiée': 'tag--info',
      'Livrée': 'tag--ok',
      'Annulée': 'tag--danger',
      'Remboursée': 'tag--danger'
    };
    return '<span class="tag ' + (map[status] || 'tag--neutral') + '">' + esc(status) + '</span>';
  }

  function shipmentTag(status) {
    var map = {
      'Étiquette créée': 'tag--neutral',
      'En transit': 'tag--info',
      'En cours de livraison': 'tag--info',
      'Livré': 'tag--ok',
      'Incident': 'tag--danger'
    };
    return '<span class="tag ' + (map[status] || 'tag--neutral') + '">' + esc(status) + '</span>';
  }

  /* Montant payé : articles, moins la réduction, plus la livraison. */
  function orderTotal(order) {
    return order.total - (order.discount || 0) + (order.shippingCost || 0);
  }

  /* Mode de livraison choisi en ligne, avec le point relais ou l'adresse. */
  function deliveryBox(order) {
    var d = order.delivery;
    if (!d) return '';
    var where = d.relay
      ? 'Point relais n° ' + esc(d.relay.id) + '<br><strong>' + esc(d.relay.name) + '</strong><br>'
        + esc(d.relay.address) + '<br>' + esc(d.relay.zip + ' ' + d.relay.city)
      : d.address
        ? 'À domicile<br><strong>' + esc(d.recipient || order.customerName) + '</strong><br>'
          + esc(d.address.address) + '<br>' + esc(d.address.zip + ' ' + d.address.city)
        : '';
    var label = order.label
      ? '<br><span class="tag tag--ok">Bordereau acheté</span> ' + esc(order.label.carrier) + ' ' + esc(order.label.service)
        + ' · n° <strong>' + esc(order.label.tracking) + '</strong>' + (order.label.test ? ' <span class="tag tag--warn">test</span>' : '')
      : '';
    /* Transporteur traité à la main : lien vers son site pour l'étiquette. */
    var portal = state.settings.carriers.find(function (c) { return c.name === d.carrier; });
    var manual = !order.label && !canBuyLabel(order) && ['Annulée', 'Remboursée'].indexOf(order.status) === -1 && portal
      ? '<br><span class="cell-sub">Étiquette à créer sur <a href="' + esc(portal.portal) + '" target="_blank" rel="noopener">le site ' + esc(d.carrier) + '</a>'
        + (d.relay ? ', point relais n° ' + esc(d.relay.id) : '') + ', puis joignez le PDF avec « Bordereau ».</span>'
      : '';
    var mail = order.mail
      ? '<br><span class="cell-sub">E-mails : boutique ' + esc(order.mail.shop) + ' · client ' + esc(order.mail.customer) + '</span>'
      : '';
    return '<div class="detail-box" style="margin-top:16px"><h3>Livraison choisie</h3><p>'
      + '<strong>' + esc(d.carrier) + '</strong> — ' + esc(d.label) + (where ? '<br>' + where : '') + label + manual + mail + '</p></div>';
  }

  function customerById(id) {
    return state.customers.find(function (c) { return c.id === id; }) || null;
  }

  function trackingUrl(carrier, tracking) {
    if (!tracking) return null;
    var found = state.settings.carriers.find(function (c) { return c.name === carrier; });
    return found ? found.tracking + encodeURIComponent(tracking) : null;
  }

  function emptyRow(columns, title, hint) {
    return '<tr><td colspan="' + columns + '"><div class="empty"><strong>' + esc(title) + '</strong>'
      + esc(hint || '') + '</div></td></tr>';
  }

  /* ---------- Vue : tableau de bord ---------- */

  function viewDashboard() {
    var s = state.stats;
    var max = Math.max.apply(null, s.months.map(function (m) { return m.revenue; }).concat([1]));

    var chart = s.months.map(function (m) {
      var height = Math.round((m.revenue / max) * 150);
      return '<div class="chart__col">'
        + '<span class="chart__value">' + (m.revenue ? Math.round(m.revenue) + ' €' : '—') + '</span>'
        + '<div class="chart__bar" style="height:' + Math.max(4, height) + 'px"></div>'
        + '<span class="chart__label">' + esc(m.label.replace('.', '')) + '</span>'
        + '</div>';
    }).join('');

    var top = s.topProducts.length ? s.topProducts.map(function (p) {
      return '<div class="list__item"><div><strong>' + esc(p.title) + '</strong><br>'
        + '<span>' + money(p.revenue) + '</span></div>'
        + '<span class="num">' + p.quantity + '</span></div>';
    }).join('') : '<div class="empty"><strong>Aucune vente</strong>Créez une commande pour alimenter ce classement.</div>';

    var alerts = s.outOfStockItems.concat(s.lowStockItems);
    var alertList = alerts.length ? alerts.slice(0, 8).map(function (p) {
      return '<div class="list__item"><div><strong>' + esc(p.title) + '</strong><br>'
        + '<span>' + esc(p.sku) + '</span></div>'
        + '<span class="num">' + p.stock + '</span></div>';
    }).join('') : '<div class="empty"><strong>Tout va bien</strong>Aucun produit sous son seuil d’alerte.</div>';

    var toPrepare = state.orders.filter(function (o) {
      return o.status === 'À préparer' || o.status === 'En préparation';
    }).slice(0, 6);

    var prepareRows = toPrepare.length ? toPrepare.map(function (o) {
      return '<tr><td class="cell-title">' + esc(o.ref) + '</td>'
        + '<td>' + esc(o.customerName) + '</td>'
        + '<td>' + date(o.createdAt) + '</td>'
        + '<td class="num">' + money(orderTotal(o)) + '</td>'
        + '<td>' + orderTag(o.status) + '</td>'
        + '<td class="actions"><button type="button" class="btn btn--ghost btn--sm" data-order-detail="' + o.id + '">Ouvrir</button></td></tr>';
    }).join('') : emptyRow(6, 'Aucune commande en attente', 'Les nouvelles commandes apparaîtront ici.');

    var activity = state.activity.slice(0, 10).map(function (a) {
      return '<div class="timeline__item"><time>' + dateTime(a.at) + '</time>'
        + '<div><strong>' + esc(a.action) + '</strong><br><em>' + esc(a.detail || '') + '</em></div></div>';
    }).join('') || '<div class="empty"><strong>Aucune activité</strong>Les actions récentes s’afficheront ici.</div>';

    return '<div class="view">'
      + '<div class="kpis">'
      + kpi('Chiffre d’affaires', money(s.revenue), s.orders + ' commandes valides')
      + kpi('Panier moyen', money(s.averageBasket), 'sur ' + s.orders + ' commandes')
      + kpi('Valeur du stock', money(s.stockValue), s.stockUnits + ' unités en entrepôt')
      + kpi('Clients', String(s.customers), s.products + ' produits au catalogue')
      + '</div>'

      + '<div class="kpis">'
      + kpi('À préparer', String(s.toPrepare), 'commandes en attente', s.toPrepare ? 'warn' : '')
      + kpi('En transit', String(s.inTransit), 'colis chez le transporteur')
      + kpi('Stock faible', String(s.lowStock), 'produits sous le seuil', s.lowStock ? 'warn' : '')
      + kpi('Ruptures', String(s.outOfStock), 'produits à réapprovisionner', s.outOfStock ? 'alert' : '')
      + '</div>'

      + '<div class="split">'
      + '<section class="card"><div class="card__head"><h2>Chiffre d’affaires</h2>'
      + '<span class="tag tag--neutral">6 derniers mois</span></div>'
      + '<div class="chart">' + chart + '</div></section>'
      + '<section class="card"><div class="card__head"><h2>Meilleures ventes</h2></div>'
      + '<div class="list">' + top + '</div></section>'
      + '</div>'

      + '<div class="split">'
      + '<section class="card"><div class="card__head"><h2>Commandes à traiter</h2>'
      + '<button type="button" class="btn btn--ghost btn--sm" data-goto="commandes">Tout voir</button></div>'
      + '<div class="table-wrap"><table class="table"><thead><tr><th>Référence</th><th>Client</th>'
      + '<th>Date</th><th class="num">Total</th><th>Statut</th><th></th></tr></thead>'
      + '<tbody>' + prepareRows + '</tbody></table></div></section>'
      + '<section class="card"><div class="card__head"><h2>Alertes de stock</h2>'
      + '<button type="button" class="btn btn--ghost btn--sm" data-goto="stock">Gérer</button></div>'
      + '<div class="list">' + alertList + '</div></section>'
      + '</div>'

      + '<section class="card"><div class="card__head"><h2>Activité récente</h2></div>'
      + '<div class="timeline">' + activity + '</div></section>'
      + '</div>';
  }

  function kpi(label, value, meta, variant) {
    return '<div class="kpi' + (variant ? ' kpi--' + variant : '') + '">'
      + '<p class="kpi__label">' + esc(label) + '</p>'
      + '<p class="kpi__value">' + esc(value) + '</p>'
      + '<p class="kpi__meta">' + esc(meta) + '</p></div>';
  }

  /* ---------- Vue : stock ---------- */

  function filteredProducts() {
    var f = filters.stock;
    var query = normalize(f.search);
    var list = state.products.filter(function (p) {
      if (query && normalize(p.title + ' ' + p.sku + ' ' + p.supplier + ' ' + p.location).indexOf(query) === -1) return false;
      if (f.category !== 'all' && p.category !== f.category) return false;
      if (f.status === 'in' && p.stock <= p.threshold) return false;
      if (f.status === 'low' && !(p.stock > 0 && p.stock <= p.threshold)) return false;
      if (f.status === 'out' && p.stock > 0) return false;
      if (f.internal !== 'all' && (p.status || 'Automatique') !== f.internal) return false;
      return true;
    });
    list.sort(function (a, b) {
      var key = f.sort;
      var va = a[key];
      var vb = b[key];
      if (typeof va === 'string') return f.dir * va.localeCompare(vb, 'fr');
      return f.dir * ((va || 0) - (vb || 0));
    });
    return list;
  }

  function viewStock() {
    var list = filteredProducts();
    var categories = state.products.reduce(function (acc, p) {
      if (acc.indexOf(p.category) === -1) acc.push(p.category);
      return acc;
    }, []);

    var rows = list.length ? list.map(function (p) {
      var ratio = p.threshold > 0 ? Math.min(100, (p.stock / (p.threshold * 3)) * 100) : 100;
      var barClass = p.stock <= 0 ? ' is-danger' : (p.stock <= p.threshold ? ' is-warn' : '');
      var margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0;
      return '<tr' + (p.visible === false ? ' class="is-hidden"' : '') + '>'
        + '<td><div class="cell-product">'
        + (p.image ? '<img class="thumb" src="' + esc(p.image) + '" alt="" loading="lazy">' : '<span class="thumb"></span>')
        + '<div><span class="cell-title">' + esc(p.title) + '</span><br>'
        + '<span class="cell-sub">' + esc(p.sku) + ' · ' + esc(p.category) + '</span></div></div></td>'
        + '<td class="num">' + money(p.price) + '<br><span class="cell-sub">marge ' + margin + ' %</span></td>'
        + '<td>'
        + '<div class="stepper">'
        + '<button type="button" data-adjust="' + esc(p.handle) + '" data-delta="-1" aria-label="Retirer une unité">−</button>'
        + '<input type="number" min="0" value="' + p.stock + '" data-stock="' + esc(p.handle) + '" aria-label="Stock">'
        + '<button type="button" data-adjust="' + esc(p.handle) + '" data-delta="1" aria-label="Ajouter une unité">+</button>'
        + '</div>'
        + '<div class="stock-bar"><i class="' + barClass.trim() + '" style="width:' + ratio + '%"></i></div></td>'
        + '<td class="num">' + p.threshold + '</td>'
        + '<td>' + availabilityTag(p) + stockNote(p) + '<br>' + badgeSummary(p) + '</td>'
        + '<td class="num">' + money(p.stock * p.cost) + '</td>'
        + '<td><span class="cell-sub">' + esc(p.location || '—') + '</span></td>'
        + '<td class="num"><button type="button" class="toggle' + (p.visible === false ? '' : ' is-on')
        + '" data-visible="' + esc(p.handle) + '" role="switch" aria-checked="' + (p.visible !== false)
        + '" title="' + (p.visible === false ? 'Masqué sur le site' : 'Visible sur le site')
        + '"><span></span></button></td>'
        + '<td class="actions">'
        + '<button type="button" class="btn btn--ghost btn--sm" data-product-edit="' + esc(p.handle) + '">Modifier</button>'
        + '<button type="button" class="btn btn--ghost btn--sm" data-product-delete="' + esc(p.handle) + '">Supprimer</button>'
        + '</td></tr>';
    }).join('') : emptyRow(9, 'Aucun produit', 'Ajustez la recherche ou les filtres.');

    var f = filters.stock;
    return '<div class="view"><section class="card">'
      + '<div class="toolbar">'
      + '<input type="search" placeholder="Rechercher un produit, une référence…" value="' + esc(f.search) + '" data-filter="stock.search">'
      + '<select data-filter="stock.category">'
      + '<option value="all">Toutes les catégories</option>'
      + categories.map(function (c) {
        return '<option value="' + esc(c) + '"' + (f.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('')
      + '</select>'
      + chip('stock.status', 'all', 'Tous', f.status)
      + chip('stock.status', 'in', 'En stock', f.status)
      + chip('stock.status', 'low', 'Stock faible', f.status)
      + chip('stock.status', 'out', 'Ruptures', f.status)
      + '<select data-filter="stock.internal">'
      + '<option value="all">Tous les statuts</option>'
      + state.productStatuses.map(function (s) {
        return '<option value="' + esc(s) + '"' + (f.internal === s ? ' selected' : '') + '>'
          + esc(s) + '</option>';
      }).join('')
      + '</select>'
      + '<div class="toolbar__right">'
      + '<button type="button" class="btn btn--ghost btn--sm" id="export-stock">Exporter en CSV</button>'
      + '<button type="button" class="btn btn--sm" id="product-new">Nouveau produit</button>'
      + '</div></div>'
      + '<div class="table-wrap"><table class="table"><thead><tr>'
      + th('Produit', 'title') + th('Prix', 'price', true) + '<th>Stock</th>'
      + th('Seuil', 'threshold', true) + '<th>État</th>' + th('Valeur', 'stock', true)
      + '<th>Emplacement</th><th class="num">Visible</th><th></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '</section></div>';
  }

  function th(label, key, num) {
    var f = filters.stock;
    var arrow = f.sort === key ? (f.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th class="sortable' + (num ? ' num' : '') + '" data-sort="' + key + '">'
      + esc(label) + '<span class="arrow">' + arrow + '</span></th>';
  }

  function chip(path, value, label, current) {
    return '<button type="button" class="chip' + (current === value ? ' is-active' : '')
      + '" data-chip="' + path + '" data-value="' + value + '">' + esc(label) + '</button>';
  }

  /* ---------- Vue : commandes ---------- */

  function viewOrders() {
    var f = filters.orders;
    var query = normalize(f.search);
    var list = state.orders.filter(function (o) {
      if (f.status !== 'all' && o.status !== f.status) return false;
      if (query && normalize(o.ref + ' ' + o.customerName).indexOf(query) === -1) return false;
      return true;
    });

    var rows = list.length ? list.map(function (o) {
      var units = o.items.reduce(function (sum, i) { return sum + i.quantity; }, 0);
      var options = state.orderStatuses.map(function (s) {
        return '<option value="' + esc(s) + '"' + (o.status === s ? ' selected' : '') + '>' + esc(s) + '</option>';
      }).join('');
      return '<tr>'
        + '<td class="cell-title">' + esc(o.ref) + '<br><span class="cell-sub">' + date(o.createdAt) + '</span></td>'
        + '<td>' + esc(o.customerName) + '</td>'
        + '<td class="num">' + units + ' art.</td>'
        + '<td class="num">' + money(orderTotal(o)) + '<br><span class="cell-sub">' + esc(o.payment) + '</span></td>'
        + '<td><select class="chip" style="border-radius:999px;padding:7px 12px" data-order-status="' + o.id + '">' + options + '</select></td>'
        + '<td class="actions">'
        + '<button type="button" class="btn btn--ghost btn--sm" data-order-detail="' + o.id + '">Détail</button>'
        + bordereauButton(o, ' btn--sm')
        + '<button type="button" class="btn btn--ghost btn--sm" data-ship-new="' + o.id + '">Expédier</button>'
        + '</td></tr>';
    }).join('') : emptyRow(6, 'Aucune commande', 'Créez une commande ou modifiez les filtres.');

    var statusChips = ['all'].concat(state.orderStatuses).map(function (s) {
      return chip('orders.status', s, s === 'all' ? 'Toutes' : s, f.status);
    }).join('');

    return '<div class="view"><section class="card">'
      + '<div class="toolbar">'
      + '<input type="search" placeholder="Rechercher une référence, un client…" value="' + esc(f.search) + '" data-filter="orders.search">'
      + statusChips
      + '<div class="toolbar__right">'
      + '<button type="button" class="btn btn--ghost btn--sm" id="export-orders">Exporter en CSV</button>'
      + '<button type="button" class="btn btn--sm" id="order-new">Nouvelle commande</button>'
      + '</div></div>'
      + '<div class="table-wrap"><table class="table"><thead><tr>'
      + '<th>Référence</th><th>Client</th><th class="num">Articles</th><th class="num">Total</th>'
      + '<th>Statut</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '</section></div>';
  }

  /* ---------- Vue : clients ---------- */

  function viewCustomers() {
    var query = normalize(filters.customers.search);
    var list = state.customers.filter(function (c) {
      if (!query) return true;
      return normalize(c.name + ' ' + c.email + ' ' + c.city + ' ' + c.country + ' ' + c.phone).indexOf(query) !== -1;
    });

    var rows = list.length ? list.map(function (c) {
      var orders = state.orders.filter(function (o) { return o.customerId === c.id; });
      var spent = orders
        .filter(function (o) { return ['Annulée', 'Remboursée'].indexOf(o.status) === -1; })
        .reduce(function (sum, o) { return sum + orderTotal(o); }, 0);
      return '<tr>'
        + '<td><span class="cell-title">' + esc(c.name) + '</span><br>'
        + '<span class="cell-sub">Client depuis le ' + date(c.createdAt) + '</span></td>'
        + '<td>' + esc(c.email || '—') + '<br><span class="cell-sub">' + esc(c.phone || '') + '</span></td>'
        + '<td>' + esc(c.city || '—') + '<br><span class="cell-sub">' + esc(c.country || '') + '</span></td>'
        + '<td class="num">' + orders.length + '</td>'
        + '<td class="num">' + money(spent) + '</td>'
        + '<td class="actions">'
        + '<button type="button" class="btn btn--ghost btn--sm" data-customer-edit="' + c.id + '">Modifier</button>'
        + '<button type="button" class="btn btn--ghost btn--sm" data-customer-delete="' + c.id + '">Supprimer</button>'
        + '</td></tr>';
    }).join('') : emptyRow(6, 'Aucun client', 'Ajoutez un client pour commencer.');

    return '<div class="view"><section class="card">'
      + '<div class="toolbar">'
      + '<input type="search" placeholder="Rechercher un client…" value="' + esc(filters.customers.search) + '" data-filter="customers.search">'
      + '<div class="toolbar__right">'
      + '<button type="button" class="btn btn--ghost btn--sm" id="export-customers">Exporter en CSV</button>'
      + '<button type="button" class="btn btn--sm" id="customer-new">Nouveau client</button>'
      + '</div></div>'
      + '<div class="table-wrap"><table class="table"><thead><tr>'
      + '<th>Nom</th><th>Contact</th><th>Ville</th><th class="num">Commandes</th>'
      + '<th class="num">Total dépensé</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '</section></div>';
  }

  /* ---------- Vue : messages ---------- */

  /* Ce que la boutique envoie : formulaire de contact et inscriptions à la
     newsletter. Tout est affiché comme du texte, jamais interprété. */

  var MESSAGE_TONES = {
    'Nouveau': 'tag--warn',
    'Lu': 'tag--info',
    'Traité': 'tag--ok',
    'Archivé': 'tag--neutral'
  };

  var MESSAGE_KINDS = { contact: 'Contact', newsletter: 'Newsletter' };

  function messageById(id) {
    return (state.messages || []).find(function (m) { return m.id === id; });
  }

  function messageTag(message) {
    return '<span class="tag ' + (MESSAGE_TONES[message.status] || 'tag--neutral') + '">'
      + esc(message.status) + '</span>';
  }

  function excerpt(text, max) {
    var clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '—';
    return clean.length > max ? esc(clean.slice(0, max - 1)) + '…' : esc(clean);
  }

  /* Le lien de réponse ouvre le client de messagerie avec l'objet déjà posé. */
  function replyLink(message) {
    var subject = message.kind === 'newsletter'
      ? 'Votre inscription à la newsletter 417 France'
      : 'Votre message à 417 France';
    return 'mailto:' + encodeURIComponent(message.email)
      + '?subject=' + encodeURIComponent(subject);
  }

  function viewMessages() {
    var f = filters.messages;
    var query = normalize(f.search);

    var list = (state.messages || []).filter(function (m) {
      if (f.status !== 'all' && m.status !== f.status) return false;
      if (f.kind !== 'all' && m.kind !== f.kind) return false;
      if (!query) return true;
      return normalize(m.name + ' ' + m.email + ' ' + m.phone + ' ' + m.message).indexOf(query) !== -1;
    });

    var rows = list.length ? list.map(function (m) {
      return '<tr' + (m.status === 'Nouveau' ? ' class="is-unread"' : '') + '>'
        + '<td><span class="cell-title">' + esc(m.name || 'Sans nom') + '</span><br>'
        + '<span class="cell-sub">' + esc(m.email) + (m.phone ? ' · ' + esc(m.phone) : '') + '</span></td>'
        + '<td><span class="cell-sub">' + esc(MESSAGE_KINDS[m.kind] || m.kind) + '</span></td>'
        + '<td>' + excerpt(m.message, 90) + '</td>'
        + '<td><span class="cell-sub">' + dateTime(m.createdAt) + '</span></td>'
        + '<td>' + messageTag(m) + '</td>'
        + '<td class="actions">'
        + '<button type="button" class="btn btn--ghost btn--sm" data-message-open="' + m.id + '">Ouvrir</button>'
        + '<button type="button" class="btn btn--ghost btn--sm" data-message-delete="' + m.id + '">Supprimer</button>'
        + '</td></tr>';
    }).join('') : emptyRow(6, 'Aucun message',
      'Les envois du formulaire de contact et les inscriptions à la newsletter arrivent ici.');

    var statusOptions = ['all'].concat(state.messageStatuses || []).map(function (s) {
      return '<option value="' + esc(s) + '"' + (f.status === s ? ' selected' : '') + '>'
        + (s === 'all' ? 'Tous les statuts' : esc(s)) + '</option>';
    }).join('');

    var kindOptions = [['all', 'Tous les formulaires'], ['contact', 'Contact'], ['newsletter', 'Newsletter']]
      .map(function (pair) {
        return '<option value="' + pair[0] + '"' + (f.kind === pair[0] ? ' selected' : '') + '>'
          + pair[1] + '</option>';
      }).join('');

    return '<div class="view"><section class="card">'
      + '<div class="toolbar">'
      + '<input type="search" placeholder="Rechercher un nom, une adresse, un mot…" value="'
      + esc(f.search) + '" data-filter="messages.search">'
      + '<select data-filter="messages.kind">' + kindOptions + '</select>'
      + '<select data-filter="messages.status">' + statusOptions + '</select>'
      + '<div class="toolbar__right">'
      + '<button type="button" class="btn btn--ghost btn--sm" id="export-messages">Exporter en CSV</button>'
      + '</div></div>'
      + '<div class="table-wrap"><table class="table"><thead><tr>'
      + '<th>Expéditeur</th><th>Formulaire</th><th>Message</th><th>Reçu le</th><th>Statut</th><th></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '</section></div>';
  }

  /* Fiche complète, avec le texte intégral et le changement de statut. */
  function messageDetail(id) {
    var m = messageById(id);
    if (!m) return;

    var statusButtons = (state.messageStatuses || []).map(function (s) {
      return '<button type="button" class="btn btn--ghost btn--sm' + (m.status === s ? ' is-active' : '')
        + '" data-message-status="' + esc(s) + '">' + esc(s) + '</button>';
    }).join('');

    var body = '<div class="detail-grid">'
      + '<div class="detail-box"><h3>Expéditeur</h3><p>' + esc(m.name || 'Sans nom') + '<br>'
      + '<a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a>'
      + (m.phone ? '<br>' + esc(m.phone) : '') + '</p></div>'
      + '<div class="detail-box"><h3>Reçu le</h3><p>' + dateTime(m.createdAt) + '<br>'
      + '<span class="cell-sub">' + esc(MESSAGE_KINDS[m.kind] || m.kind) + '</span></p></div>'
      + '</div>'
      + (m.message
        ? '<h3 class="form-title">Message</h3><p class="message-body">' + esc(m.message) + '</p>'
        : '<p class="field-hint">Inscription à la newsletter, sans message.</p>')
      + '<h3 class="form-title">Statut</h3>'
      + '<div class="btn-row" id="message-statuses">' + statusButtons + '</div>';

    openModal({
      title: 'Message de ' + (m.name || m.email),
      body: body,
      foot: '<button type="button" class="btn btn--ghost" data-close-modal>Fermer</button>'
        + '<a class="btn" href="' + replyLink(m) + '">Répondre par e-mail</a>',
      onOpen: function () {
        $$('[data-message-status]', modal).forEach(function (button) {
          button.addEventListener('click', function () {
            send('messages/status', { id: m.id, status: button.getAttribute('data-message-status') },
              'Statut mis à jour.').then(closeModal).catch(function () {});
          });
        });
      }
    });

    /* Ouvrir un message non lu le marque comme lu, sans rien demander. */
    if (m.status === 'Nouveau') {
      send('messages/status', { id: m.id, status: 'Lu' }).catch(function () {});
    }
  }

  /* ---------- Vue : livraisons ---------- */

  function viewShipments() {
    var f = filters.shipments;
    var query = normalize(f.search);
    var list = state.shipments.filter(function (s) {
      if (f.status !== 'all' && s.status !== f.status) return false;
      if (query && normalize(s.orderRef + ' ' + s.customerName + ' ' + s.carrier + ' ' + s.tracking).indexOf(query) === -1) return false;
      return true;
    });

    var rows = list.length ? list.map(function (s) {
      var url = trackingUrl(s.carrier, s.tracking);
      return '<tr>'
        + '<td class="cell-title">' + esc(s.orderRef) + '<br><span class="cell-sub">' + date(s.shippedAt) + '</span></td>'
        + '<td>' + esc(s.customerName) + '</td>'
        + '<td>' + esc(s.carrier) + '<br><span class="cell-sub">' + (s.weight ? s.weight.toFixed(2) + ' kg' : '—') + '</span></td>'
        + '<td>' + (url
          ? '<a href="' + esc(url) + '" target="_blank" rel="noopener" style="text-decoration:underline">' + esc(s.tracking) + '</a>'
          : esc(s.tracking || '—')) + '</td>'
        + '<td>' + shipmentTag(s.status) + '</td>'
        + '<td class="actions">'
        + bordereauButton(state.orders.find(function (o) { return o.id === s.orderId; }) || { id: s.orderId, label: true }, ' btn--sm')
        + '<button type="button" class="btn btn--ghost btn--sm" data-ship-edit="' + s.id + '">Modifier</button>'
        + '<button type="button" class="btn btn--ghost btn--sm" data-ship-delete="' + s.id + '">Supprimer</button>'
        + '</td></tr>';
    }).join('') : emptyRow(6, 'Aucune expédition', 'Créez une expédition depuis une commande.');

    var carriers = state.settings.carriers.map(function (c) {
      return '<div class="list__item"><div><strong>' + esc(c.name) + '</strong><br>'
        + '<span>Créer une étiquette sur le portail du transporteur</span></div>'
        + '<a class="btn btn--ghost btn--sm" style="margin-left:auto" href="' + esc(c.portal) + '" target="_blank" rel="noopener">Ouvrir ↗</a></div>';
    }).join('');

    var statusChips = ['all'].concat(state.shipmentStatuses).map(function (s) {
      return chip('shipments.status', s, s === 'all' ? 'Toutes' : s, f.status);
    }).join('');

    return '<div class="view">'
      + '<section class="card">'
      + '<div class="toolbar">'
      + '<input type="search" placeholder="Rechercher une expédition…" value="' + esc(f.search) + '" data-filter="shipments.search">'
      + statusChips
      + '<div class="toolbar__right">'
      + '<button type="button" class="btn btn--ghost btn--sm" id="export-shipments">Exporter en CSV</button>'
      + '<button type="button" class="btn btn--sm" id="ship-new">Nouvelle expédition</button>'
      + '</div></div>'
      + '<div class="table-wrap"><table class="table"><thead><tr>'
      + '<th>Commande</th><th>Client</th><th>Transporteur</th><th>Suivi</th><th>Statut</th><th></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '</section>'
      + '<section class="card"><div class="card__head"><h2>Portails transporteurs</h2></div>'
      + '<p class="card__sub">Créez l’étiquette sur le site du transporteur, puis joignez son PDF et son numéro de suivi avec « Bordereau » : le bouton ouvre ensuite l’étiquette, suivie du récapitulatif.</p>'
      + '<div class="list">' + carriers + '</div></section>'
      + '</div>';
  }

  /* ---------- Vue : réglages ---------- */

  /* ---------- Vue : codes de réduction ---------- */

  function discountById(id) {
    return (state.discounts || []).find(function (d) { return d.id === id; });
  }

  /* Ce que le code offre, en une ligne. */
  function discountEffect(d) {
    if (d.type === 'shipping') return 'Livraison offerte';
    if (d.type === 'amount') return money(d.value) + ' de remise';
    return d.value + ' % de remise';
  }

  /* Les conditions à remplir, les unes sous les autres. */
  function discountRules(d) {
    var rules = [d.auto ? 'Appliquée automatiquement' : 'Sur saisie du code'];
    if (d.minSubtotal) rules.push('Panier de ' + money(d.minSubtotal) + ' minimum');
    if (d.scope) rules.push('Gamme ' + d.scope + ' seulement');
    if (d.startsAt) rules.push('À partir du ' + date(d.startsAt));
    if (d.endsAt) rules.push('Jusqu’au ' + date(d.endsAt));
    if (d.maxUses) rules.push(d.maxUses + ' utilisation' + (d.maxUses > 1 ? 's' : '') + ' au total');
    return '<span class="cell-sub">' + rules.map(esc).join('<br>') + '</span>';
  }

  /* Un code peut être actif tout en étant hors période ou épuisé. */
  function discountStatus(d) {
    if (!d.active) return '<span class="tag tag--neutral">Inactif</span>';
    var today = new Date().toISOString().slice(0, 10);
    if (d.startsAt && today < d.startsAt) return '<span class="tag tag--info">Programmé</span>';
    if (d.endsAt && today > d.endsAt) return '<span class="tag tag--danger">Expiré</span>';
    if (d.maxUses && (d.used || 0) >= d.maxUses) return '<span class="tag tag--warn">Épuisé</span>';
    return '<span class="tag tag--ok">En cours</span>';
  }

  function viewDiscounts() {
    var list = (state.discounts || []).slice().sort(function (a, b) {
      return String(a.code).localeCompare(String(b.code));
    });

    var rows = list.length ? list.map(function (d) {
      return '<tr>'
        + '<td><span class="cell-title">' + esc(d.code) + '</span><br>'
        + '<span class="cell-sub">' + esc(d.label || '—') + '</span></td>'
        + '<td>' + esc(discountEffect(d)) + '</td>'
        + '<td>' + discountRules(d) + '</td>'
        + '<td class="num">' + (d.used || 0) + (d.maxUses ? ' / ' + d.maxUses : '') + '</td>'
        + '<td>' + discountStatus(d) + '</td>'
        + '<td class="actions">'
        + '<button type="button" class="btn btn--ghost btn--sm" data-discount-toggle="' + d.id + '">'
        + (d.active ? 'Désactiver' : 'Activer') + '</button>'
        + '<button type="button" class="btn btn--ghost btn--sm" data-discount-edit="' + d.id + '">Modifier</button>'
        + '<button type="button" class="btn btn--ghost btn--sm" data-discount-delete="' + d.id + '">Supprimer</button>'
        + '</td></tr>';
    }).join('') : emptyRow(6, 'Aucun code de réduction', 'Créez un code pour lancer une offre.');

    return '<div class="view"><section class="card">'
      + '<div class="toolbar"><div class="toolbar__right">'
      + '<button type="button" class="btn btn--ghost btn--sm" id="export-discounts">Exporter en CSV</button>'
      + '<button type="button" class="btn btn--sm" id="discount-new">Nouveau code</button>'
      + '</div></div>'
      + '<div class="table-wrap"><table class="table"><thead><tr>'
      + '<th>Code</th><th>Avantage</th><th>Conditions</th><th class="num">Utilisé</th>'
      + '<th>État</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '</section>'
      + '<section class="card"><div class="card__head"><h2>Prise en compte au paiement</h2></div>'
      + '<p class="card__sub">Les codes sont enregistrés et suivis ici. Pour qu’un client puisse '
      + 'en saisir un, la boutique doit disposer d’une caisse en ligne : le bouton « Procéder au '
      + 'paiement » ne fait encore rien. Les codes ne sont pas publiés dans les pages du site, '
      + 'sinon n’importe quel visiteur pourrait lire ceux qui ne sont pas encore lancés.</p>'
      + '</section></div>';
  }

  function discountForm(id) {
    var d = id ? discountById(id) : null;

    function options(pairs, current) {
      return pairs.map(function (pair) {
        return '<option value="' + esc(pair[0]) + '"'
          + (String(current == null ? '' : current) === pair[0] ? ' selected' : '')
          + '>' + esc(pair[1]) + '</option>';
      }).join('');
    }

    var types = [['percent', 'Pourcentage sur le panier'], ['amount', 'Montant fixe en euros'],
      ['shipping', 'Livraison offerte']];
    var scopes = [['', 'Tout le catalogue'], ['Visage', 'Soins du visage'], ['Corps', 'Soins du corps']];

    var body = '<form id="discount-form"><div class="grid-2">'
      + '<div class="field"><label for="d-code">Code</label>'
      + '<input id="d-code" name="code" value="' + esc(d ? d.code : '') + '" placeholder="BIENVENUE10" required></div>'
      + '<div class="field"><label for="d-label">Intitulé interne</label>'
      + '<input id="d-label" name="label" value="' + esc(d ? d.label : '') + '" placeholder="Offre de bienvenue"></div>'
      + '<div class="field"><label for="d-type">Avantage</label>'
      + '<select id="d-type" name="type">' + options(types, d ? d.type : 'percent') + '</select></div>'
      + '<div class="field" data-value-field><label for="d-value">Valeur</label>'
      + '<input id="d-value" name="value" type="number" min="0" step="0.01" value="' + esc(d ? d.value : 10) + '"></div>'
      + '<div class="field"><label for="d-min">Panier minimum en euros</label>'
      + '<input id="d-min" name="minSubtotal" type="number" min="0" step="1" value="' + esc(d ? d.minSubtotal : 0) + '"></div>'
      + '<div class="field"><label for="d-scope">S’applique à</label>'
      + '<select id="d-scope" name="scope">' + options(scopes, d ? d.scope : '') + '</select></div>'
      + '<div class="field"><label for="d-starts">Début</label>'
      + '<input id="d-starts" name="startsAt" type="date" value="' + esc(d ? d.startsAt : '') + '"></div>'
      + '<div class="field"><label for="d-ends">Fin</label>'
      + '<input id="d-ends" name="endsAt" type="date" value="' + esc(d ? d.endsAt : '') + '"></div>'
      + '<div class="field"><label for="d-max">Utilisations, 0 pour illimité</label>'
      + '<input id="d-max" name="maxUses" type="number" min="0" step="1" value="' + esc(d ? d.maxUses : 0) + '"></div>'
      + '<div class="field"><label for="d-auto">Application</label>'
      + '<select id="d-auto" name="auto">'
      + '<option value="false"' + (d && d.auto ? '' : ' selected') + '>Sur saisie du code</option>'
      + '<option value="true"' + (d && d.auto ? ' selected' : '') + '>Automatique, sans code</option>'
      + '</select></div>'
      + '<div class="field"><label for="d-active">État</label>'
      + '<select id="d-active" name="active">'
      + '<option value="true"' + (!d || d.active ? ' selected' : '') + '>Actif</option>'
      + '<option value="false"' + (d && !d.active ? ' selected' : '') + '>Inactif</option>'
      + '</select></div>'
      + '</div><p class="field-hint" data-value-hint></p></form>';

    openModal({
      title: d ? 'Modifier le code' : 'Nouveau code de réduction',
      body: body,
      foot: '<button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>'
        + '<button type="submit" form="discount-form" class="btn">Enregistrer</button>',
      onOpen: function () {
        var type = $('#d-type');
        var value = $('#d-value');
        var hint = $('[data-value-hint]');

        /* La valeur n'a pas de sens pour une livraison offerte. */
        function syncType() {
          var shipping = type.value === 'shipping';
          value.disabled = shipping;
          $('[data-value-field]').style.opacity = shipping ? '0.45' : '';
          if (shipping) hint.textContent = 'La livraison est offerte dès que les conditions sont remplies.';
          else if (type.value === 'percent') hint.textContent = 'Pourcentage retiré du panier, de 1 à 100.';
          else hint.textContent = 'Montant en euros retiré du panier.';
        }

        type.addEventListener('change', syncType);
        syncType();

        $('#discount-form').addEventListener('submit', function (event) {
          event.preventDefault();
          var discount = d ? { id: d.id } : {};
          $('#discount-form [name]').forEach(function (input) { discount[input.name] = input.value; });
          send('discounts/save', { discount: discount }, 'Code enregistré.')
            .then(closeModal).catch(function () {});
        });
      }
    });
  }

  function exportDiscounts() {
    var rows = [['Code', 'Intitule', 'Avantage', 'Panier minimum', 'Gamme',
      'Debut', 'Fin', 'Utilisations', 'Maximum', 'Actif']];
    (state.discounts || []).forEach(function (d) {
      rows.push([d.code, d.label || '', discountEffect(d), d.minSubtotal || 0, d.scope || 'Tout',
        d.startsAt || '', d.endsAt || '', d.used || 0, d.maxUses || 0, d.active ? 'oui' : 'non']);
    });
    download('417-codes-reduction.csv', rows);
  }

  function viewSettings() {
    var s = state.settings;
    return '<div class="view">'
      + '<section class="card"><div class="card__head"><h2>Informations de la boutique</h2></div>'
      + '<p class="card__sub">Ces informations apparaissent sur les bordereaux de livraison.</p>'
      + '<form id="settings-form">'
      + '<div class="grid-2">'
      + field('shopName', 'Nom commercial', s.shopName)
      + field('legalName', 'Raison sociale', s.legalName)
      + field('address', 'Adresse', s.address)
      + field('zip', 'Code postal', s.zip)
      + field('city', 'Ville', s.city)
      + field('country', 'Pays', s.country)
      + field('email', 'E-mail', s.email, 'email')
      + field('phone', 'Téléphone', s.phone)
      + field('siret', 'SIRET', s.siret)
      + field('vatNumber', 'N° de TVA', s.vatNumber)
      + '</div>'
      + '<div class="grid-3">'
      + field('freeShippingThreshold', 'Livraison offerte dès (€)', s.freeShippingThreshold, 'number')
      + '<div class="field"><label for="set-parcelWeight">Poids d’un colis par défaut (kg)</label>'
      + '<input id="set-parcelWeight" name="parcelWeight" type="number" min="0.05" step="0.01" value="' + esc(s.parcelWeight || 0.5) + '"></div>'
      + field('lowStockAlert', 'Seuil d’alerte stock', s.lowStockAlert, 'number')
      + field('vatRate', 'Taux de TVA (%)', s.vatRate, 'number')
      + '</div>'
      + '<button type="submit" class="btn">Enregistrer les réglages</button>'
      + '</form></section>'

      + '<div class="split--even split">'
      + '<section class="card"><div class="card__head"><h2>Mot de passe</h2></div>'
      + '<p class="card__sub">Huit caractères minimum. La session reste ouverte après le changement.</p>'
      + '<form id="password-form">'
      + '<div class="field"><label for="pw-current">Mot de passe actuel</label>'
      + '<input id="pw-current" type="password" autocomplete="current-password" required></div>'
      + '<div class="field"><label for="pw-next">Nouveau mot de passe</label>'
      + '<input id="pw-next" type="password" autocomplete="new-password" minlength="8" required></div>'
      + '<button type="submit" class="btn">Modifier le mot de passe</button>'
      + '</form></section>'

      + '<section class="card"><div class="card__head"><h2>Données de démonstration</h2></div>'
      + '<p class="card__sub">La base contient des clients, commandes et expéditions d’exemple pour illustrer le back-office. Supprimez-les avant de passer en production.</p>'
      + '<p style="font-size:13px;color:var(--muted)">Clients de démonstration : '
      + state.customers.filter(function (c) { return c.demo; }).length + ' · Commandes : '
      + state.orders.filter(function (o) { return o.demo; }).length + '</p>'
      + '<button type="button" class="btn btn--danger" id="clear-demo">Supprimer les données de démonstration</button>'
      + '</section>'
      + '</div></div>';
  }

  function field(name, label, value, type) {
    return '<div class="field"><label for="set-' + name + '">' + esc(label) + '</label>'
      + '<input id="set-' + name + '" name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value) + '"></div>';
  }

  /* ---------- Formulaires en fenêtre modale ---------- */

  function productForm(handle) {
    var p = handle ? state.products.find(function (x) { return x.handle === handle; }) : null;
    var images = p && p.images ? p.images.map(function (i) { return { src: i.src, alt: i.alt || '' }; }) : [];
    var sections = p && p.description ? p.description.map(function (d) { return { title: d.title, body: d.body }; }) : [];
    var badge = (p && p.badge) || { enabled: true, text: 'Épuisé', when: 'out-of-stock', tone: 'sombre' };
    /* « always » vient des fiches d'avant les trois etats. */
    var badgeWhen = AVAILABILITY_LABELS[badge.when] ? badge.when : 'out-of-stock';

    function imageRows() {
      return images.map(function (image, i) {
        return '<div class="repeat__row repeat__row--media">'
          + (image.src ? '<img src="' + esc(image.src) + '" alt="">' : '<span class="field-media__empty"></span>')
          + '<input type="text" data-image="' + i + '" value="' + esc(image.src) + '" placeholder="/assets/img/nom.jpg">'
          + '<button type="button" class="icon-btn" data-image-remove="' + i + '" aria-label="Supprimer">&times;</button>'
          + '</div>';
      }).join('') || '<p class="field-hint">Aucune image. La premiere sert de visuel principal.</p>';
    }

    function sectionRows() {
      return sections.map(function (section, i) {
        return '<div class="repeat__block">'
          + '<div class="repeat__head"><span>' + (i + 1) + '</span>'
          + '<button type="button" class="icon-btn" data-section-remove="' + i + '" aria-label="Supprimer">&times;</button></div>'
          + '<div class="field"><label>Intitule</label>'
          + '<input type="text" data-section-title="' + i + '" value="' + esc(section.title) + '"></div>'
          + '<div class="field"><label>Contenu (HTML autorise)</label>'
          + '<textarea data-section-body="' + i + '" rows="5">' + esc(section.body) + '</textarea></div>'
          + '</div>';
      }).join('') || '<p class="field-hint">Aucune section de description.</p>';
    }

    var body = '<form id="product-form">'
      + '<div class="grid-2">'
      + '<div class="field"><label for="p-title">Nom du produit</label>'
      + '<input id="p-title" name="title" value="' + esc(p ? p.title : '') + '" required></div>'
      + '<div class="field"><label for="p-sku">Reference (SKU)</label>'
      + '<input id="p-sku" name="sku" value="' + esc(p ? p.sku : '') + '"></div>'
      + '<div class="field"><label for="p-price">Prix de vente (EUR)</label>'
      + '<input id="p-price" name="price" type="number" step="0.01" min="0" value="' + (p ? p.price : 0) + '"></div>'
      + '<div class="field"><label for="p-compare">Prix barre (EUR)</label>'
      + '<input id="p-compare" name="compareAt" type="number" step="0.01" min="0" value="' + (p && p.compareAt ? p.compareAt : '') + '"></div>'
      + '<div class="field"><label for="p-cost">Prix d\u2019achat (EUR)</label>'
      + '<input id="p-cost" name="cost" type="number" step="0.01" min="0" value="' + (p ? p.cost : 0) + '"></div>'
      + '<div class="field"><label for="p-stock">Stock</label>'
      + '<input id="p-stock" name="stock" type="number" min="0" value="' + (p ? p.stock : 0) + '"></div>'
      + '<div class="field"><label for="p-threshold">Seuil d\u2019alerte</label>'
      + '<input id="p-threshold" name="threshold" type="number" min="0" value="' + (p ? p.threshold : 8) + '"></div>'
      + '<div class="field"><label for="p-category">Categorie</label>'
      + '<select id="p-category" name="category">'
      + ['Visage', 'Corps'].map(function (c) {
        return '<option' + (p && p.category === c ? ' selected' : '') + '>' + c + '</option>';
      }).join('')
      + '</select></div>'
      + '<div class="field"><label for="p-supplier">Fournisseur</label>'
      + '<input id="p-supplier" name="supplier" value="' + esc(p ? p.supplier : '') + '"></div>'
      + '<div class="field"><label for="p-location">Emplacement</label>'
      + '<input id="p-location" name="location" value="' + esc(p ? p.location : '') + '"></div>'
      + '</div>'

      + '<div class="field"><label for="p-excerpt">Resume (referencement et recherche)</label>'
      + '<textarea id="p-excerpt" name="excerpt" rows="2">' + esc(p ? p.excerpt : '') + '</textarea></div>'

      + '<label class="switch"><input type="checkbox" id="p-visible"' + (!p || p.visible !== false ? ' checked' : '') + '>'
      + '<span>Visible sur le site</span></label>'

      + '<h3 class="form-title">Vignette et statut</h3>'
      + '<div class="grid-2">'
      + '<div class="field"><label for="p-status">Statut du produit</label>'
      + '<select id="p-status">' + state.productStatuses.map(function (s) {
        return '<option' + (p && p.status === s ? ' selected' : '') + '>' + esc(s) + '</option>';
      }).join('') + '</select>'
      + '<p class="field-hint">Un produit sans stock est annonce En arrivage sur la boutique. '
      + 'Le statut Arrete le passe sur Epuise.</p></div>'
      + '<div class="field"><label for="p-badge-text">Texte de la vignette</label>'
      + '<input id="p-badge-text" value="' + esc(badge.text || '') + '" placeholder="Epuise, Nouveau, -20 %..."></div>'
      + '<div class="field"><label for="p-badge-when">Afficher la vignette quand le produit est</label>'
      + '<select id="p-badge-when">'
      + ['in-stock', 'out-of-stock', 'incoming'].map(function (value) {
        return '<option value="' + value + '"' + (badgeWhen === value ? ' selected' : '') + '>'
          + AVAILABILITY_LABELS[value] + '</option>';
      }).join('')
      + '</select></div>'
      + '<div class="field"><label for="p-badge-tone">Apparence</label>'
      + '<select id="p-badge-tone">'
      + '<option value="sombre"' + (badge.tone === 'sombre' ? ' selected' : '') + '>Fond sombre</option>'
      + '<option value="clair"' + (badge.tone === 'clair' ? ' selected' : '') + '>Fond clair</option>'
      + '<option value="accent"' + (badge.tone === 'accent' ? ' selected' : '') + '>Vert mineral</option>'
      + '</select></div>'
      + '</div>'
      + '<label class="switch"><input type="checkbox" id="p-badge-on"' + (badge.enabled ? ' checked' : '') + '>'
      + '<span>Afficher la vignette en haut a gauche de la carte produit</span></label>'
      + '<p class="field-hint">La vignette ne sort que pour l’etat choisi ci-dessus. '
      + 'Sans vignette active, une etiquette Promotion apparait si un prix barre est renseigne.</p>'

      + '<h3 class="form-title">Images</h3>'
      + '<div class="repeat" id="image-list">' + imageRows() + '</div>'
      + '<button type="button" class="btn btn--ghost btn--sm" id="add-image">Ajouter une image</button>'

      + '<h3 class="form-title">Description</h3>'
      + '<div class="repeat" id="section-list">' + sectionRows() + '</div>'
      + '<button type="button" class="btn btn--ghost btn--sm" id="add-section">Ajouter une section</button>'
      + '</form>';

    function readLists() {
      $$('[data-image]', modal).forEach(function (input) {
        images[Number(input.getAttribute('data-image'))].src = input.value.trim();
      });
      $$('[data-section-title]', modal).forEach(function (input) {
        sections[Number(input.getAttribute('data-section-title'))].title = input.value;
      });
      $$('[data-section-body]', modal).forEach(function (input) {
        sections[Number(input.getAttribute('data-section-body'))].body = input.value;
      });
    }

    function redraw() {
      $('#image-list').innerHTML = imageRows();
      $('#section-list').innerHTML = sectionRows();
      bindLists();
    }

    function bindLists() {
      $$('[data-image-remove]', modal).forEach(function (button) {
        button.addEventListener('click', function () {
          readLists();
          images.splice(Number(button.getAttribute('data-image-remove')), 1);
          redraw();
        });
      });
      $$('[data-section-remove]', modal).forEach(function (button) {
        button.addEventListener('click', function () {
          readLists();
          sections.splice(Number(button.getAttribute('data-section-remove')), 1);
          redraw();
        });
      });
    }

    openModal({
      title: p ? 'Modifier le produit' : 'Nouveau produit',
      body: body,
      wide: true,
      foot: '<button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>'
        + '<button type="submit" form="product-form" class="btn">Enregistrer</button>',
      onOpen: function () {
        bindLists();
        $('#add-image').addEventListener('click', function () {
          readLists();
          images.push({ src: '', alt: '' });
          redraw();
        });
        $('#add-section').addEventListener('click', function () {
          readLists();
          sections.push({ title: 'Nouvelle section', body: '<p></p>' });
          redraw();
        });

        $('#product-form').addEventListener('submit', function (event) {
          event.preventDefault();
          readLists();
          var patch = {};
          $$('#product-form [name]').forEach(function (input) { patch[input.name] = input.value; });
          patch.visible = $('#p-visible').checked;
          patch.status = $('#p-status').value;
          patch.badge = {
            enabled: $('#p-badge-on').checked,
            text: $('#p-badge-text').value,
            when: $('#p-badge-when').value,
            tone: $('#p-badge-tone').value
          };
          patch.images = images.filter(function (i) { return i.src; });
          patch.description = sections.filter(function (s) { return s.body && s.body.trim(); });

          var request = p
            ? send('products/update', { handle: p.handle, patch: patch }, 'Produit mis a jour.')
            : send('products/create', patch, 'Produit cree.');
          request.then(closeModal).catch(function () {});
        });
      }
    });
  }

  function customerForm(id) {
    var c = id ? customerById(id) : null;
    var body = '<form id="customer-form"><div class="grid-2">'
      + '<div class="field"><label for="c-name">Nom complet</label>'
      + '<input id="c-name" name="name" value="' + esc(c ? c.name : '') + '" required></div>'
      + '<div class="field"><label for="c-email">E-mail</label>'
      + '<input id="c-email" name="email" type="email" value="' + esc(c ? c.email : '') + '"></div>'
      + '<div class="field"><label for="c-phone">Téléphone</label>'
      + '<input id="c-phone" name="phone" value="' + esc(c ? c.phone : '') + '"></div>'
      + '<div class="field"><label for="c-country">Pays</label>'
      + '<input id="c-country" name="country" value="' + esc(c ? c.country : 'France') + '"></div>'
      + '</div>'
      + '<div class="field"><label for="c-address">Adresse</label>'
      + '<input id="c-address" name="address" value="' + esc(c ? c.address : '') + '"></div>'
      + '<div class="grid-2">'
      + '<div class="field"><label for="c-zip">Code postal</label>'
      + '<input id="c-zip" name="zip" value="' + esc(c ? c.zip : '') + '"></div>'
      + '<div class="field"><label for="c-city">Ville</label>'
      + '<input id="c-city" name="city" value="' + esc(c ? c.city : '') + '"></div>'
      + '</div>'
      + '<div class="field"><label for="c-notes">Notes internes</label>'
      + '<textarea id="c-notes" name="notes">' + esc(c ? c.notes : '') + '</textarea></div>'
      + '</form>';

    openModal({
      title: c ? 'Modifier le client' : 'Nouveau client',
      body: body,
      foot: '<button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>'
        + '<button type="submit" form="customer-form" class="btn">Enregistrer</button>',
      onOpen: function () {
        $('#customer-form').addEventListener('submit', function (event) {
          event.preventDefault();
          var customer = c ? { id: c.id } : {};
          $$('#customer-form [name]').forEach(function (input) { customer[input.name] = input.value; });
          send('customers/save', { customer: customer }, 'Client enregistré.')
            .then(closeModal).catch(function () {});
        });
      }
    });
  }

  function orderForm(id) {
    var order = id ? state.orders.find(function (o) { return o.id === id; }) : null;
    var lines = order ? order.items.slice() : [{ handle: state.products[0].handle, quantity: 1 }];

    function productOptions(selected) {
      return state.products.map(function (p) {
        return '<option value="' + esc(p.handle) + '"' + (p.handle === selected ? ' selected' : '') + '>'
          + esc(p.title) + ' — ' + money(p.price) + ' (' + p.stock + ' en stock)</option>';
      }).join('');
    }

    function renderLines() {
      return lines.map(function (line, index) {
        var product = state.products.find(function (p) { return p.handle === line.handle; }) || state.products[0];
        return '<div class="line-row" data-line="' + index + '">'
          + '<select data-line-handle>' + productOptions(product.handle) + '</select>'
          + '<input type="number" min="1" value="' + line.quantity + '" data-line-qty aria-label="Quantité">'
          + '<span class="price">' + money(product.price * line.quantity) + '</span>'
          + '<button type="button" class="icon-btn" data-line-remove aria-label="Retirer la ligne">'
          + '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>'
          + '</button></div>';
      }).join('');
    }

    var customerOptions = state.customers.map(function (c) {
      return '<option value="' + c.id + '"' + (order && order.customerId === c.id ? ' selected' : '') + '>'
        + esc(c.name) + (c.city ? ' — ' + esc(c.city) : '') + '</option>';
    }).join('');

    var body = '<form id="order-form">'
      + '<div class="grid-2">'
      + '<div class="field"><label for="o-customer">Client</label>'
      + '<select id="o-customer" name="customerId" required>' + customerOptions + '</select></div>'
      + '<div class="field"><label for="o-payment">Paiement</label>'
      + '<select id="o-payment" name="payment">'
      + ['En attente', 'Payée', 'Remboursée'].map(function (p) {
        return '<option' + (order && order.payment === p ? ' selected' : '') + '>' + p + '</option>';
      }).join('')
      + '</select></div></div>'
      + '<div class="field"><label>Articles</label>'
      + '<div class="line-editor" id="lines">' + renderLines() + '</div>'
      + '<button type="button" class="btn btn--ghost btn--sm" id="add-line" style="margin-top:10px">Ajouter un article</button>'
      + '</div>'
      + '<div class="field"><label for="o-note">Note de commande</label>'
      + '<textarea id="o-note" name="note">' + esc(order ? order.note : '') + '</textarea></div>'
      + '<p style="text-align:right;font-size:15px;font-weight:600" id="order-sum"></p>'
      + '</form>';

    function syncLines() {
      $$('#lines .line-row').forEach(function (row, index) {
        lines[index].handle = $('[data-line-handle]', row).value;
        lines[index].quantity = Math.max(1, parseInt($('[data-line-qty]', row).value, 10) || 1);
      });
      var total = lines.reduce(function (sum, line) {
        var product = state.products.find(function (p) { return p.handle === line.handle; });
        return sum + (product ? product.price * line.quantity : 0);
      }, 0);
      var shipping = total >= state.settings.freeShippingThreshold ? 0 : 6.9;
      $('#order-sum').textContent = 'Total : ' + money(total + shipping)
        + (shipping ? ' (dont ' + money(shipping) + ' de livraison)' : ' — livraison offerte');
      $('#lines').innerHTML = renderLines();
      bindLines();
    }

    function bindLines() {
      $$('#lines .line-row').forEach(function (row) {
        $('[data-line-handle]', row).addEventListener('change', syncLines);
        $('[data-line-qty]', row).addEventListener('change', syncLines);
        $('[data-line-remove]', row).addEventListener('click', function () {
          if (lines.length === 1) return;
          lines.splice(Number(row.getAttribute('data-line')), 1);
          syncLines();
        });
      });
    }

    openModal({
      title: order ? 'Modifier la commande ' + order.ref : 'Nouvelle commande',
      body: body,
      wide: true,
      foot: '<button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>'
        + '<button type="submit" form="order-form" class="btn">Enregistrer</button>',
      onOpen: function () {
        bindLines();
        syncLines();
        $('#add-line').addEventListener('click', function () {
          lines.push({ handle: state.products[0].handle, quantity: 1 });
          syncLines();
        });
        $('#order-form').addEventListener('submit', function (event) {
          event.preventDefault();
          send('orders/save', {
            order: {
              id: order ? order.id : null,
              customerId: $('#o-customer').value,
              payment: $('#o-payment').value,
              note: $('#o-note').value,
              items: lines
            }
          }, order ? 'Commande mise à jour.' : 'Commande créée, stock décrémenté.')
            .then(closeModal).catch(function () {});
        });
      }
    });
  }

  /* « Bordereau » ouvre l'étiquette du transporteur. Tant qu'elle n'est pas
     jointe à la commande, le bouton propose de l'ajouter. */
  function bordereauButton(order, size) {
    if (order.label) {
      return '<a class="btn btn--ghost' + size + '" href="/admin/bordereau/' + esc(order.id) + '" target="_blank" rel="noopener">Bordereau</a>';
    }
    return '<button type="button" class="btn btn--ghost' + size + '" data-label-upload="' + esc(order.id) + '">Bordereau</button>';
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-label-upload]');
    if (!trigger) return;
    event.preventDefault();
    closeModal();
    labelUploadForm(trigger.getAttribute('data-label-upload'));
  });

  /* Étiquette créée à la main sur le site du transporteur : on joint son PDF
     et son numéro de suivi à la commande. */
  function labelUploadForm(id) {
    var order = state.orders.find(function (o) { return o.id === id; });
    if (!order) return;
    var d = order.delivery || {};
    var current = order.label ? order.label.carrier : (d.carrier || '');
    var portal = state.settings.carriers.find(function (c) { return c.name === current; });
    var carrierOptions = state.settings.carriers.map(function (c) {
      return '<option value="' + esc(c.name) + '"' + (c.name === current ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
    var where = d.relay
      ? 'Point relais n° <strong>' + esc(d.relay.id) + '</strong> — ' + esc(d.relay.name) + ', ' + esc(d.relay.zip + ' ' + d.relay.city)
      : d.address ? esc(d.address.address) + ', ' + esc(d.address.zip + ' ' + d.address.city) : '';

    openModal({
      title: (order.label ? 'Remplacer le bordereau — ' : 'Ajouter le bordereau — ') + order.ref,
      body: (d.carrier
          ? '<p style="margin-top:0"><strong>' + esc(d.carrier) + '</strong> — ' + esc(d.label) + '<br>'
            + '<span class="cell-sub">' + esc(order.customerName) + (where ? ' · ' + where : '') + '</span></p>'
          : '')
        + (portal
          ? '<p class="cell-sub">1. Créez l’étiquette sur <a href="' + esc(portal.portal) + '" target="_blank" rel="noopener" style="text-decoration:underline">le site ' + esc(portal.name) + '</a>, puis téléchargez-la en PDF.<br>'
            + '2. Joignez-la ici avec son numéro de suivi. « Bordereau » l’ouvrira ensuite, suivie du récapitulatif.</p>'
          : '')
        + '<div class="grid-2">'
        + '<div class="field"><label for="u-carrier">Transporteur</label><select id="u-carrier">' + carrierOptions + '</select></div>'
        + '<div class="field"><label for="u-tracking">N° de suivi</label><input id="u-tracking" type="text" required value="' + esc(order.label ? order.label.tracking : '') + '"></div>'
        + '</div>'
        + '<div class="grid-2">'
        + '<div class="field"><label for="u-file">Étiquette (PDF)</label><input id="u-file" type="file" accept="application/pdf,.pdf" required></div>'
        + '<div class="field"><label for="u-weight">Poids (kg, facultatif)</label><input id="u-weight" type="number" min="0" step="0.01" value="' + (order.label && order.label.weight ? order.label.weight : '') + '"></div>'
        + '</div>'
        + '<p id="u-error" style="color:#98362f;margin-bottom:0"></p>',
      foot: '<button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>'
        + '<button type="button" class="btn" id="u-save">Enregistrer le bordereau</button>',
      onOpen: function () {
        var button = $('#u-save');
        var fail = function (message) {
          button.disabled = false;
          button.textContent = 'Enregistrer le bordereau';
          $('#u-error').textContent = message;
        };
        button.addEventListener('click', function () {
          var file = $('#u-file').files[0];
          var tracking = $('#u-tracking').value.trim();
          if (!tracking) return fail('Indiquez le numéro de suivi.');
          if (!file) return fail('Choisissez le fichier PDF de l’étiquette.');
          if (file.size > 5 * 1024 * 1024) return fail('Fichier trop lourd (5 Mo au plus).');
          button.disabled = true;
          button.textContent = 'Enregistrement…';
          $('#u-error').textContent = '';
          var reader = new FileReader();
          reader.onload = function () {
            api('orders/label-upload', {
              id: order.id,
              carrier: $('#u-carrier').value,
              tracking: tracking,
              weight: Number($('#u-weight').value) || 0,
              pdf: reader.result
            }).then(function (result) {
              if (result.state) { state = result.state; render(); }
              closeModal();
              toast('Bordereau enregistré : « Bordereau » l’ouvre désormais.');
              orderDetail(order.id);
            }).catch(function (err) { fail(err.message); });
          };
          reader.onerror = function () { fail('Lecture du fichier impossible.'); };
          reader.readAsDataURL(file);
        });
      }
    });
  }

  /* Un bordereau s'achète pour une commande payée en ligne, pas annulée, qui
     n'en a pas encore. */
  function canBuyLabel(order) {
    return Boolean(order.delivery && order.delivery.method && !order.label
      && ['Annulée', 'Remboursée'].indexOf(order.status) === -1
      && state.labelCarriers && state.labelCarriers[order.delivery.carrier]);
  }

  function labelForm(id) {
    var order = state.orders.find(function (o) { return o.id === id; });
    if (!order) return;
    var d = order.delivery || {};
    var units = order.items.reduce(function (sum, i) { return sum + i.quantity; }, 0);
    var weight = Number(state.settings.parcelWeight) || 0.5;
    var where = d.relay
      ? 'Point relais n° ' + esc(d.relay.id) + ' — ' + esc(d.relay.name) + ', ' + esc(d.relay.zip + ' ' + d.relay.city)
      : d.address ? esc(d.address.address) + ', ' + esc(d.address.zip + ' ' + d.address.city) : '';
    openModal({
      title: 'Acheter le bordereau — ' + order.ref,
      body: '<p style="margin-top:0"><strong>' + esc(d.carrier) + '</strong> — ' + esc(d.label) + '<br>'
        + '<span class="cell-sub">' + esc(order.customerName) + ' · ' + where + '</span></p>'
        + '<div class="field"><label for="l-weight">Poids du colis emballé (kg)</label>'
        + '<input id="l-weight" type="number" min="0.05" max="30" step="0.01" value="' + weight + '"></div>'
        + '<p class="cell-sub" style="margin-bottom:0">' + units + ' article' + (units > 1 ? 's' : '') + '. '
        + 'L’étiquette est créée chez le transporteur et facturée sur le compte de la boutique. '
        + 'Le numéro de suivi est ajouté à la commande et l’expédition est créée.</p>'
        + '<p class="form-error" id="l-error" style="color:#98362f;margin-bottom:0"></p>',
      foot: '<button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>'
        + '<button type="button" class="btn" id="l-buy">Acheter le bordereau</button>',
      onOpen: function () {
        var button = $('#l-buy');
        button.addEventListener('click', function () {
          button.disabled = true;
          button.textContent = 'Création en cours…';
          $('#l-error').textContent = '';
          api('orders/label', { id: order.id, weight: Number($('#l-weight').value) }).then(function (result) {
            if (result.state) { state = result.state; render(); }
            closeModal();
            toast('Bordereau créé : ' + result.order.label.tracking);
            orderDetail(order.id);
          }).catch(function (err) {
            button.disabled = false;
            button.textContent = 'Acheter le bordereau';
            $('#l-error').textContent = err.message;
          });
        });
      }
    });
  }

  function orderDetail(id) {
    var order = state.orders.find(function (o) { return o.id === id; });
    if (!order) return;
    var customer = customerById(order.customerId) || {};
    var shipment = state.shipments.find(function (s) { return s.orderId === order.id; });

    var rows = order.items.map(function (item) {
      return '<tr><td>' + esc(item.sku) + '</td><td>' + esc(item.title) + '</td>'
        + '<td class="num">' + item.quantity + '</td>'
        + '<td class="num">' + money(item.price) + '</td>'
        + '<td class="num">' + money(item.price * item.quantity) + '</td></tr>';
    }).join('');

    var body = '<div class="detail-grid">'
      + '<div class="detail-box"><h3>Client</h3><p><strong>' + esc(order.customerName) + '</strong><br>'
      + esc(customer.address || '') + '<br>' + esc((customer.zip || '') + ' ' + (customer.city || '')) + '<br>'
      + esc(customer.country || '') + '<br>' + esc(customer.email || '') + '<br>' + esc(customer.phone || '') + '</p></div>'
      + '<div class="detail-box"><h3>Commande</h3><p>'
      + 'Référence : <strong>' + esc(order.ref) + '</strong><br>'
      + 'Date : ' + date(order.createdAt) + '<br>'
      + 'Paiement : ' + esc(order.payment) + '<br>'
      + 'Statut : ' + orderTag(order.status) + '</p></div>'
      + '</div>'
      + '<table class="table"><thead><tr><th>Référence</th><th>Produit</th><th class="num">Qté</th>'
      + '<th class="num">P.U.</th><th class="num">Total</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<p style="text-align:right;margin-top:14px;font-size:15px">'
      + 'Sous-total ' + money(order.total)
      + (order.discount ? ' · Réduction −' + money(order.discount) : '') + ' · Livraison '
      + (order.shippingCost ? money(order.shippingCost) : 'offerte')
      + ' · <strong>Total ' + money(orderTotal(order)) + '</strong></p>'
      + deliveryBox(order)
      + (shipment ? '<div class="detail-box" style="margin-top:16px"><h3>Expédition</h3><p>'
        + esc(shipment.carrier) + ' · ' + esc(shipment.tracking || 'sans numéro') + ' · ' + esc(shipment.status) + '</p></div>' : '')
      + (order.note ? '<div class="detail-box" style="margin-top:16px"><h3>Note</h3><p>' + esc(order.note) + '</p></div>' : '');

    openModal({
      title: 'Commande ' + order.ref,
      body: body,
      wide: true,
      foot: '<button type="button" class="btn btn--danger left" id="order-delete">Supprimer</button>'
        + (canBuyLabel(order) ? '<button type="button" class="btn" id="order-label">Acheter le bordereau</button>' : '')
        + bordereauButton(order, '')
        + (order.label ? '<button type="button" class="btn btn--ghost" data-label-upload="' + order.id + '">Remplacer l’étiquette</button>' : '')
        + '<a class="btn btn--ghost" href="/admin/recapitulatif/' + order.id + '" target="_blank" rel="noopener">Récapitulatif</a>'
        + '<button type="button" class="btn btn--ghost" id="order-edit">Modifier</button>'
        + '<button type="button" class="btn" id="order-ship">Créer l’expédition</button>',
      onOpen: function () {
        var buy = $('#order-label');
        if (buy) buy.addEventListener('click', function () { closeModal(); labelForm(order.id); });
        $('#order-edit').addEventListener('click', function () { closeModal(); orderForm(order.id); });
        $('#order-ship').addEventListener('click', function () { closeModal(); shipmentForm(null, order.id); });
        $('#order-delete').addEventListener('click', function () {
          closeModal();
          confirmAction('Supprimer la commande ' + order.ref + ' ? Le stock sera recrédité.', 'Supprimer', function () {
            send('orders/delete', { id: order.id }, 'Commande supprimée.');
          });
        });
      }
    });
  }

  function shipmentForm(id, orderId) {
    var shipment = id ? state.shipments.find(function (s) { return s.id === id; }) : null;
    var selectedOrder = shipment ? shipment.orderId : orderId;

    var orderOptions = state.orders.map(function (o) {
      return '<option value="' + o.id + '"' + (o.id === selectedOrder ? ' selected' : '') + '>'
        + esc(o.ref) + ' — ' + esc(o.customerName) + '</option>';
    }).join('');

    /* Nouvelle expédition d'une commande en ligne : le transporteur choisi
       par le client est proposé d'office. */
    var forOrder = state.orders.find(function (o) { return o.id === selectedOrder; });
    var carrier = shipment ? shipment.carrier : (forOrder && forOrder.delivery ? forOrder.delivery.carrier : '');
    var carrierOptions = state.settings.carriers.map(function (c) {
      return '<option value="' + esc(c.name) + '"' + (carrier === c.name ? ' selected' : '') + '>'
        + esc(c.name) + '</option>';
    }).join('');

    var statusOptions = state.shipmentStatuses.map(function (s) {
      return '<option' + (shipment && shipment.status === s ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');

    var body = '<form id="shipment-form">'
      + '<div class="field"><label for="s-order">Commande</label>'
      + '<select id="s-order" required>' + orderOptions + '</select></div>'
      + '<div class="grid-2">'
      + '<div class="field"><label for="s-carrier">Transporteur</label>'
      + '<select id="s-carrier">' + carrierOptions + '</select></div>'
      + '<div class="field"><label for="s-status">Statut</label>'
      + '<select id="s-status">' + statusOptions + '</select></div>'
      + '<div class="field"><label for="s-tracking">Numéro de suivi</label>'
      + '<input id="s-tracking" value="' + esc(shipment ? shipment.tracking : '') + '" placeholder="Reporté depuis le portail transporteur"></div>'
      + '<div class="field"><label for="s-weight">Poids (kg)</label>'
      + '<input id="s-weight" type="number" step="0.01" min="0" value="' + (shipment ? shipment.weight : 0.5) + '"></div>'
      + '</div>'
      + '<p class="field-hint">L’étiquette d’affranchissement se crée sur le site du transporteur. '
      + 'Le bordereau de livraison, lui, se génère depuis la fiche commande.</p>'
      + '</form>';

    openModal({
      title: shipment ? 'Modifier l’expédition' : 'Nouvelle expédition',
      body: body,
      foot: '<button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>'
        + '<button type="submit" form="shipment-form" class="btn">Enregistrer</button>',
      onOpen: function () {
        $('#shipment-form').addEventListener('submit', function (event) {
          event.preventDefault();
          send('shipments/save', {
            shipment: {
              id: shipment ? shipment.id : null,
              orderId: $('#s-order').value,
              carrier: $('#s-carrier').value,
              status: $('#s-status').value,
              tracking: $('#s-tracking').value,
              weight: $('#s-weight').value
            }
          }, 'Expédition enregistrée.').then(closeModal).catch(function () {});
        });
      }
    });
  }

  /* ---------- Routage et rendu ---------- */

  var PAGES = {
    'tableau-de-bord': { title: 'Tableau de bord', sub: 'Vue d’ensemble de l’activité', view: viewDashboard },
    stock: { title: 'Gestion des stocks', sub: 'Quantités, seuils d’alerte et valeur d’inventaire', view: viewStock },
    commandes: { title: 'Commandes', sub: 'Suivi, statuts et bordereaux', view: viewOrders },
    messages: { title: 'Messages', sub: 'Formulaire de contact et inscriptions à la newsletter', view: viewMessages },
    clients: { title: 'Clients', sub: 'Fiches, coordonnées et historique d’achat', view: viewCustomers },
    livraisons: { title: 'Livraisons', sub: 'Transporteurs, numéros de suivi et étiquettes', view: viewShipments },
    reductions: { title: 'Réductions', sub: 'Codes promotionnels, avantages et conditions', view: viewDiscounts },
    reglages: { title: 'Réglages', sub: 'Boutique, sécurité et données', view: viewSettings }
  };

  /* Interface offerte aux modules complémentaires (éditeur de contenu). */
  window.ADMIN = {
    $: $, $$: $$, esc: esc, money: money, api: api, send: send, toast: toast,
    state: function () { return state; },
    registerPage: function (key, definition) { PAGES[key] = definition; }
  };

  function currentPage() {
    var hash = window.location.hash.replace('#/', '');
    return PAGES[hash] ? hash : 'tableau-de-bord';
  }

  function render() {
    var key = currentPage();
    var page = PAGES[key];

    $('#page-title').textContent = page.title;
    $('#page-sub').textContent = page.sub;
    $$('.sidebar__nav a').forEach(function (link) {
      link.classList.toggle('is-active', link.getAttribute('data-nav') === key);
    });

    $('#shop-name').textContent = state.settings.shopName || '417 France';
    $('#user-name').textContent = state.user.username;

    var publishState = $('#publish-state');
    if (state.lastBuild) {
      publishState.hidden = false;
      publishState.classList.toggle('is-error', !state.lastBuild.ok);
      publishState.textContent = state.lastBuild.ok
        ? 'Site à jour · ' + dateTime(state.lastBuild.at)
        : 'Publication en échec';
      publishState.title = state.lastBuild.message || '';
      $('#publish').textContent = 'Republier';
    }

    setBadge('#badge-stock', state.stats.lowStock + state.stats.outOfStock);
    setBadge('#badge-orders', state.stats.toPrepare);
    setBadge('#badge-ship', state.stats.inTransit);
    setBadge('#badge-messages', state.stats.newMessages || 0);
    setBadge('#badge-discounts', (state.discounts || []).filter(function (d) {
      return d.active;
    }).length);

    content.innerHTML = page.view();
    $('#page-actions').innerHTML = pageActions(key);
    bindView(key);
  }

  function setBadge(selector, value) {
    var el = $(selector);
    el.textContent = value;
    el.hidden = !value;
  }

  function pageActions(key) {
    if (key === 'stock') return '<button type="button" class="btn btn--sm" data-action="product-new">Nouveau produit</button>';
    if (key === 'commandes') return '<button type="button" class="btn btn--sm" data-action="order-new">Nouvelle commande</button>';
    if (key === 'clients') return '<button type="button" class="btn btn--sm" data-action="customer-new">Nouveau client</button>';
    if (key === 'livraisons') return '<button type="button" class="btn btn--sm" data-action="ship-new">Nouvelle expédition</button>';
    if (key === 'reductions') return '<button type="button" class="btn btn--sm" data-action="discount-new">Nouveau code</button>';
    return '';
  }

  function setFilter(path, value) {
    var parts = path.split('.');
    filters[parts[0]][parts[1]] = value;
    render();
  }

  function bindView(key) {
    /* Filtres partagés */
    $$('[data-filter]').forEach(function (input) {
      input.addEventListener('input', debounce(function () {
        var path = input.getAttribute('data-filter');
        var caret = input.selectionStart;
        setFilter(path, input.value);
        var next = $('[data-filter="' + path + '"]');
        if (next) { next.focus(); next.setSelectionRange(caret, caret); }
      }, 220));
      if (input.tagName === 'SELECT') {
        input.addEventListener('change', function () {
          setFilter(input.getAttribute('data-filter'), input.value);
        });
      }
    });

    $$('[data-chip]').forEach(function (button) {
      button.addEventListener('click', function () {
        setFilter(button.getAttribute('data-chip'), button.getAttribute('data-value'));
      });
    });

    $$('[data-sort]').forEach(function (header) {
      header.addEventListener('click', function () {
        var column = header.getAttribute('data-sort');
        if (filters.stock.sort === column) filters.stock.dir *= -1;
        else { filters.stock.sort = column; filters.stock.dir = 1; }
        render();
      });
    });

    $$('[data-goto]').forEach(function (button) {
      button.addEventListener('click', function () {
        window.location.hash = '#/' + button.getAttribute('data-goto');
      });
    });

    /* Stock */
    $$('[data-adjust]').forEach(function (button) {
      button.addEventListener('click', function () {
        send('products/adjust', {
          handle: button.getAttribute('data-adjust'),
          delta: Number(button.getAttribute('data-delta'))
        });
      });
    });

    $$('[data-visible]').forEach(function (button) {
      button.addEventListener('click', function () {
        var handle = button.getAttribute('data-visible');
        var product = state.products.find(function (p) { return p.handle === handle; });
        var next = product.visible === false;
        send('products/update', { handle: handle, patch: { visible: next } },
          next ? 'Produit affiché sur le site.' : 'Produit masqué sur le site.');
      });
    });

    $$('[data-stock]').forEach(function (input) {
      input.addEventListener('change', function () {
        send('products/update', {
          handle: input.getAttribute('data-stock'),
          patch: { stock: input.value }
        }, 'Stock mis à jour.');
      });
    });

    $$('[data-product-edit]').forEach(function (b) {
      b.addEventListener('click', function () { productForm(b.getAttribute('data-product-edit')); });
    });
    $$('[data-product-delete]').forEach(function (b) {
      b.addEventListener('click', function () {
        var handle = b.getAttribute('data-product-delete');
        var product = state.products.find(function (p) { return p.handle === handle; });
        confirmAction('Supprimer « ' + product.title + ' » du catalogue ?', 'Supprimer', function () {
          send('products/delete', { handle: handle }, 'Produit supprimé.');
        });
      });
    });

    /* Commandes */
    $$('[data-order-detail]').forEach(function (b) {
      b.addEventListener('click', function () { orderDetail(b.getAttribute('data-order-detail')); });
    });
    $$('[data-order-status]').forEach(function (select) {
      select.addEventListener('change', function () {
        send('orders/status', { id: select.getAttribute('data-order-status'), status: select.value }, 'Statut mis à jour.');
      });
    });
    $$('[data-ship-new]').forEach(function (b) {
      b.addEventListener('click', function () { shipmentForm(null, b.getAttribute('data-ship-new')); });
    });

    /* Messages */
    $$('[data-message-open]').forEach(function (b) {
      b.addEventListener('click', function () { messageDetail(b.getAttribute('data-message-open')); });
    });
    $$('[data-message-delete]').forEach(function (b) {
      b.addEventListener('click', function () {
        var message = messageById(b.getAttribute('data-message-delete'));
        confirmAction('Supprimer le message de ' + (message.name || message.email) + ' ?',
          'Supprimer', function () {
            send('messages/delete', { id: message.id }, 'Message supprimé.');
          });
      });
    });

    var exportMessages = $('#export-messages');
    if (exportMessages) {
      exportMessages.addEventListener('click', function () {
        download('messages.csv', [['Reçu le', 'Formulaire', 'Nom', 'E-mail', 'Téléphone', 'Statut', 'Message']]
          .concat((state.messages || []).map(function (m) {
            return [m.createdAt, MESSAGE_KINDS[m.kind] || m.kind, m.name, m.email, m.phone, m.status, m.message];
          })));
      });
    }

    /* Clients */
    $$('[data-customer-edit]').forEach(function (b) {
      b.addEventListener('click', function () { customerForm(b.getAttribute('data-customer-edit')); });
    });
    $$('[data-customer-delete]').forEach(function (b) {
      b.addEventListener('click', function () {
        var customer = customerById(b.getAttribute('data-customer-delete'));
        confirmAction('Supprimer la fiche de ' + customer.name + ' ?', 'Supprimer', function () {
          send('customers/delete', { id: customer.id }, 'Client supprimé.');
        });
      });
    });

    /* Livraisons */
    $$('[data-ship-edit]').forEach(function (b) {
      b.addEventListener('click', function () { shipmentForm(b.getAttribute('data-ship-edit')); });
    });
    $$('[data-ship-delete]').forEach(function (b) {
      b.addEventListener('click', function () {
        confirmAction('Supprimer cette expédition ?', 'Supprimer', function () {
          send('shipments/delete', { id: b.getAttribute('data-ship-delete') }, 'Expédition supprimée.');
        });
      });
    });

    /* Codes de réduction */
    $$('[data-discount-edit]').forEach(function (b) {
      b.addEventListener('click', function () { discountForm(b.getAttribute('data-discount-edit')); });
    });
    $$('[data-discount-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        send('discounts/toggle', { id: b.getAttribute('data-discount-toggle') }, 'Code mis à jour.');
      });
    });
    $$('[data-discount-delete]').forEach(function (b) {
      b.addEventListener('click', function () {
        var discount = discountById(b.getAttribute('data-discount-delete'));
        confirmAction('Supprimer le code ' + discount.code + ' ?', 'Supprimer', function () {
          send('discounts/delete', { id: discount.id }, 'Code supprimé.');
        });
      });
    });

    /* Boutons de création */
    bindCreate('#discount-new', discountForm);
    bindCreate('#product-new', productForm);
    bindCreate('#order-new', orderForm);
    bindCreate('#customer-new', customerForm);
    bindCreate('#ship-new', shipmentForm);

    /* Exports */
    bindClick('#export-stock', exportStock);
    bindClick('#export-orders', exportOrders);
    bindClick('#export-customers', exportCustomers);
    bindClick('#export-discounts', exportDiscounts);
    bindClick('#export-shipments', exportShipments);

    if (key === 'reglages') bindSettings();
    if (PAGES[key] && typeof PAGES[key].bind === 'function') PAGES[key].bind();
  }

  function bindCreate(selector, fn) {
    var button = $(selector);
    if (button) button.addEventListener('click', function () { fn(); });
  }

  function bindClick(selector, fn) {
    var button = $(selector);
    if (button) button.addEventListener('click', fn);
  }

  function bindSettings() {
    $('#settings-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var settings = {};
      $$('#settings-form [name]').forEach(function (input) { settings[input.name] = input.value; });
      send('settings/save', { settings: settings }, 'Réglages enregistrés.');
    });

    $('#password-form').addEventListener('submit', function (event) {
      event.preventDefault();
      api('password', { current: $('#pw-current').value, next: $('#pw-next').value })
        .then(function () {
          toast('Mot de passe modifié.');
          $('#password-form').reset();
        })
        .catch(function (err) { toast(err.message, true); });
    });

    $('#clear-demo').addEventListener('click', function () {
      confirmAction('Supprimer tous les clients, commandes et expéditions de démonstration ?', 'Supprimer', function () {
        send('demo/clear', {}, 'Données de démonstration supprimées.');
      });
    });
  }

  /* ---------- Exports CSV ---------- */

  function exportStock() {
    var rows = [['Produit', 'SKU', 'Categorie', 'Prix', 'Cout', 'Stock', 'Seuil', 'Valeur stock',
      'Fournisseur', 'Emplacement', 'Statut interne', 'Visible']];
    filteredProducts().forEach(function (p) {
      rows.push([p.title, p.sku, p.category, p.price, p.cost, p.stock, p.threshold,
        (p.stock * p.cost).toFixed(2), p.supplier, p.location,
        p.status || 'Automatique', p.visible === false ? 'non' : 'oui']);
    });
    download('417-stock.csv', rows);
  }

  function exportOrders() {
    var rows = [['Reference', 'Date', 'Client', 'Articles', 'Sous-total', 'Livraison', 'Total', 'Paiement', 'Statut']];
    state.orders.forEach(function (o) {
      rows.push([o.ref, date(o.createdAt), o.customerName,
        o.items.map(function (i) { return i.quantity + '× ' + i.title; }).join(' | '),
        o.total.toFixed(2), (o.shippingCost || 0).toFixed(2), orderTotal(o).toFixed(2), o.payment, o.status]);
    });
    download('417-commandes.csv', rows);
  }

  function exportCustomers() {
    var rows = [['Nom', 'Email', 'Telephone', 'Adresse', 'Code postal', 'Ville', 'Pays', 'Commandes', 'Total depense']];
    state.customers.forEach(function (c) {
      var orders = state.orders.filter(function (o) { return o.customerId === c.id; });
      var spent = orders.reduce(function (sum, o) { return sum + orderTotal(o); }, 0);
      rows.push([c.name, c.email, c.phone, c.address, c.zip, c.city, c.country, orders.length, spent.toFixed(2)]);
    });
    download('417-clients.csv', rows);
  }

  function exportShipments() {
    var rows = [['Commande', 'Client', 'Transporteur', 'Suivi', 'Poids', 'Statut', 'Date']];
    state.shipments.forEach(function (s) {
      rows.push([s.orderRef, s.customerName, s.carrier, s.tracking, s.weight, s.status, date(s.shippedAt)]);
    });
    download('417-livraisons.csv', rows);
  }

  /* ---------- Divers ---------- */

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { fn.apply(self, args); }, delay);
    };
  }

  document.addEventListener('click', function (event) {
    var action = event.target.closest('[data-action]');
    if (!action) return;
    var map = {
      'product-new': productForm, 'order-new': orderForm,
      'customer-new': customerForm, 'ship-new': shipmentForm,
      'discount-new': discountForm
    };
    var fn = map[action.getAttribute('data-action')];
    if (fn) fn();
  });

  $('#burger').addEventListener('click', function () {
    $('#sidebar').classList.toggle('is-open');
  });
  $$('.sidebar__nav a').forEach(function (link) {
    link.addEventListener('click', function () { $('#sidebar').classList.remove('is-open'); });
  });

  $('#publish').addEventListener('click', function () {
    var button = $('#publish');
    button.disabled = true;
    button.textContent = 'Publication…';
    api('site/publish').then(function (result) {
      if (result.state) { state = result.state; render(); }
      toast('Site publié. ' + (result.output || ''));
    }).catch(function (err) {
      toast(err.message, true);
    }).then(function () {
      var next = $('#publish');
      if (next) { next.disabled = false; next.textContent = 'Publier le site'; }
    });
  });

  $('#logout').addEventListener('click', function () {
    api('logout').then(function () { window.location.href = '/admin/login'; });
  });

  window.addEventListener('hashchange', render);

  /* ---------- Démarrage ---------- */

  fetch('/api/state', { headers: { 'X-Requested-With': 'fetch' } })
    .then(function (response) {
      if (response.status === 401) {
        window.location.href = '/admin/login';
        throw new Error('non connecté');
      }
      return response.json();
    })
    .then(function (data) {
      state = data;
      if (!window.location.hash) window.location.hash = '#/tableau-de-bord';
      render();
    })
    .catch(function (err) {
      if (err.message !== 'non connecté') {
        content.innerHTML = '<div class="card"><div class="empty"><strong>Chargement impossible</strong>'
          + esc(err.message) + '</div></div>';
      }
    });
})();
