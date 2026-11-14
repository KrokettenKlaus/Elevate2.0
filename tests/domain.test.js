import test from 'node:test';
import assert from 'node:assert/strict';

import { addDays, daysBetween, dayKey, inSeason, isoWeek, weekStart, weekDates } from '../js/domain/dates.js';
import { GRADES, compareGrades, maxSend, normalizeGrade, pyramid, pyramidProgress, pyramidRows } from '../js/domain/grades.js';
import { acwrDaysMissing, acwrSeries, dailyLoads, ewma, loadEntries, monotony, srpe, weeklyLoads } from '../js/domain/load.js';
import { bodyweightAt, hangSeries, pctBodyweight } from '../js/domain/hangboard.js';
import { collectActuals, defaultTemplates, generateWeek, reconcileDay, reconcileWeek, templateForDate, weekPlan } from '../js/domain/plan.js';
import { exWorkWeight, exerciseNames, lastExercise, progressRows, sesVolume } from '../js/domain/strength.js';
import { findActivityList, moduleForSport, normalizeStravaActivity, pace, parseHrZones, suggestRpe } from '../js/domain/endurance.js';
import { referenceTests, testSeries, testValue } from '../js/domain/tests.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('dates: week arithmetic is Monday-based and DST-safe', () => {
  assert.equal(weekStart('2026-11-13'), '2026-11-09'); // Friday → Monday
  assert.equal(weekStart('2026-11-09'), '2026-11-09');
  assert.equal(weekStart('2026-11-15'), '2026-11-09'); // Sunday
  assert.equal(dayKey('2026-11-13'), 'fri');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30'); // across the DST switch
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(daysBetween('2026-09-06', '2026-11-12'), 67);
  assert.deepEqual(weekDates('2026-11-09').at(-1), '2026-11-15');
  assert.deepEqual(isoWeek('2026-11-13'), { year: 2026, week: 46 });
  assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 });
});

test('dates: summer window, also across new year', () => {
  assert.equal(inSeason('2026-06-01', '06-01', '09-30'), true);
  assert.equal(inSeason('2026-09-30', '06-01', '09-30'), true);
  assert.equal(inSeason('2026-10-01', '06-01', '09-30'), false);
  assert.equal(inSeason('2026-01-10', '11-01', '02-28'), true);
  assert.equal(inSeason('2026-05-10', '11-01', '02-28'), false);
});

test('grades: French scale 5a … 9c in order', () => {
  assert.equal(GRADES[0], '5a');
  assert.equal(GRADES.at(-1), '9c');
  assert.equal(GRADES.length, 29);
  assert.ok(compareGrades('7c', '7c+') < 0);
  assert.ok(compareGrades('7c+', '8a') < 0);
  assert.ok(compareGrades('8a', '7b+') > 0);
  assert.equal(normalizeGrade(' 7C + '), '7c+');
  assert.equal(normalizeGrade('7d'), null);
});

test('grades: pyramid combines hall and rock, repeats do not count as sends', () => {
  const ticks = [
    { grade: '7c', style: 'RP', date: '2026-10-01', place: 'Fels' },
    { grade: '7c', style: 'RP', date: '2026-10-08', place: 'Halle' },
    { grade: '7b+', style: 'OS', date: '2026-09-01' },
    { grade: '7b+', style: 'Flash', date: '2025-01-01' },
    { grade: '7c', style: 'Repeat', date: '2026-10-09' },
    { grade: '7A', style: 'RP', date: '2026-10-09', discipline: 'boulder' },
  ];
  const p = pyramid(ticks);
  assert.deepEqual(p.get('7c'), { OS: 0, Flash: 0, RP: 2, Repeat: 0, sends: 2 });
  assert.equal(p.get('7b+').sends, 2);
  assert.equal(pyramid(ticks, { since: '2026-01-01' }).get('7b+').sends, 1);
  assert.equal(pyramid(ticks, { includeRepeats: true }).get('7c').Repeat, 1);
  assert.equal(maxSend(ticks), '7c');

  const rows = pyramidRows(ticks, { '8a': 1, '7c+': 2, '7c': 4, '7b+': 8 });
  assert.deepEqual(rows.map(r => r.grade).slice(0, 4), ['8a', '7c+', '7c', '7b+']);
  assert.equal(rows[0].missing, 1);
  assert.equal(rows[2].missing, 2);
  near(pyramidProgress(rows), (0 + 0 + 2 + 2) / 15);
});

