// Building blocks every view shares: cards, KPI tiles, sub-tabs, small lists.
import { h, icon, local } from './dom.js';

export function card(title, opts = {}, ...body) {
  const { actions, hint, cls = '' } = opts;
  return h('section', { class: `card ${cls}` },
    title || actions ? h('div', { class: 'card-head' },
      h('div', { class: 'card-title' }, title ? h('h2', {}, title) : null, hint ? h('span', { class: 'hint' }, hint) : null),
      actions ? h('div', { class: 'card-actions' }, actions) : null) : null,
    body);
}

export function kpi(label, value, sub, cls = '') {
  return h('div', { class: `kpi ${cls}` }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), h('div', { class: 'sub' }, sub ?? ''));
}

/**
 * Sub-navigation inside a view. The active tab is remembered per viewer.
 * @returns { el, active }
 */
export function subTabs(key, defs, onChange) {
  const stored = local.get(`tab:${key}`);
  let active = defs.some(d => d[0] === stored) ? stored : defs[0][0];
  const el = h('div', { class: 'subtabs', role: 'tablist' });
  for (const [id, label, count] of defs) {
    el.append(h('button', { type: 'button', role: 'tab', class: id === active ? 'active' : '', 'aria-selected': id === active, onclick: () => { local.set(`tab:${key}`, id); onChange(id); } },
      label, count != null ? h('span', { class: 'count' }, String(count)) : null));
  }
  return { el, active };
}
export const setTab = (key, id) => local.set(`tab:${key}`, id);

export const btn = (label, onclick, cls = '', ico) => h('button', { type: 'button', class: `btn ${cls}`, onclick }, ico ? icon(ico, 16) : null, label);

export const badge = (text, cls = '') => h('span', { class: `badge ${cls}` }, text);

/** "Label  value" pairs in a compact definition list. */
export function facts(pairs) {
  return h('dl', { class: 'facts' }, pairs.filter(p => p && p[1] != null && p[1] !== '').map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))));
}

export const loadBadge = (duration, rpe) => {
  const d = Number(duration), r = Number(rpe);
  if (!(d > 0) || !(r > 0)) return null;
  return h('span', { class: 'load-pill', title: `sRPE = ${r} × ${d} min` }, `${Math.round(d * r)} sRPE`);
};

/** A card that acts as one big button (keyboard accessible). */
export function pressable(cls, onclick, ...kids) {
  return h('div', {
    class: `${cls} pressable`, role: 'button', tabindex: 0, onclick,
    onkeydown: ev => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); onclick(ev); } },
  }, kids);
}
