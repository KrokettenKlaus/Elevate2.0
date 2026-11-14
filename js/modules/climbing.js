// Klettern: sessions with ticks and project attempts, the tick list and projects.
import store, { clone, newId } from '../store/index.js';
import { MONTHS, fmtD, fmtDs, today, wd } from '../domain/dates.js';
import { GRADES, STYLES, compareGrades, gradeIndex, normalizeGrade } from '../domain/grades.js';
import { PLACES, PROJECT_STATUS, SESSION_TYPES, projectStats, projectsCompletedBy, tickSummary } from '../domain/climbing.js';
import { $, $$, emptyState, esc, fmtDur, fmtNum, h, icon } from '../ui/dom.js';
import { confirmDialog, openDialog, toast } from '../ui/dialog.js';
import { datalist, field, formDialog, rpeScale, seg, selectInput } from '../ui/forms.js';
import { badge, btn, card, loadBadge, pressable, subTabs } from '../ui/view.js';

export const meta = { id: 'climbing', title: 'Klettern', sub: 'Sessions, Ticks und Projekte – Halle und Fels gemeinsam' };

const sessions = () => store.list('climb_sessions');
const ticks = () => store.list('ticks');
const projects = () => store.list('projects');
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
const venues = () => [...new Set([...sessions().map(s => s.venue), ...ticks().map(t => t.area), ...projects().map(p => p.area)].filter(Boolean))];

let tab = null;
let tickFilter = { style: 'all', place: 'all', q: '', sort: 'date' };
let projectFilter = 'offen';

export function render(root) {
  const tabs = subTabs('climbing', [['sessions', 'Sessions', sessions().length], ['ticks', 'Ticks', ticks().length], ['projects', 'Projekte', projects().filter(p => p.status === 'aktiv').length]], id => { tab = id; render(root); });
  tab = tabs.active;
  root.replaceChildren(tabs.el);
  if (tab === 'sessions') renderSessions(root);
  if (tab === 'ticks') renderTicks(root);
  if (tab === 'projects') renderProjects(root);
}

/* ============ Sessions ============ */
function renderSessions(root) {
  const ss = [...sessions()].sort(byDateDesc);
  root.append(h('div', { class: 'toolbar' }, h('span', { class: 'hint' }, `${ss.length} Sessions`), h('span', { class: 'grow' }), btn('+ Session', () => openSessionEditor(), 'primary')));
  if (!ss.length) return root.append(emptyState('Noch keine Klettersession', 'Eine Session fasst einen Klettertag zusammen: Dauer und RPE für die Belastung, dazu deine Ticks und Projektversuche.', btn('+ Erste Session', () => openSessionEditor(), 'primary')));
  const allTicks = ticks(), allProjects = projects();
  const listEl = h('div', {});
  root.append(listEl);
  let month = '', grid;
  for (const s of ss) {
    const m = `${MONTHS[Number(s.date.slice(5, 7)) - 1]} ${s.date.slice(0, 4)}`;
    if (m !== month) { month = m; listEl.append(h('div', { class: 'month-head' }, m)); grid = h('div', { class: 'sessions-grid' }); listEl.append(grid); }
    grid.append(sessionCard(s, allTicks, allProjects));
  }
}

