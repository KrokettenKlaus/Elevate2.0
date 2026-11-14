// COROS: the connector answers in formatted text, not JSON. These parsers read
// the lines the COROS tools print (`querySportRecords`, `getActivityDetail`)
// and ignore everything they do not know. Nothing is guessed: a record without
// a labelId or a date is dropped.
import { moduleForSport } from './endurance.js';

/** COROS sport type codes that belong to running and cycling here. Everything else stays "other". */
const SPORT_BY_CODE = {
  100: 'Run', 101: 'Run', 102: 'TrailRun', 103: 'Run',
  200: 'Ride', 201: 'VirtualRide', 203: 'GravelRide', 204: 'MountainBikeRide', 299: 'Ride',
};

const HEADER = /^\s*\d+\.\s+(.+?)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})\s*$/;
const firstNumber = v => { const m = /-?\d+(?:\.\d+)?/.exec(String(v ?? '')); return m ? Number(m[0]) : null; };

/** "51:42" → 52, "2:07:47" → 128 (minutes, rounded). Two parts are minutes and seconds. */
export function parseDurationMin(v) {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?/.exec(String(v ?? '').trim());
  if (!m) return null;
  const secs = m[3] != null ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
  return Math.round(secs / 60);
}

/** "9.48 km" → 9.48, "244 m" → 0.24 */
function parseDistanceKm(v) {
  const m = /^(-?\d+(?:\.\d+)?)\s*(km|m)\b/i.exec(String(v ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].toLowerCase() === 'km' ? n : Math.round(n / 10) / 100;
}

/** Key/value pairs of one printed line: "A: 1 | B: 2" and "x=1 | y=2". Keys are lower-cased. */
function readLine(line, into) {
  for (const part of line.split('|')) {
    const p = part.trim();
    if (!p) continue;
    for (const m of p.matchAll(/([A-Za-z]+)=([^\s|]+)/g)) into[m[1].toLowerCase()] = m[2];
    const i = p.indexOf(':');
    if (i > 0) into[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim();
  }
}

/**
 * Read the answer of `querySportRecords`.
 * @returns { records: [{ sportName, date, fields }], announced: number | null }
 *   announced – the count the header line states ("(62 records)"), if any
 */
export function parseCorosRecords(text) {
  const records = [];
  let cur = null;
  const lines = String(text ?? '').split(/\r?\n/);
  for (const line of lines) {
    const head = HEADER.exec(line);
    if (head) { cur = { sportName: head[1].trim(), date: head[2], fields: {} }; records.push(cur); continue; }
    if (cur) readLine(line, cur.fields);
  }
  const count = /\((\d+)\s+records?\)/i.exec(lines.slice(0, 3).join(' '));
  return { records, announced: count ? Number(count[1]) : null };
}

/** Map one parsed record to an endurance document. Returns null without a labelId or a date. */
export function normalizeCorosRecord(rec) {
  const f = rec?.fields ?? {};
  const labelId = f.labelid;
  if (!labelId || !/^\d+$/.test(labelId) || !/^\d{4}-\d{2}-\d{2}$/.test(rec.date ?? '')) return null;
  const code = firstNumber(f.sporttype);
  const sport = SPORT_BY_CODE[code] ?? rec.sportName;
  const startTs = firstNumber(f.starttimestamp);
  const calories = firstNumber(f.calories);
  return {
    id: `coros-${labelId}`,
    source: 'coros',
    corosId: labelId,               // stays a string: the number is larger than JavaScript can hold exactly
    corosSportType: code,
    date: rec.date,
    startTime: startTs > 0 ? new Date(startTs * 1000).toISOString() : null,
    sport,
    module: moduleForSport(sport),
    name: f.location || rec.sportName,
    duration_min: parseDurationMin(f.duration),
    distance_km: parseDistanceKm(f.distance),
    elevation_m: null,
    avg_hr: firstNumber(f['avg hr']),
    max_hr: null,
    loadRaw: calories != null ? { calories } : null,
  };
}

/**
 * Read the answer of `getActivityDetail`: one "Key: value" per line.
 * Only values that are present are returned; `fields` lists every key seen.
 */
export function parseCorosDetail(text) {
  const f = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) f[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const positive = v => { const n = firstNumber(v); return n != null && n > 0 ? n : null; };
  const out = {
    elevation_m: firstNumber(f['elevation gain / loss'] ?? f['elevation gain']),
    trainingLoad: positive(f['training load']),
    aerobicTE: positive(f['aerobic te']),
    anaerobicTE: firstNumber(f['anaerobic te']),
    focus: f['training focus'] || null,
    avg_hr: positive(f['average heart rate']),
    max_hr: positive(f['max heart rate'] ?? f['maximum heart rate']),
  };
  return { ...Object.fromEntries(Object.entries(out).filter(([, v]) => v != null)), fields: Object.keys(f) };
}

/** Merge what `getActivityDetail` knows into an activity from the list. */
export function applyCorosDetail(act, detail) {
  if (detail.elevation_m != null) act.elevation_m = detail.elevation_m;
  if (detail.max_hr != null) act.max_hr = detail.max_hr;
  act.avg_hr ??= detail.avg_hr ?? null;
  if (detail.trainingLoad != null) act.trainingLoad = detail.trainingLoad;
  const raw = { ...(act.loadRaw ?? {}) };
  if (detail.trainingLoad != null) raw.training_load = detail.trainingLoad;
  if (detail.aerobicTE != null) raw.aerobic_te = detail.aerobicTE;
  if (detail.anaerobicTE != null) raw.anaerobic_te = detail.anaerobicTE;
  if (detail.focus) raw.focus = detail.focus;
  act.loadRaw = Object.keys(raw).length ? raw : null;
  return act;
}