test('load: sRPE = RPE × minutes and is skipped without both values', () => {
  assert.equal(srpe({ duration_min: 90, rpe: 7 }), 630);
  assert.equal(srpe({ duration_min: 90 }), null);
  assert.equal(srpe({ rpe: 7 }), null);
  assert.equal(srpe({ duration_min: 0, rpe: 5 }), null);
  const entries = loadEntries({
    climb_sessions: [{ id: 'c1', date: '2026-11-10', duration_min: 120, rpe: 8 }],
    strength_sessions: [{ id: 's-old', date: '2026-07-27', exercises: [] }, { id: 's2', date: '2026-11-11', duration_min: 40, rpe: 5 }],
    endurance_activities: [{ id: 'e1', date: '2026-11-11', module: 'run', duration_min: 50, rpe: 4 }],
  });
  assert.equal(entries.length, 3); // the old session without duration/RPE is skipped
  const daily = dailyLoads(entries, '2026-11-09', '2026-11-11');
  assert.deepEqual(daily.map(d => d.total), [0, 960, 400]);
  assert.equal(daily[2].by.strength, 200);
  assert.equal(daily[2].by.run, 200);
  const weeks = weeklyLoads(entries, '2026-11-09', '2026-11-15');
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].total, 1360);
});

test('load: EWMA uses λ = 2/(N+1)', () => {
  const out = ewma([100, 0, 0], 7); // λ = 0.25
  near(out[0], 100); near(out[1], 75); near(out[2], 56.25);
  const flat = ewma(Array(50).fill(300), 28);
  near(flat.at(-1), 300);
});

test('load: ACWR appears only after 28 days of data and flags spikes', () => {
  const mk = (date, load) => ({ date, module: 'climbing', load });
  const start = '2026-09-01';
  const steady = Array.from({ length: 40 }, (_, i) => mk(addDays(start, i), 400));
  const series = acwrSeries(steady, addDays(start, 39));
  assert.equal(series.length, 40);
  assert.equal(series[26].ratio, null);          // day 27: not yet
  near(series[27].ratio, 1);                     // day 28: shown, constant load → 1.0
  assert.equal(series[39].flag, 'ok');
  assert.equal(acwrDaysMissing(steady.slice(0, 10), addDays(start, 9)), 18);

  const spike = [...steady, ...Array.from({ length: 5 }, (_, i) => mk(addDays(start, 40 + i), 1600))];
  const s2 = acwrSeries(spike, addDays(start, 44));
  assert.ok(s2.at(-1).ratio > 1.5);
  assert.equal(s2.at(-1).flag, 'high');

  const s3 = acwrSeries(steady, addDays(start, 55)); // 16 days without training
  assert.ok(s3.at(-1).ratio < 0.8);
  assert.equal(s3.at(-1).flag, 'low');
  assert.deepEqual(acwrSeries([], '2026-11-13'), []);
});

test('load: monotony is undefined for a flat or empty week', () => {
  assert.equal(monotony([0, 0, 0, 0, 0, 0, 0]).monotony, null);
  assert.equal(monotony([5, 5, 5, 5, 5, 5, 5]).monotony, null);
  assert.ok(monotony([600, 0, 300, 400, 0, 700, 500]).monotony > 0);
});

test('hangboard: body weight at a date and % of body weight', () => {
  const bw = [{ date: '2026-11-13', kg: 75 }, { date: '2026-12-01', kg: 74 }];
  assert.deepEqual(bodyweightAt(bw, '2026-11-20'), { kg: 75, date: '2026-11-13', approx: false });
  assert.deepEqual(bodyweightAt(bw, '2026-12-01'), { kg: 74, date: '2026-12-01', approx: false });
  assert.deepEqual(bodyweightAt(bw, '2026-09-06'), { kg: 75, date: '2026-11-13', approx: true }); // before the series starts
  assert.equal(bodyweightAt([], '2026-09-06'), null);

  near(pctBodyweight('hang_two_arm', 37, 75), 149.3333333, 1e-4); // the reference: 149 %
  near(pctBodyweight('hang_two_arm', -10, 75), 86.6666667, 1e-4); // assisted via pulley
  near(pctBodyweight('lift_one_arm', 26, 75), 34.6666667, 1e-4);
  assert.equal(pctBodyweight('lift_one_arm', 26, null), null);
});