export function sessionCard(s, allTicks = ticks(), allProjects = projects()) {
  const mine = allTicks.filter(t => t.sessionId === s.id).sort((a, b) => compareGrades(b.grade, a.grade));
  const sum = tickSummary(mine);
  return pressable('s-card climb', () => openSessionEditor(s),
    h('div', { class: 's-head' },
      h('span', { class: 's-date' }, fmtD(s.date), h('small', {}, wd(s.date))),
      h('span', { class: 'badges' }, badge(s.place ?? 'Halle', s.place === 'Fels' ? 'rock' : 'gym'), badge(s.type ?? 'Sonstiges', 'climb'))),
    s.venue ? h('div', { class: 's-venue' }, s.venue) : null,
    mine.length ? h('ul', { class: 'ex-list' }, mine.slice(0, 6).map(t => h('li', {},
      h('span', { class: 'n' }, h('b', { class: 'grade' }, t.grade ?? '?'), ' ', t.route || 'ohne Namen'),
      h('span', { class: 'd' }, h('span', { class: `style st-${t.style}` }, t.style), t.attempts > 1 ? ` · ${t.attempts} Vers.` : ''))),
      mine.length > 6 ? h('li', { class: 'more' }, `+ ${mine.length - 6} weitere`) : null) : null,
    (s.projectAttempts ?? []).length ? h('ul', { class: 'ex-list attempts' }, s.projectAttempts.map(a => {
      const p = allProjects.find(x => x.id === a.projectId);
      return h('li', {}, h('span', { class: 'n' }, icon('flag', 14), ' ', p ? `${p.name} (${p.grade ?? '?'})` : 'Projekt'),
        h('span', { class: 'd' }, `${a.attempts ?? 0} Vers.${a.highpointPct != null ? ` · ${a.highpointPct} %` : ''}`));
    })) : null,
    s.notes ? h('div', { class: 's-notes' }, s.notes) : null,
    h('div', { class: 's-foot' },
      sum.count ? h('span', {}, `${sum.count} Ticks${sum.hardest ? ` · bis ${sum.hardest}` : ''}`) : h('span', {}, 'keine Ticks'),
      s.duration_min ? h('span', {}, fmtDur(s.duration_min)) : null,
      s.rpe ? h('span', {}, `RPE ${s.rpe}`) : null,
      loadBadge(s.duration_min, s.rpe)));
}

/* ---------- Session editor ---------- */
function tickRow(t, ctx) {
  const row = h('div', { class: 'tick-edit' });
  row.dataset.id = t.id ?? '';
  const projSel = selectInput([['', '– kein Projekt –'], ...ctx.projectOptions()], t.projectId ?? '', { class: 't-project', title: 'Projekt' });
  row.append(
    h('input', { class: 't-grade grade-input', list: 'dl-grades', placeholder: 'Grad', value: t.grade ?? '', autocomplete: 'off', 'aria-label': 'Grad' }),
    h('input', { class: 't-route', list: 'dl-routes', placeholder: 'Routenname', value: t.route ?? '', autocomplete: 'off', 'aria-label': 'Routenname' }),
    selectInput(STYLES, t.style ?? 'RP', { class: 't-style', 'aria-label': 'Stil' }),
    h('input', { class: 't-attempts', type: 'number', min: 1, step: 1, value: t.attempts ?? 1, title: 'Versuche', 'aria-label': 'Versuche' }),
    h('input', { class: 't-area', list: 'dl-venues', placeholder: 'Sektor', value: t.area ?? '', autocomplete: 'off', 'aria-label': 'Gebiet bzw. Sektor' }),
    projSel,
    h('input', { class: 't-note', placeholder: 'Notiz', value: t.note ?? '', 'aria-label': 'Notiz' }),
    h('button', { type: 'button', class: 'icon-btn', title: 'Tick entfernen', onclick: () => row.remove() }, icon('close', 16)));
  // OS and Flash are always first go
  $('.t-style', row).addEventListener('change', ev => { if (['OS', 'Flash'].includes(ev.target.value)) $('.t-attempts', row).value = 1; });
  // choosing a project fills name and grade
  projSel.addEventListener('change', () => {
    const p = projects().find(x => x.id === projSel.value);
    if (!p) return;
    if (!$('.t-route', row).value) $('.t-route', row).value = p.name ?? '';
    if (!$('.t-grade', row).value) $('.t-grade', row).value = p.grade ?? '';
    if (!$('.t-area', row).value) $('.t-area', row).value = p.area ?? '';
  });
  return row;
}

