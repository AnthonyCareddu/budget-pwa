'use strict';

/* ============================================================================
 *  CONFIG — à renseigner APRÈS le déploiement (voir SETUP.md).
 *  Tu peux aussi les saisir dans l'app via ⚙️ Réglages (elles priment alors).
 * ========================================================================== */
const DEFAULTS = {
  API_URL: 'https://script.google.com/macros/s/AKfycbybPWZzzUHlTEnZ5HK3e6Gc5xf4smgM_wFsCDd5tfPMALTEhvHzDcHIJYqO3ox9UlCn/exec',
  GOOGLE_CLIENT_ID: '291608936405-ddbgkq5hchqu42n3k92ajo95guokt6vn.apps.googleusercontent.com',
};

const FALLBACK_CATS = [
  { name: 'Abonnements', emoji: '📱' }, { name: 'Alimentation', emoji: '🍔' },
  { name: 'Animaux', emoji: '🐾' }, { name: 'Assurances', emoji: '🛡️' },
  { name: 'Cadeaux', emoji: '🎁' }, { name: 'Divers', emoji: '🔹' },
  { name: 'Enfants', emoji: '🧸' }, { name: 'Epargne', emoji: '💰' },
  { name: 'Factures', emoji: '🧾' }, { name: 'Frais bancaires', emoji: '🏦' },
  { name: 'Hygiène et beauté', emoji: '🧴' }, { name: 'Logement', emoji: '🏠' },
  { name: 'Loisirs et Shopping', emoji: '🛍️' }, { name: 'Restauration / Sorties', emoji: '🍽️' },
  { name: 'Revenu', emoji: '💵' }, { name: 'Santé', emoji: '💊' },
  { name: 'Tabac', emoji: '🚬' }, { name: 'Transport', emoji: '🚗' },
  { name: 'Vacances / Voyages', emoji: '✈️' }, { name: 'Virement Interne', emoji: '🔄' },
];

