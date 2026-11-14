// Dashboard: the current week, load, progress towards 8a and the last strength session.
import store from '../store/index.js';
import { addDays, fmtD, fmtDs, isoWeek, relDay, today, weekStart } from '../domain/dates.js';
import { acwrSeries, loadEntries, weeklyLoads } from '../domain/load.js';
import { maxSend, pyramidProgress, pyramidRows } from '../domain/grades.js';
import { compareGrades } from '../domain/grades.js';
import { projectStats } from '../domain/climbing.js';
import { sortedSessions } from '../domain/strength.js';
import { collectActuals } from '../domain/plan.js';
import { testSeries, testValue } from '../domain/tests.js';
import { bodyweightAt } from '../domain/hangboard.js';
import { esc, fmtDur, fmtNum, fmtPct, h, icon, legend, moduleColor, moduleLabel, navigate } from '../ui/dom.js';
import { pyramidChart } from '../ui/charts.js';
import { btn, card, kpi, pressable } from '../ui/view.js';
import { setTab } from '../ui/view.js';
import { weekGrid, weekState, weekSummaryEl, openDayEditor, BLOCK_COLOR } from './plan.js';
import { LOAD_LEGEND, STYLE_LEGEND, acwrBadge, loadCharts } from './analysis.js';
import { headline as hangHeadline } from './hangboard.js';
import { openEditor as openStrength, sessionBody } from './strength.js';
import { openProjectEditor } from './climbing.js';
import { openActual } from './open.js';

export const meta = { id: 'dashboard', title: 'Dashboard', sub: null };

const go = (route, tabKey, tabId) => () => { if (tabKey) setTab(tabKey, tabId); navigate(route); };

export function render(root) {
  root.replaceChildren();
  const data = store.all();
  const settings = store.settings();
  const t = today(), ws = weekStart(t);
  const state = weekState(ws);
  const entries = loadEntries(data);
  const hasAnything = ['climb_sessions', 'ticks', 'hangboard_sessions', 'strength_sessions', 'endurance_activities'].some(c => data[c].length);

  if (!hasAnything) root.append(welcome());

  // ---- headline numbers
  const weeks = weeklyLoads(entries, addDays(ws, -7), addDays(ws, 6));
  const [prevW, curW] = weeks;
  const acwrNow = acwrSeries(entries, t).at(-1);
  const goal = settings.goalGrade ?? '8a';
  const rows12 = pyramidRows(data.ticks, settings.targetPyramid ?? {}, { since: addDays(t, -365) });
  const progress = pyramidProgress(rows12);
  const best = maxSend(data.ticks, addDays(t, -365));
  const s = state.summary;
  root.append(h('div', { class: 'kpis' },
    kpi(`Woche ${isoWeek(ws).week}`, state.planned ? `${s.done}/${s.planned}` : '–', state.planned ? `erledigt${s.open ? ` · ${s.open} offen` : ''}${s.missed ? ` · ${s.missed} ausgelassen` : ''}` : 'kein Plan', 'accent'),
    kpi('Belastung (sRPE)', fmtNum(curW?.total ?? 0), prevW?.total ? `Vorwoche ${fmtNum(prevW.total)}` : 'diese Woche'),
    h('div', { class: `kpi${acwrNow?.flag === 'high' ? ' kpi-warn' : ''}` }, h('div', { class: 'label' }, 'ACWR'), h('div', { class: 'value' }, acwrNow?.ratio != null ? fmtNum(acwrNow.ratio, 2) : '–'), h('div', { class: 'sub' }, acwrBadge(acwrNow))),
    kpi(`Richtung ${goal}`, progress == null ? '–' : fmtPct(progress * 100), best ? `Soll-Pyramide gefüllt · bisher bis ${best}` : 'Soll-Pyramide gefüllt'),
    fingerKpi(data)));

  // ---- current week
  const block = state.block;
  root.append(card('Aktuelle Woche', {
    hint: `${fmtDs(ws)} – ${fmtD(addDays(ws, 6))}${block ? ` · ${block.name}` : ''}`,
    actions: [block ? h('span', { class: 'mchip', style: { '--c': BLOCK_COLOR[block.type] } }, h('i'), `Block: ${block.type}`) : null, btn('Planung', go('plan', 'plan', 'week'), 'small ghost')],
  }, weekSummaryEl(state), weekGrid(state, { compact: true, onDay: date => openDayEditor(date) })));

  // ---- load + road to goal
  const bars = h('div', { class: 'chart' }), line = h('div', { class: 'chart' });
  const loadCard = card('Belastung', { hint: 'sRPE pro Tag, letzte 6 Wochen', actions: [legend(LOAD_LEGEND().filter(l => entries.some(e => moduleLabel(e.module, true) === l.label))), btn('Details', go('analysis', 'analysis', 'load'), 'small ghost')] },
    bars, h('h3', { class: 'chart-sub' }, 'ACWR'), line);
  const goalCard = roadToGoal(data, settings, rows12, goal);
  root.append(h('div', { class: 'grid-2 wide-left' }, loadCard, goalCard.el));
  if (entries.length) loadCharts(bars, line, entries, addDays(ws, -35), addDays(ws, 6), { height: 190 });
  else { bars.replaceChildren(h('div', { class: 'chart-empty' }, 'Belastung = RPE × Minuten. Sobald Einheiten Dauer und RPE haben, erscheinen sie hier – gestapelt nach Modul.')); line.previousSibling.hidden = true; }
  goalCard.draw();

  // ---- strength + recent
  const ss = sortedSessions(data.strength_sessions);
  const strengthCard = card('Kraft & Prävention', { hint: ss[0] ? `letzte Sitzung ${relDay(ss[0].date)}` : null, actions: ss[0] ? [btn('Als Vorlage', () => openStrength(null, ss[0]), 'small ghost'), btn('Alle', go('strength'), 'small ghost')] : null },
    ss[0] ? sessionBody(ss[0], true) : h('div', { class: 'chart-empty' }, 'Noch keine Sitzung. Importiere RehabBoard oder lege eine Sitzung an.'));
  root.append(h('div', { class: 'grid-2' }, strengthCard, recentCard(data)));
}