function attemptRow(a, ctx) {
  const row = h('div', { class: 'attempt-edit' });
  row.append(
    selectInput([['', '– Projekt wählen –'], ...ctx.projectOptions(true)], a.projectId ?? '', { class: 'a-project', 'aria-label': 'Projekt' }),
    h('input', { class: 'a-attempts', type: 'number', min: 0, step: 1, value: a.attempts ?? 1, title: 'Versuche', 'aria-label': 'Versuche' }),
    h('input', { class: 'a-high', placeholder: 'Höchster Punkt (z. B. 6. Haken, nach der Crux)', value: a.highpoint ?? '', 'aria-label': 'Höchster Punkt' }),
    h('input', { class: 'a-pct', type: 'number', min: 0, max: 100, step: 5, placeholder: '%', value: a.highpointPct ?? '', title: 'Prozent der Route', 'aria-label': 'Prozent der Route' }),
    h('input', { class: 'a-note', placeholder: 'Notiz', value: a.note ?? '', 'aria-label': 'Notiz' }),
    h('button', { type: 'button', class: 'icon-btn', title: 'Versuch entfernen', onclick: () => row.remove() }, icon('close', 16)));
  return row;
}

export function openSessionEditor(session = null, preset = {}) {
  const last = [...sessions()].sort(byDateDesc)[0];
  datalist('dl-grades', GRADES);
  datalist('dl-venues', venues());
  datalist('dl-routes', [...ticks().map(t => t.route), ...projects().map(p => p.name)]);
  const existing = session ? ticks().filter(t => t.sessionId === session.id).sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))) : [];
  const ctx = {
    projectOptions: (onlyOpen = false) => projects()
      .filter(p => !onlyOpen || p.status !== 'aufgegeben')
      .sort((a, b) => PROJECT_STATUS.indexOf(a.status) - PROJECT_STATUS.indexOf(b.status) || (a.name ?? '').localeCompare(b.name ?? ''))
      .map(p => [p.id, `${p.name} (${p.grade ?? '?'})${p.status !== 'aktiv' ? ` – ${p.status}` : ''}`]),
  };

  const date = h('input', { type: 'date', id: 'climb-date', value: session?.date ?? preset.date ?? today(), required: true });
  const place = seg(PLACES, session?.place ?? preset.place ?? last?.place ?? 'Halle');
  const venue = h('input', { id: 'climb-venue', list: 'dl-venues', placeholder: 'z. B. Kletterzentrum, Arco …', value: session?.venue ?? preset.venue ?? last?.venue ?? '', autocomplete: 'off' });
  const type = selectInput(SESSION_TYPES, session?.type ?? preset.type ?? 'Projektieren', { id: 'climb-type' });
  const duration = h('input', { type: 'number', id: 'climb-duration', min: 0, step: 5, placeholder: 'min', value: session?.duration_min ?? preset.duration_min ?? '' });
  const rpe = rpeScale(session?.rpe ?? null);
  const notes = h('textarea', { id: 'climb-notes', rows: 2, placeholder: 'Form, Haut, Bedingungen, Erkenntnisse …' });
  notes.value = session?.notes ?? '';

  const ticksEl = h('div', { id: 'climb-ticks', class: 'rows' });
  existing.forEach(t => ticksEl.append(tickRow(t, ctx)));
  const attemptsEl = h('div', { id: 'climb-attempts', class: 'rows' });
  (session?.projectAttempts ?? []).forEach(a => attemptsEl.append(attemptRow(a, ctx)));

  const d = openDialog({
    title: session ? `Klettersession – ${fmtD(session.date)}` : 'Neue Klettersession',
    size: 'xl',
    body: [
      h('div', { class: 'row' }, field('Datum', date), field('Ort', place), field('Gebiet bzw. Halle', venue, { cls: 'grow' }), field('Session-Typ', type)),
      h('div', { class: 'row load-row' }, field('Dauer (min)', duration), field('Anstrengung (RPE)', rpe)),
      h('div', { class: 'section-head' }, h('h3', {}, 'Ticks'), h('span', { class: 'hint' }, 'Grad · Route · Stil · Versuche · Sektor · Projekt · Notiz')),
      ticksEl,
      h('div', { class: 'add-row' }, btn('+ Tick', () => { const r = tickRow({ area: '' }, ctx); ticksEl.append(r); $('.t-grade', r).focus(); })),
      h('div', { class: 'section-head' }, h('h3', {}, 'Projektversuche'), h('span', { class: 'hint' }, 'Versuche ohne Durchstieg, mit höchstem Punkt')),
      attemptsEl,
      h('div', { class: 'add-row' },
        btn('+ Projektversuch', () => {
          if (!projects().length) return toast('Lege zuerst unter „Projekte“ ein Projekt an.', true);
          const r = attemptRow({}, ctx); attemptsEl.append(r); $('.a-project', r).focus();
        })),
      field('Notizen', notes),
    ],
    foot: [
      session ? h('button', { type: 'button', class: 'btn ghost danger', onclick: async () => {
        if (!await confirmDialog({ title: 'Session löschen?', text: `Die Session vom ${fmtD(session.date)} und ihre ${existing.length} Ticks werden endgültig gelöscht.` })) return;
        try {
          for (const t of existing) await store.remove('ticks', t.id);
          await store.remove('climb_sessions', session.id);
          d.close(); toast('Session gelöscht');
        } catch (e) { toast(e.message, true); }
      } }, icon('trash', 16), 'Löschen') : null,
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => d.close() }, 'Abbrechen'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Speichern'),
    ],
    onSubmit: async () => {
      if (!date.value) return toast('Bitte ein Datum wählen', true);
      const sessionId = session?.id ?? newId('climb_sessions');
      const tickDocs = [];
      for (const row of $$('.tick-edit', ticksEl)) {
        const gradeRaw = $('.t-grade', row).value.trim(), route = $('.t-route', row).value.trim();
        if (!gradeRaw && !route) continue;
        const grade = normalizeGrade(gradeRaw);
        if (!grade) { $('.t-grade', row).focus(); return toast(`„${gradeRaw || 'leer'}“ ist kein Grad zwischen 5a und 9c.`, true); }
        const prev = existing.find(t => t.id === row.dataset.id);
        tickDocs.push({
          ...(prev ? clone(prev) : {}),
          id: prev?.id ?? newId('ticks'), date: date.value, route, area: $('.t-area', row).value.trim() || venue.value.trim(), grade,
          place: place.getValue(), style: $('.t-style', row).value, attempts: Number($('.t-attempts', row).value) || 1,
          note: $('.t-note', row).value.trim(), sessionId, projectId: $('.t-project', row).value || null, discipline: prev?.discipline ?? 'route',
        });
      }
      const projectAttempts = $$('.attempt-edit', attemptsEl).map(row => ({
        projectId: $('.a-project', row).value, attempts: Number($('.a-attempts', row).value) || 0, highpoint: $('.a-high', row).value.trim(),
        highpointPct: $('.a-pct', row).value === '' ? null : Math.min(100, Math.max(0, Number($('.a-pct', row).value))), note: $('.a-note', row).value.trim(),
      })).filter(a => a.projectId);

      const doc = {
        ...(session ? clone(session) : {}),
        id: sessionId, date: date.value, place: place.getValue(), venue: venue.value.trim(), type: type.value,
        duration_min: duration.value === '' ? null : Number(duration.value), rpe: rpe.getValue(), notes: notes.value.trim(),
        ticks: tickDocs.map(t => t.id), projectAttempts,
      };
      await store.put('climb_sessions', doc);
      for (const t of tickDocs) await store.put('ticks', t);
      for (const t of existing) if (!tickDocs.some(x => x.id === t.id)) await store.remove('ticks', t.id);
      d.close();
      toast(session ? 'Session aktualisiert' : 'Session gespeichert');
      await offerProjectSends(tickDocs);
    },
  });
  if (!session) setTimeout(() => (venue.value ? duration : venue).focus(), 30);
  return d;
}