/* ---------------------------------------------------------------- helpers -- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.prototype.slice.call(r.querySelectorAll(s));

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const money = (x) => (x == null || isNaN(x)) ? '—' : eur.format(x);
const todayISO = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const isPlaceholder = (v) => !v || v.indexOf('PASTE_') !== -1;

class ApiError extends Error {}

const store = {
  get apiUrl() { return localStorage.getItem('budget.apiUrl') || DEFAULTS.API_URL; },
  get clientId() { return localStorage.getItem('budget.clientId') || DEFAULTS.GOOGLE_CLIENT_ID; },
  get session() { try { return JSON.parse(localStorage.getItem('budget.session') || 'null'); } catch (e) { return null; } },
  set session(v) { v ? localStorage.setItem('budget.session', JSON.stringify(v)) : localStorage.removeItem('budget.session'); },
  get queue() { try { return JSON.parse(localStorage.getItem('budget.queue') || '[]'); } catch (e) { return []; } },
  set queue(v) { localStorage.setItem('budget.queue', JSON.stringify(v)); },
  get meta() { try { return JSON.parse(localStorage.getItem('budget.meta') || 'null'); } catch (e) { return null; } },
  set meta(v) { localStorage.setItem('budget.meta', JSON.stringify(v)); },
  get suggestions() { try { return JSON.parse(localStorage.getItem('budget.suggestions') || '[]'); } catch (e) { return []; } },
  set suggestions(v) { localStorage.setItem('budget.suggestions', JSON.stringify(v)); },
};

const state = { form: {}, histo: [], histoFiltre: 'tous', catEmoji: {} };

/* -------------------------------------------------------------------- API -- */
async function rawPost(payload) {
  let resp;
  try {
    resp = await fetch(store.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // simple request => pas de préflight CORS
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
  } catch (e) {
    throw new ApiError('network');
  }
  let json;
  try { json = await resp.json(); } catch (e) { throw new ApiError('bad_response'); }
  if (!json.ok) throw new ApiError(json.error || 'error');
  return json.data;
}

async function api(action, payload) {
  const s = store.session;
  if (!s || s.exp < Date.now()) throw new ApiError('unauthorized');
  return rawPost({ action: action, token: s.token, payload: payload || {} });
}

async function apiLogin(googleToken) {
  return rawPost({ action: 'login', googleToken: googleToken });
}

/* ------------------------------------------------------------------- AUTH -- */
function showAuth(msg) {
  $('#app').hidden = true;
  $('#auth').hidden = false;
  if (msg) showAuthError(msg);
  initGoogle();
}
function showAuthError(m) {
  const el = $('#auth-error');
  el.textContent = m || '';
  el.hidden = !m;
}
function authMessage(e) {
  const map = {
    email_not_allowed: "Ce compte Google n'est pas autorisé.",
    google_token_invalid: 'Jeton Google invalide, réessaie.',
    network: 'Pas de connexion au serveur.',
    bad_response: 'Réponse inattendue du serveur (vérifie l\'URL de l\'API).',
  };
  return map[e && e.message] || 'Connexion impossible : ' + (e && e.message || 'erreur');
}

let gisReady = false;
function initGoogle() {
  if (isPlaceholder(store.apiUrl) || isPlaceholder(store.clientId)) {
    showAuthError('Configuration requise — ouvre Réglages pour saisir l\'URL de l\'API et l\'ID client.');
    openSettings();
    return;
  }
  if (!(window.google && google.accounts && google.accounts.id)) {
    return void setTimeout(initGoogle, 250);
  }
  if (gisReady) { try { google.accounts.id.prompt(); } catch (e) {} return; }
  gisReady = true;
  google.accounts.id.initialize({
    client_id: store.clientId,
    callback: handleCredential,
    auto_select: true,
    cancel_on_tap_outside: false,
  });
  try {
    google.accounts.id.renderButton($('#gbtn'), {
      theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'fr',
    });
  } catch (e) {
    $('#gbtn-fallback').hidden = false;
  }
  try { google.accounts.id.prompt(); } catch (e) {}
  setTimeout(() => { if (!$('#gbtn').childElementCount) $('#gbtn-fallback').hidden = false; }, 1500);
}

async function handleCredential(response) {
  if (!response || !response.credential) return;
  showAuthError('');
  try {
    const data = await apiLogin(response.credential);
    store.session = { token: data.token, exp: data.exp, email: data.email };
    await bootApp();
  } catch (e) {
    showAuthError(authMessage(e));
  }
}

function logout() {
  store.session = null;
  try { google.accounts.id.disableAutoSelect(); } catch (e) {}
  location.reload();
}

/* ------------------------------------------------------------------- BOOT -- */
async function bootApp() {
  $('#auth').hidden = true;
  $('#app').hidden = false;

  applyMeta(store.meta || { categories: FALLBACK_CATS });
  api('meta').then((m) => { store.meta = m; applyMeta(m); }).catch(() => {});
  api('suggestions').then((s) => { store.suggestions = s; }).catch(() => {});

  showScreen('screen-saisie');
  flushQueue();
}

function applyMeta(meta) {
  const cats = (meta && meta.categories && meta.categories.length) ? meta.categories : FALLBACK_CATS;
  state.catEmoji = {};
  state.natureDefaut = {};
  cats.forEach((c) => { state.catEmoji[c.name] = c.emoji; if (c.natureDefaut) state.natureDefaut[c.name] = c.natureDefaut; });

  const sel = $('#f-categorie');
  const current = sel.value;
  sel.innerHTML = '';
  cats.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.name;
    o.textContent = (c.emoji ? c.emoji + '  ' : '') + c.name;
    sel.appendChild(o);
  });
  if (current) sel.value = current;

  const comptes = (meta && meta.comptes && meta.comptes.length) ? meta.comptes : ['Antho', 'Compte Joint'];
  state.comptes = comptes;
  state.virementCat = (meta && meta.virementCat) || 'Virement interne';
  const short = (c) => c.replace(/^Compte\s+/i, '');

  buildSeg($('#seg-compte'), comptes, 'compte', state.form.compte || comptes[0], short);
  buildSeg($('#seg-vers'), comptes, 'compteVers', state.form.compteVers || comptes[1] || comptes[0], short);
  state.form.compte = state.form.compte || comptes[0];

  // filtres de l'historique (délégation câblée dans wireUI)
  const box = $('#histo-filtres');
  box.querySelectorAll('.chip:not([data-filtre="tous"])').forEach((c) => c.remove());
  comptes.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.filtre = c; b.textContent = short(c);
    box.appendChild(b);
  });
}