test('hangboard: series are split by type, mode, grip and edge', () => {
  const sessions = [
    { id: 'a', date: '2026-09-06', type: 'Strength', blocks: [
      { mode: 'lift_one_arm', grip: 'halfcrimp', edge_mm: 20, load_kg: 18, reps: 4 },
      { mode: 'lift_one_arm', grip: 'open', edge_mm: 20, load_kg: 6, reps: 4 }] },
    { id: 'b', date: '2026-09-13', type: 'Strength', blocks: [{ mode: 'lift_one_arm', grip: 'halfcrimp', edge_mm: 20, load_kg: 20, reps: 4 }] },
    { id: 'c', date: '2026-10-29', type: 'PowerEndurance', blocks: [{ mode: 'hang_two_arm', grip: 'halfcrimp', edge_mm: 20, load_kg: -10, reps: 20, sets: 3 }] },
  ];
  const series = hangSeries(sessions, [{ date: '2026-11-13', kg: 75 }]);
  assert.equal(series.size, 3);
  const hc = series.get('Strength|lift_one_arm|halfcrimp|20');
  assert.deepEqual(hc.pts.map(p => p.load), [18, 20]);
  near(hc.pts[1].pct, 20 / 75 * 100);
  assert.equal(hc.pts[0].bwApprox, true);
  near(series.get('PowerEndurance|hang_two_arm|halfcrimp|20').pts[0].pct, 65 / 75 * 100);
});

const planCtx = (extra = {}) => ({
  planUnits: [], templates: defaultTemplates(), blocks: [],
  settings: { summer: { from: '06-01', to: '09-30' }, planStart: '2026-01-05' }, ...extra,
});

test('plan: default week template and the summer variant', () => {
  const { templates, blocks, settings } = planCtx();
  const winter = generateWeek('2026-11-09', templates, blocks, settings);
  const byDay = d => winter.filter(u => u.date === d).map(u => u.module);
  assert.deepEqual(byDay('2026-11-09'), ['rest']);
  assert.deepEqual(byDay('2026-11-10'), ['climbing']);
  assert.deepEqual(byDay('2026-11-11'), ['strength', 'run']);
  assert.deepEqual(byDay('2026-11-12'), ['strength', 'hangboard']);
  assert.deepEqual(byDay('2026-11-13'), ['run', 'mobility']);
  assert.deepEqual(byDay('2026-11-14'), ['climbing']);
  assert.deepEqual(byDay('2026-11-15'), ['climbing', 'hangboard']);
  assert.ok(winter.filter(u => u.date === '2026-11-15').every(u => u.alt === 'a'));

  assert.equal(templateForDate('2026-07-04', templates, blocks, settings).id, 'summer');
  const summer = generateWeek('2026-06-29', templates, blocks, settings);
  assert.deepEqual(summer.filter(u => u.date === '2026-07-04').map(u => u.module), ['ride']);
});

test('plan: a block template overrides standard and summer', () => {
  const ctx = planCtx();
  ctx.templates.push({ id: 'tpl-deload', name: 'Deload', variant: 'block', days: { mon: [{ module: 'rest' }], tue: [{ module: 'mobility' }] } });
  ctx.blocks.push({ id: 'b1', name: 'Deload', type: 'Deload', start: '2026-07-06', end: '2026-07-12', templateId: 'tpl-deload' });
  assert.equal(templateForDate('2026-07-07', ctx.templates, ctx.blocks, ctx.settings).id, 'tpl-deload');
  assert.equal(templateForDate('2026-07-13', ctx.templates, ctx.blocks, ctx.settings).id, 'summer');
  const week = generateWeek('2026-07-06', ctx.templates, ctx.blocks, ctx.settings);
  assert.deepEqual(week.filter(u => u.date === '2026-07-08').map(u => u.module), ['rest']); // empty template day → rest
});

test('plan: stored units fix a week, weeks before planStart have no plan', () => {
  const ctx = planCtx({ planUnits: [{ id: 'pu-20261110-1', date: '2026-11-10', module: 'run' }] });
  const fixed = weekPlan('2026-11-09', ctx);
  assert.equal(fixed.fixed, true);
  assert.equal(fixed.units.length, 1);
  assert.equal(weekPlan('2026-11-16', ctx).fixed, false);
  assert.equal(weekPlan('2026-11-16', ctx).units.length, 11);
  assert.equal(weekPlan('2025-12-22', ctx).planned, false);
});

