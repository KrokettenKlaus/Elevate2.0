// Kraft & Prävention – the former RehabBoard, with its full feature set and data format.
import store, { clone } from '../store/index.js';
import { MONTHS, addDays, daysBetween, fmtD, fmtDay, fmtDs, today, wd, weekStart } from '../domain/dates.js';
import {
  CATEGORIES, KIND_LABEL, exReps, exSets, exVolume, exerciseNames, exerciseSeries, fmtGroups, groupParts,
  isStrength, lastExercise, progressRows, sesSets, sesVolume, sortedSessions, weeklyStats,
} from '../domain/strength.js';
import { $, $$, emptyState, esc, fmtDur, fmtKg, fmtNum, h, icon, legend, local, navigate } from '../ui/dom.js';
import { confirmDialog, openDialog, toast } from '../ui/dialog.js';
import { datalist, field, rpeScale, seg, selectInput } from '../ui/forms.js';
import { barChart, heatCalendar, lineChart, rankBars, sparkline } from '../ui/charts.js';
import { btn, card, kpi, loadBadge, pressable, subTabs } from '../ui/view.js';

export const meta = { id: 'strength', title: 'Kraft & Prävention', sub: 'Schulter-Reha, Kraft und Physio-Termine' };

const sessions = () => store.list('strength_sessions');
let tab = null;
let kindFilter = 'all';
let query = '';
let statsExercise = null;

export function render(root) {
  const ss = sortedSessions(sessions());
  const tabs = subTabs('strength', [['overview', 'Übersicht'], ['sessions', 'Sitzungen', ss.length], ['stats', 'Statistik']], id => { tab = id; render(root); });
  tab = tabs.active;
  root.replaceChildren(tabs.el);
  if (!ss.length) {
    root.append(emptyState('Noch keine Sitzungen', 'Lege die erste Sitzung an oder übernimm deine RehabBoard-Daten über den Import.',
      h('div', { class: 'row center' }, btn('+ Neue Sitzung', () => openEditor(), 'primary'), btn('Zum Import', () => navigate('import')))));
    return;
  }
  if (tab === 'overview') renderOverview(root, ss);
  if (tab === 'sessions') renderSessions(root, ss);
  if (tab === 'stats') renderStats(root, ss);
}

/* ============ Übersicht ============ */
function renderOverview(root, ss) {
  const first = ss[ss.length - 1].date, last = ss[0].date, t = today();
  const weeks = Math.max(1, daysBetween(weekStart(first), weekStart(t)) / 7 + 1);
  const thisWeek = ss.filter(s => s.date >= weekStart(t)).length;
  const last30 = ss.filter(s => { const d = daysBetween(s.date, t); return d >= 0 && d < 30; }).length;
  const physio = ss.filter(s => s.kind === 'physio').length;
  const vol = ss.reduce((a, s) => a + sesVolume(s), 0);
  const sets = ss.reduce((a, s) => a + sesSets(s), 0);
  const since = daysBetween(last, t);
  root.append(h('div', { class: 'kpis' },
    kpi('Sitzungen gesamt', fmtNum(ss.length), `seit ${fmtD(first)}`, 'accent'),
    kpi('Diese Woche', fmtNum(thisWeek), `Ø ${fmtNum(ss.length / weeks, 1)} pro Woche`),
    kpi('Letzte 30 Tage', fmtNum(last30), 'Sitzungen'),
    kpi('Physio-Termine', fmtNum(physio), `${fmtNum(ss.length - physio)} × Eigentraining`),
    kpi('Letztes Training', since === 0 ? 'Heute' : since === 1 ? 'Gestern' : `vor ${since} T.`, fmtDay(last)),
    kpi('Bewegtes Gewicht', `${fmtNum(vol / 1000, 1)} t`, `${fmtNum(sets)} Sätze insgesamt`)));

  const cal = h('div', { class: 'calendar' });
  const byDate = new Map();
  for (const s of ss) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  root.append(h('div', { class: 'grid-2' },
    card('Trainingskalender', { actions: legend([{ color: 'var(--m-strength)', label: 'Eigentraining' }, { color: 'var(--physio)', label: 'Physio' }]) }, cal),
    card('Letzte Sitzung', { actions: btn('Als Vorlage', () => openEditor(null, ss[0]), 'ghost small') }, sessionBody(ss[0], true))));
  heatCalendar(cal, weekStart(first), weekStart(t), date => {
    const list = byDate.get(date);
    if (!list) return null;
    return {
      cls: list.some(s => s.kind === 'physio') ? 'physio' : 'home',
      tip: list.map(s => `<b>${KIND_LABEL[s.kind]}</b> · ${s.exercises.length} Übungen`).join('<br>'),
      onClick: () => openEditor(list[0]),
    };
  });

  const rows = progressRows(sessions());
  const table = h('div', { class: 'table-wrap' });
  if (!rows.length) table.append(h('div', { class: 'chart-empty' }, 'Noch zu wenig Daten – ab drei Sitzungen mit Gewicht erscheint hier der Verlauf.'));
  else {
    table.innerHTML = `<table><thead><tr><th>Übung</th><th class="r">Sitzungen</th><th class="r">Start</th><th class="r">Aktuell</th><th class="r">Best</th><th class="r">Veränderung</th><th>Verlauf</th><th class="r">Zuletzt</th></tr></thead><tbody>${rows.map(r =>
      `<tr class="click" data-name="${esc(r.name)}"><td>${esc(r.name)}</td><td class="r">${r.pts.length}</td><td class="r">${fmtKg(r.first)}</td><td class="r"><b>${fmtKg(r.current)}</b></td><td class="r">${fmtKg(r.best)}</td><td class="r">${r.pct > 0 ? `<span class="delta">+${r.pct} %</span>` : `${r.pct} %`}</td><td>${sparkline(r.pts.map(p => p.w), 120, 28, 'var(--m-strength)')}</td><td class="r">${fmtDs(r.last)}</td></tr>`).join('')}</tbody></table>`;
    $$('tr.click', table).forEach(tr => tr.addEventListener('click', () => { statsExercise = tr.dataset.name; local.set('tab:strength', 'stats'); render(root); }));
  }
  root.append(card('Fortschritt Arbeitsgewicht', { hint: 'erstes vs. aktuelles Gewicht, Verlauf' }, table));
}

