// Start: shell, hash routing, global "+ Einheit", status banner.
import store from './store/index.js';
import { fmtDay, today } from './domain/dates.js';
import { $, h, icon, iconSvg, local, moduleColor } from './ui/dom.js';
import { openDialog, toast } from './ui/dialog.js';
import { pressable } from './ui/view.js';
import { QUICK_ADD, openNewFor } from './modules/open.js';
import * as dashboard from './modules/dashboard.js';
import * as plan from './modules/plan.js';
import * as climbing from './modules/climbing.js';
import * as hangboard from './modules/hangboard.js';
import * as strength from './modules/strength.js';
import * as endurance from './modules/endurance.js';
import * as tests from './modules/tests.js';
import * as analysis from './modules/analysis.js';
import * as importer from './modules/import.js';
import * as prefs from './modules/prefs.js';

// Simple hash names only. `settings`, `sidebar`, `customize`, `upgrade`, `downloads`
// and `comment-*` are reserved by claude.ai – hence `#prefs`.
const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', mod: dashboard },
  { id: 'plan', label: 'Planung', icon: 'plan', mod: plan },
  { id: 'climbing', label: 'Klettern', icon: 'climbing', mod: climbing, color: 'climbing', group: 'Training' },
  { id: 'hangboard', label: 'Hangboard', icon: 'hangboard', mod: hangboard, color: 'hangboard' },
  { id: 'strength', label: 'Kraft & Prävention', icon: 'strength', mod: strength, color: 'strength' },
  { id: 'endurance', label: 'Ausdauer', icon: 'endurance', mod: endurance, color: 'run' },
  { id: 'tests', label: 'Tests', icon: 'tests', mod: tests, group: 'Auswertung' },
  { id: 'analysis', label: 'Analyse', icon: 'analysis', mod: analysis },
  { id: 'import', label: 'Import', icon: 'import', mod: importer, group: 'Daten' },
  { id: 'prefs', label: 'Einstellungen', icon: 'prefs', mod: prefs },
];
const byId = Object.fromEntries(ROUTES.map(r => [r.id, r]));

const els = { nav: $('#nav'), view: $('#view'), title: $('#page-title'), sub: $('#page-sub'), banner: $('#banner'), app: $('#app') };
let current = null;
let frame = 0;

function routeFromHash() {
  const id = location.hash.replace(/^#/, '');
  return byId[id] ? id : null;
}

function buildNav() {
  els.nav.replaceChildren();
  for (const r of ROUTES) {
    if (r.group) els.nav.append(h('div', { class: 'nav-group' }, r.group));
    els.nav.append(h('a', { href: `#${r.id}`, class: 'nav-item', dataset: { route: r.id }, style: r.color ? { '--c': moduleColor(r.color) } : null },
      icon(r.icon, 18), h('span', {}, r.label), r.color ? h('i', { class: 'nav-dot' }) : null));
  }
}

function show(id) {
  current = byId[id] ? id : 'dashboard';
  local.set('view', current);
  for (const a of els.nav.querySelectorAll('.nav-item')) {
    const on = a.dataset.route === current;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  els.app.classList.remove('nav-open');
  const { meta } = byId[current].mod;
  els.title.textContent = meta.title;
  els.sub.textContent = current === 'dashboard' ? fmtDay(today()) : (meta.sub ?? '');
  document.title = current === 'dashboard' ? 'Elevate' : `${meta.title} · Elevate`;
  window.scrollTo(0, 0);
  render();
}

function render() {
  cancelAnimationFrame(frame);
  frame = 0;
  renderBanner();
  if (store.status.phase !== 'ready') {
    els.view.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', {}, 'Lade deine Trainingsdaten …')));
    return;
  }
  try {
    els.view.dataset.view = current;
    byId[current].mod.render(els.view);
  } catch (e) {
    console.error(e);
    els.view.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'Diese Ansicht konnte nicht aufgebaut werden'), h('p', {}, e.message)));
  }
}
const scheduleRender = () => { if (!frame) frame = requestAnimationFrame(render); };

function renderBanner() {
  const st = store.status;
  const items = [];
  if (st.phase === 'ready' && st.backend === 'local') items.push(['info', 'Lokaler Modus, Daten nur in diesem Browser. Im veröffentlichten Artifact liegen sie in der Claude-Datenbank.']);
  if (st.stale.length) items.push(['warn', 'Die Datenbank antwortet gerade nicht. Angezeigte Daten können veraltet sein – sie aktualisieren sich von selbst, sobald die Verbindung steht.']);
  if (Object.keys(st.errors).length) items.push(['warn', 'Ein Teil der Daten kann in dieser Ansicht nicht geladen werden. Öffne die Seite neu, wenn das so bleibt.']);
  if (st.readOnly) items.push(['warn', 'Schreiben wurde abgelehnt. Nur der Eigentümer des Artifacts kann Einträge ändern.']);
  els.banner.replaceChildren(...items.map(([kind, text]) => h('div', { class: `notice ${kind}` }, icon(kind === 'warn' ? 'warn' : 'info', 16), h('span', {}, text))));
}

/* ---------- global "+ Einheit" ---------- */
function openQuickAdd() {
  const d = openDialog({
    title: 'Was möchtest du erfassen?', size: 'md',
    body: h('div', { class: 'quick-grid' }, QUICK_ADD.map(q => pressable('quick-item', () => { d.close(); openNewFor(q.id, {}); },
      h('i', { class: 'dot', style: { background: moduleColor(q.module) } }), h('b', {}, q.label), h('span', { class: 'hint' }, q.sub)))),
  });
  d.body.querySelector('.quick-item')?.focus();
}

/* ---------- wiring ---------- */
$('#btn-add').append(h('span', { html: iconSvg('plus', 16), class: 'ico' }), h('span', { class: 'lbl' }, 'Einheit'));
$('#btn-add').addEventListener('click', openQuickAdd);
$('#btn-menu').addEventListener('click', () => els.app.classList.toggle('nav-open'));
$('#scrim').addEventListener('click', () => els.app.classList.remove('nav-open'));

window.addEventListener('hashchange', () => show(routeFromHash() ?? 'dashboard'));
document.addEventListener('keydown', e => {
  if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable) return;
  e.preventDefault();
  openQuickAdd();
});

// charts are drawn to the pixel width of their container – redraw when it changes
let lastWidth = innerWidth, resizeTimer = 0;
window.addEventListener('resize', () => {
  if (innerWidth === lastWidth) return;
  lastWidth = innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!document.querySelector('dialog[open]')) render(); }, 160);
});

prefs.applyTheme();
buildNav();
store.subscribe(scheduleRender);
show(routeFromHash() ?? local.get('view', 'dashboard'));
store.init().catch(e => { console.error(e); toast('Die Daten konnten nicht geladen werden.', true); });
