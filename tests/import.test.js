// The parsers are tested against the real source files (read-only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseRehabBoard } from '../js/import/rehabboard.js';
import { parseHangboardTxt, toDocument } from '../js/import/hangboardTxt.js';

const path = rel => fileURLToPath(new URL(rel, import.meta.url));
const REHAB = path('../../RehabBoard/data/sessions.json');
const HANG = path('../Hangboard.txt');

test('RehabBoard: exactly 61 sessions, copied 1:1 with unchanged names', { skip: !existsSync(REHAB) && 'RehabBoard data not found' }, () => {
  const text = readFileSync(REHAB, 'utf8');
  const source = JSON.parse(text);
  const { sessions, tests, errors, stats } = parseRehabBoard(text);

  assert.deepEqual(errors, []);
  assert.equal(sessions.length, 61);
  assert.deepEqual({ home: stats.home, physio: stats.physio }, { home: 55, physio: 6 });
  assert.equal(stats.from, '2026-07-27');
  assert.equal(stats.to, '2026-11-12');
  assert.deepEqual(sessions, source.sessions);             // 1:1, including `raw` and ids
  assert.notEqual(sessions[0], source.sessions[0]);        // but a copy
  assert.ok(sessions.every(s => s.id.startsWith('s-')));

  const names = s => s.flatMap(x => x.exercises.map(e => e.name));
  assert.deepEqual(names(sessions), names(source.sessions));
  const all = new Set(names(sessions));
  assert.ok(all.has('Innenrotation'), 'Innenrotation exists');
  assert.equal(sessions.reduce((a, s) => a + s.exercises.filter(e => e.raw).length, 0), 278);

  // "Test" exercises stay in the session and are proposed as tests
  assert.deepEqual(tests.map(t => [t.date, t.type, t.sourceName]), [
    ['2026-08-26', 'stuetz_test', 'Stütz-Test'],
    ['2026-08-26', 'pullup_test', 'Pullup-Test'],
  ]);
  assert.equal(new Set(tests.map(t => t.id)).size, 2);
  assert.ok(tests.every(t => /^[A-Za-z0-9_.~:@+-]+$/.test(t.id)), 'ids are valid document ids');
});

test('RehabBoard: broken input is reported, not thrown', () => {
  assert.equal(parseRehabBoard('{nope').errors.length, 1);
  assert.equal(parseRehabBoard('{"foo":1}').errors.length, 1);
  const r = parseRehabBoard({ sessions: [{ id: 's-1', date: '2026-01-01', kind: 'home', notes: '', exercises: [] }, { id: 's-1', date: '2026-01-02', exercises: [] }, { date: 'x' }] });
  assert.equal(r.sessions.length, 1);
  assert.equal(r.errors.length, 2);
});

test('Hangboard.txt: all 16 headers recognised, no line silently dropped', { skip: !existsSync(HANG) && 'Hangboard.txt not found' }, () => {
  const text = readFileSync(HANG, 'utf8');
  const { sessions, orphans, stats } = parseHangboardTxt(text);

  assert.equal(sessions.length, 16);
  assert.deepEqual(orphans, []);
  assert.deepEqual(stats.byType, { Strength: 5, PowerEndurance: 10, PullUp: 1 });
  assert.equal(sessions[0].id, 'hb-20260906');
  assert.equal(sessions.at(-1).id, 'hb-20261112');
  assert.equal(new Set(sessions.map(s => s.id)).size, 16);
  assert.ok(sessions.every(s => s.warmup), 'every session has a warm-up line');

  // every non-empty source line is accounted for in exactly one session's raw text
  const sourceLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  assert.deepEqual(sessions.flatMap(s => s.raw.split('\n')), sourceLines);
  assert.equal(stats.lines, sourceLines.length);

  // every line is a header, a warm-up, a protocol line, part of a block, or flagged in the notes
  for (const s of sessions) {
    const inBlocks = s.blocks.flatMap(b => b.raw.split('\n'));
    const inNotes = s.notes ? s.notes.split('\n') : [];
    for (const line of s.raw.split('\n').slice(1)) {
      const body = line.replace(/^-\s*/, '');
      const known = /warmup/i.test(line) || /s work \d+ min pause/.test(line) || inBlocks.includes(line) || inNotes.includes(body);
      assert.ok(known, `line accounted for: "${line}" (${s.id})`);
    }
    for (const n of inNotes) assert.ok(s.review.some(r => r.raw.includes(n)), `note is flagged for review: "${n}"`);
  }
});

