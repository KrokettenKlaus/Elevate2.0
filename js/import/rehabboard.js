// Import of RehabBoard's `data/sessions.json` → `strength_sessions` (1:1).
// Ids stay `s-…`, `raw` stays on the exercises, names are never changed.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function testTypeFor(name) {
  const n = name.toLowerCase();
  if (/pull\s*-?\s*up/.test(n) || /klimmzug/.test(n)) return 'pullup_test';
  if (/st(ü|ue)tz/.test(n)) return 'stuetz_test';
  return 'custom';
}
const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'test';

/**
 * @param input  parsed JSON or the raw file text
 * @returns { sessions, tests, errors, stats }
 *   sessions – documents for `strength_sessions`, deep copies of the source
 *   tests    – proposals for `tests` from free exercises of category "Test"
 */
export function parseRehabBoard(input) {
  const errors = [];
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input.replace(/^﻿/, '')); }
    catch (e) { return { sessions: [], tests: [], errors: [`Datei ist kein gültiges JSON: ${e.message}`], stats: null }; }
  }
  const list = Array.isArray(data) ? data : data?.sessions;
  if (!Array.isArray(list)) return { sessions: [], tests: [], errors: ['Kein Feld „sessions“ gefunden – ist das die RehabBoard-Datei?'], stats: null };

  const sessions = [], tests = [], seen = new Set();
  list.forEach((src, i) => {
    const where = `Sitzung ${i + 1}${src?.date ? ` (${src.date})` : ''}`;
    if (!src || typeof src !== 'object') return errors.push(`${where}: kein Objekt`);
    if (typeof src.id !== 'string' || !src.id) return errors.push(`${where}: ohne id`);
    if (seen.has(src.id)) return errors.push(`${where}: id „${src.id}“ doppelt`);
    if (!DATE_RE.test(src.date ?? '')) return errors.push(`${where}: ungültiges Datum`);
    if (!Array.isArray(src.exercises)) return errors.push(`${where}: ohne Übungen`);
    seen.add(src.id);
    const s = JSON.parse(JSON.stringify(src)); // 1:1 copy, unknown fields included
    if (s.kind !== 'physio') s.kind = 'home';
    if (typeof s.notes !== 'string') s.notes = '';
    sessions.push(s);

    for (const e of s.exercises) {
      if (e.type !== 'free' || e.category !== 'Test') continue;
      const type = testTypeFor(e.name);
      tests.push({
        id: `t-${s.id}-${slug(e.name)}`,
        date: s.date,
        type,
        ...(type === 'custom' ? { name: e.name } : {}),
        protocol: { text: e.description || '' },
        result: '',
        bodyweight_kg: null,
        note: `Aus Kraft & Prävention vom ${s.date.slice(8)}.${s.date.slice(5, 7)}.${s.date.slice(0, 4)} übernommen.`,
        sourceSessionId: s.id,
        sourceName: e.name,
      });
    }
  });

  const dates = sessions.map(s => s.date).sort();
  return {
    sessions, tests, errors,
    stats: {
      total: sessions.length,
      home: sessions.filter(s => s.kind === 'home').length,
      physio: sessions.filter(s => s.kind === 'physio').length,
      exercises: sessions.reduce((a, s) => a + s.exercises.length, 0),
      from: dates[0] ?? null, to: dates[dates.length - 1] ?? null,
    },
  };
}