function welcome() {
  return h('section', { class: 'card welcome' },
    h('div', {}, h('h2', {}, 'Willkommen bei Elevate'), h('p', {}, 'Ein Logbuch für alles: Klettern, Hangboard, Kraft & Prävention, Laufen und Rad – mit gemeinsamer Belastungssteuerung und dem Blick Richtung 8a.')),
    h('ol', { class: 'steps' },
      h('li', {}, h('b', {}, 'Daten übernehmen'), h('span', {}, 'RehabBoard-Sitzungen und die Hangboard-Notizen importieren.'), btn('Zum Import', go('import'), 'primary small')),
      h('li', {}, h('b', {}, 'Woche ansehen'), h('span', {}, 'Die Standard-Vorlage ist angelegt und lässt sich pro Tag anpassen.'), btn('Zur Planung', go('plan'), 'small')),
      h('li', {}, h('b', {}, 'Erste Einheit erfassen'), h('span', {}, 'Mit Dauer und RPE – daraus entsteht die Belastung.'), h('span', { class: 'hint' }, 'Taste N oder „+ Einheit“'))));
}

/** Finger strength against the pre-injury reference. */
function fingerKpi(data) {
  const ref = data.tests.find(x => x.isReference && x.type === 'max_hang');
  const refV = ref ? testValue(ref).value : null;
  const bw = bodyweightAt(data.bodyweight, today())?.kg ?? null;
  const same = ref ? testSeries(data.tests, bw).find(s => s.key === `max_hang|${ref.protocol.edge_mm}`) : null;
  const lastTest = same?.pts.at(-1);
  if (lastTest?.y != null && refV) return kpi('Fingerkraft', fmtPct(lastTest.y / refV * 100), `der Referenz · Max Hang ${ref.protocol.edge_mm} mm am ${fmtDs(lastTest.date)}`);
  const hl = hangHeadline();
  if (hl?.last?.pct != null) return kpi('Fingerkraft', `${fmtNum(hl.last.pct)} % KG`, `${hl.series.label} · ${fmtDs(hl.last.date)}`);
  return kpi('Fingerkraft', refV ? `${fmtNum(refV)} % KG` : '–', refV ? 'Referenz vor der Verletzung' : 'noch keine Daten');
}

