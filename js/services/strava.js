// Strava import through the viewer's claude.ai connector (capability `mcp`).
//
// The argument names of the Strava tools are not known at build time and are
// never guessed: the page reads each tool's input schema with `describeTool`
// and only sends arguments that the schema names. Without a schema the list
// tool is called without arguments and the result is filtered here.
import { addDays, today, toUTC } from '../domain/dates.js';
import { findActivityList, normalizeStravaActivity, parseHrZones, parseZoneTimes } from '../domain/endurance.js';
import { cap, wait } from './caps.js';

export const SERVER = 'Strava';
const TOOL = { list: 'list_activities', perf: 'get_activity_performance', zones: 'get_athlete_zones' };
const MAX_PAGES = 8;
const MAX_DETAIL_CALLS = 30;

export const stravaAvailable = async () => !!(await cap('mcp'));

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

async function schemaOf(mcp, tool) {
  try { return (await mcp.describeTool(SERVER, tool))?.inputSchema ?? null; }
  catch (_) { return null; }
}

const propNames = schema => Object.keys(schema?.properties ?? {});
const findProp = (schema, candidates) => candidates.find(c => propNames(schema).includes(c)) ?? null;

/** Encode a date for a schema property: epoch seconds for numbers, ISO text otherwise. */
function encodeDate(prop, date) {
  const type = Array.isArray(prop?.type) ? prop.type.find(t => t !== 'null') : prop?.type;
  const epoch = Math.floor(toUTC(date) / 1000);
  if (type === 'integer' || type === 'number') return epoch;
  const text = `${prop?.description ?? ''} ${prop?.format ?? ''}`.toLowerCase();
  if (/epoch|unix|timestamp/.test(text) && !/iso/.test(text)) return String(epoch);
  if (prop?.format === 'date' || /yyyy-mm-dd/.test(text)) return date;
  return `${date}T00:00:00Z`;
}

/** Build the arguments of `list_activities` strictly from its schema. */
export function buildListInput(schema, { since, page, perPage = 50 }) {
  const input = {};
  if (!schema) return { input, keys: {} };
  const props = schema.properties ?? {};
  const afterKey = findProp(schema, ['after', 'start_date', 'since', 'from', 'after_date', 'date_from', 'start', 'start_date_local']);
  const perKey = findProp(schema, ['per_page', 'limit', 'page_size', 'perPage', 'count']);
  const pageKey = findProp(schema, ['page']);
  if (afterKey && since) input[afterKey] = encodeDate(props[afterKey], since);
  if (perKey) input[perKey] = Math.min(perPage, Number(props[perKey]?.maximum) || perPage);
  if (pageKey && page != null) input[pageKey] = page;
  return { input, keys: { afterKey, perKey, pageKey } };
}

function idInputFor(schema, stravaId) {
  if (!schema) return null;
  const names = propNames(schema);
  const key = names.find(n => /^(activity_?id|activityId|id)$/i.test(n)) ?? (schema.required?.length === 1 ? schema.required[0] : null);
  if (!key) return null;
  const type = schema.properties?.[key]?.type;
  return { [key]: type === 'string' ? String(stravaId) : Number(stravaId) };
}

/**
 * Fetch activities since `since` (YYYY-MM-DD).
 * @returns { activities, zones, diagnostics, notes }
 *   activities – normalised documents, each with `zoneTimes` when available
 */
