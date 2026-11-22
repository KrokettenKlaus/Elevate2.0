// Weekly review with Claude (capability `sample`) and the compact summary it is based on.
import store from '../store/index.js';
import { addDays, isoWeek, today, wd } from '../domain/dates.js';
import { acwrSeries, loadEntries, monotony, weeklyLoads } from '../domain/load.js';
import { pyramidRows } from '../domain/grades.js';
import { bodyweightAt, describeBlock, pctBodyweight } from '../domain/hangboard.js';
import { blockAt, collectActuals, reconcileWeek, weekPlan } from '../domain/plan.js';
import { cap } from './caps.js';

const round = (v, d = 0) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Compact JSON summary of one week: plan vs. actual, load, ticks, hangboard. */
export function buildWeekSummary(ws) {
  const data = store.all();
  const end = addDays(ws, 6);
  const settings = store.settings();
  const inWeek = x => x.date >= ws && x.date <= end;
  const plan = weekPlan(ws, { planUnits: data.plan_units, templates: data.plan_templates, blocks: data.plan_blocks, settings });
  const recon = reconcileWeek(ws, plan, collectActuals(data), today());
  const entries = loadEntries(data);
  const weeks = weeklyLoads(entries, addDays(ws, -7), end);
  const [prev, cur] = weeks;
  const acwr = acwrSeries(entries, end <= today() ? end : today());
  const last = acwr.at(-1);
  const bw = bodyweightAt(data.bodyweight, end);
  const block = blockAt(data.plan_blocks, ws) ?? blockAt(data.plan_blocks, end);
  const sessionsWithoutLoad = [...data.climb_sessions, ...data.hangboard_sessions, ...data.strength_sessions, ...data.endurance_activities]
    .filter(inWeek).filter(s => !(s.duration_min > 0 && s.rpe > 0)).length;

  return {
    woche: { kw: isoWeek(ws).week, von: ws, bis: end, heute: today() },
    ziel: { grad: settings.goalGrade ?? '8a', soll_pyramide: settings.targetPyramid ?? {} },
    block: block ? { name: block.name, typ: block.type, von: block.start, bis: block.end, fokus: block.focus || undefined } : null,
    plan: recon.planned ? {
      zusammenfassung: { geplant: recon.summary.planned, erledigt: recon.summary.done, offen: recon.summary.open, ausgelassen: recon.summary.missed, zusaetzlich: recon.summary.extra },
      tage: recon.days.map(d => ({
        tag: wd(d.date), datum: d.date,
        geplant: d.items.filter(i => i.status !== 'rest').map(i => ({ modul: i.unit.module, typ: i.unit.type, status: i.status === 'alt' ? 'alternative_nicht_noetig' : i.status, oder: i.alt ? true : undefined })),
        zusaetzlich: d.extras.map(a => a.module),
      })),
    } : null,
    einheiten: collectActuals(data).filter(inWeek).sort((a, b) => a.date.localeCompare(b.date)).map(a => ({
      datum: a.date, modul: a.module, was: a.label, dauer_min: a.duration_min ?? undefined, rpe: a.rpe ?? undefined,
      srpe: a.duration_min > 0 && a.rpe > 0 ? a.duration_min * a.rpe : undefined,
    })),
    belastung: {
      woche_srpe: round(cur?.total), vorwoche_srpe: round(prev?.total),
      nach_modul: cur ? Object.fromEntries(Object.entries(cur.by).filter(([, v]) => v > 0).map(([k, v]) => [k, round(v)])) : {},
      acwr: round(last?.ratio, 2), akut_ewma7: round(last?.acute), chronisch_ewma28: round(last?.chronic),
      monotonie: cur ? round(monotony(cur.days).monotony, 2) : null,
      einheiten_ohne_dauer_oder_rpe: sessionsWithoutLoad || undefined,
      hinweis: last?.ratio == null ? 'ACWR noch nicht aussagekräftig (weniger als 28 Tage mit Daten)' : undefined,
    },
    klettern: {
      ticks: data.ticks.filter(inWeek).map(t => ({ datum: t.date, grad: t.grade, stil: t.style, route: t.route || undefined, versuche: t.attempts, ort: t.place })),
      projektversuche: data.climb_sessions.filter(inWeek).flatMap(s => (s.projectAttempts ?? []).map(a => {
        const p = data.projects.find(x => x.id === a.projectId);
        return { datum: s.date, projekt: p?.name, grad: p?.grade, versuche: a.attempts, hoechster_punkt: a.highpoint || undefined, prozent: a.highpointPct ?? undefined };
      })),
      aktive_projekte: data.projects.filter(p => p.status === 'aktiv').map(p => ({ name: p.name, grad: p.grade })),
      pyramide_12_monate: pyramidRows(data.ticks, settings.targetPyramid ?? {}, { since: addDays(end, -365) }).map(r => ({ grad: r.grade, begehungen: r.sends, soll: r.target || undefined })),
    },
    hangboard: data.hangboard_sessions.filter(inWeek).map(s => ({
      datum: s.date, typ: s.type === 'Custom' ? `Eigenes: ${s.name ?? ''}` : s.type,
      bloecke: (s.blocks ?? []).map(b => ({ text: describeBlock(s.type, b), prozent_kg: bw && b.load_kg != null ? round(pctBodyweight(s.type === 'PullUp' ? 'pullup' : b.mode, b.load_kg, bw.kg)) : undefined })),
    })),
    kraft_praevention: data.strength_sessions.filter(inWeek).map(s => ({ datum: s.date, art: s.kind, uebungen: s.exercises.length, notiz: s.notes || undefined })),
    koerpergewicht_kg: bw?.kg ?? null,
  };
}

