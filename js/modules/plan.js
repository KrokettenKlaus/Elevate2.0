// Planung: the week (planned vs. actual), training blocks and week templates.
import store, { clone, newId } from '../store/index.js';
import { DAY_KEYS, DAY_LABELS, DAY_LONG, addDays, dayKey, fmtD, fmtDs, isoWeek, today, wd, weekStart } from '../domain/dates.js';
import { BLOCK_TYPES, PLAN_MODULES, blockAt, collectActuals, generateWeek, reconcileWeek, templateForDate, unitId, weekPlan } from '../domain/plan.js';
import { SESSION_TYPES } from '../domain/climbing.js';
import { HB_TYPE_LABEL } from '../domain/hangboard.js';
import { $, $$, emptyState, esc, fmtDur, fmtNum, h, icon, iconSvg, moduleColor, moduleLabel } from '../ui/dom.js';
import { confirmDialog, guarded, openDialog, toast } from '../ui/dialog.js';
import { field, formDialog, selectInput } from '../ui/forms.js';
import { timeline } from '../ui/charts.js';
import { badge, btn, card, pressable, subTabs } from '../ui/view.js';
import { openActual, openNewFor } from './open.js';

export const meta = { id: 'plan', title: 'Planung', sub: 'Woche, Trainingsblöcke und Vorlagen' };

let tab = null;
let viewWeek = null;

const ctx = () => ({ planUnits: store.list('plan_units'), templates: store.list('plan_templates'), blocks: store.list('plan_blocks'), settings: store.settings() });
export const BLOCK_COLOR = { Basis: 'var(--b-basis)', Kraft: 'var(--b-kraft)', Power: 'var(--b-power)', 'Power-Endurance': 'var(--b-pe)', Performance: 'var(--b-performance)', Deload: 'var(--b-deload)', 'Übergang': 'var(--b-uebergang)' };

/** Reconciled week for any view (dashboard, review). */
export function weekState(ws) {
  const c = ctx();
  const plan = weekPlan(ws, c);
  return { ...reconcileWeek(ws, plan, collectActuals(store.all()), today()), plan, template: plan.fixed ? null : templateForDate(ws, c.templates, c.blocks, c.settings), block: blockAt(c.blocks, today() >= ws && today() <= addDays(ws, 6) ? today() : ws) };
}

export function render(root) {
  const tabs = subTabs('plan', [['week', 'Woche'], ['blocks', 'Blöcke', store.list('plan_blocks').length], ['templates', 'Vorlagen']], id => { tab = id; render(root); });
  tab = tabs.active;
  root.replaceChildren(tabs.el);
  if (tab === 'week') renderWeek(root);
  if (tab === 'blocks') renderBlocks(root);
  if (tab === 'templates') renderTemplates(root);
}

/* ============ Woche ============ */
const STATUS = {
  done: { label: 'erledigt', icon: 'check' }, open: { label: 'offen', icon: 'dot' }, missed: { label: 'ausgelassen', icon: 'close' },
  alt: { label: 'Alternative – nicht nötig', icon: 'check' }, rest: { label: 'Ruhetag', icon: 'moon' }, extra: { label: 'zusätzlich', icon: 'plus' },
};

const unitText = u => [moduleLabel(u.module, true), u.type].filter(Boolean).join(' · ');
const unitTargets = u => [u.duration_min ? fmtDur(u.duration_min) : null, u.rpe ? `RPE ${u.rpe}` : null].filter(Boolean).join(' · ');

