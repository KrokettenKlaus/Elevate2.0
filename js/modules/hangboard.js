// Hangboard: strength, repeaters and weighted pull-ups, compared as % of body weight.
import store, { clone } from '../store/index.js';
import { MONTHS, addDays, fmtD, fmtDs, today, wd } from '../domain/dates.js';
import {
  CUSTOM, CUSTOM_MODES, EDITOR_TYPES, GRIPS, GRIP_LABEL, HB_TYPE_LABEL, MODES, MODE_LABEL, bodyweightAt, customNames, describeBlock, fmtLoad, isOneArm,
  hangSeries, pctBodyweight, sessionLabel, timeUnderTension,
} from '../domain/hangboard.js';
import { testValue } from '../domain/tests.js';
import { $, $$, emptyState, esc, fmtDur, fmtNum, fmtPct, h, icon, local, navigate } from '../ui/dom.js';
import { confirmDialog, openDialog, toast } from '../ui/dialog.js';
import { datalist, field, rpeScale, seg, selectInput } from '../ui/forms.js';
import { lineChart } from '../ui/charts.js';
import { badge, btn, card, kpi, loadBadge, pressable } from '../ui/view.js';

export const meta = { id: 'hangboard', title: 'Hangboard', sub: 'Fingerkraft in % vom Körpergewicht' };

const sessions = () => store.list('hangboard_sessions');
const sorted = () => [...sessions()].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
let seriesKey = null;
let unit = 'pct';
let typeFilter = 'all';

/** Reference line for a series, only where the comparison is fair. */
export function referenceFor(series) {
  const tests = store.list('tests').filter(t => t.isReference);
  if (series.mode === 'pullup') {
    const ref = tests.find(t => t.type === 'max_pullup');
    if (!ref) return null;
    const bw = Number(ref.bodyweight_kg) || null;
    return bw ? { y: pctBodyweight('pullup', ref.protocol.load_kg, bw), label: `Referenz ${ref.protocol.reps} × +${ref.protocol.load_kg} kg`, exact: true } : null;
  }
  const ref = tests.find(t => t.type === 'max_hang');
  if (!ref) return null;
  const v = testValue(ref);
  if (v.value == null) return null;
  const sameSetup = series.mode === 'hang_two_arm' && series.type === 'Strength' && Number(series.edge) === Number(ref.protocol.edge_mm);
  if (series.mode !== 'hang_two_arm' || series.type !== 'Strength') return null;
  return { y: v.value, label: `Referenz ${ref.protocol.edge_mm} mm · ${fmtNum(v.value)} %`, exact: sameSetup, edge: ref.protocol.edge_mm };
}