function buildSeg(container, values, field, active, labelFn) {
  if (!container || !values.length) return;
  if (values.indexOf(active) === -1) active = values[0];
  container.innerHTML = '';
  container.classList.toggle('seg-3', values.length === 3);
  container.classList.toggle('seg-4', values.length >= 4);
  values.forEach((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-item' + (v === active ? ' is-active' : '');
    b.dataset.field = field;
    b.dataset.value = v;
    b.textContent = labelFn ? labelFn(v) : v;
    container.appendChild(b);
  });
  state.form[field] = active;
}

function setNatureFromCategorie() {
  const n = state.natureDefaut[$('#f-categorie').value];
  if (n) setSeg('nature', n);
}

/* --------------------------------------------------------- NAV / SCREENS -- */
function showScreen(id) {
  $$('.screen').forEach((s) => { s.hidden = s.id !== id; });
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.screen === id));
  closeSuggestions();
  if (id === 'screen-bord') loadDashboard();
  if (id === 'screen-histo') loadHistory();
}

/* ---------------------------------------------------------------- SAISIE -- */
function wireForm() {
  state.form = { type: 'Sortie', compte: 'Antho', compteVers: 'Compte Joint', nature: 'Optionnel' };

  // segmented controls — délégation (les boutons compte/vers sont créés dynamiquement)
  $('#op-form').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-item');
    if (!btn) return;
    const field = btn.dataset.field;
    $$('.seg-item[data-field="' + field + '"]', $('#op-form'))
      .forEach((b) => b.classList.toggle('is-active', b === btn));
    state.form[field] = btn.dataset.value;
    haptic();
    if (field === 'type') setMode(btn.dataset.value);
    if (field === 'compte' || field === 'compteVers') guardTransferAccounts(field);
  });

  $('#f-categorie').addEventListener('change', setNatureFromCategorie);

  const lib = $('#f-libelle');
  lib.addEventListener('input', () => renderSuggestions(lib.value));
  lib.addEventListener('focus', () => renderSuggestions(lib.value));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#f-libelle') && !e.target.closest('#suggestions')) closeSuggestions();
  });

  $('#op-form').addEventListener('submit', onSubmit);
}

/** Bascule l'affichage du formulaire entre opération et transfert. */
function setMode(type) {
  const transfert = type === 'Transfert';
  $('#field-vers').hidden = !transfert;
  $('#field-categorie').hidden = transfert;
  $('#field-nature').hidden = transfert;
  $('#label-compte').textContent = transfert ? 'De' : 'Compte';
  $('#f-libelle').placeholder = transfert ? '(optionnel) ex. Épargne du mois' : 'ex. Courses Leclerc';
  $('#op-submit').textContent = transfert ? 'Enregistrer le transfert' : "Ajouter l'opération";
  if (transfert) guardTransferAccounts('compte');
}

/** Empêche source == cible sur un transfert : décale l'autre seg si besoin. */
function guardTransferAccounts(changed) {
  if (state.form.type !== 'Transfert') return;
  if (state.form.compte !== state.form.compteVers) return;
  const other = changed === 'compte' ? 'compteVers' : 'compte';
  const alt = (state.comptes || []).find((c) => c !== state.form[changed]);
  if (alt) setSeg(other, alt);
}

function renderSuggestions(q) {
  q = (q || '').trim().toLowerCase();
  const box = $('#suggestions');
  if (q.length < 2) return closeSuggestions();
  const list = store.suggestions
    .filter((s) => s.libelle.toLowerCase().indexOf(q) !== -1)
    .slice(0, 6);
  if (!list.length) return closeSuggestions();
  box.innerHTML = '';
  list.forEach((s) => {
    const li = document.createElement('li');
    li.innerHTML = '<span>' + escapeHtml(s.libelle) + '</span><span class="s-cat">' +
      escapeHtml(s.categorie || '') + '</span>';
    li.addEventListener('click', () => applySuggestion(s));
    box.appendChild(li);
  });
  box.hidden = false;
}
function closeSuggestions() { const b = $('#suggestions'); if (b) { b.hidden = true; b.innerHTML = ''; } }