function exerciseListEl(s) {
  return h('ul', { class: 'ex-list' }, s.exercises.map(e => {
    const d = h('span', { class: 'd' });
    if (isStrength(e)) {
      groupParts(e).forEach((p, i) => d.append(i ? ', ' : '', p.warmup ? h('span', { class: 'w', title: 'Aufwärmsatz' }, `A: ${p.text}`) : p.text));
      if (e.note) d.append(' ', h('span', { class: 'w' }, `(${e.note})`));
    } else d.append(h('span', { class: 'badge cat' }, e.category || 'Frei'));
    return h('li', {}, h('span', { class: 'n', title: e.raw || e.name }, e.name), d);
  }));
}

/** Body of a session card; also used by the dashboard. */
export function sessionBody(s, withHead = false) {
  return h('div', { class: 's-body' },
    withHead ? h('div', { class: 's-head' }, h('span', { class: 's-date' }, fmtDay(s.date)), h('span', { class: `badge ${s.kind}` }, KIND_LABEL[s.kind])) : null,
    exerciseListEl(s),
    s.notes ? h('div', { class: 's-notes' }, s.notes) : null,
    h('div', { class: 's-foot' },
      h('span', {}, `${s.exercises.length} Übungen`), h('span', {}, `${sesSets(s)} Sätze`),
      sesVolume(s) ? h('span', {}, `${fmtNum(sesVolume(s))} kg Volumen`) : null,
      s.duration_min ? h('span', {}, fmtDur(s.duration_min)) : null,
      loadBadge(s.duration_min, s.rpe)));
}

/* ============ Sitzungen ============ */
function renderSessions(root, ss) {
  const listEl = h('div', {});
  const countEl = h('span', { class: 'hint' });
  const search = h('input', { type: 'search', id: 'strength-search', placeholder: 'Übung oder Notiz suchen …', value: query, oninput: () => { query = search.value; paint(); } });
  const filter = seg([['all', 'Alle'], ['home', 'Eigentraining'], ['physio', 'Physio']], kindFilter, v => { kindFilter = v; paint(); });
  root.append(h('div', { class: 'toolbar' }, search, filter, countEl, h('span', { class: 'grow' }), btn('+ Neue Sitzung', () => openEditor(), 'primary')), listEl);

  function paint() {
    const q = query.trim().toLowerCase();
    const list = ss.filter(s => (kindFilter === 'all' || s.kind === kindFilter)
      && (!q || s.notes?.toLowerCase().includes(q) || s.exercises.some(e => e.name.toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q))));
    countEl.textContent = `${list.length} Sitzungen`;
    listEl.replaceChildren();
    if (!list.length) return listEl.append(h('div', { class: 'chart-empty' }, 'Keine Sitzungen gefunden.'));
    let month = '', grid;
    for (const s of list) {
      const m = `${MONTHS[Number(s.date.slice(5, 7)) - 1]} ${s.date.slice(0, 4)}`;
      if (m !== month) { month = m; listEl.append(h('div', { class: 'month-head' }, m)); grid = h('div', { class: 'sessions-grid' }); listEl.append(grid); }
      grid.append(pressable(`s-card ${s.kind}`, () => openEditor(s),
        h('div', { class: 's-head' }, h('span', { class: 's-date' }, fmtD(s.date), h('small', {}, wd(s.date))), h('span', { class: `badge ${s.kind}` }, KIND_LABEL[s.kind])),
        sessionBody(s)));
    }
  }
  paint();
}