export function render(root) {
  const ss = sorted();
  root.replaceChildren();
  if (!ss.length) {
    root.append(emptyState('Noch keine Hangboard-Einheiten', 'Trage eine Einheit ein oder importiere deine Notizen aus Hangboard.txt.',
      h('div', { class: 'row center' }, btn('+ Einheit', () => openEditor(), 'primary'), btn('Zum Import', () => navigate('import')))));
    return;
  }
  const bws = store.list('bodyweight');
  const series = hangSeries(sessions(), bws);
  const list = [...series.values()].sort((a, b) => b.pts.length - a.pts.length || a.label.localeCompare(b.label));
  if (!seriesKey || !series.has(seriesKey)) seriesKey = local.get('hb:series') && series.has(local.get('hb:series')) ? local.get('hb:series') : list[0]?.key ?? null;
  const cur = series.get(seriesKey);

  const t = today();
  const last = ss[0];
  const last30 = ss.filter(s => s.date >= addDays(t, -30)).length;
  const bwNow = bodyweightAt(bws, t);
  const lastPt = cur?.pts.at(-1), firstPt = cur?.pts[0];
  root.append(h('div', { class: 'kpis' },
    kpi('Letzte Einheit', fmtDs(last.date), `${wd(last.date)} · ${sessionLabel(last)}`, 'accent-hb'),
    kpi('Letzte 30 Tage', fmtNum(last30), 'Einheiten'),
    kpi('Körpergewicht', bwNow ? `${fmtNum(bwNow.kg, 1)} kg` : '–', bwNow ? `seit ${fmtD(bwNow.date)}` : 'unter Tests eintragen'),
    cur && lastPt ? kpi('Aktuell', lastPt.pct != null ? fmtPct(lastPt.pct) : fmtLoad(cur.mode, lastPt.load), cur.label) : null,
    cur && lastPt && firstPt && lastPt !== firstPt ? kpi('Seit Beginn', `${lastPt.load - firstPt.load >= 0 ? '+' : '−'}${fmtNum(Math.abs(lastPt.load - firstPt.load), 1)} kg`, `${fmtLoad(cur.mode, firstPt.load)} → ${fmtLoad(cur.mode, lastPt.load)}`) : null));

  // ---- progress chart
  const chart = h('div', { class: 'chart' });
  const picker = selectInput(list.map(s => [s.key, `${s.label} (${s.pts.length}×)`]), seriesKey, { id: 'hb-series', onchange: () => { seriesKey = picker.value; local.set('hb:series', seriesKey); render(root); } });
  const unitSeg = seg([['pct', '% Körpergewicht'], ['kg', 'kg']], unit, v => { unit = v; render(root); });
  const note = h('div', { class: 'hint chart-note' });
  root.append(card('Verlauf', { actions: [picker, unitSeg] }, chart, note));
  if (cur) {
    const ref = referenceFor(cur);
    const pts = cur.pts.map(p => ({ ...p, y: unit === 'pct' ? p.pct : p.load }));
    const refLines = unit === 'pct' && ref?.exact ? [{ y: ref.y, label: ref.label, cls: 'ref' }] : [];
    lineChart(chart, [{ name: cur.label, color: 'var(--m-hangboard)', pts }], {
      zeroBased: false, refLines, height: 240,
      yFmt: v => (unit === 'pct' ? `${fmtNum(v)} %` : `${fmtNum(v, 1)}`),
      tipFn: hits => {
        const p = hits[0];
        return `<div class="t">${wd(p.date)}, ${fmtD(p.date)}</div>${esc(describeBlock(p.session.type, p.block))}<br>${p.pct != null ? `<b>${fmtPct(p.pct, 1)}</b> vom Körpergewicht (${fmtNum(p.bw, 1)} kg${p.bwApprox ? ', geschätzt' : ''})` : 'kein Körpergewicht hinterlegt'}`;
      },
    });
    const parts = [];
    if (cur.mode === 'lift_one_arm') parts.push('Einarmig gehoben: Last ÷ Körpergewicht, pro Hand.');
    else if (cur.mode === 'hang_one_arm') parts.push('Einarmig gehängt: (Körpergewicht + Last) ÷ Körpergewicht an einer Hand. Negative Last bedeutet Entlastung über die Umlenkrolle.');
    else parts.push('Beidarmig: (Körpergewicht + Last) ÷ Körpergewicht. Negative Last bedeutet Entlastung über die Umlenkrolle.');
    if (cur.pts.some(p => p.bwApprox)) parts.push('Vor dem ersten Körpergewichts-Eintrag wird mit dem frühesten bekannten Wert gerechnet.');
    if (ref && !ref.exact) parts.push(`Die Referenz von vor der Verletzung lief auf ${ref.edge} mm – wegen der anderen Leiste wird sie hier nicht eingezeichnet.`);
    if (!ref && isOneArm(cur.mode)) parts.push(`Die Referenz (beidarmiger Max Hang) ist mit einarmigem ${cur.mode === 'lift_one_arm' ? 'Heben' : 'Hängen'} nicht vergleichbar.`);
    note.textContent = parts.join(' ');
  }

  // ---- sessions
  const filter = seg([['all', 'Alle'], ...EDITOR_TYPES.map(t2 => [t2, HB_TYPE_LABEL[t2]])], typeFilter, v => { typeFilter = v; render(root); });
  const listEl = h('div', {});
  root.append(h('div', { class: 'toolbar' }, filter, h('span', { class: 'hint' }, `${ss.length} Einheiten`), h('span', { class: 'grow' }), btn('+ Einheit', () => openEditor(), 'primary')), listEl);
  let month = '', grid;
  for (const s of ss.filter(x => typeFilter === 'all' || x.type === typeFilter)) {
    const m = `${MONTHS[Number(s.date.slice(5, 7)) - 1]} ${s.date.slice(0, 4)}`;
    if (m !== month) { month = m; listEl.append(h('div', { class: 'month-head' }, m)); grid = h('div', { class: 'sessions-grid' }); listEl.append(grid); }
    grid.append(sessionCard(s, bws));
  }
}

