// Benchmarks: test types, derived values and the pre-injury reference.
import { epley1RM, pctBodyweight } from './hangboard.js';

export const TEST_TYPES = ['max_hang', 'max_pullup', 'pullup_test', 'stuetz_test', 'custom'];
export const TEST_LABEL = {
  max_hang: 'Max Hang', max_pullup: 'Max Pull-up', pullup_test: 'Pullup-Test', stuetz_test: 'Stütz-Test', custom: 'Eigener Test',
};

const num = (n, dec = 1) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: dec });
const signed = kg => (Number(kg) === 0 ? 'Körpergewicht' : `${Number(kg) > 0 ? '+' : '−'}${num(Math.abs(kg))} kg`);

/** Reference values from before the injury (spring 2026), created once on first start. */
export function referenceTests() {
  return [
    { id: 'ref-max-hang', date: '2026-04-01', dateApprox: true, isReference: true, type: 'max_hang',
      protocol: { edge_mm: 25, time_s: 5, load_kg: 37 }, bodyweight_kg: 75, bodyweightAssumed: true,
      result: '', note: 'Referenz vor der Verletzung (Frühling 2026). Körpergewicht geschätzt.' },
    { id: 'ref-max-pullup', date: '2026-04-01', dateApprox: true, isReference: true, type: 'max_pullup',
      protocol: { reps: 2, load_kg: 40 }, bodyweight_kg: 75, bodyweightAssumed: true,
      result: '', note: 'Referenz vor der Verletzung (Frühling 2026). Körpergewicht geschätzt.' },
  ];
}

/**
 * Comparable value of a test.
 *  - max_hang / max_pullup: % of body weight (total load), plus an Epley 1RM for pull-ups
 *  - other tests: the free numeric `value`, if given
 */
export function testValue(t, fallbackBw = null) {
  const bw = Number(t.bodyweight_kg) || fallbackBw || null;
  const p = t.protocol ?? {};
  if (t.type === 'max_hang' && p.load_kg != null) {
    return { value: pctBodyweight('hang_two_arm', p.load_kg, bw), unit: '% KG', bw };
  }
  if (t.type === 'max_pullup' && p.load_kg != null) {
    const total = bw ? bw + Number(p.load_kg) : null;
    const oneRm = total ? epley1RM(total, Number(p.reps) || 1) : null;
    return { value: oneRm && bw ? oneRm / bw * 100 : null, unit: '% KG (1RM)', bw, oneRmAddedKg: oneRm ? oneRm - bw : null };
  }
  return { value: t.value != null && t.value !== '' ? Number(t.value) : null, unit: t.unit || '', bw };
}

/** Series key: tests on different edges are never mixed. */
export function testKey(t) {
  if (t.type === 'max_hang') return `max_hang|${t.protocol?.edge_mm ?? ''}`;
  if (t.type === 'custom') return `custom|${(t.name ?? '').trim().toLowerCase()}`;
  return t.type;
}

export function testKeyLabel(t) {
  if (t.type === 'max_hang') return `Max Hang · ${t.protocol?.edge_mm ?? '?'} mm`;
  if (t.type === 'custom') return t.name || 'Eigener Test';
  return TEST_LABEL[t.type] ?? t.type;
}

export function describeTest(t) {
  const p = t.protocol ?? {};
  if (t.type === 'max_hang') return `${p.edge_mm ?? '?'} mm · ${p.time_s ?? '?'} s · ${signed(p.load_kg ?? 0)} beidarmig`;
  if (t.type === 'max_pullup') return `${p.reps ?? '?'} Wdh. · ${signed(p.load_kg ?? 0)}`;
  return [p.text, t.result].filter(Boolean).join(' → ') || '–';
}

/** Group tests into chartable series, oldest first. */
export function testSeries(tests, fallbackBw = null) {
  const out = new Map();
  for (const t of [...tests].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = testKey(t);
    const s = out.get(key) ?? { key, label: testKeyLabel(t), type: t.type, pts: [], reference: null };
    const v = testValue(t, fallbackBw);
    const pt = { date: t.date, y: v.value, unit: v.unit, test: t, ...v };
    if (t.isReference) s.reference = pt; else s.pts.push(pt);
    out.set(key, s);
  }
  return [...out.values()];
}