/** One planned unit as a row with its status. */
function unitRow(item, { onRecord, compact }) {
  const u = item.unit, st = STATUS[item.status];
  const row = h('div', { class: `unit st-${item.status}`, style: { '--c': moduleColor(u.module) }, title: st.label },
    h('span', { class: 'u-status', html: iconSvg(st.icon, 14), 'aria-label': st.label }),
    h('span', { class: 'u-body' },
      h('span', { class: 'u-name' }, unitText(u)),
      !compact && (unitTargets(u) || u.note) ? h('span', { class: 'u-sub' }, [unitTargets(u), u.note].filter(Boolean).join(' – ')) : null,
      item.actual ? h('span', { class: 'u-sub actual' }, actualText(item.actual)) : item.manual ? h('span', { class: 'u-sub' }, 'von Hand gesetzt') : null));
  if (item.actual) { row.classList.add('click'); row.addEventListener('click', ev => { ev.stopPropagation(); openActual(item.actual); }); }
  else if (item.status === 'open' && onRecord && u.module !== 'rest') {
    row.append(h('button', { type: 'button', class: 'u-record', title: 'Jetzt erfassen', onclick: ev => { ev.stopPropagation(); onRecord(u); } }, icon('plus', 14)));
  }
  return row;
}
const actualText = a => [a.label, a.duration_min ? fmtDur(a.duration_min) : null, a.rpe ? `RPE ${a.rpe}` : null].filter(Boolean).join(' · ');

/**
 * The seven days of a reconciled week. Used here and on the dashboard.
 * opts: { onDay(date), compact }
 */
export function weekGrid(state, { onDay, compact = false } = {}) {
  const t = today();
  const blocks = store.list('plan_blocks');
  const grid = h('div', { class: `week-grid${compact ? ' compact' : ''}` });
  for (const day of state.days) {
    const block = blockAt(blocks, day.date);
    const col = h('div', { class: `day${day.date === t ? ' today' : ''}${day.date < t ? ' past' : ''}` });
    col.append(h('div', { class: 'day-head' },
      h('span', { class: 'day-name' }, wd(day.date)), h('span', { class: 'day-date' }, fmtDs(day.date)),
      block ? h('i', { class: 'day-block', style: { background: BLOCK_COLOR[block.type] ?? 'var(--muted)' }, title: `${block.name} (${block.type})` }) : null,
      onDay ? h('button', { type: 'button', class: 'icon-btn day-edit', title: 'Tag planen', onclick: () => onDay(day.date) }, icon('edit', 14)) : null));
    const list = h('div', { class: 'day-units' });
    let lastAlt = null;
    for (const item of day.items) {
      if (item.alt && item.alt === lastAlt) list.append(h('div', { class: 'or' }, 'oder'));
      lastAlt = item.alt ?? null;
      list.append(unitRow(item, { compact, onRecord: u => openNewFor(u.module, { date: day.date, ...(u.duration_min ? { duration_min: u.duration_min } : {}) }) }));
    }
    for (const a of day.extras) {
      const row = h('div', { class: `unit st-extra click${day.planned ? '' : ' unplanned'}`, style: { '--c': moduleColor(a.module) }, title: day.planned ? 'zusätzlich' : 'ohne Plan', onclick: () => openActual(a) },
        h('span', { class: 'u-status', html: iconSvg(day.planned ? 'plus' : 'check', 14) }),
        h('span', { class: 'u-body' }, h('span', { class: 'u-name' }, moduleLabel(a.module, true)), h('span', { class: 'u-sub actual' }, `${day.planned ? 'zusätzlich · ' : ''}${actualText(a)}`)));
      list.append(row);
    }
    if (!day.items.length && !day.extras.length) list.append(h('div', { class: 'day-empty' }, '–'));
    col.append(list);
    grid.append(col);
  }
  return grid;
}

export function weekSummaryEl(state) {
  const s = state.summary;
  if (!state.planned) return h('div', { class: 'week-summary' }, h('span', { class: 'hint' }, 'Für diese Woche gab es noch keinen Plan.'));
  const pct = s.planned ? Math.round(s.done / s.planned * 100) : 0;
  return h('div', { class: 'week-summary' },
    h('div', { class: 'adherence', title: `${s.done} von ${s.planned} geplanten Einheiten erledigt` }, h('i', { style: { width: `${pct}%` } })),
    h('span', {}, h('b', {}, `${s.done}/${s.planned}`), ' erledigt'),
    s.open ? h('span', {}, h('b', {}, String(s.open)), ' offen') : null,
    s.missed ? h('span', { class: 'missed' }, h('b', {}, String(s.missed)), ' ausgelassen') : null,
    s.extra ? h('span', {}, h('b', {}, String(s.extra)), ' zusätzlich') : null);
}