/** An RP tick on a project: offer to mark the project as sent. */
async function offerProjectSends(tickDocs) {
  for (const { project, tick } of projectsCompletedBy(tickDocs, projects())) {
    const yes = await confirmDialog({
      title: 'Projekt geschafft?', danger: false, ok: 'Als geschafft markieren', cancel: 'Nein',
      text: `Du hast „${project.name}“ (${project.grade ?? '?'}) am ${fmtD(tick.date)} im Stil ${tick.style} getickt. Soll das Projekt auf „geschafft“ gesetzt werden?`,
    });
    if (!yes) continue;
    await store.put('projects', { ...clone(project), status: 'geschafft', sendDate: tick.date });
    if (!tick.projectId) await store.put('ticks', { ...clone(store.get('ticks', tick.id) ?? tick), projectId: project.id });
    toast(`${project.name}: geschafft`);
  }
}

/* ============ Ticks ============ */
const tickFields = () => [
  { key: 'date', label: 'Datum', type: 'date', required: true, width: 'third' },
  { key: 'grade', label: 'Grad', type: 'grade', required: true, width: 'third' },
  { key: 'style', label: 'Stil', type: 'select', options: STYLES, width: 'third' },
  { key: 'route', label: 'Routenname', type: 'text', list: [...ticks().map(t => t.route), ...projects().map(p => p.name)], width: 'half' },
  { key: 'area', label: 'Gebiet bzw. Sektor', type: 'text', list: venues(), width: 'half' },
  { key: 'place', label: 'Ort', type: 'seg', options: PLACES, width: 'third' },
  { key: 'attempts', label: 'Versuche', type: 'number', min: 1, step: 1, width: 'third' },
  { key: 'projectId', label: 'Projekt', type: 'select', options: [['', '– kein Projekt –'], ...projects().map(p => [p.id, `${p.name} (${p.grade ?? '?'})`])], width: 'third' },
  { key: 'note', label: 'Notiz', type: 'textarea', rows: 2, width: 'full' },
];