function roadToGoal(data, settings, rows, goal) {
  const pyr = h('div', { class: 'chart pyramid-wrap' });
  const sessions = data.climb_sessions;
  const active = data.projects.filter(p => p.status === 'aktiv').sort((a, b) => compareGrades(b.grade, a.grade));
  const ref = data.tests.find(x => x.isReference && x.type === 'max_hang');
  const refV = ref ? testValue(ref).value : null;
  const hl = hangHeadline();

  const projectsEl = h('div', { class: 'mini-list' });
  if (!active.length) projectsEl.append(h('div', { class: 'hint' }, 'Kein aktives Projekt.'), btn('Projekt anlegen', () => openProjectEditor(), 'small'));
  for (const p of active.slice(0, 4)) {
    const st = projectStats(p, sessions);
    projectsEl.append(pressable('mini-row', () => openProjectEditor(p),
      h('b', { class: 'grade' }, p.grade ?? '?'), h('span', { class: 'grow name' }, p.name),
      h('span', { class: 'hint' }, `${st.attempts} Vers.${st.bestPct != null ? ` · ${st.bestPct} %` : ''}`)));
  }

  const finger = h('div', { class: 'finger' });
  if (hl?.last) {
    const pct = hl.last.pct;
    finger.append(
      h('div', { class: 'finger-now' }, h('b', {}, pct != null ? `${fmtNum(pct)} %` : `${fmtNum(hl.last.load, 1)} kg`), h('span', {}, 'vom Körpergewicht')),
      h('div', { class: 'hint' }, `${hl.series.label} · ${fmtD(hl.last.date)}`));
    if (refV) {
      if (hl.ref?.exact && pct != null) finger.append(h('div', { class: 'progress', title: `${fmtNum(pct / refV * 100)} % der Referenz` }, h('i', { style: { width: `${Math.min(100, pct / refV * 100)}%`, background: 'var(--m-hangboard)' } })));
      finger.append(h('div', { class: 'hint' }, `Referenz vor der Verletzung: ${fmtNum(refV)} % (Max Hang ${ref.protocol.edge_mm} mm, ${ref.protocol.time_s} s, +${fmtNum(ref.protocol.load_kg, 1)} kg beidarmig)${hl.ref?.exact ? '' : ' – anderer Aufbau, nicht direkt vergleichbar'}`));
    }
  } else {
    finger.append(h('div', { class: 'hint' }, refV ? `Referenz vor der Verletzung: ${fmtNum(refV)} % vom Körpergewicht. Noch keine Hangboard-Einheit erfasst.` : 'Noch keine Hangboard-Daten.'));
  }

  const el = card(`Richtung ${goal}`, { actions: [legend(STYLE_LEGEND), btn('Analyse', go('analysis', 'analysis', 'pyramid'), 'small ghost')] },
    pyr,
    h('h3', { class: 'chart-sub' }, 'Aktive Projekte'), projectsEl,
    h('h3', { class: 'chart-sub' }, 'Fingerkraft'), finger);
  return { el, draw: () => pyramidChart(pyr, rows.slice(0, 6), { goal, compact: true }) };
}

function recentCard(data) {
  const acts = collectActuals(data).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  const list = h('div', { class: 'mini-list' });
  for (const a of acts) {
    list.append(pressable('mini-row', () => openActual(a),
      h('i', { class: 'dot', style: { background: moduleColor(a.module) } }),
      h('span', { class: 'when' }, fmtDs(a.date)),
      h('span', { class: 'grow name' }, `${moduleLabel(a.module, true)} · ${a.label}`),
      h('span', { class: 'hint' }, [a.duration_min ? fmtDur(a.duration_min) : null, a.rpe ? `RPE ${a.rpe}` : null].filter(Boolean).join(' · '))));
  }
  if (!acts.length) list.append(h('div', { class: 'chart-empty' }, 'Hier erscheinen deine letzten Einheiten aus allen Modulen.'));
  return card('Zuletzt', { hint: 'alle Module' }, list);
}

export { esc, icon };