function renderWeek(root) {
  const t = today();
  if (!viewWeek) viewWeek = weekStart(t);
  const ws = viewWeek, state = weekState(ws);
  const kw = isoWeek(ws);
  const source = state.plan.fixed ? badge('angepasst', 'fixed') : state.planned ? badge(`Vorlage „${state.template?.name ?? '–'}“`, 'cat') : badge('kein Plan', 'cat');
  const block = blockAt(store.list('plan_blocks'), ws) ?? blockAt(store.list('plan_blocks'), addDays(ws, 6));
  root.append(h('div', { class: 'toolbar week-nav' },
    h('button', { type: 'button', class: 'btn icon-only', title: 'Vorige Woche', onclick: () => { viewWeek = addDays(ws, -7); render(root); } }, icon('left')),
    h('div', { class: 'week-title' }, h('b', {}, `KW ${kw.week}`), h('span', {}, `${fmtDs(ws)} – ${fmtD(addDays(ws, 6))}`)),
    h('button', { type: 'button', class: 'btn icon-only', title: 'Nächste Woche', onclick: () => { viewWeek = addDays(ws, 7); render(root); } }, icon('right')),
    ws !== weekStart(t) ? btn('Heute', () => { viewWeek = weekStart(t); render(root); }, 'ghost') : null,
    source, block ? h('span', { class: 'mchip', style: { '--c': BLOCK_COLOR[block.type] } }, h('i'), `${block.name} · ${block.type}`) : null,
    h('span', { class: 'grow' }),
    state.plan.fixed ? btn('Auf Vorlage zurücksetzen', guarded(() => resetWeek(ws))) : state.planned ? btn('Woche anpassen', guarded(async () => { await fixWeek(ws); toast('Woche übernommen – du kannst jetzt jeden Tag ändern'); })) : null));
  root.append(card(null, {}, weekSummaryEl(state), weekGrid(state, { onDay: date => openDayEditor(date) })),
    h('p', { class: 'hint foot-note' }, 'Abgleich automatisch über Datum und Modul: Eine Einheit ist erledigt, wenn am selben Tag eine passende tatsächliche Einheit existiert. Ohne Treffer bleibt sie bis zum Ende des Tages offen, danach gilt sie als ausgelassen. Bei „oder“-Tagen genügt eine der Alternativen.'));
}

const cleanUnit = u => {
  const out = { id: u.id, date: u.date, module: u.module };
  for (const k of ['type', 'duration_min', 'rpe', 'note', 'alt', 'manual']) if (u[k] != null && u[k] !== '') out[k] = u[k];
  return out;
};

/** Store the template's units for a week so that it can be changed day by day. */
async function fixWeek(ws) {
  const c = ctx();
  if (weekPlan(ws, c).fixed) return;
  for (const u of generateWeek(ws, c.templates, c.blocks, c.settings)) await store.put('plan_units', cleanUnit(u));
}

async function resetWeek(ws) {
  if (!await confirmDialog({ title: 'Woche zurücksetzen?', text: 'Alle Anpassungen dieser Woche werden verworfen. Es gilt wieder die Vorlage.', ok: 'Zurücksetzen' })) return;
  for (const u of store.list('plan_units').filter(x => x.date >= ws && x.date <= addDays(ws, 6))) await store.remove('plan_units', u.id);
  toast('Woche folgt wieder der Vorlage');
}

/* ---------- day editor (shared by weeks and templates) ---------- */
const TYPE_HINTS = { climbing: SESSION_TYPES, hangboard: Object.values(HB_TYPE_LABEL), strength: ['Eigentraining', 'Physio', 'Schulter', 'Antagonisten'], run: ['Locker', 'Lang', 'Intervalle', 'Trail'], ride: ['Locker', 'Lang', 'Berg'], mobility: ['Mobility', 'Yoga'], rest: [] };