export async function fetchActivities({ since, withDetails = true, onProgress = () => {}, signal } = {}) {
  const mcp = await cap('mcp');
  if (!mcp) throw Object.assign(new Error('Kein Connector-Zugriff in dieser Ansicht.'), { code: 'capability_disabled' });
  const notes = [];
  const diagnostics = { server: SERVER, since, calls: [] };

  // Zones first: it needs no arguments, and the first call is the one that asks for consent.
  onProgress('Herzfrequenz-Zonen abrufen …');
  let zones = null;
  try {
    const res = await read(mcp, TOOL.zones, {}, signal);
    zones = parseHrZones(res.payload);
    diagnostics.calls.push({ tool: TOOL.zones, ok: true, recognised: !!zones });
    if (!zones) notes.push('Herzfrequenz-Zonen konnten nicht gelesen werden – der RPE-Vorschlag nutzt dann nur die Ø-Herzfrequenz.');
  } catch (e) {
    if (['needs_reauth', 'server_not_connected', 'selection_required', 'not_in_manifest', 'blocked_by_policy', 'approval_required', 'not_granted', 'consent_required'].includes(e?.code)) throw e;
    diagnostics.calls.push({ tool: TOOL.zones, ok: false, code: e?.code });
    notes.push('Herzfrequenz-Zonen nicht verfügbar – der RPE-Vorschlag nutzt nur die Ø-Herzfrequenz.');
  }

  onProgress('Aktivitäten abrufen …');
  const listSchema = await schemaOf(mcp, TOOL.list);
  diagnostics.listSchema = listSchema ? propNames(listSchema) : null;
  if (!listSchema) notes.push('Strava hat keine Beschreibung der Abfrage geliefert – es werden die zuletzt gelieferten Aktivitäten verwendet und hier nach Datum gefiltert.');

  const raw = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { input, keys } = buildListInput(listSchema, { since, page });
    diagnostics.listInputKeys = Object.keys(input);
    const res = await read(mcp, TOOL.list, input, signal);
    const list = findActivityList(res.payload);
    if (!list) {
      diagnostics.unreadable = typeof res.payload === 'string' ? res.payload.slice(0, 400) : Object.keys(res.payload ?? {});
      throw Object.assign(new Error('Die Antwort von Strava hat ein unbekanntes Format.'), { code: 'unknown_shape', diagnostics });
    }
    if (page === 1 && list[0]) diagnostics.activityFields = Object.keys(list[0]);
    let fresh = 0;
    for (const a of list) {
      const key = String(a?.id ?? a?.activity_id ?? JSON.stringify(a).slice(0, 80));
      if (seen.has(key)) continue;
      seen.add(key); raw.push(a); fresh++;
    }
    onProgress(`${raw.length} Aktivitäten geladen …`);
    if (!keys.pageKey || !fresh || (keys.perKey && list.length < input[keys.perKey])) break;
  }

  const activities = [];
  let unreadable = 0;
  for (const r of raw) {
    const a = normalizeStravaActivity(r);
    if (!a) { unreadable++; continue; }
    if (since && a.date < since) continue;
    activities.push({ ...a, zoneTimes: parseZoneTimes(r) });
  }
  if (unreadable) notes.push(`${unreadable} Einträge ohne Strava-ID oder Datum wurden übersprungen.`);
  activities.sort((a, b) => b.date.localeCompare(a.date));

  if (withDetails && activities.length) {
    const perfSchema = await schemaOf(mcp, TOOL.perf);
    const todo = activities.filter(a => !a.zoneTimes).slice(0, MAX_DETAIL_CALLS);
    if (!perfSchema || !idInputFor(perfSchema, 1)) {
      notes.push('Zeit in den HF-Zonen ist nicht abrufbar – der RPE-Vorschlag nutzt die Ø-Herzfrequenz.');
    } else {
      let done = 0, failed = 0;
      for (const a of todo) {
        if (signal?.aborted) break;
        onProgress(`Belastungsdaten ${++done} von ${todo.length} …`);
        try {
          const res = await read(mcp, TOOL.perf, idInputFor(perfSchema, a.stravaId), signal);
          a.zoneTimes = parseZoneTimes(res.payload);
          const p = res.payload && typeof res.payload === 'object' ? res.payload : {};
          a.avg_hr ??= numberOrNull(p.average_heartrate ?? p.avg_heartrate);
          a.max_hr ??= numberOrNull(p.max_heartrate ?? p.max_hr);
          if (p.suffer_score != null) a.loadRaw = { ...(a.loadRaw ?? {}), suffer_score: p.suffer_score };
        } catch (e) {
          if (e?.code === 'cancelled') break;
          failed++;
          if (['needs_reauth', 'not_in_manifest', 'blocked_by_policy', 'approval_required'].includes(e?.code)) { notes.push(`Belastungsdaten nicht erlaubt (${e.code}).`); break; }
        }
      }
      if (failed) notes.push(`Für ${failed} Aktivitäten gab es keine Belastungsdaten.`);
      if (activities.filter(a => !a.zoneTimes).length > todo.length) notes.push(`Belastungsdaten wurden nur für die neuesten ${MAX_DETAIL_CALLS} Aktivitäten geladen.`);
    }
  }
  return { activities, zones, diagnostics, notes };
}

const numberOrNull = v => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** What the viewer should read for each connector error code. */
export function stravaErrorMessage(e) {
  switch (e?.code) {
    case 'needs_reauth': return 'Die Verbindung zu Strava ist abgelaufen. Verbinde Strava in claude.ai unter Einstellungen → Connectors neu und starte den Import erneut.';
    case 'server_not_connected': return 'Strava ist nicht verbunden. Füge den Strava-Connector in claude.ai unter Einstellungen → Connectors hinzu.';
    case 'selection_required': return 'Du hast mehrere Strava-Connectors. Wähle in claude.ai einen aus und starte den Import erneut.';
    case 'server_not_found': return 'Der Strava-Connector existiert nicht mehr. Füge ihn in claude.ai neu hinzu.';
    case 'not_in_manifest':
    case 'consent_required':
    case 'not_granted': return 'Der Zugriff auf Strava wurde für diese Seite nicht erlaubt. Erlaube ihn im Berechtigungs-Menü des Artifacts.';
    case 'approval_required': return 'Der Abruf braucht deine Zustimmung. Starte den Import erneut und bestätige die Anfrage.';
    case 'blocked_by_policy': return 'Deine Organisation blockiert den Strava-Zugriff für diese Seite.';
    case 'server_unavailable':
    case 'rate_limited': return 'Strava antwortet gerade nicht. Versuche es in ein paar Minuten noch einmal.';
    case 'tool_error': return `Strava meldet einen Fehler: ${e.message ?? 'unbekannt'}`;
    case 'cancelled': return 'Import abgebrochen.';
    case 'capability_disabled':
    case 'capability_removed': return 'Der Strava-Import ist nur im veröffentlichten Artifact auf claude.ai verfügbar.';
    case 'unknown_shape': return 'Die Antwort von Strava hat ein unbekanntes Format. Die technischen Details unten helfen, die Zuordnung anzupassen.';
    default: return `Der Abruf ist fehlgeschlagen${e?.message ? `: ${e.message}` : '.'}`;
  }
}

export const defaultSince = lastSync => (lastSync ? addDays(lastSync, -2) : addDays(today(), -60));
