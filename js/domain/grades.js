// French sport grades as an ordered list, plus the grade pyramid.

export const GRADES = (() => {
  const out = [];
  for (let n = 5; n <= 9; n++) for (const l of ['a', 'b', 'c']) out.push(`${n}${l}`, `${n}${l}+`);
  return out.slice(0, out.indexOf('9c') + 1); // 5a … 9c
})();

export const STYLES = ['OS', 'Flash', 'RP', 'Repeat'];
export const STYLE_LABEL = { OS: 'Onsight', Flash: 'Flash', RP: 'Rotpunkt', Repeat: 'Wiederholung' };
/** Styles that count as a first ascent of the route for the pyramid. */
export const SEND_STYLES = ['OS', 'Flash', 'RP'];

const INDEX = new Map(GRADES.map((g, i) => [g, i]));

/** "7C +" → "7c+"; returns null if it is not a grade on the scale. */
export function normalizeGrade(input) {
  const g = String(input ?? '').toLowerCase().replace(/\s+/g, '');
  return INDEX.has(g) ? g : null;
}
export const gradeIndex = g => INDEX.get(normalizeGrade(g) ?? '') ?? -1;
export const compareGrades = (a, b) => gradeIndex(a) - gradeIndex(b);
export const shiftGrade = (g, steps) => GRADES[Math.min(GRADES.length - 1, Math.max(0, gradeIndex(g) + steps))];

/**
 * Count ticks per grade and style. Hall and rock are combined on purpose.
 * @param ticks  [{ grade, style, date, discipline? }]
 * @param opts   { since?: 'YYYY-MM-DD', includeRepeats?: boolean }
 * @returns Map grade → { OS, Flash, RP, Repeat, sends }
 */
export function pyramid(ticks, { since = null, includeRepeats = false } = {}) {
  const rows = new Map();
  for (const t of ticks) {
    if ((t.discipline ?? 'route') !== 'route') continue;
    if (since && t.date < since) continue;
    const g = normalizeGrade(t.grade);
    if (!g || !STYLES.includes(t.style)) continue;
    if (t.style === 'Repeat' && !includeRepeats) continue;
    const row = rows.get(g) ?? { OS: 0, Flash: 0, RP: 0, Repeat: 0, sends: 0 };
    row[t.style]++;
    if (SEND_STYLES.includes(t.style)) row.sends++;
    rows.set(g, row);
  }
  return rows;
}

/** Hardest grade with at least one send, or null. */
export function maxSend(ticks, since = null) {
  let best = null;
  for (const [g, row] of pyramid(ticks, { since })) if (row.sends && (best == null || compareGrades(g, best) > 0)) best = g;
  return best;
}

/**
 * Rows for a pyramid chart from `topGrade` downwards, compared with a target
 * pyramid such as { '8a': 1, '7c+': 2, '7c': 4, '7b+': 8 }.
 */
export function pyramidRows(ticks, target = {}, { since = null, includeRepeats = false, minRows = 6 } = {}) {
  const counts = pyramid(ticks, { since, includeRepeats });
  const targetIdx = Object.keys(target).map(gradeIndex).filter(i => i >= 0);
  const countIdx = [...counts.keys()].map(gradeIndex);
  const all = [...targetIdx, ...countIdx];
  if (!all.length) return [];
  const top = Math.max(...all);
  let bottom = Math.min(...(targetIdx.length ? targetIdx : all), ...(countIdx.length ? [Math.max(...countIdx) - 3] : []));
  bottom = Math.max(0, Math.min(bottom, top - (minRows - 1)));
  const rows = [];
  for (let i = top; i >= bottom; i--) {
    const grade = GRADES[i];
    const c = counts.get(grade) ?? { OS: 0, Flash: 0, RP: 0, Repeat: 0, sends: 0 };
    const goal = Number(target[grade]) || 0;
    rows.push({ grade, ...c, target: goal, missing: Math.max(0, goal - c.sends) });
  }
  return rows;
}

/** Share of the target pyramid that is already filled, 0…1. */
export function pyramidProgress(rows) {
  const goal = rows.reduce((a, r) => a + r.target, 0);
  if (!goal) return null;
  return rows.reduce((a, r) => a + Math.min(r.sends, r.target), 0) / goal;
}
