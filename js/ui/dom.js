// Small DOM helpers shared by every view.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'indeterminate', 'open', 'htmlFor']);

/** Hyperscript: h('div', { class: 'x', onclick }, child, 'text', [more]) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') {
        for (const [p, val] of Object.entries(v)) if (val != null) (p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val));
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) el[k] = v;
      else if (v === false) continue;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtNum = (n, dec = 0) => (n == null || Number.isNaN(Number(n)) ? '–' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: dec, minimumFractionDigits: 0 }));
export const fmtKg = w => (w == null ? '' : `${fmtNum(w, 1)} kg`);
export const fmtPct = (v, dec = 0) => (v == null ? '–' : `${fmtNum(v, dec)} %`);
export function fmtDur(min) {
  if (min == null || min === '') return '–';
  const m = Math.round(Number(min));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
}
export const plural = (n, one, many) => `${fmtNum(n)} ${n === 1 ? one : many}`;

/* ---------- Icons (inline SVG, 24 × 24, stroke) ---------- */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  plan: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 14h3M13.5 14h3M7.5 17.5h3"/>',
  climbing: '<path d="M2.5 20.5 9 8l3.5 5 2.5-3.5 6.5 11z"/><path d="M9 8l1.2 4.2L12.5 13"/>',
  hangboard: '<rect x="2.5" y="4" width="19" height="7" rx="2"/><path d="M6.5 11v2.5M11 11v4.5M15 11v3.5M18.5 11v2"/><path d="M8 19.5c1.2-1.3 2.4-1.3 3.6 0s2.4 1.3 3.6 0"/>',
  strength: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>',
  endurance: '<path d="M2.5 12h4l2.5-6 4.5 12 2.5-6h5.5"/>',
  tests: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  analysis: '<path d="M3.5 20.5h17"/><path d="M6.5 20.5v-7M11 20.5v-12M15.5 20.5v-5M20 20.5V4.5"/>',
  import: '<path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 17.5v1.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-1.5"/>',
  prefs: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  right: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  up: '<path d="M5.5 14.5 12 8l6.5 6.5"/>',
  down: '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
  check: '<path d="M4.5 12.5 10 18 19.5 7"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  edit: '<path d="M4 20h4L19.5 8.5l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sync: '<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.5 3.5v4h-4M5.5 20.5v-4h4"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  warn: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17v.5"/>',
  spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  flag: '<path d="M5 21V4M5 4.5h11l-2 4 2 4H5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = iconSvg(name, size);
  return span;
}
export const iconSvg = (name, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;

/* ---------- Module identity (label, colour token, icon) ---------- */
export const MODULE_META = {
  climbing: { label: 'Klettern', color: 'var(--m-climbing)', icon: 'climbing', route: 'climbing' },
  hangboard: { label: 'Hangboard', color: 'var(--m-hangboard)', icon: 'hangboard', route: 'hangboard' },
  strength: { label: 'Kraft & Prävention', short: 'Kraft', color: 'var(--m-strength)', icon: 'strength', route: 'strength' },
  run: { label: 'Laufen', color: 'var(--m-run)', icon: 'endurance', route: 'endurance' },
  ride: { label: 'Rad', color: 'var(--m-ride)', icon: 'endurance', route: 'endurance' },
  other: { label: 'Sonstiges', color: 'var(--m-other)', icon: 'endurance', route: 'endurance' },
  mobility: { label: 'Mobility', color: 'var(--m-other)', icon: 'spark', route: 'strength' },
  rest: { label: 'Ruhetag', color: 'var(--m-rest)', icon: 'moon', route: null },
};
export const moduleLabel = (m, short = false) => (short && MODULE_META[m]?.short) || MODULE_META[m]?.label || m;
export const moduleColor = m => MODULE_META[m]?.color ?? 'var(--m-other)';

/** A small coloured dot + label, used in legends and lists. */
export const moduleChip = (m, text) => h('span', { class: 'mchip', style: { '--c': moduleColor(m) } }, h('i'), text ?? moduleLabel(m, true));

export function legend(items) {
  return h('div', { class: 'legend' }, items.map(it => h('span', {}, h('i', { style: { background: it.color }, class: it.shape === 'line' ? 'line' : it.shape === 'outline' ? 'outline' : '' }), it.label)));
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, title), text ? h('p', {}, text) : null, action ?? null);
}

/** Navigate to a view (hash routing, simple names only). */
export function navigate(name) {
  if (location.hash === `#${name}`) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = name;
}

/** Per-viewer conveniences only (last tab, drafts). Always guarded. */
export const local = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(`elevate2.ui:${key}`); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`elevate2.ui:${key}`, JSON.stringify(value)); } catch (_) { /* ignore */ }
  },
};
