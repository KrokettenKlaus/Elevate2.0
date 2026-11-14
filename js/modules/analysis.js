// Analyse: grade pyramid, load (sRPE / ACWR), hangboard, projects and the weekly review.
import store from '../store/index.js';
import { addDays, daysBetween, fmtD, fmtDs, isoWeek, today, wd, weekStart } from '../domain/dates.js';
import { STYLES, STYLE_LABEL, maxSend, pyramidProgress, pyramidRows } from '../domain/grades.js';
import { ACWR_HIGH, ACWR_LOW, LOAD_MODULES, acwrDaysMissing, acwrSeries, dailyLoads, loadEntries, monotony, weeklyLoads } from '../domain/load.js';
import { hangSeries } from '../domain/hangboard.js';
import { projectStats } from '../domain/climbing.js';
import { emptyState, esc, fmtNum, fmtPct, h, icon, legend, moduleColor, moduleLabel, navigate } from '../ui/dom.js';
import { copyText, toast } from '../ui/dialog.js';
import { seg, selectInput } from '../ui/forms.js';
import { barChart, lineChart, pyramidChart, timeline, tipKey } from '../ui/charts.js';
import { badge, btn, card, kpi, subTabs } from '../ui/view.js';
import { referenceFor } from './hangboard.js';
import { openProjectEditor } from './climbing.js';
import { buildPrompt, buildWeekSummary, requestReview, reviewAvailable, reviewErrorMessage, reviewId } from '../services/review.js';

export const meta = { id: 'analysis', title: 'Analyse', sub: 'Pyramide, Belastung, Fingerkraft, Projekte und Wochenreview' };

let tab = null;
let pyrPeriod = '12m';
let pyrRepeats = false;
let loadRange = 42;
let reviewWeek = null;
let reviewRun = null; // { ws, text, busy, error, controller }
let reviewPaint = null; // repaints the review card of the view that is currently on screen

export function render(root) {
  const tabs = subTabs('analysis', [['pyramid', 'Pyramide'], ['load', 'Belastung'], ['hangboard', 'Hangboard'], ['projects', 'Projekte'], ['review', 'Wochenreview']], id => { tab = id; render(root); });
  tab = tabs.active;
  root.replaceChildren(tabs.el);
  ({ pyramid: renderPyramid, load: renderLoad, hangboard: renderHangboard, projects: renderProjects, review: renderReview })[tab](root);
}

/* ============ Pyramide ============ */
export const STYLE_LEGEND = [
  { color: 'var(--st-os)', label: 'Onsight' }, { color: 'var(--st-flash)', label: 'Flash' }, { color: 'var(--st-rp)', label: 'Rotpunkt' },
];