function applySuggestion(s) {
  $('#f-libelle').value = s.libelle;
  if (s.categorie) $('#f-categorie').value = s.categorie;
  if (s.nature) setSeg('nature', s.nature);
  if (s.compte) setSeg('compte', s.compte);
  closeSuggestions();
  $('#f-montant').focus();
}
function setSeg(field, value) {
  let hit = false;
  $$('.seg-item[data-field="' + field + '"]', $('#op-form')).forEach((b) => {
    const on = b.dataset.value === value;
    b.classList.toggle('is-active', on);
    if (on) hit = true;
  });
  if (hit) state.form[field] = value;
}

function parseMontant(v) {
  if (!v) return NaN;
  return parseFloat(String(v).replace(/[\s €]/g, '').replace(',', '.'));
}

async function onSubmit(e) {
  e.preventDefault();
  const montant = parseMontant($('#f-montant').value);
  if (!isFinite(montant) || montant <= 0) return toast('Montant invalide', true);
  const m = Math.round(montant * 100) / 100;
  const transfert = state.form.type === 'Transfert';
  const date = $('#f-date').value || todayISO();

  let action, payload;
  if (transfert) {
    if (state.form.compte === state.form.compteVers) return toast('Choisis deux comptes différents', true);
    action = 'addTransfer';
    payload = { montant: m, compteSource: state.form.compte, compteCible: state.form.compteVers,
                libelle: $('#f-libelle').value.trim(), date: date };
  } else {
    const libelle = $('#f-libelle').value.trim();
    if (!libelle) return toast('Libellé manquant', true);
    action = 'addOperation';
    payload = { montant: m, libelle: libelle, compte: state.form.compte, type: state.form.type,
                categorie: $('#f-categorie').value, nature: state.form.nature, date: date };
  }

  const btn = $('#op-submit');
  btn.disabled = true;
  try {
    await api(action, payload);
    afterAdd(transfert ? 'Transfert enregistré ✓' : 'Ajouté ✓');
  } catch (err) {
    if (err.message === 'network' || err.message === 'unauthorized') {
      const q = store.queue; q.push({ action: action, payload: payload }); store.queue = q;
      afterAdd('Enregistré hors ligne — sera synchronisé');
      updateQueueNote();
      if (err.message === 'unauthorized') scheduleReauth();
    } else {
      toast('Refusé : ' + err.message, true);
    }
  } finally {
    btn.disabled = false;
  }
}

function afterAdd(msg) {
  haptic();
  toast(msg);
  $('#f-montant').value = '';
  $('#f-libelle').value = '';
  closeSuggestions();
  $('#f-montant').focus();
  // rafraîchit les suggestions en tâche de fond
  api('suggestions').then((s) => { store.suggestions = s; }).catch(() => {});
}

/* ------------------------------------------------------------- DASHBOARD -- */
async function loadDashboard() {
  const box = $('#bord-content');
  $('#bord-loading').hidden = false;
  try {
    const d = await api('dashboard');
    $('#bord-mois').textContent = cap(d.mois || '');
    box.innerHTML = '';
    const comptes = Object.keys(d.soldes || {});
    Object.keys(d.comptes || {}).forEach((c) => { if (comptes.indexOf(c) === -1) comptes.push(c); });
    comptes.forEach((c) => box.appendChild(acctCard(c, d.soldes ? d.soldes[c] : null, (d.comptes || {})[c])));
    if (!comptes.length) box.innerHTML = '<p class="muted">Aucune donnée ce mois-ci.</p>';
  } catch (e) {
    box.innerHTML = viewError(e);
    if (e.message === 'unauthorized') scheduleReauth();
  }
  $('#bord-loading').hidden = true;
}

