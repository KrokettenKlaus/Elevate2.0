// Kraft & Prävention: the RehabBoard calculations as pure functions.
// Exercise names are never merged or normalised – "Innenrotation" and
// "Innenrotation (seitlich liegend)" stay two different exercises.
import { addDays, weekStart } from './dates.js';

export const CATEGORIES = ['Aufwärmen', 'Schnellkraft', 'Isometrie', 'Mobilität', 'Test', 'Sonstiges'];
export const KIND_LABEL = { home: 'Eigentraining', physio: 'Physio' };

const num = (n, dec = 1) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: dec });

export const isStrength = e => e.type === 'strength';
export const exVolume = e => (isStrength(e) ? e.groups.reduce((s, g) => s + (g.sets || 0) * (g.reps || 0) * (g.weight || 0), 0) : 0);
export const exSets = e => (isStrength(e) ? e.groups.reduce((s, g) => s + (g.sets || 0), 0) : 0);
export const exReps = e => (isStrength(e) ? e.groups.reduce((s, g) => s + (g.sets || 0) * (g.reps || 0), 0) : 0);

/** Heaviest work set (warm-up sets only count when there is nothing else). */
export function exWorkWeight(e) {
  if (!isStrength(e)) return null;
  const work = e.groups.filter(g => !g.warmup && g.weight != null).map(g => g.weight);
  const all = e.groups.filter(g => g.weight != null).map(g => g.weight);
  const arr = work.length ? work : all;
  return arr.length ? Math.max(...arr) : null;
}

export const sesVolume = s => s.exercises.reduce((a, e) => a + exVolume(e), 0);
export const sesSets = s => s.exercises.reduce((a, e) => a + exSets(e), 0);

/** "3×10 @ 5 kg, A: 1×10 @ 4 kg" – `parts` returns the pieces for custom markup. */
export function groupParts(e) {
  if (!isStrength(e)) return [];
  return e.groups.map(g => ({ warmup: !!g.warmup, text: `${g.sets}×${g.reps}${g.weight != null ? ` @ ${num(g.weight)} kg` : ''}` }));
}
export function fmtGroups(e) {
  if (!isStrength(e)) return [e.description, e.duration ? `${e.duration} min` : ''].filter(Boolean).join(' · ');
  return groupParts(e).map(p => (p.warmup ? 'A: ' : '') + p.text).join(', ');
}

/** Newest first; sessions on the same day keep their insertion order reversed. */
export function sortedSessions(sessions) {
  return sessions.map((s, i) => [s, i]).sort((a, b) => b[0].date.localeCompare(a[0].date) || b[1] - a[1]).map(x => x[0]);
}

/** All exercise names with usage count, most used first. */
export function exerciseNames(sessions) {
  const m = new Map();
  for (const s of sessions) for (const e of s.exercises) {
    const r = m.get(e.name) ?? { name: e.name, count: 0, type: e.type, category: e.category, last: '' };
    r.count++;
    if (s.date >= r.last) { r.last = s.date; r.type = e.type; r.category = e.category; }
    m.set(e.name, r);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Last time an exercise was done (name compared case-insensitively, as in RehabBoard). */
export function lastExercise(sessions, name, beforeDate, excludeId) {
  const needle = name.toLowerCase();
  for (const s of sortedSessions(sessions)) {
    if (s.id === excludeId) continue;
    if (beforeDate && s.date > beforeDate) continue;
    const ex = s.exercises.find(x => x.name.toLowerCase() === needle);
    if (ex) return { session: s, ex };
  }
  return null;
}

/** History of one strength exercise, oldest first. */
export function exerciseSeries(sessions, name) {
  const pts = [];
  for (const s of sortedSessions(sessions).reverse()) for (const e of s.exercises) {
    if (e.name !== name || !isStrength(e)) continue;
    pts.push({ date: s.date, w: exWorkWeight(e), vol: exVolume(e), reps: exReps(e), sets: exSets(e), ex: e, session: s });
  }
  return pts;
}

/** Sessions and volume per week from the first session to `today`. */
export function weeklyStats(sessions, todayStr) {
  if (!sessions.length) return [];
  const first = sessions.reduce((a, s) => (s.date < a ? s.date : a), sessions[0].date);
  const weeks = new Map();
  for (let w = weekStart(first); w <= weekStart(todayStr); w = addDays(w, 7)) weeks.set(w, { weekStart: w, home: 0, physio: 0, vol: 0 });
  for (const s of sessions) {
    const r = weeks.get(weekStart(s.date));
    if (!r) continue;
    r[s.kind === 'physio' ? 'physio' : 'home']++;
    r.vol += sesVolume(s);
  }
  return [...weeks.values()];
}

/** Rows of the "Fortschritt Arbeitsgewicht" table (exercises with ≥ 3 weighted sessions). */
export function progressRows(sessions) {
  const rows = exerciseNames(sessions)
    .map(n => ({ name: n.name, pts: exerciseSeries(sessions, n.name).filter(p => p.w != null) }))
    .filter(r => r.pts.length >= 3)
    .map(r => {
      const first = r.pts[0].w, current = r.pts[r.pts.length - 1].w;
      return { ...r, first, current, best: Math.max(...r.pts.map(p => p.w)), pct: first ? Math.round((current - first) / first * 100) : 0, last: r.pts[r.pts.length - 1].date };
    });
  return rows.sort((a, b) => b.last.localeCompare(a.last) || b.pts.length - a.pts.length);
}
