// Training load across all sports: sRPE (RPE × minutes) and ACWR with EWMA.
import { addDays, dateRange, daysBetween, weekStart } from './dates.js';

/** Stack order of the modules in every load chart (validated colour order). */
export const LOAD_MODULES = ['climbing', 'hangboard', 'run', 'strength', 'ride', 'other'];
export const MODULE_LABEL = {
  climbing: 'Klettern', hangboard: 'Hangboard', strength: 'Kraft & Prävention',
  run: 'Laufen', ride: 'Rad', other: 'Sonstiges', mobility: 'Mobility', rest: 'Ruhetag',
};

export const ACWR_HIGH = 1.5;
export const ACWR_LOW = 0.8;

/** sRPE of one session, or null when duration or RPE is missing. Never stored. */
export function srpe(x) {
  const d = Number(x?.duration_min), r = Number(x?.rpe);
  return d > 0 && r > 0 ? d * r : null;
}

/** Normalise every session/activity that carries a load into { date, module, load, … }. */
export function loadEntries(data) {
  const out = [];
  const push = (col, module, s) => {
    const load = srpe(s);
    if (load != null && s.date) out.push({ id: s.id, col, date: s.date, module, load, duration_min: Number(s.duration_min), rpe: Number(s.rpe) });
  };
  for (const s of data.climb_sessions ?? []) push('climb_sessions', 'climbing', s);
  for (const s of data.hangboard_sessions ?? []) push('hangboard_sessions', 'hangboard', s);
  for (const s of data.strength_sessions ?? []) push('strength_sessions', 'strength', s);
  for (const s of data.endurance_activities ?? []) push('endurance_activities', LOAD_MODULES.includes(s.module) ? s.module : 'other', s);
  return out;
}

const emptyBy = () => Object.fromEntries(LOAD_MODULES.map(m => [m, 0]));

/** One row per calendar day in [from, to], zero-filled. */
export function dailyLoads(entries, from, to) {
  const byDate = new Map();
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    const row = byDate.get(e.date) ?? { total: 0, by: emptyBy() };
    row.total += e.load;
    row.by[e.module] = (row.by[e.module] ?? 0) + e.load;
    byDate.set(e.date, row);
  }
  return dateRange(from, to).map(date => ({ date, ...(byDate.get(date) ?? { total: 0, by: emptyBy() }) }));
}

/** Exponentially weighted moving average with λ = 2 / (N + 1), seeded with the first value. */
export function ewma(values, N) {
  const lambda = 2 / (N + 1);
  const out = [];
  let prev = null;
  for (const v of values) {
    prev = prev == null ? v : v * lambda + (1 - lambda) * prev;
    out.push(prev);
  }
  return out;
}

/**
 * Acute:chronic workload ratio per day, from the first day with load up to `to`.
 * `ratio` stays null until `minDays` days of data exist (plan: 28).
 */
export function acwrSeries(entries, to, { acuteN = 7, chronicN = 28, minDays = 28 } = {}) {
  if (!entries.length) return [];
  const first = entries.reduce((a, e) => (e.date < a ? e.date : a), entries[0].date);
  if (first > to) return [];
  const daily = dailyLoads(entries, first, to);
  const loads = daily.map(d => d.total);
  const acute = ewma(loads, acuteN), chronic = ewma(loads, chronicN);
  return daily.map((d, i) => {
    const ready = i + 1 >= minDays && chronic[i] > 0;
    const ratio = ready ? acute[i] / chronic[i] : null;
    return { date: d.date, load: d.total, acute: acute[i], chronic: chronic[i], ratio, flag: acwrFlag(ratio) };
  });
}

export function acwrFlag(ratio) {
  if (ratio == null) return null;
  if (ratio > ACWR_HIGH) return 'high';
  if (ratio < ACWR_LOW) return 'low';
  return 'ok';
}

/** Days of data that are still missing before the ACWR is shown. */
export function acwrDaysMissing(entries, to, minDays = 28) {
  if (!entries.length) return minDays;
  const first = entries.reduce((a, e) => (e.date < a ? e.date : a), entries[0].date);
  return Math.max(0, minDays - (daysBetween(first, to) + 1));
}

/** Weekly totals (Monday-based) over [from, to]. */
export function weeklyLoads(entries, from, to) {
  const weeks = new Map();
  for (let w = weekStart(from); w <= to; w = addDays(w, 7)) weeks.set(w, { weekStart: w, total: 0, by: emptyBy(), sessions: 0, days: Array(7).fill(0) });
  for (const e of entries) {
    const w = weeks.get(weekStart(e.date));
    if (!w || e.date < from || e.date > to) continue;
    w.total += e.load;
    w.by[e.module] = (w.by[e.module] ?? 0) + e.load;
    w.sessions++;
    w.days[daysBetween(w.weekStart, e.date)] += e.load;
  }
  return [...weeks.values()];
}

/** Foster's monotony (mean / sd of the daily loads of a week) and strain. */
export function monotony(days) {
  const mean = days.reduce((a, b) => a + b, 0) / days.length;
  const sd = Math.sqrt(days.reduce((a, b) => a + (b - mean) ** 2, 0) / days.length);
  if (!mean || !sd) return { monotony: null, strain: null };
  const m = mean / sd;
  return { monotony: m, strain: m * mean * days.length };
}
