// Import of the free-text notes in `Hangboard.txt` → `hangboard_sessions`.
// Every source line is kept: recognised lines become blocks (with `raw`),
// everything else lands in the session notes and is flagged for review.

const NUM = String.raw`-?\d+(?:[.,]\d+)?`;
const toNum = s => Number(String(s).replace(',', '.'));
const pad = n => String(n).padStart(2, '0');

const HEADER_RE = /^(\d{1,2})\.(\d{1,2})\.?\s+(\S.*)$/;

function sessionType(word) {
  const w = word.toLowerCase().replace(/[\s_-]+/g, '');
  if (/^stre?ng/.test(w) || /^maxkraft|^maximalkraft/.test(w)) return 'Strength';
  if (/^power?end|^pe$|^repeater/.test(w)) return 'PowerEndurance';
  if (/^pull?ups?$|^klimmz/.test(w)) return 'PullUp';
  return null;
}

const GRIP_ALIASES = {
  halfcrimp: 'halfcrimp', half: 'halfcrimp', hc: 'halfcrimp',
  open: 'open', openhand: 'open', slope: 'slope', sloper: 'slope',
  fullcrimp: 'fullcrimp', full: 'fullcrimp', crimp: 'fullcrimp', pinch: 'pinch',
};
const gripOf = s => GRIP_ALIASES[String(s ?? '').toLowerCase().replace(/[\s_-]+/g, '')] ?? null;

const RE = {
  warmup: /warm\s*-?\s*up|aufw(ä|ae)rmen/i,
  protocol: new RegExp(String.raw`^(\d+)\s*s(?:ec)?\s*work\s+(${NUM})\s*(min|s)\s*pause$`, 'i'),
  strengthSet: new RegExp(String.raw`^(${NUM})\s*kg\s*[*x×]\s*(\d+)\s*(?:\(\s*([a-z\s-]+?)\s*\))?$`, 'i'),
  repeater: new RegExp(String.raw`^(\d+)\s*\/\s*(\d+)\s+(${NUM})\s*kg\s*[*x×]\s*(\d+)\s*(?:\(?\s*(\d+)\s*sets?\s*\)?)?$`, 'i'),
  repeaterSwitch: new RegExp(String.raw`^(\d+)\s*\/\s*(\d+)\s+(${NUM})\s*kg\s+switching\s+sides$`, 'i'),
  repeaterBoard: new RegExp(String.raw`^(\d+)\s*\/\s*(\d+)\s*[*x×]\s*(\d+)\s+hangboard\s+(${NUM})\s*kg\s*(?:\(?\s*(\d+)\s*sets?\s*\)?)?$`, 'i'),
  freeSwitch: /^(\d+)\s*s\s+switching\s+sides$/i,
  pullups: new RegExp(String.raw`^(\d+)\s*pull\s*-?\s*ups?\s*(\+?\s*${NUM})\s*kg$`, 'i'),
  pullupRest: new RegExp(String.raw`^work\s*\/\s*(${NUM})\s*(min|s)\s*pause$`, 'i'),
  sets: /^(\d+)\s*sets?$/i,
};

/**
 * @param text     file content
 * @param options  { year = 2026, defaultEdge = 20, strengthMode = 'lift_one_arm', defaultGrip = 'halfcrimp' }
 * @returns { sessions, stats }
 *   session: { id: 'hb-YYYYMMDD', date, type, warmup, blocks[], notes, raw, duration_min: null, rpe: null,
 *              review: [{ raw, reason }] }   – `review` is preview-only and not stored
 */