test('Hangboard.txt: the documented patterns', { skip: !existsSync(HANG) && 'Hangboard.txt not found' }, () => {
  const { sessions } = parseHangboardTxt(readFileSync(HANG, 'utf8'));
  const get = id => sessions.find(s => s.id === id);
  const strip = b => { const { raw, ...rest } = b; return rest; };

  // 06.09. Strengh · 7 s work 3 min pause · 18kg * 4 (halfcrimp) · 6kg * 4 (open)
  const s0906 = get('hb-20260906');
  assert.equal(s0906.type, 'Strength');
  assert.equal(s0906.date, '2026-09-06');
  assert.deepEqual(strip(s0906.blocks[0]), { mode: 'lift_one_arm', work_s: 7, rest_s: 180, edge_mm: 20, grip: 'halfcrimp', load_kg: 18, reps: 4, sets: 1, side: 'each', switching: false });
  assert.equal(s0906.blocks[0].raw, '- 18kg * 4 (halfcrimp)');
  assert.equal(s0906.blocks[1].grip, 'open');
  assert.equal(s0906.blocks[1].load_kg, 6);

  // 27.09. · 5 s work · open + slope
  assert.deepEqual(get('hb-20260927').blocks.map(b => [b.work_s, b.grip, b.load_kg]), [[5, 'open', 10], [5, 'slope', 16]]);

  // 10.09. PowerEndurance · 7/3 25kg*24 · 7/3 22kg*30 · 7/3 22kg switching sides
  const s0910 = get('hb-20260910');
  assert.deepEqual(strip(s0910.blocks[0]), { mode: 'lift_one_arm', work_s: 7, rest_s: 3, edge_mm: 20, grip: 'halfcrimp', load_kg: 25, reps: 24, sets: 1, side: 'each', switching: false });
  assert.equal(s0910.blocks[1].reps, 30);
  assert.deepEqual([s0910.blocks[2].switching, s0910.blocks[2].reps, s0910.blocks[2].load_kg], [true, null, 22]);
  assert.ok(s0910.review.some(r => /Wiederholungen unbekannt/.test(r.reason)));

  // set counts: "(2sets)", "2sets", "3sets"
  assert.deepEqual([get('hb-20260924').blocks[0].rest_s, get('hb-20260924').blocks[0].sets], [2, 2]);
  assert.equal(get('hb-20261015').blocks[0].sets, 2);
  assert.equal(get('hb-20261022').blocks[0].sets, 3);
  assert.equal(get('hb-20260917').blocks[0].sets, 1);

  // 01.10. "20s switching sides" → note, flagged
  const s1001 = get('hb-20261001');
  assert.equal(s1001.blocks.length, 1);
  assert.equal(s1001.notes, '20s switching sides');
  assert.equal(s1001.review.length, 1);

  // 25.10. Strength without a protocol line → flagged
  const s1025 = get('hb-20261025');
  assert.equal(s1025.blocks[0].work_s, null);
  assert.equal(s1025.review.length, 2);

  // 29.10. "7/3 * 20 Hangboard -10kg 3sets" → two-arm hang, assisted
  assert.deepEqual(strip(get('hb-20261029').blocks[0]), { mode: 'hang_two_arm', work_s: 7, rest_s: 3, edge_mm: 20, grip: 'halfcrimp', load_kg: -10, reps: 20, sets: 3, side: 'both', switching: false });

  // 01.11. PullUp · 5 Pullups +19kg · Work / 3min Pause · 6 sets
  const s1101 = get('hb-20261101');
  assert.equal(s1101.type, 'PullUp');
  assert.deepEqual(strip(s1101.blocks[0]), { mode: 'pullup', work_s: null, rest_s: 180, edge_mm: null, grip: null, load_kg: 19, reps: 5, sets: 6, side: 'both', switching: false });
  assert.equal(s1101.blocks[0].raw, '5 Pullups +19kg\nWork / 3min Pause\n6 sets');
  assert.equal(s1101.notes, '');

  assert.equal('review' in toDocument(s1101), false);
});

test('Hangboard.txt: options and unknown lines', () => {
  const text = 'Vorspann\n3.1. Strength\n- 5 s work 2 min pause\n- 12,5kg x 3 (Half Crimp)\n- irgendwas Neues\n\n3.1. PE\n- 7/3 20kg*10';
  const { sessions, orphans, stats } = parseHangboardTxt(text, { year: 2027, strengthMode: 'hang_two_arm', defaultEdge: 18 });
  assert.deepEqual(orphans, ['Vorspann']);
  assert.deepEqual(sessions.map(s => s.id), ['hb-20270103', 'hb-20270103-2']);
  const b = sessions[0].blocks[0];
  assert.deepEqual([b.mode, b.side, b.load_kg, b.grip, b.edge_mm, b.rest_s], ['hang_two_arm', 'both', 12.5, 'halfcrimp', 18, 120]);
  assert.equal(sessions[0].notes, 'irgendwas Neues');
  assert.equal(sessions[1].blocks[0].mode, 'lift_one_arm'); // PowerEndurance with kg stays a one-arm lift
  assert.equal(stats.review, 2);
});