test('plan: reconciliation – done, open, missed, extra and "or" days', () => {
  const today = '2026-11-13';
  const ctx = planCtx();
  const plan = weekPlan('2026-11-09', ctx);
  const actuals = collectActuals({
    climb_sessions: [{ id: 'c1', date: '2026-11-10', type: 'Projektieren' }, { id: 'c2', date: '2026-11-11', type: 'Volumen' }],
    strength_sessions: [{ id: 's1', date: '2026-11-11', kind: 'home', exercises: [] }],
    hangboard_sessions: [{ id: 'hb-20261112', date: '2026-11-12', type: 'PowerEndurance' }],
    endurance_activities: [{ id: 'e1', date: '2026-11-13', module: 'run', sport: 'Run', name: 'Morgenlauf' }],
  });
  const week = reconcileWeek('2026-11-09', plan, actuals, today);
  const day = d => week.days.find(x => x.date === d);
  const status = d => day(d).items.map(i => `${i.unit.module}:${i.status}`);

  assert.deepEqual(status('2026-11-09'), ['rest:rest']);
  assert.deepEqual(status('2026-11-10'), ['climbing:done']);
  assert.deepEqual(status('2026-11-11'), ['strength:done', 'run:missed']);   // past day
  assert.deepEqual(day('2026-11-11').extras.map(a => a.id), ['c2']);          // unplanned climbing = zusätzlich
  assert.deepEqual(status('2026-11-12'), ['strength:missed', 'hangboard:done']);
  assert.deepEqual(status('2026-11-13'), ['run:done', 'mobility:open']);      // today stays open
  assert.deepEqual(status('2026-11-14'), ['climbing:open']);
  assert.deepEqual(status('2026-11-15'), ['climbing:open', 'hangboard:open']);
  assert.deepEqual(week.summary, { planned: 9, done: 4, open: 3, missed: 2, extra: 1, adherence: 4 / 9 });

  // "or" day: one of the alternatives is enough
  const sunday = reconcileDay('2026-11-15', plan.units.filter(u => u.date === '2026-11-15'),
    collectActuals({ hangboard_sessions: [{ id: 'hb-x', date: '2026-11-15', type: 'Strength' }] }), '2026-11-16');
  assert.deepEqual(sunday.items.map(i => i.status), ['alt', 'done']);
  assert.equal(sunday.extras.length, 0);
});

test('plan: mobility is fulfilled by a strength session with a mobility exercise, manual override wins', () => {
  const units = [{ id: 'u1', date: '2026-11-13', module: 'run', manual: 'done' }, { id: 'u2', date: '2026-11-13', module: 'mobility' }];
  const actuals = collectActuals({ strength_sessions: [{ id: 's1', date: '2026-11-13', kind: 'home', exercises: [{ name: 'Hüftöffner', type: 'free', category: 'Mobilität' }] }] });
  const day = reconcileDay('2026-11-13', units, actuals, '2026-11-14');
  assert.deepEqual(day.items.map(i => i.status), ['done', 'done']);
  assert.equal(day.items[0].manual, true);
});

test('strength: RehabBoard calculations', () => {
  const sessions = [
    { id: 's1', date: '2026-07-27', kind: 'home', exercises: [
      { name: 'Seitheben', type: 'strength', groups: [{ sets: 1, reps: 10, weight: 4, warmup: true }, { sets: 1, reps: 10, weight: 5, warmup: false }] },
      { name: 'Innenrotation', type: 'free', category: 'Sonstiges', description: '' }] },
    { id: 's2', date: '2026-08-03', kind: 'physio', exercises: [
      { name: 'Seitheben', type: 'strength', groups: [{ sets: 3, reps: 10, weight: 6, warmup: false }] },
      { name: 'Innenrotation (seitlich liegend)', type: 'free', category: 'Sonstiges', description: '' }] },
    { id: 's3', date: '2026-08-10', kind: 'home', exercises: [{ name: 'Seitheben', type: 'strength', groups: [{ sets: 3, reps: 10, weight: 7, warmup: false }] }] },
  ];
  assert.equal(exWorkWeight(sessions[0].exercises[0]), 5); // warm-up set ignored
  assert.equal(sesVolume(sessions[0]), 90);
  const names = exerciseNames(sessions).map(n => n.name);
  assert.ok(names.includes('Innenrotation') && names.includes('Innenrotation (seitlich liegend)')); // never merged
  assert.equal(lastExercise(sessions, 'seitheben', '2026-08-09', null).session.id, 's2');
  const [row] = progressRows(sessions);
  assert.equal(row.name, 'Seitheben');
  assert.equal(row.first, 5); assert.equal(row.current, 7); assert.equal(row.pct, 40);
});