export function parseHangboardTxt(text, options = {}) {
  const { year = 2026, defaultEdge = 20, strengthMode = 'lift_one_arm', defaultGrip = 'halfcrimp' } = options;
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const sessions = [];
  const orphans = [];
  let cur = null, proto = null, lineCount = 0;

  const finish = () => {
    if (!cur) return;
    cur.raw = cur._raw.join('\n');
    cur.notes = cur._notes.join('\n');
    delete cur._raw; delete cur._notes;
    sessions.push(cur);
    cur = null; proto = null;
  };

  for (const original of lines) {
    const line = original.trim();
    if (!line) continue;
    lineCount++;
    const head = HEADER_RE.exec(line);
    const type = head ? sessionType(head[3]) : null;
    if (head && type) {
      finish();
      const date = `${year}-${pad(head[2])}-${pad(head[1])}`;
      cur = { id: `hb-${date.replaceAll('-', '')}`, date, type, warmup: false, blocks: [], duration_min: null, rpe: null, review: [], _raw: [line], _notes: [] };
      continue;
    }
    if (!cur) { orphans.push(line); continue; }
    cur._raw.push(line);
    const body = line.replace(/^[-–•*]\s*/, '').trim();
    const note = reason => { cur._notes.push(body); cur.review.push({ raw: line, reason }); };
    let m;

    if (RE.warmup.test(body) && body.length < 40) { cur.warmup = true; continue; }

    if ((m = RE.protocol.exec(body))) {
      proto = { work_s: Number(m[1]), rest_s: toNum(m[2]) * (m[3].toLowerCase() === 'min' ? 60 : 1) };
      continue;
    }
    if ((m = RE.repeaterBoard.exec(body))) {
      cur.blocks.push({ mode: 'hang_two_arm', work_s: Number(m[1]), rest_s: Number(m[2]), edge_mm: defaultEdge, grip: defaultGrip, load_kg: toNum(m[4]), reps: Number(m[3]), sets: Number(m[5] ?? 1), side: 'both', switching: false, raw: line });
      continue;
    }
    if ((m = RE.repeater.exec(body))) {
      cur.blocks.push({ mode: 'lift_one_arm', work_s: Number(m[1]), rest_s: Number(m[2]), edge_mm: defaultEdge, grip: defaultGrip, load_kg: toNum(m[3]), reps: Number(m[4]), sets: Number(m[5] ?? 1), side: 'each', switching: false, raw: line });
      continue;
    }
    if ((m = RE.repeaterSwitch.exec(body))) {
      cur.blocks.push({ mode: 'lift_one_arm', work_s: Number(m[1]), rest_s: Number(m[2]), edge_mm: defaultEdge, grip: defaultGrip, load_kg: toNum(m[3]), reps: null, sets: 1, side: 'alternating', switching: true, raw: line });
      cur.review.push({ raw: line, reason: 'Wiederholungen unbekannt' });
      continue;
    }
    if ((m = RE.freeSwitch.exec(body))) { note('Freier Block – bitte prüfen'); continue; }
    if ((m = RE.strengthSet.exec(body))) {
      const grip = m[3] ? gripOf(m[3]) : defaultGrip;
      if (m[3] && !grip) { note(`Griffart „${m[3]}“ unbekannt`); continue; }
      const mode = cur.type === 'Strength' ? strengthMode : 'lift_one_arm';
      cur.blocks.push({ mode, work_s: proto?.work_s ?? null, rest_s: proto?.rest_s ?? null, edge_mm: defaultEdge, grip, load_kg: toNum(m[1]), reps: Number(m[2]), sets: 1, side: mode === 'lift_one_arm' ? 'each' : 'both', switching: false, raw: line });
      if (cur.type === 'Strength' && !proto) cur.review.push({ raw: line, reason: 'Hängezeit und Pause nicht angegeben' });
      continue;
    }
    if ((m = RE.pullups.exec(body))) {
      cur.blocks.push({ mode: 'pullup', work_s: null, rest_s: null, edge_mm: null, grip: null, load_kg: toNum(m[2].replace(/[+\s]/g, '')), reps: Number(m[1]), sets: 1, side: 'both', switching: false, raw: line });
      continue;
    }
    const last = cur.blocks[cur.blocks.length - 1];
    if ((m = RE.pullupRest.exec(body)) && last) {
      last.rest_s = toNum(m[1]) * (m[2].toLowerCase() === 'min' ? 60 : 1);
      last.raw += `\n${line}`;
      continue;
    }
    if ((m = RE.sets.exec(body)) && last) {
      last.sets = Number(m[1]);
      last.raw += `\n${line}`;
      continue;
    }
    note('Zeile nicht erkannt');
  }
  finish();

  // Two sessions on the same day must not share an id.
  const ids = new Map();
  for (const s of sessions) {
    const n = (ids.get(s.id) ?? 0) + 1;
    ids.set(s.id, n);
    if (n > 1) s.id = `${s.id}-${n}`;
  }

  return {
    sessions,
    orphans,
    stats: {
      lines: lineCount,
      sessions: sessions.length,
      blocks: sessions.reduce((a, s) => a + s.blocks.length, 0),
      review: sessions.reduce((a, s) => a + s.review.length, 0) + orphans.length,
      byType: sessions.reduce((a, s) => ({ ...a, [s.type]: (a[s.type] ?? 0) + 1 }), {}),
    },
  };
}

/** Strip preview-only fields before a session is stored. */
export function toDocument(session) {
  const { review, ...doc } = session;
  return doc;
}