export function sessionCard(s, bws = store.list('bodyweight')) {
  const bw = bodyweightAt(bws, s.date);
  const tut = (s.blocks ?? []).reduce((a, b) => a + timeUnderTension(b), 0);
  return pressable('s-card hb', () => openEditor(s),
    h('div', { class: 's-head' }, h('span', { class: 's-date' }, fmtD(s.date), h('small', {}, wd(s.date))), badge(sessionLabel(s), 'hb')),
    h('ul', { class: 'ex-list blocks' }, (s.blocks ?? []).map(b => {
      const mode = s.type === 'PullUp' ? 'pullup' : b.mode;
      const pct = bw && b.load_kg != null ? pctBodyweight(mode, b.load_kg, bw.kg) : null;
      return h('li', {}, h('span', { class: 'n', title: b.raw || '' }, describeBlock(s.type, b)), h('span', { class: 'd' }, pct != null ? fmtPct(pct) : ''));
    })),
    s.notes ? h('div', { class: 's-notes' }, s.notes) : null,
    h('div', { class: 's-foot' },
      s.warmup ? h('span', {}, 'aufgewärmt') : null,
      tut ? h('span', {}, `${fmtNum(tut)} s unter Last`) : null,
      s.duration_min ? h('span', {}, fmtDur(s.duration_min)) : null,
      loadBadge(s.duration_min, s.rpe)));
}

/* ============ Editor ============ */
const num = (cls, value, attrs = {}) => h('input', { type: 'number', class: cls, inputmode: 'decimal', step: 'any', value: value ?? '', ...attrs });
const cell = (label, control) => h('label', { class: 'b-cell' }, h('span', {}, label), control);