function renderPyramid(root) {
  const ticks = store.list('ticks');
  const settings = store.settings();
  const goal = settings.goalGrade ?? '8a';
  const since = pyrPeriod === '12m' ? addDays(today(), -365) : null;
  const rows = pyramidRows(ticks, settings.targetPyramid ?? {}, { since, includeRepeats: pyrRepeats });
  const progress = pyramidProgress(rows);
  const best = maxSend(ticks, since);
  const sends = rows.reduce((a, r) => a + r.sends, 0);
  const missing = rows.reduce((a, r) => a + r.missing, 0);

  root.append(h('div', { class: 'kpis' },
    kpi('Ziel', goal, missing ? `noch ${missing} Begehungen bis zur Soll-Pyramide` : 'Soll-Pyramide erfüllt', 'accent-climb'),
    kpi('Soll-Pyramide', progress == null ? '–' : fmtPct(progress * 100), 'gefüllt'),
    kpi('Schwerste Begehung', best ?? '–', pyrPeriod === '12m' ? 'letzte 12 Monate' : 'gesamt'),
    kpi('Begehungen', fmtNum(sends), 'in den gezeigten Graden'),
    kpi('Onsight / Flash', fmtNum(rows.reduce((a, r) => a + r.OS + r.Flash, 0)), `${fmtNum(rows.reduce((a, r) => a + r.RP, 0))} Rotpunkt`)));

  const chart = h('div', { class: 'chart pyramid-wrap' });
  const repeatBox = h('input', { type: 'checkbox', id: 'pyr-repeats', checked: pyrRepeats, onchange: () => { pyrRepeats = repeatBox.checked; render(root); } });
  root.append(card('Grad-Pyramide', {
    hint: 'Halle und Fels kombiniert · ein Stein pro Begehung',
    actions: [seg([['12m', '12 Monate'], ['all', 'Gesamt']], pyrPeriod, v => { pyrPeriod = v; render(root); }), h('label', { class: 'chk' }, repeatBox, 'Wiederholungen zeigen')],
  }, chart,
    h('div', { class: 'row between' },
      legend([...STYLE_LEGEND, ...(pyrRepeats ? [{ color: 'var(--st-repeat)', label: 'Wiederholung' }] : []), { color: 'transparent', label: 'fehlt bis zum Soll', shape: 'outline' }]),
      btn('Soll-Pyramide ändern', () => navigate('prefs'), 'small ghost'))));
  pyramidChart(chart, rows, { goal });

  if (!ticks.length) root.append(emptyState('Noch keine Ticks', 'Die Pyramide zeigt bisher nur dein Soll. Sobald du Routen tickst, füllen sich die Steine.', btn('Zu den Ticks', () => navigate('climbing'), 'primary')));
  else {
    const table = h('div', { class: 'table-wrap' });
    table.innerHTML = `<table><thead><tr><th>Grad</th>${STYLES.map(s => `<th class="r">${esc(STYLE_LABEL[s])}</th>`).join('')}<th class="r">Begehungen</th><th class="r">Soll</th><th class="r">fehlt</th></tr></thead><tbody>${rows.map(r =>
      `<tr><td><b class="grade">${r.grade}</b>${r.grade === goal ? ' <span class="badge ref">Ziel</span>' : ''}</td>${STYLES.map(s => `<td class="r">${r[s] || ''}</td>`).join('')}<td class="r"><b>${r.sends || ''}</b></td><td class="r">${r.target || ''}</td><td class="r">${r.missing || ''}</td></tr>`).join('')}</tbody></table>`;
    root.append(h('details', { class: 'table-toggle card' }, h('summary', {}, 'Als Tabelle anzeigen'), table));
  }
}

/* ============ Belastung ============ */
export const LOAD_LEGEND = () => LOAD_MODULES.map(m => ({ color: moduleColor(m), label: moduleLabel(m, true) }));

export function loadTip(d, title) {
  const rows = LOAD_MODULES.filter(m => d.by[m] > 0).map(m => `${tipKey(moduleColor(m))}${esc(moduleLabel(m, true))} <b>${fmtNum(d.by[m])}</b>`);
  return `<div class="t">${title}</div>${rows.join('<br>') || 'kein Training mit Dauer und RPE'}${rows.length > 1 ? `<br>Summe <b>${fmtNum(d.total)}</b>` : ''}`;
}