/* ============ Statistik ============ */
function renderStats(root, ss) {
  const all = sessions();
  const names = exerciseNames(all).filter(n => all.some(s => s.exercises.some(e => e.name === n.name && isStrength(e))));
  if (!statsExercise || !names.some(n => n.name === statsExercise)) statsExercise = names[0]?.name ?? null;
  const sel = selectInput(names.map(n => [n.name, `${n.name} (${n.count}×)`]), statsExercise, { id: 'strength-ex-select', onchange: () => { statsExercise = sel.value; render(root); } });

  const pts = statsExercise ? exerciseSeries(all, statsExercise) : [];
  const wpts = pts.filter(p => p.w != null);
  const summary = h('div', { class: 'ex-summary' });
  if (pts.length) {
    const f = wpts[0], l = wpts[wpts.length - 1];
    const item = (v, t) => h('div', {}, h('b', {}, v), h('span', {}, t));
    summary.append(item(pts.length, 'Sitzungen'), item(f ? fmtKg(f.w) : '–', `Start${f ? ` (${fmtDs(f.date)})` : ''}`), item(l ? fmtKg(l.w) : '–', `Aktuell${l ? ` (${fmtDs(l.date)})` : ''}`),
      item(wpts.length ? fmtKg(Math.max(...wpts.map(p => p.w))) : '–', 'Bestwert'), item(fmtNum(pts.reduce((a, p) => a + p.reps, 0)), 'Wiederholungen gesamt'));
  }
  const cWeight = h('div', { class: 'chart' }), cVol = h('div', { class: 'chart' });
  const tbl = h('div', { class: 'table-wrap' });
  tbl.innerHTML = `<table><thead><tr><th>Datum</th><th>Sätze</th><th class="r">Arbeitsgewicht</th><th class="r">Volumen</th><th>Originalnotiz</th></tr></thead><tbody>${[...pts].reverse().map(p =>
    `<tr><td>${fmtD(p.date)}</td><td>${esc(fmtGroups(p.ex))}</td><td class="r">${fmtKg(p.w)}</td><td class="r">${fmtNum(p.vol)}</td><td class="raw">${esc(p.ex.raw || '')}</td></tr>`).join('')}</tbody></table>`;

  const cWeeks = h('div', { class: 'chart' }), cWeekVol = h('div', { class: 'chart' }), cFreq = h('div', {});
  root.append(
    card('Übungsverlauf', { actions: sel }, summary,
      h('div', { class: 'grid-2 tight' },
        h('div', {}, h('h3', {}, 'Max. Arbeitsgewicht (kg)'), cWeight),
        h('div', {}, h('h3', {}, 'Volumen pro Sitzung (kg × WH)'), cVol)),
      h('details', { class: 'table-toggle' }, h('summary', {}, 'Tabelle anzeigen'), tbl)),
    h('div', { class: 'grid-2' },
      card('Sitzungen pro Woche', { actions: legend([{ color: 'var(--m-strength)', label: 'Eigentraining' }, { color: 'var(--physio)', label: 'Physio' }]) }, cWeeks),
      card('Volumen pro Woche (kg × WH)', {}, cWeekVol)),
    card('Häufigste Übungen', { hint: 'Anzahl Sitzungen' }, cFreq));

  const tipFor = p => `<div class="t">${wd(p.date)}, ${fmtD(p.date)}${p.session.kind === 'physio' ? ' · Physio' : ''}</div>${esc(fmtGroups(p.ex))}<br>Arbeitsgewicht <b>${fmtKg(p.w) || '–'}</b> · Volumen <b>${fmtNum(p.vol)} kg</b>`;
  lineChart(cWeight, [{ name: statsExercise, color: 'var(--m-strength)', pts: wpts.map(p => ({ ...p, y: p.w })) }], { unit: ' kg', tipFn: hits => tipFor(hits[0]) });
  barChart(cVol, pts.map(p => ({ label: fmtDs(p.date), segs: [{ v: p.vol || p.reps, color: 'var(--m-strength)' }], tip: tipFor(p) + (p.vol ? '' : '<br><span class="raw">ohne Gewicht – zeigt Wiederholungen</span>') })));

  const wk = weeklyStats(all, today());
  barChart(cWeeks, wk.map(r => ({ label: fmtDs(r.weekStart), segs: [{ v: r.home, color: 'var(--m-strength)' }, { v: r.physio, color: 'var(--physio)' }], tip: `<div class="t">Woche ab ${fmtD(r.weekStart)}</div>Eigentraining <b>${r.home}</b><br>Physio <b>${r.physio}</b>` })), { ticks: 3 });
  barChart(cWeekVol, wk.map(r => ({ label: fmtDs(r.weekStart), segs: [{ v: r.vol, color: 'var(--m-strength)' }], tip: `<div class="t">Woche ab ${fmtD(r.weekStart)}</div><b>${fmtNum(r.vol)} kg</b> bewegt` })));
  rankBars(cFreq, exerciseNames(all).slice(0, 18).map(f => ({
    label: f.name, value: f.count, cls: f.type === 'free' ? 'free' : '',
    tip: `<b>${esc(f.name)}</b><br>${f.count} Sitzungen · zuletzt ${fmtD(f.last)}${f.type === 'free' ? `<br>freie Übung (${esc(f.category || '')})` : ''}`,
  })), { color: 'var(--m-strength)' });
}