export function openTickEditor(tick = null, preset = {}) {
  const last = [...ticks()].sort(byDateDesc)[0];
  const value = tick ? clone(tick) : { date: today(), style: 'RP', attempts: 1, place: last?.place ?? 'Halle', area: last?.area ?? '', discipline: 'route', projectId: '', ...preset };
  return formDialog({
    title: tick ? 'Tick bearbeiten' : 'Neuer Tick',
    intro: tick?.sessionId ? 'Dieser Tick gehört zu einer Session und bleibt mit ihr verknüpft.' : 'Einzelner Tick ohne Session. Für Dauer und RPE lege stattdessen eine Session an.',
    fields: tickFields(), value,
    onSave: async v => {
      const doc = { ...v, attempts: v.attempts || 1, projectId: v.projectId || null, discipline: v.discipline ?? 'route', sessionId: v.sessionId ?? null };
      if (!doc.id) doc.id = newId('ticks');
      await store.put('ticks', doc);
      toast(tick ? 'Tick aktualisiert' : 'Tick gespeichert');
      setTimeout(() => offerProjectSends([doc]), 50);
    },
    onDelete: tick ? async () => {
      await store.remove('ticks', tick.id);
      const s = tick.sessionId && store.get('climb_sessions', tick.sessionId);
      if (s) await store.put('climb_sessions', { ...clone(s), ticks: (s.ticks ?? []).filter(id => id !== tick.id) });
    } : null,
    deleteText: 'Der Tick wird endgültig gelöscht.',
  });
}