/** Daily stacked load + the ACWR below it on the same time axis. */
export function loadCharts(elBars, elAcwr, entries, from, to, { height = 220 } = {}) {
  const daily = dailyLoads(entries, from, to);
  const span = daysBetween(from, to) + 1;
  barChart(elBars, daily.map(d => ({
    label: wd(d.date) === 'Mo' ? fmtDs(d.date) : '', strong: d.date === today(), labelSlot: true,
    segs: LOAD_MODULES.map(m => ({ v: d.by[m], color: moduleColor(m) })), tip: loadTip(d, `${wd(d.date)}, ${fmtD(d.date)}`),
  })), { height, labelEvery: 1, maxBar: span > 60 ? 8 : 18, yFmt: v => fmtNum(v) });
  if (!elAcwr) return;
  const series = acwrSeries(entries, to).filter(p => p.date >= from);
  const ready = series.filter(p => p.ratio != null);
  if (!ready.length) {
    const missing = acwrDaysMissing(entries, to);
    elAcwr.replaceChildren(h('div', { class: 'chart-empty' }, entries.length
      ? `Die ACWR erscheint, sobald 28 Tage mit Daten vorliegen – es fehlen noch ${missing} Tage.`
      : 'Für die ACWR brauchen Einheiten Dauer und RPE.'));
    return;
  }
  lineChart(elAcwr, [{ name: 'ACWR', color: 'var(--text-2)', pts: ready.map(p => ({ date: p.date, y: p.ratio, p })), markers: false }], {
    height: 150, xFrom: from, xTo: to, bandScale: true, yMin: 0, yMax: Math.max(2, ...ready.map(p => p.ratio)), ticks: 4,
    bands: [{ from: ACWR_LOW, to: ACWR_HIGH, cls: 'band-ok' }],
    refLines: [{ y: ACWR_HIGH, label: 'Spitze > 1,5', cls: 'warn' }, { y: ACWR_LOW, label: 'unter 0,8', cls: 'low', below: true }],
    yFmt: v => fmtNum(v, 1),
    tipFn: hits => {
      const p = hits[0].p;
      const state = p.flag === 'high' ? 'Belastungsspitze' : p.flag === 'low' ? 'Unterbelastung' : 'im Zielbereich';
      return `<div class="t">${wd(p.date)}, ${fmtD(p.date)}</div>ACWR <b>${fmtNum(p.ratio, 2)}</b> · ${state}<br>akut (7 T.) <b>${fmtNum(p.acute)}</b> · chronisch (28 T.) <b>${fmtNum(p.chronic)}</b>`;
    },
  });
}

export function acwrBadge(point) {
  if (!point || point.ratio == null) return badge('noch keine ACWR', 'cat');
  const map = { high: ['Spitze', 'flag-high', 'warn'], low: ['Unterbelastung', 'flag-low', 'info'], ok: ['im Zielbereich', 'flag-ok', 'check'] };
  const [label, cls, ico] = map[point.flag];
  return h('span', { class: `badge ${cls}` }, icon(ico, 13), label);
}