export function buildPrompt(summary) {
  return [
    'Du bist Trainingsberater für einen Sportkletterer (aktuell 7c, Ziel 8a) mit Hangboard-, Kraft-, Lauf- und Radtraining. Er hatte ab Juni 2026 eine Schulterverletzung und trainiert seither Kraft & Prävention; aktuell ohne Einschränkungen.',
    'Unten steht die Zusammenfassung seiner Trainingswoche als JSON. Belastung ist sRPE (RPE × Minuten), die ACWR nutzt EWMA mit 7 und 28 Tagen. Eine ACWR über 1,5 gilt als Spitze, unter 0,8 als Unterbelastung.',
    'Schreibe einen kurzen Wochenrückblick auf Deutsch, in der Du-Form, sachlich und konkret. Nutze nur, was in den Daten steht, und erfinde keine Werte. Höchstens 220 Wörter.',
    'Gliedere genau so, jede Überschrift in einer eigenen Zeile mit ## davor:',
    '## Rückblick\n2–3 Sätze: Was wurde gemacht, wie passt es zum Plan?',
    '## Auffälligkeiten\n2–4 Stichpunkte mit "- ": Belastung, ACWR, ausgelassene Einheiten, Fortschritt Richtung 8a, Fingerkraft.',
    '## Empfehlung für nächste Woche\n3–4 Stichpunkte mit "- ": konkrete, umsetzbare Anpassungen.',
    '',
    'Daten:',
    JSON.stringify(summary),
  ].join('\n');
}

export const reviewAvailable = async () => !!(await cap('sample'));

/**
 * Ask Claude for the review. Streams through `onText`. Resolves { text, truncated }.
 * Rejects with the capability's { code, message, text? }.
 */
export async function requestReview(summary, { onText, signal, refresh = false } = {}) {
  const sample = await cap('sample');
  if (!sample) throw { code: 'capability_disabled', message: 'sample unavailable' };
  return sample(buildPrompt(summary), { onText, signal, cache: refresh ? false : true });
}

export function reviewErrorMessage(e) {
  switch (e?.code) {
    case 'cancelled': return null;
    case 'not_granted': return 'Du hast Claude für diese Seite nicht erlaubt. Der Wochenreview ist deshalb ausgeschaltet.';
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed': return 'Der Wochenreview mit Claude ist in dieser Ansicht nicht verfügbar. Du kannst die Zusammenfassung kopieren und in Claude einfügen.';
    case 'rate_limited': return 'Gerade sind zu viele Anfragen unterwegs oder dein Nutzungslimit ist erreicht. Versuche es später noch einmal.';
    case 'session_expired': return 'Deine Anmeldung ist abgelaufen. Melde dich in claude.ai neu an.';
    case 'refused': return 'Claude hat diese Anfrage abgelehnt.';
    case 'prompt_too_large': return 'Die Wochenzusammenfassung ist zu groß geworden.';
    case 'empty_completion': return 'Claude hat keine Antwort geschrieben. Versuche es noch einmal.';
    default: return 'Die Verbindung zu Claude wurde unterbrochen. Versuche es noch einmal.';
  }
}

export const reviewId = ws => `rev-${ws.replaceAll('-', '')}`;
