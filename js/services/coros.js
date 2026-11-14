// COROS import through the viewer's claude.ai connector (capability `mcp`).
//
// The arguments are the ones the tools' input schemas name (read 2026-11-14):
//   querySportRecords { startDate, endDate (yyyyMMdd), limit }
//   getActivityDetail { labelId (string), sportType (integer) }
// Both tools answer in formatted text; ../domain/coros.js reads it. The list
// has no paging, so the period is fetched in windows and a full window is split.
import { addDays, daysBetween, today } from '../domain/dates.js';
import { applyCorosDetail, normalizeCorosRecord, parseCorosDetail, parseCorosRecords } from '../domain/coros.js';
import { cap, wait } from './caps.js';

export const SERVER = 'Coros';
const TOOL = { list: 'querySportRecords', detail: 'getActivityDetail' };
const WINDOW_DAYS = 30;
const MAX_WINDOWS = 12;
const LIMIT = 100;
const MAX_DETAIL_CALLS = 40;
const DENIED = ['needs_reauth', 'server_not_connected', 'selection_required', 'not_in_manifest', 'blocked_by_policy', 'approval_required', 'not_granted', 'consent_required', 'capability_disabled', 'capability_removed'];

const ymd = date => date.replaceAll('-', '');

/** One read with at most one retry, and only when the error says so. */
async function read(mcp, tool, input, signal) {
  const run = () => mcp.callTool(SERVER, tool, input, { cache: false, signal });
  try { return await run(); }
  catch (e) {
    if (!e?.retryable) throw e;
    await wait(Math.min(e.retryAfterMs ?? 0, 15000) || 600 + Math.random() * 900);
    return run();
  }
}

/** The text a tool answered with, wherever the result carries it. */
export function textOf(res) {
  const unquote = t => {
    if (!t.startsWith('"')) return t;
    try { const j = JSON.parse(t); return typeof j === 'string' ? j : t; } catch (_) { return t; }
  };
  const p = res?.payload;
  if (typeof p === 'string') return unquote(p);
  const blocks = (res?.content ?? []).filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text);
  if (blocks.length) return unquote(blocks.join('\n'));
  if (p && typeof p === 'object') {
    const strings = Object.values(p).filter(v => typeof v === 'string').sort((a, b) => b.length - a.length);
    if (strings.length) return strings[0];
  }
  return '';
}

/** [start, end] windows from today back to `since`, newest first. */
export function windowsSince(since, until) {
  const out = [];
  for (let end = until; end >= since && out.length < MAX_WINDOWS; end = addDays(end, -WINDOW_DAYS)) {
    const start = addDays(end, -(WINDOW_DAYS - 1));
    out.push([start < since ? since : start, end]);
  }
  return out;
}

/**
 * Fetch activities since `since` (YYYY-MM-DD).
 * @param knownIds   ids that are already stored – no detail call is spent on them
 * @param wantDetail which of the new activities are worth a detail call
 * @returns { activities, diagnostics, notes }
 */