function blockRow(type, b, ctx) {
  const row = h('div', { class: 'block-edit' });
  row.dataset.raw = b.raw ?? '';
  const pctEl = h('span', { class: 'b-pct' });
  const custom = type === CUSTOM;
  const modes = custom ? CUSTOM_MODES : MODES;
  const mode = type === 'PullUp' ? null : selectInput(modes.map(m => [m, MODE_LABEL[m]]), b.mode && modes.includes(b.mode) ? b.mode : ctx.defaultMode(type), { class: 'b-mode' });
  const load = num('b-load', b.load_kg, { placeholder: 'kg', title: 'Negativ = Entlastung über die Umlenkrolle (nicht beim einarmigen Heben)' });
  const fields = h('div', { class: 'b-grid' });
  if (type === 'PullUp') {
    fields.append(cell('Wiederholungen', num('b-reps', b.reps, { min: 0, step: 1 })), cell('Zusatzgewicht (kg)', load), cell('Sätze', num('b-sets', b.sets ?? 1, { min: 1, step: 1 })), cell('Pause (s)', num('b-rest', b.rest_s, { min: 0, step: 5 })));
  } else {
    fields.append(
      cell('Ausführung', mode),
      cell(type === 'PowerEndurance' ? 'Last (kg)' : 'Last (kg)', load),
      cell(type === 'PowerEndurance' ? 'Wdh. pro Satz' : 'Wiederholungen', num('b-reps', b.reps, { min: 0, step: 1 })),
      cell('Sätze', num('b-sets', b.sets ?? 1, { min: 1, step: 1 })),
      cell(type === 'PowerEndurance' ? 'Belastung (s)' : 'Hängezeit (s)', num('b-work', b.work_s, { min: 0, step: 1 })),
      cell('Pause (s)', num('b-rest', b.rest_s, { min: 0, step: 1 })),
      cell('Leiste (mm)', num('b-edge', b.edge_mm ?? ctx.defaultEdge, { min: 4, step: 1 })),
      cell('Griff', selectInput(GRIPS.map(g => [g, GRIP_LABEL[g]]), b.grip ?? 'halfcrimp', { class: 'b-grip' })));
    if (type === 'PowerEndurance' || custom) fields.append(h('label', { class: 'b-cell chk-cell' }, h('span', {}, 'Seitenwechsel'), h('input', { type: 'checkbox', class: 'b-switch', checked: !!b.switching })));
    if (custom) {
      // pull-ups have no edge or grip
      const sync = () => $$('.b-edge, .b-grip, .b-switch', fields).forEach(el => { el.disabled = mode.value === 'pullup'; });
      mode.addEventListener('change', sync);
      sync();
    }
  }
  const paint = () => {
    const bw = bodyweightAt(store.list('bodyweight'), ctx.date());
    const m = type === 'PullUp' ? 'pullup' : mode.value;
    const pct = bw && load.value !== '' ? pctBodyweight(m, Number(load.value), bw.kg) : null;
    pctEl.textContent = pct != null ? `${fmtPct(pct, 1)} KG` : '';
    pctEl.title = bw ? `Körpergewicht ${fmtNum(bw.kg, 1)} kg${bw.approx ? ' (frühester bekannter Wert)' : ''}` : 'Kein Körpergewicht hinterlegt';
  };
  row.addEventListener('input', paint);
  row.addEventListener('change', paint);
  row.append(fields, h('div', { class: 'b-side' }, pctEl, h('button', { type: 'button', class: 'icon-btn', title: 'Block entfernen', onclick: () => row.remove() }, icon('close', 16))),
    b.raw ? h('div', { class: 'raw b-raw', title: 'Originalzeile aus dem Import' }, b.raw) : null);
  paint();
  row.paint = paint;
  return row;
}

function collectBlocks(wrap, type) {
  const n = (row, cls) => { const el = $(`.${cls}`, row); return !el || el.value === '' ? null : Number(el.value); };
  return $$('.block-edit', wrap).map(row => {
    if (type === 'PullUp') {
      return { mode: 'pullup', work_s: null, rest_s: n(row, 'b-rest'), edge_mm: null, grip: null, load_kg: n(row, 'b-load') ?? 0, reps: n(row, 'b-reps'), sets: n(row, 'b-sets') ?? 1, side: 'both', switching: false, raw: row.dataset.raw || undefined };
    }
    const mode = $('.b-mode', row).value;
    if (mode === 'pullup') {
      return { mode, work_s: n(row, 'b-work'), rest_s: n(row, 'b-rest'), edge_mm: null, grip: null, load_kg: n(row, 'b-load') ?? 0, reps: n(row, 'b-reps'), sets: n(row, 'b-sets') ?? 1, side: 'both', switching: false, raw: row.dataset.raw || undefined };
    }
    const switching = !!$('.b-switch', row)?.checked;
    return {
      mode, work_s: n(row, 'b-work'), rest_s: n(row, 'b-rest'), edge_mm: n(row, 'b-edge'), grip: $('.b-grip', row).value,
      load_kg: n(row, 'b-load'), reps: n(row, 'b-reps'), sets: n(row, 'b-sets') ?? 1,
      side: switching ? 'alternating' : isOneArm(mode) ? 'each' : 'both', switching, raw: row.dataset.raw || undefined,
    };
  }).filter(b => b.load_kg != null || b.reps != null);
}