function acctCard(nom, solde, agg) {
  const el = document.createElement('div');
  el.className = 'acct-card';
  let html = '<div class="acct-top"><span class="acct-name">' + escapeHtml(nom) + '</span>' +
    '<span class="acct-solde">' + money(solde) + '</span></div>';
  if (agg) {
    html += '<div class="acct-flux">' +
      '<span class="out">− ' + money(agg.sorties).replace('-', '') + ' dépensé</span>' +
      '<span class="in">+ ' + money(agg.entrees) + ' entré</span></div>';
    const cats = (agg.categories || []).slice(0, 6);
    const max = cats.reduce((m, c) => Math.max(m, c.montant), 0) || 1;
    if (cats.length) {
      html += '<div class="catline">';
      cats.forEach((c) => {
        html += '<div class="catline-row"><span>' + (state.catEmoji[c.categorie] || '•') + ' ' +
          escapeHtml(c.categorie) + '</span><span>' + money(c.montant) + '</span></div>' +
          '<div class="catbar"><span style="width:' + Math.round(c.montant / max * 100) + '%"></span></div>';
      });
      html += '</div>';
    }
  }
  el.innerHTML = html;
  return el;
}

/* ------------------------------------------------------------- HISTORIQUE -- */
async function loadHistory() {
  $('#histo-loading').hidden = false;
  try {
    state.histo = await api('history', { limit: 80 });
    renderHistory();
  } catch (e) {
    $('#histo-content').innerHTML = viewError(e);
    if (e.message === 'unauthorized') scheduleReauth();
  }
  $('#histo-loading').hidden = true;
}

function renderHistory() {
  const box = $('#histo-content');
  const f = state.histoFiltre;
  const rows = state.histo.filter((r) => f === 'tous' || r.compte === f);
  box.innerHTML = '';
  if (!rows.length) { box.innerHTML = '<p class="muted">Rien à afficher.</p>'; return; }
  let lastDay = '';
  rows.forEach((r) => {
    if (r.date !== lastDay) {
      lastDay = r.date;
      const h = document.createElement('div');
      h.className = 'histo-day';
      h.textContent = frDate(r.date);
      box.appendChild(h);
    }
    box.appendChild(opRow(r));
  });
}

function opRow(r) {
  const el = document.createElement('div');
  const virement = /virement interne/i.test(r.categorie || '');
  el.className = 'op' + (virement ? ' op-virement' : '');
  const sortie = r.type === 'Sortie';
  el.innerHTML =
    '<div class="op-emoji">' + (virement ? '🔄' : (state.catEmoji[r.categorie] || '•')) + '</div>' +
    '<div class="op-main"><div class="op-lib">' + escapeHtml(r.libelle) + '</div>' +
    '<div class="op-meta">' + escapeHtml(virement ? r.compte : r.categorie + ' · ' + r.compte) + '</div></div>' +
    '<div class="op-right"><span class="op-montant ' + (sortie ? 'sortie' : 'rentree') + '">' +
    (sortie ? '−' : '+') + ' ' + money(r.montant).replace('-', '') + '</span>' +
    '<span class="op-badge">' + escapeHtml(r.nature || '') + '</span></div>';

  if (r.id) {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('op-del')) return;
      const open = el.classList.toggle('confirming');
      $$('.op.confirming').forEach((o) => { if (o !== el) o.classList.remove('confirming'); });
      let del = el.querySelector('.op-del');
      if (open && !del) {
        del = document.createElement('button');
        del.className = 'op-del';
        del.textContent = virement ? 'Supprimer ce transfert (2 lignes)' : 'Supprimer cette opération';
        del.addEventListener('click', () => removeOp(r, el));
        el.appendChild(del);
      } else if (!open && del) {
        del.remove();
      }
    });
  }
  return el;
}

async function removeOp(r, el) {
  el.style.opacity = '.5';
  try {
    const res = await api('deleteOperation', { id: r.id });
    if (res && res.deleted) {
      state.histo = state.histo.filter((x) => x.id !== r.id);
      renderHistory();
      toast(res.deleted > 1 ? 'Transfert supprimé' : 'Supprimé');
      haptic();
    } else {
      el.style.opacity = '1';
      toast('Introuvable (déjà supprimée ?)', true);
    }
  } catch (e) {
    el.style.opacity = '1';
    toast('Échec suppression : ' + e.message, true);
  }
}

