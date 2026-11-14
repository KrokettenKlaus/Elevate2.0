// Date helpers. All dates are plain `YYYY-MM-DD` strings; arithmetic runs in UTC
// so that daylight-saving changes can never shift a day.

export const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const MSHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_LABELS = { mon: 'Mo', tue: 'Di', wed: 'Mi', thu: 'Do', fri: 'Fr', sat: 'Sa', sun: 'So' };
export const DAY_LONG = { mon: 'Montag', tue: 'Dienstag', wed: 'Mittwoch', thu: 'Donnerstag', fri: 'Freitag', sat: 'Samstag', sun: 'Sonntag' };

const DAY_MS = 864e5;
const pad = n => String(n).padStart(2, '0');

export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUTC(s));

export function toUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export const fromUTC = ms => new Date(ms).toISOString().slice(0, 10);

/** Local calendar date of a JS Date as `YYYY-MM-DD`. */
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const nowIso = () => new Date().toISOString();

export const addDays = (s, n) => fromUTC(toUTC(s) + n * DAY_MS);
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
/** 0 = Sunday … 6 = Saturday */
export const weekday = s => new Date(toUTC(s)).getUTCDay();
/** Monday of the week containing `s`. */
export const weekStart = s => addDays(s, -((weekday(s) + 6) % 7));
export const weekDates = ws => Array.from({ length: 7 }, (_, i) => addDays(ws, i));
export const dayKey = s => DAY_KEYS[(weekday(s) + 6) % 7];

export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** ISO-8601 week number. */
export function isoWeek(s) {
  const thursday = addDays(weekStart(s), 3);
  const year = Number(thursday.slice(0, 4));
  const firstThursday = addDays(weekStart(`${year}-01-04`), 3);
  return { year, week: 1 + Math.round(daysBetween(firstThursday, thursday) / 7) };
}

/** Is `date` inside the yearly window `MM-DD`…`MM-DD` (may wrap over new year)? */
export function inSeason(date, fromMD, toMD) {
  if (!fromMD || !toMD) return false;
  const md = date.slice(5);
  return fromMD <= toMD ? md >= fromMD && md <= toMD : md >= fromMD || md <= toMD;
}

export const wd = s => WD[weekday(s)];
export const fmtD = s => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
export const fmtDs = s => `${s.slice(8, 10)}.${s.slice(5, 7)}.`;
export const fmtDay = s => `${wd(s)}, ${fmtD(s)}`;
export const monthLabel = s => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;

/** "heute", "gestern", "vor 5 Tagen" */
export function relDay(s, ref = today()) {
  const n = daysBetween(s, ref);
  if (n === 0) return 'heute';
  if (n === 1) return 'gestern';
  if (n === -1) return 'morgen';
  if (n > 1) return `vor ${n} Tagen`;
  return `in ${-n} Tagen`;
}