function unitEditRow(u, { withStatus }) {
  const row = h('div', { class: 'unit-edit' });
  const mod = selectInput(PLAN_MODULES.map(m => [m, moduleLabel(m)]), u.module ?? 'climbing', { class: 'ue-module', 'aria-label': 'Modul' });
  const listId = `dl-unit-types-${Math.random().toString(36).slice(2, 7)}`;
  const dl = h('datalist', { id: listId });
  const fillTypes = () => dl.replaceChildren(...(TYPE_HINTS[mod.value] ?? []).map(v => h('option', { value: v })));
  fillTypes();
  mod.addEventListener('change', () => { fillTypes(); row.classList.toggle('is-rest', mod.value === 'rest'); });
  row.classList.toggle('is-rest', mod.value === 'rest');
  row.append(mod, dl,
    h('input', { class: 'ue-type', list: listId, placeholder: 'Typ (optional)', value: u.type ?? '', autocomplete: 'off', 'aria-label': 'Typ' }),
    h('input', { class: 'ue-dur', type: 'number', min: 0, step: 5, placeholder: 'min', value: u.duration_min ?? '', title: 'Ziel-Dauer in Minuten', 'aria-label': 'Ziel-Dauer' }),
    h('input', { class: 'ue-rpe', type: 'number', min: 1, max: 10, step: 1, placeholder: 'RPE', value: u.rpe ?? '', title: 'Ziel-RPE', 'aria-label': 'Ziel-RPE' }),
    h('input', { class: 'ue-note', placeholder: 'Notiz', value: u.note ?? '', 'aria-label': 'Notiz' }),
    h('label', { class: 'chk', title: 'Alle markierten Einheiten eines Tages sind Alternativen – eine davon genügt.' }, h('input', { type: 'checkbox', class: 'ue-alt', checked: !!u.alt }), 'oder'),
    withStatus ? selectInput([['', 'automatisch'], ['done', 'erledigt'], ['skipped', 'ausgelassen']], u.manual ?? '', { class: 'ue-manual', title: 'Status von Hand setzen', 'aria-label': 'Status' }) : null,
    h('button', { type: 'button', class: 'icon-btn', title: 'Entfernen', onclick: () => row.remove() }, icon('close', 16)));
  return row;
}

function collectUnits(wrap) {
  const units = $$('.unit-edit', wrap).map(row => ({
    module: $('.ue-module', row).value,
    type: $('.ue-type', row).value.trim() || undefined,
    duration_min: $('.ue-dur', row).value === '' ? undefined : Number($('.ue-dur', row).value),
    rpe: $('.ue-rpe', row).value === '' ? undefined : Math.min(10, Math.max(1, Number($('.ue-rpe', row).value))),
    note: $('.ue-note', row).value.trim() || undefined,
    alt: $('.ue-alt', row).checked ? 'a' : undefined,
    manual: $('.ue-manual', row)?.value || undefined,
  }));
  const alts = units.filter(u => u.alt && u.module !== 'rest');
  for (const u of units) if (u.alt && (alts.length < 2 || u.module === 'rest')) delete u.alt; // an "or" needs two
  const training = units.filter(u => u.module !== 'rest');
  const list = training.length ? training : [{ module: 'rest' }];
  return list.map(u => JSON.parse(JSON.stringify(u)));
}

