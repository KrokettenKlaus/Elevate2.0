// Defaults that are created once on first start, if they are missing:
// settings, the two week templates, the body-weight start value and the
// pre-injury reference tests. `settings.seeds` remembers what was created, so
// something the user deletes later does not come back.
import { today, weekStart } from '../domain/dates.js';
import { defaultTemplates } from '../domain/plan.js';
import { referenceTests } from '../domain/tests.js';

export const DEFAULT_SETTINGS = {
  summer: { from: '06-01', to: '09-30' },
  defaultEdge: 20,
  goalGrade: '8a',
  targetPyramid: { '8a': 1, '7c+': 2, '7c': 4, '7b+': 8 },
  includeOtherSports: false,
  hrMax: null,
  hrZones: null,
  stravaLastSync: null,
  corosLastSync: null,
  strengthModeDefault: 'lift_one_arm',
};

let running = false;

export async function ensureDefaults(store) {
  if (running) return;
  running = true;
  try {
    const current = store.get('settings', 'main');
    const seeds = { ...(current?.seeds ?? {}) };
    const next = { ...DEFAULT_SETTINGS, ...(current ?? {}), id: 'main' };
    if (!next.planStart) next.planStart = weekStart(today());

    if (!seeds.templates) {
      for (const t of defaultTemplates()) if (!store.get('plan_templates', t.id)) await store.put('plan_templates', t);
      seeds.templates = true;
    }
    if (!seeds.bodyweight) {
      if (!store.list('bodyweight').length) await store.put('bodyweight', { id: 'bw-20261113', date: '2026-11-13', kg: 75 });
      seeds.bodyweight = true;
    }
    if (!seeds.referenceTests) {
      for (const t of referenceTests()) if (!store.get('tests', t.id)) await store.put('tests', t);
      seeds.referenceTests = true;
    }
    next.seeds = seeds;
    await store.put('settings', next); // no-op when nothing changed
  } finally {
    running = false;
  }
}
