// COROS: the connector answers in formatted text. The samples below copy the
// printed layout with made-up values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCorosDetail, normalizeCorosRecord, parseCorosDetail, parseCorosRecords, parseDurationMin } from '../js/domain/coros.js';
import { suggestRpe } from '../js/domain/endurance.js';

const LIST = [
  'Sport Records — 2026-09-01 to 2026-09-30 (5 records)',
  '========================',
  '',
  '1. Outdoor Run — 2026-09-28',
  '   Location: Musterstadt Laufen',
  '   Start Coordinates: 47.000000, 11.000000',
  '   Time Window: startTimestamp=1790582400 | endTimestamp=1790585600',
  '   Duration: 47:20 | Distance: 8.60 km',
  '   Average Pace: 5:30 /km | Avg HR: 150 bpm | Calories: 600 kcal',
  '   LabelId: 400000000000000101 | SportType: 100',
  '',
  '2. Cycling — 2026-09-27',
  '   Location: Musterstadt Rennrad',
  '   Time Window: startTimestamp=1790496000 | endTimestamp=1790516000',
  '   Duration: 3:30:00 | Distance: 80.00 km',
  '   Average Speed: 22.9 km/h | Avg HR: 125 bpm | Calories: 1500 kcal',
  '   LabelId: 400000000000000202 | SportType: 200',
  '',
  '3. Strength — 2026-09-26',
  '   Location: Kraft',
  '   Time Window: startTimestamp=1790409600 | endTimestamp=1790412700',
  '   Duration: 45:00 | Sets: 12',
  ' | Avg HR: 90 bpm | Calories: 150 kcal',
  '   LabelId: 400000000000000303 | SportType: 402',
  '',
  '4. Hike — 2026-09-25',
  '   Location: Musterberg Wandern',
  '   Duration: 4:10 | Distance: 350 m',
  '   Average Speed: 5.0 km/h | Avg HR: 92 bpm | Calories: 15 kcal',
  '   LabelId: 400000000000000404 | SportType: 104',
  '',
  '5. Gym Cardio — 2026-09-24',
  '   Location: Cardio Indoor',
  '   Duration: 30:00',
  ' | Avg HR: 120 bpm | Calories: 200 kcal',
].join('\n');

test('coros: the activity list is read from the printed text', () => {
  const { records, announced } = parseCorosRecords(LIST);
  assert.equal(announced, 5);
  assert.equal(records.length, 5);
  const [run, ride, strength, hike] = records.map(normalizeCorosRecord);

  assert.equal(run.id, 'coros-400000000000000101');
  assert.equal(run.corosId, '400000000000000101'); // kept as text, too large for a number
  assert.equal(run.corosSportType, 100);
  assert.equal(run.source, 'coros');
  assert.equal(run.date, '2026-09-28');
  assert.equal(run.startTime, new Date(1790582400 * 1000).toISOString());
  assert.equal(run.sport, 'Run');
  assert.equal(run.module, 'run');
  assert.equal(run.name, 'Musterstadt Laufen');
  assert.equal(run.duration_min, 47);
  assert.equal(run.distance_km, 8.6);
  assert.equal(run.avg_hr, 150);
  assert.deepEqual(run.loadRaw, { calories: 600 });

  assert.equal(ride.module, 'ride');
  assert.equal(ride.duration_min, 210);
  assert.equal(ride.distance_km, 80);

  assert.equal(strength.module, 'other');
  assert.equal(strength.sport, 'Strength');
  assert.equal(strength.distance_km, null);
  assert.equal(strength.avg_hr, 90); // from the line that starts with " | "

  assert.equal(hike.module, 'other');
  assert.equal(hike.distance_km, 0.35);
  assert.equal(hike.duration_min, 4);
  assert.equal(hike.startTime, null);

  assert.equal(normalizeCorosRecord(records[4]), null, 'no labelId – nothing is guessed');
});

test('coros: empty and foreign answers yield no records', () => {
  assert.deepEqual(parseCorosRecords('No sport records found from 2020-01-01 to 2020-01-07.'), { records: [], announced: null });
  assert.deepEqual(parseCorosRecords(null), { records: [], announced: null });
  assert.equal(parseDurationMin('1:20:00'), 80);
  assert.equal(parseDurationMin('9:40'), 10);
  assert.equal(parseDurationMin('–'), null);
});

test('coros: activity detail adds elevation and training load, and drives the RPE suggestion', () => {
  const detail = parseCorosDetail([
    '🏃 Outdoor Run Activity Details', '========================================', '',
    'Workout Time: 47:20', 'Distance: 8.60 km', 'Average Heart Rate: 150 bpm',
    'Elevation Gain / Loss: 80 m / 82 m', 'Calories: 600 kcal', 'Training Load: 100',
    'Aerobic TE: 3.0', 'Anaerobic TE: 1.0', 'Training Focus: Tempo', 'Performance: -1',
  ].join('\n'));
  assert.equal(detail.elevation_m, 80);
  assert.equal(detail.trainingLoad, 100);
  assert.equal(detail.aerobicTE, 3);
  assert.equal(detail.focus, 'Tempo');
  assert.equal('max_hr' in detail, false);

  const act = applyCorosDetail(normalizeCorosRecord(parseCorosRecords(LIST).records[0]), detail);
  assert.equal(act.elevation_m, 80);
  assert.deepEqual(act.loadRaw, { calories: 600, training_load: 100, aerobic_te: 3, anaerobic_te: 1, focus: 'Tempo' });

  assert.deepEqual(suggestRpe(act), { rpe: 6, basis: 'load' });                                     // about 127 load per hour
  assert.deepEqual(suggestRpe({ trainingLoad: 200, duration_min: 240 }), { rpe: 5, basis: 'load' }); // easy, but long
  assert.equal(suggestRpe({ trainingLoad: 30, duration_min: 60 }).rpe, 3);
  assert.equal(suggestRpe({ trainingLoad: 200, duration_min: 60 }).rpe, 9);
  assert.equal(suggestRpe({ avg_hr: 150, hrMax: 190, duration_min: 40 }).basis, 'hrmax');           // no load: heart rate decides
  assert.deepEqual(parseCorosDetail('').fields, []);
});

test('coros: result text and fetch windows', async () => {
  const { textOf, windowsSince } = await import('../js/services/coros.js');
  assert.equal(textOf({ payload: 'abc' }), 'abc');
  assert.equal(textOf({ payload: '"a\\nb"' }), 'a\nb');
  assert.equal(textOf({ content: [{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }] }), 'x\ny');
  assert.equal(textOf({ payload: { result: 'langer Text', n: 1 } }), 'langer Text');
  assert.equal(textOf(null), '');

  assert.deepEqual(windowsSince('2026-11-01', '2026-11-14'), [['2026-11-01', '2026-11-14']]);
  const wins = windowsSince('2026-09-01', '2026-11-14');
  assert.deepEqual(wins[0], ['2026-10-16', '2026-11-14']);
  assert.deepEqual(wins.at(-1), ['2026-09-01', '2026-09-15']);
  for (let i = 1; i < wins.length; i++) assert.equal(wins[i][1] < wins[i - 1][0], true, 'windows do not overlap');
  assert.equal(windowsSince('2020-01-01', '2026-11-14').length, 12);
});