function renderTicks(root) {
  const all = ticks();
  const tableEl = h('div', { class: 'table-wrap' });
  const countEl = h('span', { class: 'hint' });
  const search = h('input', { type: 'search', id: 'tick-search', placeholder: 'Route oder Gebiet suchen …', value: tickFilter.q, oninput: () => { tickFilter.q = search.value; paint(); } });
  root.append(h('div', { class: 'toolbar' }, search,
    seg([['all', 'Alle Stile'], ...STYLES], tickFilter.style, v => { tickFilter.style = v; paint(); }),
    seg([['all', 'Halle + Fels'], ...PLACES], tickFilter.place, v => { tickFilter.place = v; paint(); }),
    seg([['date', 'nach Datum'], ['grade', 'nach Grad']], tickFilter.sort, v => { tickFilter.sort = v; paint(); }),
    countEl, h('span', { class: 'grow' }), btn('+ Tick', () => openTickEditor(), 'primary')), tableEl);
  if (!all.length) { tableEl.replaceWith(emptyState('Noch keine Ticks', 'Ticks entstehen in einer Session oder einzeln über „+ Tick“. Aus ihnen wächst die Grad-Pyramide.')); return; }

  function paint() {
    const q = tickFilter.q.trim().toLowerCase();
    const list = all.filter(t => (tickFilter.style === 'all' || t.style === tickFilter.style) && (tickFilter.place === 'all' || t.place === tickFilter.place)
      && (!q || (t.route ?? '').toLowerCase().includes(q) || (t.area ?? '').toLowerCase().includes(q)))
      .sort(tickFilter.sort === 'grade' ? (a, b) => gradeIndex(b.grade) - gradeIndex(a.grade) || byDateDesc(a, b) : byDateDesc);
    countEl.textContent = `${list.length} von ${all.length}`;
    if (!list.length) { tableEl.replaceChildren(h('div', { class: 'chart-empty' }, 'Keine Ticks für diesen Filter.')); return; }
    tableEl.innerHTML = `<table class="ticks"><thead><tr><th>Datum</th><th>Grad</th><th>Route</th><th>Gebiet / Sektor</th><th>Ort</th><th>Stil</th><th class="r">Versuche</th><th>Notiz</th></tr></thead><tbody>${list.map(t =>
      `<tr class="click" data-id="${esc(t.id)}"><td>${fmtD(t.date)}</td><td><b class="grade">${esc(t.grade ?? '')}</b></td><td>${esc(t.route || '–')}${t.projectId ? ' <span class="badge cat">Projekt</span>' : ''}</td><td>${esc(t.area ?? '')}</td><td>${esc(t.place ?? '')}</td><td><span class="style st-${esc(t.style)}">${esc(t.style)}</span></td><td class="r">${fmtNum(t.attempts ?? 1)}</td><td class="raw">${esc(t.note ?? '')}</td></tr>`).join('')}</tbody></table>`;
    $$('tr.click', tableEl).forEach(tr => tr.addEventListener('click', () => openTickEditor(store.get('ticks', tr.dataset.id))));
  }
  paint();
}

/* ============ Projekte ============ */
const projectFields = () => [
  { key: 'name', label: 'Routenname', type: 'text', required: true, width: 'half' },
  { key: 'area', label: 'Gebiet', type: 'text', list: venues(), width: 'half' },
  { key: 'grade', label: 'Grad', type: 'grade', required: true, width: 'third' },
  { key: 'status', label: 'Status', type: 'select', options: PROJECT_STATUS, width: 'third' },
  { key: 'place', label: 'Ort', type: 'seg', options: PLACES, width: 'third' },
  { key: 'startDate', label: 'Startdatum', type: 'date', width: 'half' },
  { key: 'sendDate', label: 'Durchstiegsdatum', type: 'date', width: 'half', showIf: v => v.status === 'geschafft' },
  { key: 'notes', label: 'Crux und Beta', type: 'textarea', rows: 5, width: 'full', placeholder: 'Schlüsselstelle, Züge, Rastpunkte, Bedingungen …' },
];