function unitsDialog({ title, intro, units, withStatus, onSave }) {
  const wrap = h('div', { class: 'rows' }, units.map(u => unitEditRow(u, { withStatus })));
  const d = openDialog({
    title, size: 'xl',
    body: [intro ? h('p', { class: 'hint dlg-intro' }, intro) : null,
      h('div', { class: 'section-head' }, h('span', { class: 'hint' }, `Modul · Typ · Ziel-Dauer · Ziel-RPE · Notiz · oder${withStatus ? ' · Status' : ''}`)),
      wrap,
      h('div', { class: 'add-row' }, btn('+ Einheit', () => { const r = unitEditRow({ module: 'climbing' }, { withStatus }); wrap.append(r); $('.ue-module', r).focus(); }))],
    foot: [h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn ghost', onclick: () => d.close() }, 'Abbrechen'), h('button', { type: 'submit', class: 'btn primary' }, 'Speichern')],
    onSubmit: async () => { await onSave(collectUnits(wrap)); d.close(); },
  });
  return d;
}

export function openDayEditor(date) {
  const ws = weekStart(date);
  const current = weekPlan(ws, ctx()).units.filter(u => u.date === date);
  return unitsDialog({
    title: `${DAY_LONG[dayKey(date)]}, ${fmtD(date)}`,
    intro: 'Geplante Einheiten für diesen Tag. Die Woche wird beim Speichern aus der Vorlage übernommen und gilt dann als angepasst.',
    units: current.map(clone), withStatus: true,
    onSave: async list => {
      await fixWeek(ws);
      const docs = list.map((u, i) => cleanUnit({ ...u, id: unitId(date, i + 1), date }));
      for (const doc of docs) await store.put('plan_units', doc);
      for (const old of store.list('plan_units').filter(u => u.date === date && !docs.some(d => d.id === u.id))) await store.remove('plan_units', old.id);
      toast('Tag gespeichert');
    },
  });
}

/* ============ Blöcke ============ */
function renderBlocks(root) {
  const blocks = [...store.list('plan_blocks')].sort((a, b) => a.start.localeCompare(b.start));
  root.append(h('div', { class: 'toolbar' }, h('span', { class: 'hint' }, 'Trainingsblöcke geben den Wochen einen Schwerpunkt. Ein Block kann eine eigene Wochenvorlage mitbringen.'), h('span', { class: 'grow' }), btn('+ Block', () => openBlockEditor(), 'primary')));
  if (!blocks.length) return root.append(emptyState('Noch keine Trainingsblöcke', 'Blöcke wie Basis, Kraft, Power-Endurance oder Deload legst du zusammen mit Claude fest. Hier lassen sie sich anlegen und bearbeiten.', btn('+ Ersten Block anlegen', () => openBlockEditor(), 'primary')));
  const t = today();
  const from = [blocks[0].start, addDays(t, -30)].sort()[0], to = [blocks.at(-1).end, addDays(t, 60)].sort().at(-1);
  const tl = h('div', { class: 'chart' });
  root.append(card('Zeitleiste', {}, tl));
  timeline(tl, blocks.map(b => ({
    label: b.name, sub: b.type, from: b.start, to: b.end, color: BLOCK_COLOR[b.type],
    tip: `<div class="t">${fmtD(b.start)} – ${fmtD(b.end)}</div><b>${esc(b.name)}</b> · ${esc(b.type)}${b.focus ? `<br>${esc(b.focus)}` : ''}`,
    onClick: () => openBlockEditor(b),
  })), { from: weekStart(from), to });
  root.append(h('div', { class: 'sessions-grid' }, blocks.map(b => {
    const weeks = Math.round((Date.parse(b.end) - Date.parse(b.start)) / 864e5 / 7 * 10) / 10;
    const state = b.end < t ? 'vorbei' : b.start > t ? `startet ${fmtDs(b.start)}` : 'läuft';
    const tpl = b.templateId ? store.get('plan_templates', b.templateId) : null;
    return pressable('s-card block', () => openBlockEditor(b),
      h('div', { class: 's-head' }, h('span', { class: 's-date' }, b.name), h('span', { class: 'mchip', style: { '--c': BLOCK_COLOR[b.type] } }, h('i'), b.type)),
      h('div', { class: 's-venue' }, `${fmtD(b.start)} – ${fmtD(b.end)} · ${fmtNum(weeks, 1)} Wochen`),
      b.focus ? h('div', { class: 's-notes plain' }, b.focus) : null,
      b.notes ? h('div', { class: 's-notes' }, b.notes) : null,
      h('div', { class: 's-foot' }, h('span', { class: state === 'läuft' ? 'ok' : '' }, state), tpl ? h('span', {}, `Vorlage „${tpl.name}“`) : h('span', {}, 'Standard-Vorlage')));
  })));
}

export function openBlockEditor(block = null) {
  const templates = store.list('plan_templates');
  return formDialog({
    title: block ? `Block – ${block.name}` : 'Neuer Trainingsblock',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, width: 'half', placeholder: 'z. B. Kraftblock Winter' },
      { key: 'type', label: 'Typ', type: 'select', options: BLOCK_TYPES, width: 'half' },
      { key: 'start', label: 'Start', type: 'date', required: true, width: 'half' },
      { key: 'end', label: 'Ende', type: 'date', required: true, width: 'half' },
      { key: 'focus', label: 'Ziel bzw. Fokus', type: 'text', width: 'full', placeholder: 'z. B. Maximalkraft Finger, 2 × Hangboard pro Woche' },
      { key: 'templateId', label: 'Wochenvorlage', type: 'select', width: 'full', options: [['', 'Standard bzw. Sommer (keine eigene)'], ...templates.filter(t => t.variant === 'block').map(t => [t.id, t.name])], hint: 'Eine eigene Vorlage überschreibt die Standard-Vorlage für die Dauer des Blocks. Neue Vorlagen legst du unter „Vorlagen“ an.' },
      { key: 'notes', label: 'Notizen', type: 'textarea', rows: 3, width: 'full' },
    ],
    value: block ? clone(block) : { type: 'Basis', start: weekStart(today()), end: addDays(weekStart(today()), 27), templateId: '' },
    onSave: async v => {
      if (v.end < v.start) throw new Error('Das Ende liegt vor dem Start.');
      const doc = { ...v, templateId: v.templateId || null };
      if (!doc.id) doc.id = newId('plan_blocks');
      await store.put('plan_blocks', doc);
      toast(block ? 'Block aktualisiert' : 'Block angelegt');
    },
    onDelete: block ? () => store.remove('plan_blocks', block.id) : null,
  });
}