/* ============ Editor ============ */
function groupRow(g = {}) {
  const row = h('div', { class: 'g-row' },
    h('input', { type: 'number', min: 1, step: 1, class: 'g-sets', value: g.sets ?? 1, 'aria-label': 'Sätze' }),
    h('span', { class: 'x' }, '×'),
    h('input', { type: 'number', min: 0, step: 1, class: 'g-reps', value: g.reps ?? '', 'aria-label': 'Wiederholungen', placeholder: 'WH' }),
    h('span', { class: 'x' }, '@'),
    h('input', { type: 'number', min: 0, step: 0.5, class: 'g-weight', value: g.weight ?? '', placeholder: 'kg / Band', 'aria-label': 'Gewicht in kg' }),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'g-warm', checked: !!g.warmup }), 'Aufwärmsatz'),
    h('button', { type: 'button', class: 'icon-btn', title: 'Satzgruppe entfernen', onclick: () => row.remove() }, icon('close', 16)));
  return row;
}

function exerciseEditor(e, ctx) {
  const box = h('div', { class: `ex-edit${e.type === 'free' ? ' free' : ''}` });
  box.dataset.type = e.type;
  const name = h('input', { class: 'name', list: 'dl-exercises', placeholder: 'Übungsname (z. B. Seitheben)', value: e.name || '', autocomplete: 'off' });
  const typeSel = selectInput([['strength', 'Sätze/WH/kg'], ['free', 'Freie Übung']], e.type === 'free' ? 'free' : 'strength', { title: 'Art der Übung' });
  const body = h('div');
  const hint = h('div', { class: 'last-hint' });
  box.append(h('div', { class: 'ex-top' }, name, typeSel,
    h('button', { type: 'button', class: 'icon-btn', title: 'Nach oben', onclick: () => box.previousElementSibling && box.parentNode.insertBefore(box, box.previousElementSibling) }, icon('up', 16)),
    h('button', { type: 'button', class: 'icon-btn', title: 'Übung entfernen', onclick: () => box.remove() }, icon('close', 16))), body, hint);

  function build(type, data) {
    box.dataset.type = type;
    box.classList.toggle('free', type === 'free');
    body.replaceChildren();
    if (type === 'strength') {
      const groups = h('div', { class: 'groups' }, h('div', { class: 'g-head' }, h('span', {}, 'Sätze'), h('span'), h('span', {}, 'WH'), h('span'), h('span', {}, 'Gewicht (kg)'), h('span'), h('span')));
      (data.groups?.length ? data.groups : [{ sets: 3, reps: 10 }]).forEach(g => groups.append(groupRow(g)));
      body.append(groups, h('div', { class: 'ex-extra' },
        h('button', { type: 'button', class: 'btn small', onclick: () => {
          const rows = $$('.g-row', groups), last = rows[rows.length - 1];
          groups.append(groupRow(last ? { sets: 1, reps: $('.g-reps', last).value, weight: $('.g-weight', last).value } : {}));
        } }, '+ Satzgruppe'),
        h('input', { class: 'ex-note', placeholder: 'Notiz (z. B. pro Seite, mit Band, ohne Push)', value: data.note || '' })));
    } else {
      body.append(h('div', { class: 'free-fields' },
        selectInput(CATEGORIES, data.category || 'Sonstiges', { class: 'f-cat' }),
        h('input', { class: 'desc', placeholder: 'Beschreibung (z. B. 3 Runden, Tennisball an die Wand, 30 Würfe)', value: data.description || '' }),
        h('input', { class: 'dur', type: 'number', min: 0, step: 1, placeholder: 'Dauer (min)', value: data.duration ?? '' })));
    }
  }
  build(e.type === 'free' ? 'free' : 'strength', e);
  typeSel.addEventListener('change', () => build(typeSel.value, typeSel.value === 'free' ? { category: 'Sonstiges' } : {}));

  function updateHint() {
    hint.replaceChildren();
    const n = name.value.trim();
    if (!n) return;
    const found = lastExercise(sessions(), n, ctx.date(), ctx.editingId);
    if (!found) { hint.textContent = 'Neue Übung'; return; }
    const { session, ex } = found;
    hint.append(`Letztes Mal (${fmtDs(session.date)}): ${fmtGroups(ex) || ex.category || ''} `,
      h('button', { type: 'button', onclick: () => { typeSel.value = ex.type; const c = clone(ex); delete c.raw; build(ex.type, c); } }, 'übernehmen'));
  }
  name.addEventListener('change', () => {
    const found = lastExercise(sessions(), name.value.trim(), ctx.date(), ctx.editingId);
    const isEmpty = box.dataset.type === 'strength' ? !$$('.g-weight', body).some(i => i.value) : !$('.desc', body)?.value;
    if (found && isEmpty && found.ex.type !== box.dataset.type) { typeSel.value = found.ex.type; build(found.ex.type, { category: found.ex.category }); }
    updateHint();
  });
  updateHint();
  return box;
}