test('endurance: Strava mapping is tolerant and never guesses an id', () => {
  const raw = { id: 123456, name: 'Feierabendrunde', sport_type: 'TrailRun', start_date_local: '2026-11-12T17:30:00Z', moving_time: 3125, distance: 9340.5, total_elevation_gain: 410, average_heartrate: 151.2, max_heartrate: 176, suffer_score: 62 };
  const a = normalizeStravaActivity(raw);
  assert.equal(a.id, 'strava-123456');
  assert.equal(a.date, '2026-11-12');
  assert.equal(a.module, 'run');
  assert.equal(a.duration_min, 52);
  assert.equal(a.distance_km, 9.34);
  assert.deepEqual(a.loadRaw, { suffer_score: 62 });
  assert.equal(normalizeStravaActivity({ name: 'ohne id', start_date: '2026-11-12' }), null);
  assert.equal(moduleForSport('GravelRide'), 'ride');
  assert.equal(moduleForSport('Swim'), 'other');
  assert.deepEqual(findActivityList({ activities: [raw] }), [raw]);
  assert.deepEqual(findActivityList([raw]), [raw]);
  assert.equal(findActivityList('Text'), null);
  assert.equal(pace(52, 9.34), '5:34');
});

test('endurance: RPE suggestion from zones, average heart rate or nothing', () => {
  const zones = parseHrZones({ heart_rate: { custom_zones: false, zones: [{ min: 0, max: 115 }, { min: 115, max: 152 }, { min: 152, max: 171 }, { min: 171, max: 190 }, { min: 190, max: -1 }] } });
  assert.equal(zones.length, 5);
  assert.equal(zones[4].max, null);
  assert.deepEqual(suggestRpe({ zoneTimes: [0, 3000, 0, 0, 0], duration_min: 50 }), { rpe: 4, basis: 'zones' });
  assert.equal(suggestRpe({ zoneTimes: [0, 600, 600, 1800, 0], duration_min: 50 }).rpe, 7);
  const easy = suggestRpe({ avg_hr: 130, zones, duration_min: 45 });
  const hard = suggestRpe({ avg_hr: 178, zones, duration_min: 45 });
  assert.equal(easy.basis, 'avg_hr_zones');
  assert.ok(easy.rpe >= 3 && easy.rpe <= 5);
  assert.ok(hard.rpe >= 7 && hard.rpe <= 9);
  assert.ok(suggestRpe({ avg_hr: 130, zones, duration_min: 200 }).rpe > easy.rpe); // long efforts weigh more
  assert.equal(suggestRpe({ avg_hr: 150, hrMax: 190, duration_min: 40 }).basis, 'hrmax');
  assert.deepEqual(suggestRpe({ duration_min: 40 }), { rpe: null, basis: 'none' });
});

test('tests: reference values and comparable series', () => {
  const refs = referenceTests();
  const hang = testValue(refs[0]);
  assert.equal(Math.round(hang.value), 149); // 25 mm, 5 s, +37 kg at 75 kg
  const series = testSeries([
    ...refs,
    { id: 't1', date: '2026-11-20', type: 'max_hang', protocol: { edge_mm: 25, time_s: 5, load_kg: 25 }, bodyweight_kg: 75 },
    { id: 't2', date: '2026-11-20', type: 'max_hang', protocol: { edge_mm: 20, time_s: 7, load_kg: 20 }, bodyweight_kg: 75 },
  ]);
  const keys = series.map(s => s.key);
  assert.deepEqual(keys.sort(), ['max_hang|20', 'max_hang|25', 'max_pullup']); // 20 mm and 25 mm never mixed
  const s25 = series.find(s => s.key === 'max_hang|25');
  assert.equal(s25.reference.test.id, 'ref-max-hang');
  assert.equal(s25.pts.length, 1);
  assert.equal(series.find(s => s.key === 'max_hang|20').reference, null);
});