function renderLoad(root) {
  const data = store.all();
  const entries = loadEntries(data);
  const t = today();
  const to = addDays(weekStart(t), 6), from = addDays(to, -(loadRange - 1));
  const skipped = [...data.climb_sessions, ...data.hangboard_sessions, ...data.strength_sessions, ...data.endurance_activities].filter(s => !(s.duration_min > 0 && s.rpe > 0)).length;
  const acwr = acwrSeries(entries, t);
  const now = acwr.at(-1);
  const weeksAll = weeklyLoads(entries, addDays(weekStart(t), -7 * 11), to);
  const cur = weeksAll.at(-1), prev = weeksAll.at(-2);
  const mono = cur ? monotony(cur.days) : {};

  root.append(h('div', { class: 'kpis' },
    kpi('sRPE diese Woche', fmtNum(cur?.total ?? 0), prev?.total ? `Vorwoche ${fmtNum(prev.total)} (${cur.total >= prev.total ? '+' : '−'}${fmtNum(Math.abs(cur.total - prev.total) / prev.total * 100)} %)` : 'Vorwoche ohne Daten', 'accent'),
    kpi('ACWR heute', now?.ratio != null ? fmtNum(now.ratio, 2) : '–', now?.ratio != null ? (now.flag === 'high' ? 'Spitze – über 1,5' : now.flag === 'low' ? 'unter 0,8' : 'im Zielbereich 0,8–1,5') : `ab 28 Tagen Daten (noch ${acwrDaysMissing(entries, t)})`, now?.flag === 'high' ? 'kpi-warn' : ''),
    kpi('Akut (7 Tage)', now ? fmtNum(now.acute) : '–', 'EWMA, λ = 2/8'),
    kpi('Chronisch (28 Tage)', now ? fmtNum(now.chronic) : '–', 'EWMA, λ = 2/29'),
    kpi('Monotonie', mono.monotony != null ? fmtNum(mono.monotony, 2) : '–', 'Ø ÷ Streuung der Tageslast, diese Woche')));

  if (!entries.length) {
    root.append(emptyState('Noch keine Belastungsdaten', 'Die Belastung wird als sRPE gerechnet: RPE × Minuten. Trage bei deinen Einheiten Dauer und RPE ein – ältere Einträge ohne diese Werte werden übersprungen.'));
    if (skipped) root.append(h('p', { class: 'hint foot-note' }, `${skipped} vorhandene Einheiten haben keine Dauer oder keine RPE.`));
    return;
  }
  const bars = h('div', { class: 'chart' }), line = h('div', { class: 'chart' });
  root.append(card('Tägliche Belastung (sRPE)', {
    hint: 'gestapelt nach Modul',
    actions: [seg([[42, '6 Wochen'], [84, '12 Wochen'], [182, '6 Monate']], loadRange, v => { loadRange = Number(v); render(root); }), legend(LOAD_LEGEND())],
  }, bars, h('h3', { class: 'chart-sub' }, 'ACWR – akut : chronisch'), line,
    h('p', { class: 'hint' }, 'Grauer Bereich: Zielkorridor 0,8 bis 1,5. Beide Diagramme teilen sich die Zeitachse.')));
  loadCharts(bars, line, entries, from, to);

  const wkChart = h('div', { class: 'chart' });
  const table = h('div', { class: 'table-wrap' });
  root.append(card('Belastung pro Woche', { hint: 'letzte 12 Wochen' }, wkChart, h('details', { class: 'table-toggle' }, h('summary', {}, 'Wochen als Tabelle'), table)));
  barChart(wkChart, weeksAll.map(w => ({
    label: `KW ${isoWeek(w.weekStart).week}`, strong: w.weekStart === weekStart(t),
    segs: LOAD_MODULES.map(m => ({ v: w.by[m], color: moduleColor(m) })), tip: loadTip(w, `KW ${isoWeek(w.weekStart).week} · ab ${fmtD(w.weekStart)}`),
  })), { yFmt: v => fmtNum(v) });
  table.innerHTML = `<table><thead><tr><th>Woche</th>${LOAD_MODULES.map(m => `<th class="r">${esc(moduleLabel(m, true))}</th>`).join('')}<th class="r">Summe</th><th class="r">Einheiten</th><th class="r">Monotonie</th><th class="r">Strain</th></tr></thead><tbody>${[...weeksAll].reverse().map(w => {
    const m = monotony(w.days);
    return `<tr><td>KW ${isoWeek(w.weekStart).week} · ${fmtDs(w.weekStart)}</td>${LOAD_MODULES.map(k => `<td class="r">${w.by[k] ? fmtNum(w.by[k]) : ''}</td>`).join('')}<td class="r"><b>${fmtNum(w.total)}</b></td><td class="r">${w.sessions}</td><td class="r">${m.monotony != null ? fmtNum(m.monotony, 2) : ''}</td><td class="r">${m.strain != null ? fmtNum(m.strain) : ''}</td></tr>`;
  }).join('')}</tbody></table>`;
  if (skipped) root.append(h('p', { class: 'hint foot-note' }, `${skipped} Einheiten ohne Dauer oder RPE gehen nicht in die Rechnung ein – darunter alle alten Kraft-Sitzungen aus RehabBoard.`));
}