export async function fetchActivities({ since, withDetails = true, knownIds = new Set(), wantDetail = () => true, onProgress = () => {}, signal } = {}) {
  const mcp = await cap('mcp');
  if (!mcp) throw Object.assign(new Error('Kein Connector-Zugriff in dieser Ansicht.'), { code: 'capability_disabled' });
  const notes = [];
  const until = today();
  const from = since && since <= until ? since : addDays(until, -60);
  const diagnostics = { server: SERVER, since: from, calls: [] };

  async function fetchWindow(start, end, depth = 0) {
    const res = await read(mcp, TOOL.list, { startDate: ymd(start), endDate: ymd(end), limit: LIMIT }, signal);
    const text = textOf(res);
    const { records, announced } = parseCorosRecords(text);
    diagnostics.calls.push({ tool: TOOL.list, from: start, to: end, records: records.length, announced, ...(records.length ? {} : { reply: text.slice(0, 120) }) });
    if (!records.length && /labelid/i.test(text)) {
      diagnostics.unreadable = text.slice(0, 400);
      throw Object.assign(new Error('Die Antwort von Coros hat ein unbekanntes Format.'), { code: 'unknown_shape', diagnostics });
    }
    if (announced != null && announced > records.length) notes.push(`${announced - records.length} Einträge zwischen ${start} und ${end} konnten nicht gelesen werden.`);
    if (records.length >= LIMIT) {
      const span = daysBetween(start, end);
      if (span >= 1 && depth < 5) {
        const mid = addDays(start, Math.floor(span / 2));
        return [...await fetchWindow(addDays(mid, 1), end, depth + 1), ...await fetchWindow(start, mid, depth + 1)];
      }
      notes.push(`Zwischen ${start} und ${end} gibt es mehr Einträge, als Coros auf einmal liefert – die Liste kann dort unvollständig sein.`);
    }
    return records;
  }

  onProgress('Aktivitäten abrufen …');
  const wins = windowsSince(from, until);
  if (wins.at(-1)[0] > from) notes.push(`Es wurden nur die Aktivitäten seit ${wins.at(-1)[0]} abgerufen. Für ältere wähle den Zeitraum in mehreren Schritten.`);
  const seen = new Set();
  const activities = [];
  let unreadable = 0;
  for (const [start, end] of wins) {
    for (const rec of await fetchWindow(start, end)) {
      const a = normalizeCorosRecord(rec);
      if (!a) { unreadable++; continue; }
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      activities.push(a);
    }
    onProgress(`${activities.length} Aktivitäten geladen …`);
  }
  if (unreadable) notes.push(`${unreadable} Einträge ohne Coros-ID oder Datum wurden übersprungen.`);
  activities.sort((a, b) => b.date.localeCompare(a.date) || String(b.startTime ?? '').localeCompare(String(a.startTime ?? '')));

  if (withDetails) {
    const fresh = activities.filter(a => !knownIds.has(a.id) && a.corosSportType != null && wantDetail(a));
    const todo = fresh.slice(0, MAX_DETAIL_CALLS);
    let done = 0, failed = 0;
    for (const a of todo) {
      if (signal?.aborted) break;
      onProgress(`Belastungsdaten ${++done} von ${todo.length} …`);
      try {
        const detail = parseCorosDetail(textOf(await read(mcp, TOOL.detail, { labelId: a.corosId, sportType: a.corosSportType }, signal)));
        diagnostics.detailFields ??= detail.fields;
        if (!detail.fields.length) { failed++; continue; }
        applyCorosDetail(a, detail);
      } catch (e) {
        if (e?.code === 'cancelled') break;
        failed++;
        diagnostics.calls.push({ tool: TOOL.detail, ok: false, code: e?.code ?? null });
        if (DENIED.includes(e?.code)) { notes.push(`Belastungsdaten nicht erlaubt (${e.code}).`); break; }
      }
    }
    if (failed) notes.push(`Für ${failed === 1 ? 'eine Aktivität' : `${failed} Aktivitäten`} gab es keine Belastungsdaten. Einen RPE-Vorschlag gibt es dort nur, wenn in den Einstellungen deine maximale Herzfrequenz steht.`);
    if (fresh.length > todo.length) notes.push(`Belastungsdaten wurden nur für die neuesten ${MAX_DETAIL_CALLS} Aktivitäten geladen. Ein weiterer Abruf holt die nächsten.`);
  }
  return { activities, diagnostics, notes };
}

/** What the viewer should read for each connector error code. */
export function corosErrorMessage(e) {
  switch (e?.code) {
    case 'needs_reauth': return 'Die Verbindung zu Coros ist abgelaufen. Verbinde Coros in claude.ai unter Einstellungen → Connectors neu und starte den Abruf erneut.';
    case 'server_not_connected': return 'Coros ist nicht verbunden. Füge den Coros-Connector in claude.ai unter Einstellungen → Connectors hinzu.';
    case 'selection_required': return 'Du hast mehrere Coros-Connectors. Wähle in claude.ai einen aus und starte den Abruf erneut.';
    case 'server_not_found': return 'Der Coros-Connector existiert nicht mehr. Füge ihn in claude.ai neu hinzu.';
    case 'not_in_manifest':
    case 'consent_required':
    case 'not_granted': return 'Der Zugriff auf Coros wurde für diese Seite nicht erlaubt. Erlaube ihn im Berechtigungs-Menü des Artifacts.';
    case 'approval_required': return 'Der Abruf braucht deine Zustimmung. Starte ihn erneut und bestätige die Anfrage.';
    case 'blocked_by_policy': return 'Deine Organisation blockiert den Coros-Zugriff für diese Seite.';
    case 'server_unavailable':
    case 'rate_limited': return 'Coros antwortet gerade nicht. Versuche es in ein paar Minuten noch einmal.';
    case 'tool_error': return `Coros meldet einen Fehler: ${e.message ?? 'unbekannt'}`;
    case 'cancelled': return 'Abruf abgebrochen.';
    case 'capability_disabled':
    case 'capability_removed': return 'Der Coros-Abruf ist in dieser Ansicht nicht möglich. Öffne das Artifact direkt in claude.ai.';
    case 'unknown_shape': return 'Die Antwort von Coros hat ein unbekanntes Format. Die technischen Details unten helfen, die Zuordnung anzupassen.';
    default: return `Der Abruf ist fehlgeschlagen${e?.message ? `: ${e.message}` : '.'}`;
  }
}

export const defaultSince = lastSync => (lastSync ? addDays(lastSync, -2) : addDays(today(), -60));