function collect(wrap) {
  const exercises = [];
  for (const box of $$('.ex-edit', wrap)) {
    const name = $('input.name', box).value.trim();
    if (!name) continue;
    if (box.dataset.type === 'strength') {
      const groups = $$('.g-row', box).map(r => ({
        sets: parseInt($('.g-sets', r).value, 10) || 1,
        reps: parseFloat($('.g-reps', r).value) || 0,
        weight: $('.g-weight', r).value === '' ? null : parseFloat($('.g-weight', r).value),
        warmup: $('.g-warm', r).checked,
      })).filter(g => g.reps > 0);
      const ex = { name, type: 'strength', groups };
      const note = $('.ex-note', box)?.value.trim();
      if (note) ex.note = note;
      exercises.push(ex);
    } else {
      const ex = { name, type: 'free', category: $('.f-cat', box).value, description: $('.desc', box).value.trim() };
      const dur = $('.dur', box).value;
      if (dur) ex.duration = parseFloat(dur);
      exercises.push(ex);
    }
  }
  return exercises;
}

/**
 * @param session   existing session to edit, or null for a new one
 * @param template  session whose exercises are copied into a new one
 * @param preset    { date, kind } for new sessions
 */
export function openEditor(session = null, template = null, preset = {}) {
  const src = session || template;
  datalist('dl-exercises', exerciseNames(sessions()).map(n => n.name));
  const date = h('input', { type: 'date', id: 'strength-date', value: session ? session.date : (preset.date ?? today()), required: true });
  const kind = seg([['home', 'Eigentraining'], ['physio', 'Physio']], session ? session.kind : (preset.kind ?? 'home'), null, { cls: 'kind-seg' });
  const others = sortedSessions(sessions()).filter(s => s.id !== session?.id).slice(0, 40);
  const tpl = selectInput([['', '– aus früherer Sitzung übernehmen –'], ...others.map(s =>
    [s.id, `${wd(s.date)} ${fmtDs(s.date)}${s.kind === 'physio' ? ' (Physio)' : ''} – ${s.exercises.map(e => e.name).slice(0, 4).join(', ')}${s.exercises.length > 4 ? ' …' : ''}`])], '', { id: 'strength-template' });
  const exWrap = h('div', { id: 'strength-exercises' });
  const ctx = { date: () => date.value, editingId: session?.id ?? null };
  const fill = exs => { exWrap.replaceChildren(); exs.forEach(e => { delete e.raw; exWrap.append(exerciseEditor(e, ctx)); }); };
  const exs = src ? clone(src.exercises) : [];
  if (exs.length) fill(exs); else exWrap.append(exerciseEditor({ type: 'strength', name: '', groups: [{ sets: 3, reps: 10, weight: null, warmup: false }] }, ctx));

  tpl.addEventListener('change', async () => {
    const s = sessions().find(x => x.id === tpl.value);
    tpl.value = '';
    if (!s) return;
    const hasContent = $$('.ex-edit input.name', exWrap).some(i => i.value.trim());
    if (hasContent && !await confirmDialog({ title: 'Übungen ersetzen?', text: 'Die aktuellen Übungen werden durch die Vorlage ersetzt.', ok: 'Ersetzen', danger: false })) return;
    fill(clone(s.exercises));
  });

  const notes = h('textarea', { id: 'strength-notes', rows: 2, placeholder: 'Wie hat sich die Schulter angefühlt? Schmerzen, Besonderheiten …' });
  notes.value = session ? session.notes || '' : '';
  const duration = h('input', { type: 'number', id: 'strength-duration', min: 0, step: 5, placeholder: 'optional', value: session?.duration_min ?? '' });
  const rpe = rpeScale(session?.rpe ?? null);

  const d = openDialog({
    title: session ? `Sitzung bearbeiten – ${fmtD(session.date)}` : 'Neue Sitzung',
    size: 'lg',
    body: [
      h('div', { class: 'row' }, field('Datum', date), field('Art', kind), field('Vorlage laden', tpl, { cls: 'grow' })),
      exWrap,
      h('div', { class: 'add-row' },
        btn('+ Übung (Sätze/WH/Gewicht)', () => { const b = exerciseEditor({ type: 'strength', name: '' }, ctx); exWrap.append(b); $('input.name', b).focus(); }),
        btn('+ Freie Übung (Aufwärmen, Ball …)', () => { const b = exerciseEditor({ type: 'free', name: '', category: 'Aufwärmen' }, ctx); exWrap.append(b); $('input.name', b).focus(); })),
      h('div', { class: 'row load-row' }, field('Dauer (min)', duration, { hint: 'für die Belastung (sRPE)' }), field('Anstrengung (RPE)', rpe)),
      field('Notizen', notes),
    ],
    foot: [
      session ? h('button', { type: 'button', class: 'btn ghost danger', onclick: async () => {
        if (!await confirmDialog({ title: 'Sitzung löschen?', text: `Die Sitzung vom ${fmtD(session.date)} wird endgültig gelöscht.` })) return;
        try { await store.remove('strength_sessions', session.id); d.close(); toast('Sitzung gelöscht'); } catch (e) { toast(e.message, true); }
      } }, icon('trash', 16), 'Löschen') : null,
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => d.close() }, 'Abbrechen'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Speichern'),
    ],
    onSubmit: async () => {
      if (!date.value) return toast('Bitte ein Datum wählen', true);
      const exercises = collect(exWrap);
      if (!exercises.length) return toast('Mindestens eine Übung mit Namen eintragen', true);
      // keep the original note (raw) of exercises that were not changed
      if (session) exercises.forEach(e => { const o = session.exercises.find(x => x.name === e.name && x.raw); if (o && fmtGroups(o) === fmtGroups(e)) e.raw = o.raw; });
      const doc = { ...(session ? clone(session) : {}), id: session ? session.id : `s-${Date.now()}`, date: date.value, kind: kind.getValue(), notes: notes.value.trim(), exercises };
      const dur = duration.value === '' ? null : Number(duration.value);
      if (dur) doc.duration_min = dur; else delete doc.duration_min;
      if (rpe.getValue()) doc.rpe = rpe.getValue(); else delete doc.rpe;
      await store.put('strength_sessions', doc);
      d.close();
      toast(session ? 'Sitzung aktualisiert' : 'Sitzung gespeichert');
    },
  });
  if (!session && !template) setTimeout(() => $('.ex-edit input.name', exWrap)?.focus(), 30);
  return d;
}

export const openNew = preset => openEditor(null, null, preset);
export const openById = id => { const s = store.get('strength_sessions', id); if (s) openEditor(s); };