/* ------------------------------------------------------------------ QUEUE -- */
async function flushQueue() {
  const q = store.queue;
  updateQueueNote();
  if (!q.length || !store.session) return;
  const keep = [];
  for (let i = 0; i < q.length; i++) {
    // rétro-compat : anciennes entrées = opération brute ; nouvelles = { action, payload }
    const item = q[i] && q[i].action ? q[i] : { action: 'addOperation', payload: q[i] };
    try {
      await api(item.action, item.payload);
    } catch (e) {
      if (e.message === 'network' || e.message === 'unauthorized') {
        for (let j = i; j < q.length; j++) keep.push(q[j]);
        break;
      }
      toast('Saisie en attente ignorée (' + e.message + ')', true);
    }
  }
  store.queue = keep;
  updateQueueNote();
  if (q.length && !keep.length) toast(q.length + ' saisie(s) synchronisée(s) ✓');
}

function updateQueueNote() {
  const n = store.queue.length;
  const el = $('#queue-note');
  el.hidden = n === 0;
  el.textContent = n ? n + ' saisie(s) en attente de synchronisation' : '';
}

let reauthTimer = null;
function scheduleReauth() {
  if (reauthTimer) return;
  reauthTimer = setTimeout(() => { reauthTimer = null; store.session = null; showAuth('Session expirée — reconnecte-toi.'); }, 400);
}

/* --------------------------------------------------------------- RÉGLAGES -- */
function openSettings() {
  $('#s-api').value = localStorage.getItem('budget.apiUrl') || '';
  $('#s-client').value = localStorage.getItem('budget.clientId') || '';
  const d = $('#settings');
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
}
function closeSettings() { const d = $('#settings'); d.close ? d.close() : d.removeAttribute('open'); }

function wireSettings() {
  $('#open-settings').addEventListener('click', openSettings);
  $('#auth-settings-link').addEventListener('click', openSettings);
  $('#s-close').addEventListener('click', closeSettings);
  $('#s-logout').addEventListener('click', logout);
  $('#s-save').addEventListener('click', () => {
    const api2 = $('#s-api').value.trim();
    const cid = $('#s-client').value.trim();
    api2 ? localStorage.setItem('budget.apiUrl', api2) : localStorage.removeItem('budget.apiUrl');
    cid ? localStorage.setItem('budget.clientId', cid) : localStorage.removeItem('budget.clientId');
    $('#s-status').textContent = 'Enregistré. Rechargement…';
    setTimeout(() => location.reload(), 500);
  });
}

/* ------------------------------------------------------------------ MISC -- */
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, err ? 3200 : 1900);
}
function haptic() { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} }
function setOffline(off) { $('#offline-bar').hidden = !off; }
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function frDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function viewError(e) {
  if (e.message === 'unauthorized') return '<p class="muted">Session expirée…</p>';
  if (e.message === 'network') return '<p class="muted">Hors ligne — réessaie plus tard.</p>';
  return '<p class="muted">Erreur : ' + escapeHtml(e.message) + '</p>';
}

function wireUI() {
  wireForm();
  wireSettings();
  $$('.tab').forEach((t) => t.addEventListener('click', () => showScreen(t.dataset.screen)));
  $('#refresh-bord').addEventListener('click', loadDashboard);
  $('#refresh-histo').addEventListener('click', loadHistory);
  $('#gbtn-fallback').addEventListener('click', () => { try { google.accounts.id.prompt(); } catch (e) {} });
  $('#histo-filtres').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $$('#histo-filtres .chip').forEach((x) => x.classList.toggle('is-active', x === chip));
    state.histoFiltre = chip.dataset.filtre;
    renderHistory();
  });
  window.addEventListener('online', () => { setOffline(false); flushQueue(); });
  window.addEventListener('offline', () => setOffline(true));
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ------------------------------------------------------------------ INIT -- */
document.addEventListener('DOMContentLoaded', () => {
  registerSW();
  wireUI();
  setOffline(!navigator.onLine);
  $('#f-date').value = todayISO();

  const s = store.session;
  if (s && s.token && s.exp > Date.now()) {
    bootApp().catch(() => showAuth('Reconnecte-toi.'));
  } else {
    showAuth();
  }
});