export function openProjectEditor(project = null) {
  return formDialog({
    title: project ? `Projekt – ${project.name}` : 'Neues Projekt',
    fields: projectFields(),
    value: project ? clone(project) : { status: 'aktiv', startDate: today(), place: 'Fels' },
    onSave: async v => {
      if (v.status === 'geschafft' && !v.sendDate) v.sendDate = today();
      if (v.status !== 'geschafft') v.sendDate = null;
      if (!v.id) v.id = newId('projects');
      await store.put('projects', v);
      toast(project ? 'Projekt aktualisiert' : 'Projekt angelegt');
    },
    onDelete: project ? () => store.remove('projects', project.id) : null,
    deleteText: 'Das Projekt wird gelöscht. Versuche in Sessions bleiben erhalten, verlieren aber ihre Zuordnung.',
  });
}

export function projectCard(p, ss = sessions()) {
  const st = projectStats(p, ss);
  return pressable(`s-card project status-${p.status}`, () => openProjectEditor(p),
    h('div', { class: 's-head' },
      h('span', { class: 's-date' }, h('b', { class: 'grade big' }, p.grade ?? '?'), ' ', p.name),
      badge(p.status, `status-${p.status}`)),
    p.area ? h('div', { class: 's-venue' }, p.area) : null,
    st.bestPct != null ? h('div', { class: 'progress', title: `höchster Punkt: ${st.bestPct} % der Route` }, h('i', { style: { width: `${st.bestPct}%` } })) : null,
    st.lastHighpoint ? h('div', { class: 's-notes plain' }, `Höchster Punkt: ${st.lastHighpoint}`) : null,
    p.notes ? h('div', { class: 's-notes' }, p.notes.length > 160 ? `${p.notes.slice(0, 160)} …` : p.notes) : null,
    h('div', { class: 's-foot' },
      h('span', {}, `${fmtNum(st.attempts)} Versuche`), h('span', {}, `${fmtNum(st.sessions)} Sessions`),
      p.startDate ? h('span', {}, `seit ${fmtDs(p.startDate)}${p.startDate.slice(0, 4)}`) : null,
      p.sendDate ? h('span', { class: 'ok' }, `Durchstieg ${fmtD(p.sendDate)}`) : null));
}

function renderProjects(root) {
  const all = projects();
  const groups = { offen: ['aktiv', 'pausiert'], geschafft: ['geschafft'], alle: PROJECT_STATUS };
  root.append(h('div', { class: 'toolbar' },
    seg([['offen', 'Offen'], ['geschafft', 'Geschafft'], ['alle', 'Alle']], projectFilter, v => { projectFilter = v; render(root); }),
    h('span', { class: 'hint' }, `${all.length} Projekte`), h('span', { class: 'grow' }), btn('+ Projekt', () => openProjectEditor(), 'primary')));
  if (!all.length) return root.append(emptyState('Noch kein Projekt', 'Lege Routen an, die du projektierst. Versuche trägst du dann in der Session ein, und ein RP-Tick schließt das Projekt ab.', btn('+ Erstes Projekt', () => openProjectEditor(), 'primary')));
  const list = all.filter(p => groups[projectFilter].includes(p.status))
    .sort((a, b) => PROJECT_STATUS.indexOf(a.status) - PROJECT_STATUS.indexOf(b.status) || compareGrades(b.grade, a.grade));
  if (!list.length) return root.append(h('div', { class: 'chart-empty' }, 'Keine Projekte in dieser Ansicht.'));
  root.append(h('div', { class: 'sessions-grid' }, list.map(p => projectCard(p))));
}

export const openNew = preset => openSessionEditor(null, preset);
export const openById = id => { const s = store.get('climb_sessions', id); if (s) openSessionEditor(s); };
export { card };