/* ============ Vorlagen ============ */
function templateCard(tpl) {
  const settings = store.settings();
  const usedBy = store.list('plan_blocks').filter(b => b.templateId === tpl.id);
  const sub = tpl.variant === 'standard' ? 'gilt, wenn nichts anderes zutrifft'
    : tpl.variant === 'summer' ? `gilt vom ${mdLabel(settings.summer?.from)} bis ${mdLabel(settings.summer?.to)}`
    : usedBy.length ? `für ${usedBy.map(b => b.name).join(', ')}` : 'noch keinem Block zugeordnet';
  const grid = h('div', { class: 'week-grid template' });
  for (const key of DAY_KEYS) {
    const units = tpl.days?.[key]?.length ? tpl.days[key] : [{ module: 'rest' }];
    const col = pressable('day', () => openTemplateDay(tpl, key),
      h('div', { class: 'day-head' }, h('span', { class: 'day-name' }, DAY_LABELS[key]), h('span', { class: 'ico-edit', html: iconSvg('edit', 13) })));
    const list = h('div', { class: 'day-units' });
    let lastAlt = null;
    for (const u of units) {
      if (u.alt && u.alt === lastAlt) list.append(h('div', { class: 'or' }, 'oder'));
      lastAlt = u.alt ?? null;
      list.append(h('div', { class: `unit st-${u.module === 'rest' ? 'rest' : 'plan'}`, style: { '--c': moduleColor(u.module) } },
        h('span', { class: 'u-status', html: iconSvg(u.module === 'rest' ? 'moon' : 'dot', 14) }),
        h('span', { class: 'u-body' }, h('span', { class: 'u-name' }, unitText(u)), unitTargets(u) ? h('span', { class: 'u-sub' }, unitTargets(u)) : null)));
    }
    col.append(list);
    grid.append(col);
  }
  const actions = [];
  if (tpl.variant === 'summer') actions.push(btn('Zeitraum', () => openSummerEditor(), 'small'));
  if (tpl.variant === 'block') actions.push(btn('Umbenennen', () => renameTemplate(tpl), 'small'), btn('Löschen', guarded(() => deleteTemplate(tpl)), 'small danger'));
  return card(tpl.name, { hint: sub, actions }, grid);
}