export function openEditor(session = null, preset = {}) {
  const settings = store.settings();
  const sameName = (a, b) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
  const lastOfType = t => sorted().find(s => s.type === t && s.id !== session?.id && (t !== CUSTOM || sameName(s.name, nameInput.value)));
  const nameInput = h('input', { type: 'text', id: 'hb-name', value: session?.name ?? preset.name ?? '', placeholder: 'z. B. Min-Edge, Density Hangs, No-Hangs', autocomplete: 'off', list: datalist('dl-hb-custom', customNames(sessions())) });
  const nameField = field('Name des Trainings', nameInput, { hint: 'Einheiten mit demselben Namen bilden eine gemeinsame Verlaufskurve.' });
  const ctx = {
    date: () => date.value,
    defaultEdge: settings.defaultEdge ?? 20,
    defaultMode: type => lastOfType(type)?.blocks?.[0]?.mode ?? (type === 'Strength' ? settings.strengthModeDefault ?? 'lift_one_arm' : 'lift_one_arm'),
  };
  const date = h('input', { type: 'date', id: 'hb-date', value: session?.date ?? preset.date ?? today(), required: true });
  let type = session?.type ?? preset.type ?? 'Strength';
  const blocksEl = h('div', { id: 'hb-blocks' });
  const fill = list => { blocksEl.replaceChildren(...list.map(b => blockRow(type, b, ctx))); };
  const starter = t => {
    const prev = lastOfType(t);
    if (prev?.blocks?.length) return clone(prev.blocks).map(b => { delete b.raw; return b; });
    return [t === 'PullUp' ? { reps: 5, sets: 5, rest_s: 180 } : t === 'PowerEndurance' ? { work_s: 7, rest_s: 3, sets: 3 } : { work_s: 7, rest_s: 180, reps: 4, sets: 1 }];
  };
  const showName = () => { nameField.hidden = type !== CUSTOM; };
  const typeSeg = seg(EDITOR_TYPES.map(t => [t, HB_TYPE_LABEL[t]]), type, v => { type = v; showName(); fill(session && session.type === v ? clone(session.blocks) : starter(v)); hint(); if (v === CUSTOM && !nameInput.value) nameInput.focus(); });
  // a known custom name pre-fills the blocks of its last session
  nameInput.addEventListener('change', () => { if (!session && type === CUSTOM && lastOfType(CUSTOM)) { fill(starter(CUSTOM)); hint(); } });
  const warm = h('input', { type: 'checkbox', id: 'hb-warm', checked: session ? !!session.warmup : true });
  const duration = h('input', { type: 'number', id: 'hb-duration', min: 0, step: 5, placeholder: 'optional', value: session?.duration_min ?? '' });
  const rpe = rpeScale(session?.rpe ?? null);
  const notes = h('textarea', { id: 'hb-notes', rows: 2, placeholder: 'Wie haben sich die Finger angefühlt?' });
  notes.value = session?.notes ?? '';
  const hintEl = h('div', { class: 'hint' });
  const hint = () => { const prev = lastOfType(type); hintEl.textContent = !session && prev ? `Vorbelegt mit den Werten vom ${fmtDs(prev.date)}.` : ''; };
  fill(session ? clone(session.blocks ?? []) : starter(type));
  hint();
  showName();
  date.addEventListener('change', () => $$('.block-edit', blocksEl).forEach(r => r.paint()));

  const d = openDialog({
    title: session ? `Hangboard – ${fmtD(session.date)}` : 'Neue Hangboard-Einheit',
    size: 'lg',
    body: [
      h('div', { class: 'row' }, field('Datum', date), field('Typ', typeSeg), h('label', { class: 'field inline' }, h('span', { class: 'lbl' }, 'Aufwärmen'), h('span', { class: 'chk' }, warm, 'ja'))),
      nameField, hintEl, blocksEl,
      h('div', { class: 'add-row' }, btn('+ Block', () => { const rows = collectBlocks(blocksEl, type); const b = rows.at(-1) ? { ...rows.at(-1), raw: undefined } : starter(type)[0]; const r = blockRow(type, b, ctx); blocksEl.append(r); $('.b-load', r).focus(); })),
      h('div', { class: 'row load-row' }, field('Dauer (min)', duration, { hint: 'für die Belastung (sRPE)' }), field('Anstrengung (RPE)', rpe)),
      field('Notizen', notes),
      session?.raw ? h('details', { class: 'table-toggle' }, h('summary', {}, 'Originalnotiz aus dem Import'), h('pre', { class: 'raw-block' }, session.raw)) : null,
    ],
    foot: [
      session ? h('button', { type: 'button', class: 'btn ghost danger', onclick: async () => {
        if (!await confirmDialog({ title: 'Einheit löschen?', text: `Die Hangboard-Einheit vom ${fmtD(session.date)} wird endgültig gelöscht.` })) return;
        try { await store.remove('hangboard_sessions', session.id); d.close(); toast('Einheit gelöscht'); } catch (e) { toast(e.message, true); }
      } }, icon('trash', 16), 'Löschen') : null,
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => d.close() }, 'Abbrechen'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Speichern'),
    ],
    onSubmit: async () => {
      if (!date.value) return toast('Bitte ein Datum wählen', true);
      const name = nameInput.value.trim();
      if (type === CUSTOM && !name) { nameInput.focus(); return toast('Bitte dem eigenen Training einen Namen geben', true); }
      const blocks = collectBlocks(blocksEl, type);
      if (!blocks.length) return toast('Mindestens einen Block mit Last oder Wiederholungen eintragen', true);
      // the original line only stays while the block still says what it said
      if (session) blocks.forEach(b => { const o = (session.blocks ?? []).find(x => x.raw === b.raw); if (!o || describeBlock(session.type, o) !== describeBlock(type, b)) delete b.raw; });
      const doc = {
        ...(session ? clone(session) : {}),
        id: session?.id ?? uniqueId(date.value), date: date.value, type, warmup: warm.checked, blocks,
        duration_min: duration.value === '' ? null : Number(duration.value), rpe: rpe.getValue(), notes: notes.value.trim(),
      };
      if (type === CUSTOM) {
        // reuse the spelling of an existing training so series don't split on capitalisation
        doc.name = customNames(sessions().filter(s => s.id !== session?.id)).find(n => sameName(n, name)) ?? name;
      } else delete doc.name;
      await store.put('hangboard_sessions', doc);
      d.close();
      toast(session ? 'Einheit aktualisiert' : 'Einheit gespeichert');
    },
  });
  return d;
}

function uniqueId(date) {
  const base = `hb-${date.replaceAll('-', '')}`;
  if (!store.get('hangboard_sessions', base)) return base;
  for (let i = 2; ; i++) if (!store.get('hangboard_sessions', `${base}-${i}`)) return `${base}-${i}`;
}

export const openNew = preset => openEditor(null, preset);
export const openById = id => { const s = store.get('hangboard_sessions', id); if (s) openEditor(s); };

/** Latest comparable value against the pre-injury reference, for the dashboard. */
export function headline() {
  const series = [...hangSeries(sessions(), store.list('bodyweight')).values()];
  if (!series.length) return null;
  const pick = series.find(s => s.mode === 'hang_two_arm' && s.type === 'Strength') ?? series.sort((a, b) => b.pts.at(-1).date.localeCompare(a.pts.at(-1).date))[0];
  const last = pick.pts.at(-1);
  return { series: pick, last, ref: referenceFor(pick) };
}