/* ============ Hangboard ============ */
function renderHangboard(root) {
  const series = [...hangSeries(store.list('hangboard_sessions'), store.list('bodyweight')).values()].sort((a, b) => b.pts.length - a.pts.length);
  if (!series.length) return root.append(emptyState('Noch keine Hangboard-Daten', 'Sobald Einheiten erfasst oder importiert sind, erscheint hier der Verlauf je Ausführungsart, Griff und Leiste.', btn('Zum Hangboard', () => navigate('hangboard'), 'primary')));
  root.append(h('p', { class: 'hint' }, 'Verlauf in % vom Körpergewicht, getrennt nach Ausführungsart, Griff und Leiste. Pro Einheit zählt der schwerste Block. Die Referenzlinie erscheint nur dort, wo Aufbau und Leiste zum Test von vor der Verletzung passen.'));
  const grid = h('div', { class: 'grid-2' });
  root.append(grid);
  for (const s of series) {
    const chart = h('div', { class: 'chart' });
    const ref = referenceFor(s);
    const last = s.pts.at(-1), first = s.pts[0];
    grid.append(card(s.label, { hint: `${s.pts.length} Einheiten${last.pct != null ? ` · zuletzt ${fmtPct(last.pct)}` : ''}${first !== last && last.pct != null && first.pct != null ? ` · ${last.pct - first.pct >= 0 ? '+' : '−'}${fmtNum(Math.abs(last.pct - first.pct), 1)} Punkte` : ''}` }, chart));
    lineChart(chart, [{ name: s.label, color: 'var(--m-hangboard)', pts: s.pts.map(p => ({ ...p, y: p.pct })) }], {
      height: 190, zeroBased: false, yFmt: v => `${fmtNum(v)} %`,
      refLines: ref?.exact ? [{ y: ref.y, label: ref.label, cls: 'ref' }] : [],
      tipFn: hits => `<div class="t">${wd(hits[0].date)}, ${fmtD(hits[0].date)}</div><b>${fmtPct(hits[0].pct, 1)}</b> · ${fmtNum(hits[0].load, 1)} kg bei ${fmtNum(hits[0].bw, 1)} kg`,
      empty: 'Kein Körpergewicht hinterlegt',
    });
  }
}

/* ============ Projekte ============ */
function renderProjects(root) {
  const projects = store.list('projects'), sessions = store.list('climb_sessions');
  if (!projects.length) return root.append(emptyState('Noch keine Projekte', 'Lege unter Klettern ein Projekt an und trage Versuche in deinen Sessions ein.', btn('Zu den Projekten', () => { navigate('climbing'); }, 'primary')));
  const t = today();
  const sorted = [...projects].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
  const starts = sorted.map(p => p.startDate).filter(Boolean);
  const from = starts.length ? starts.sort()[0] : addDays(t, -90);
  const STATUS_COLOR = { aktiv: 'var(--m-climbing)', pausiert: 'var(--m-other)', geschafft: 'var(--good)', aufgegeben: 'var(--m-rest)' };
  const tl = h('div', { class: 'chart' });
  root.append(card('Zeitleiste', { hint: 'vom Start bis zum Durchstieg bzw. heute' }, tl));
  timeline(tl, sorted.filter(p => p.startDate).map(p => ({
    label: `${p.grade ?? '?'} ${p.name}`, sub: p.status, from: p.startDate, to: p.sendDate ?? (p.status === 'aktiv' ? t : projectStats(p, sessions).lastDate ?? p.startDate),
    color: STATUS_COLOR[p.status], open: p.status === 'aktiv', onClick: () => openProjectEditor(p),
    tip: `<b>${esc(p.name)}</b> · ${esc(p.grade ?? '')}<br>${esc(p.status)}${p.sendDate ? ` am ${fmtD(p.sendDate)}` : ''}`,
  })), { from: weekStart(from), to: addDays(t, 14) });

  const grid = h('div', { class: 'grid-2' });
  root.append(grid);
  for (const p of sorted.filter(x => x.status !== 'aufgegeben').reverse()) {
    const st = projectStats(p, sessions);
    const attempts = h('div', { class: 'chart' }), high = h('div', { class: 'chart' });
    grid.append(card(`${p.grade ?? '?'} · ${p.name}`, { hint: `${st.attempts} Versuche in ${st.sessions} Sessions`, actions: badge(p.status, `status-${p.status}`) },
      st.timeline.length ? [h('h3', {}, 'Versuche pro Session'), attempts, h('h3', { class: 'chart-sub' }, 'Höchster Punkt (% der Route)'), high]
        : h('div', { class: 'chart-empty' }, 'Noch keine Versuche eingetragen. Füge sie in einer Klettersession unter „Projektversuche“ hinzu.')));
    if (!st.timeline.length) continue;
    barChart(attempts, st.timeline.map(x => ({ label: fmtDs(x.date), segs: [{ v: x.attempts, color: 'var(--m-climbing)' }], tip: `<div class="t">${fmtD(x.date)}</div><b>${x.attempts}</b> Versuche${x.highpoint ? `<br>${esc(x.highpoint)}` : ''}${x.note ? `<br><span class="raw">${esc(x.note)}</span>` : ''}` })), { height: 150, ticks: 3 });
    const pts = st.timeline.filter(x => x.highpointPct != null).map(x => ({ date: x.date, y: x.highpointPct, x }));
    if (p.sendDate) pts.push({ date: p.sendDate, y: 100, x: { highpoint: 'Durchstieg' } });
    lineChart(high, [{ name: 'Höchster Punkt', color: 'var(--m-climbing)', pts }], { height: 150, yMin: 0, yMax: 100, ticks: 4, yFmt: v => `${fmtNum(v)} %`, empty: 'Trage beim Versuch eine Prozentzahl ein, um den Fortschritt zu sehen.',
      tipFn: hits => `<div class="t">${fmtD(hits[0].date)}</div><b>${fmtNum(hits[0].y)} %</b>${hits[0].x.highpoint ? ` · ${esc(hits[0].x.highpoint)}` : ''}` });
  }
}