const mdLabel = md => (md ? `${md.slice(3)}.${md.slice(0, 2)}.` : '–');

function renderTemplates(root) {
  const order = { standard: 0, summer: 1, block: 2 };
  const templates = [...store.list('plan_templates')].sort((a, b) => (order[a.variant] ?? 3) - (order[b.variant] ?? 3) || (a.name ?? '').localeCompare(b.name ?? ''));
  root.append(h('div', { class: 'toolbar' }, h('span', { class: 'hint' }, 'Aus der Vorlage entsteht der Plan jeder Woche. Klicke einen Tag an, um ihn zu ändern.'), h('span', { class: 'grow' }), btn('+ Block-Vorlage', guarded(() => newTemplate()), 'primary')));
  if (!templates.length) return root.append(emptyState('Vorlagen werden angelegt …', 'Die Standard- und die Sommer-Vorlage entstehen beim ersten Start automatisch.'));
  for (const t of templates) root.append(templateCard(t));
}

function openTemplateDay(tpl, key) {
  return unitsDialog({
    title: `${tpl.name} – ${DAY_LONG[key]}`,
    intro: 'Änderungen gelten für alle Wochen, die dieser Vorlage folgen und noch nicht angepasst wurden.',
    units: clone(tpl.days?.[key] ?? []), withStatus: false,
    onSave: async list => {
      await store.put('plan_templates', { ...clone(tpl), days: { ...clone(tpl.days ?? {}), [key]: list.map(({ manual, ...u }) => u) } });
      toast('Vorlage gespeichert');
    },
  });
}

async function newTemplate() {
  const standard = store.list('plan_templates').find(t => t.variant === 'standard');
  formDialog({
    title: 'Neue Block-Vorlage', size: 'sm',
    intro: 'Startet als Kopie der Standard-Vorlage. Danach ordnest du sie unter „Blöcke“ einem Trainingsblock zu.',
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true, width: 'full', placeholder: 'z. B. Deload-Woche' }],
    value: {},
    onSave: async v => { await store.put('plan_templates', { id: newId('plan_templates'), name: v.name, variant: 'block', days: clone(standard?.days ?? {}) }); toast('Vorlage angelegt'); },
  });
}

function renameTemplate(tpl) {
  formDialog({
    title: 'Vorlage umbenennen', size: 'sm',
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true, width: 'full' }],
    value: { name: tpl.name },
    onSave: async v => { await store.put('plan_templates', { ...clone(tpl), name: v.name }); },
  });
}

async function deleteTemplate(tpl) {
  const used = store.list('plan_blocks').filter(b => b.templateId === tpl.id);
  if (!await confirmDialog({ title: 'Vorlage löschen?', text: used.length ? `Die Blöcke ${used.map(b => `„${b.name}“`).join(', ')} folgen danach wieder der Standard-Vorlage.` : `„${tpl.name}“ wird endgültig gelöscht.` })) return;
  for (const b of used) await store.put('plan_blocks', { ...clone(b), templateId: null });
  await store.remove('plan_templates', tpl.id);
  toast('Vorlage gelöscht');
}

export function openSummerEditor() {
  const s = store.settings().summer ?? { from: '06-01', to: '09-30' };
  const year = today().slice(0, 4);
  return formDialog({
    title: 'Zeitraum der Sommer-Variante', size: 'sm',
    intro: 'Gilt jedes Jahr in diesem Zeitraum. Das Jahr im Datumsfeld spielt keine Rolle.',
    fields: [
      { key: 'from', label: 'von', type: 'date', required: true, width: 'half' },
      { key: 'to', label: 'bis', type: 'date', required: true, width: 'half' },
    ],
    value: { from: `${year}-${s.from}`, to: `${year}-${s.to}` },
    onSave: async v => { await store.saveSettings({ summer: { from: v.from.slice(5), to: v.to.slice(5) } }); toast('Sommerzeitraum gespeichert'); },
  });
}