/* ============ Wochenreview ============ */
/** Minimal, safe renderer for the review text: ## headings, "- " bullets, **bold**. */
export function renderReviewText(text) {
  const out = h('div', { class: 'review-text' });
  let list = null;
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    if (/^#{1,4}\s+/.test(line)) { list = null; out.append(h('h3', { html: inline(line.replace(/^#{1,4}\s+/, '')) })); continue; }
    if (/^[-*•]\s+/.test(line)) { if (!list) { list = h('ul'); out.append(list); } list.append(h('li', { html: inline(line.replace(/^[-*•]\s+/, '')) })); continue; }
    list = null;
    out.append(h('p', { html: inline(line) }));
  }
  return out;
}

function renderReview(root) {
  const t = today();
  const thisWeek = weekStart(t);
  if (!reviewWeek) reviewWeek = weekStart(t) === t ? addDays(thisWeek, -7) : thisWeek; // on a Monday, look back at last week
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(thisWeek, -7 * i));
  const picker = selectInput(weeks.map(w => [w, `KW ${isoWeek(w).week} · ${fmtDs(w)} – ${fmtD(addDays(w, 6))}${w === thisWeek ? ' (laufend)' : ''}`]), reviewWeek, { id: 'review-week', onchange: () => { reviewWeek = picker.value; render(root); } });
  const summary = buildWeekSummary(reviewWeek);
  const saved = store.get('reviews', reviewId(reviewWeek));
  const run = reviewRun?.ws === reviewWeek ? reviewRun : null;

  const out = h('div', { class: 'review-out' });
  const status = h('div', { class: 'hint' });
  const startBtn = btn(saved ? 'Neu erstellen' : 'Wochenreview erstellen', () => start(!!saved), 'primary', 'spark');
  const stopBtn = btn('Stopp', () => reviewRun?.controller?.abort(), 'ghost');
  stopBtn.hidden = !run?.busy;
  startBtn.disabled = !!run?.busy;

  const paint = () => {
    const cur = reviewRun?.ws === reviewWeek ? reviewRun : null;
    const text = cur?.text ?? saved?.text ?? '';
    out.replaceChildren(cur?.busy && !text ? h('div', { class: 'sync-progress' }, h('span', { class: 'spinner' }), h('span', {}, 'Claude denkt nach …')) : text ? renderReviewText(text) : h('div', { class: 'chart-empty' }, 'Für diese Woche gibt es noch keinen Review.'));
    status.textContent = cur?.error ?? (cur?.busy ? '' : saved ? `Erstellt am ${fmtD(saved.createdAt.slice(0, 10))}${saved.truncated ? ' · gekürzt' : ''}` : '');
    stopBtn.hidden = !cur?.busy;
    startBtn.disabled = !!cur?.busy;
  };
  reviewPaint = paint;

  async function start(refresh) {
    const ws = reviewWeek;
    reviewRun = { ws, text: '', busy: true, error: null, controller: new AbortController() };
    reviewPaint?.();
    try {
      const res = await requestReview(summary, { signal: reviewRun.controller.signal, refresh, onText: ({ text }) => { if (reviewRun?.ws === ws) { reviewRun.text = text; reviewPaint?.(); } } });
      reviewRun = null;
      await store.put('reviews', { id: reviewId(ws), weekStart: ws, text: res.text, truncated: !!res.truncated, summary, modelTier: res.modelTierApplied ?? null });
      toast('Wochenreview gespeichert');
    } catch (e) {
      const msg = e?.code ? reviewErrorMessage(e) : (e?.message ?? 'Unbekannter Fehler');
      if (reviewRun?.ws === ws) reviewRun = { ws, text: e?.code === 'refused' ? '' : (e?.text ?? reviewRun.text), busy: false, error: msg, controller: null };
      reviewPaint?.();
    }
  }

  const json = JSON.stringify(summary, null, 2);
  root.append(
    h('div', { class: 'toolbar' }, picker, h('span', { class: 'grow' }), stopBtn, startBtn),
    card('Rückblick und Empfehlung', { hint: `KW ${isoWeek(reviewWeek).week}` }, out, status),
    card('Was an Claude geht', { hint: 'kompakte Zusammenfassung der Woche', actions: [btn('Anfrage kopieren', () => copyText(buildPrompt(summary), 'Anfrage kopiert'), 'small', 'copy')] },
      h('div', { class: 'summary-facts' },
        fact('Geplant / erledigt', summary.plan ? `${summary.plan.zusammenfassung.erledigt} / ${summary.plan.zusammenfassung.geplant}` : '–'),
        fact('Einheiten', String(summary.einheiten.length)),
        fact('sRPE', summary.belastung.woche_srpe != null ? fmtNum(summary.belastung.woche_srpe) : '–'),
        fact('ACWR', summary.belastung.acwr != null ? fmtNum(summary.belastung.acwr, 2) : '–'),
        fact('Ticks', String(summary.klettern.ticks.length)),
        fact('Hangboard', String(summary.hangboard.length))),
      h('details', { class: 'table-toggle' }, h('summary', {}, 'JSON anzeigen'), h('pre', { class: 'raw-block' }, json))));
  paint();

  reviewAvailable().then(ok => {
    if (ok || !startBtn.isConnected) return;
    startBtn.disabled = true;
    status.textContent = 'Der Wochenreview läuft über Claude und ist nur im veröffentlichten Artifact verfügbar. Lokal kannst du die Anfrage kopieren und in Claude einfügen.';
  });

  const old = [...store.list('reviews')].filter(r => r.id !== reviewId(reviewWeek)).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  if (old.length) {
    root.append(card('Frühere Reviews', {}, old.slice(0, 12).map(r => h('details', { class: 'review-old' },
      h('summary', {}, `KW ${isoWeek(r.weekStart).week} · ${fmtDs(r.weekStart)} – ${fmtD(addDays(r.weekStart, 6))}`), renderReviewText(r.text)))));
  }
}

const fact = (k, v) => h('div', {}, h('b', {}, v), h('span', {}, k));
