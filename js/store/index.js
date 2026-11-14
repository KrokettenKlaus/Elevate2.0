// Storage abstraction: one interface for the whole app, two backends.
//
//   list(col) · get(col, id) · put(col, doc) · putMany(col, docs) · remove(col, id) · subscribe(cb)
//
// All collections are small, so they are subscribed once at start and kept in
// memory. Documents handed out are frozen – clone before editing.
import { nowIso } from '../domain/dates.js';
import { createClaudeDb, dbErrorMessage } from './claudeDb.js';
import { createLocalDb } from './localDb.js';
import { ensureDefaults } from './defaults.js';

export const COLLECTIONS = [
  'climb_sessions', 'ticks', 'projects', 'hangboard_sessions', 'strength_sessions',
  'endurance_activities', 'bodyweight', 'tests', 'plan_blocks', 'plan_templates',
  'plan_units', 'reviews', 'settings',
];

const ID_PREFIX = {
  climb_sessions: 'cs', ticks: 'tk', projects: 'pr', hangboard_sessions: 'hb', strength_sessions: 's',
  endurance_activities: 'en', bodyweight: 'bw', tests: 't', plan_blocks: 'blk', plan_templates: 'tpl',
  plan_units: 'pu', reviews: 'rev', settings: 'cfg',
};

const USE_TIMEOUT_MS = 10_000;

const mem = new Map(COLLECTIONS.map(c => [c, new Map()]));
const listCache = new Map();
const pending = new Map();   // "col/id" → doc | null (deleted) while a write is queued or in flight
const queues = new Map();    // "col/id" → tail of the write chain
const listeners = new Set();
let backend = null;

export const status = {
  phase: 'starting',   // starting | loading | ready
  backend: null,       // 'claude' | 'local'
  stale: [],           // collections without a confirmed answer after 10 s
  errors: {},          // collection → terminal listener error
  writing: 0,
  readOnly: false,
};

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
const plain = o => JSON.parse(JSON.stringify(o));
export const clone = o => (o == null ? o : plain(o));

export function newId(col) {
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ID_PREFIX[col] ?? 'x'}-${Date.now().toString(36)}${rand}`;
}

function emit(col) {
  listCache.delete(col);
  for (const cb of listeners) {
    try { cb(col); } catch (e) { console.error(e); }
  }
}

/** JSON with sorted keys, so that key order never counts as a change. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
function sameContent(a, b) {
  const strip = ({ updatedAt, createdAt, ...rest }) => rest;
  return stable(strip(a)) === stable(strip(b));
}

function applySnapshot(col, docs) {
  const map = new Map(docs.map(d => [d.id, deepFreeze(d)]));
  // keep our own not-yet-confirmed writes on top of whatever the store delivered
  for (const [key, doc] of pending) {
    const [c, id] = splitKey(key);
    if (c !== col) continue;
    if (doc === null) map.delete(id); else map.set(id, doc);
  }
  mem.set(col, map);
  emit(col);
}
const splitKey = key => { const i = key.indexOf('/'); return [key.slice(0, i), key.slice(i + 1)]; };

function enqueue(key, fn) {
  const tail = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  queues.set(key, tail);
  const cleanup = () => { if (queues.get(key) === tail) queues.delete(key); };
  tail.then(cleanup, cleanup);
  return tail;
}

async function pickBackend() {
  // Locally `window.claude` does not exist – never touch `claude.use` without this check.
  if (typeof window !== 'undefined' && typeof window.claude?.use === 'function') {
    try {
      const db = await Promise.race([
        window.claude.use('db'),
        new Promise(r => setTimeout(() => r(null), USE_TIMEOUT_MS)),
      ]);
      if (db) return createClaudeDb(db);
    } catch (e) { console.warn('claude.use("db") failed', e); }
  }
  return createLocalDb();
}

/** Choose the backend, subscribe to everything, create missing defaults. */
export async function init() {
  status.phase = 'loading';
  emit('*');
  backend = await pickBackend();
  status.backend = backend.name;
  emit('*');
  await backend.open(COLLECTIONS, {
    onData: (col, docs) => applySnapshot(col, docs),
    onError: (col, err) => { status.errors[col] = err; console.error(`db listener for ${col} ended`, err); emit('*'); },
    onStale: cols => { status.stale = cols; emit('*'); },
    onDefinitive: () => {
      // Defaults are only written once the store has confirmed what really exists.
      ensureDefaults(api).catch(e => console.error('defaults', e));
    },
  });
  status.phase = 'ready';
  emit('*');
}

export function list(col) {
  let arr = listCache.get(col);
  if (!arr) { arr = Object.freeze([...mem.get(col).values()]); listCache.set(col, arr); }
  return arr;
}
export const get = (col, id) => mem.get(col).get(id) ?? null;
export const all = () => Object.fromEntries(COLLECTIONS.map(c => [c, list(c)]));
export const settings = () => get('settings', 'main') ?? {};

/**
 * Create or replace a document. Writes only when the content really changed,
 * and never two at once to the same document.
 */
export async function put(col, doc) {
  const id = doc.id ?? newId(col);
  const prev = get(col, id);
  const now = nowIso();
  const next = deepFreeze(plain({ ...doc, id, createdAt: prev?.createdAt ?? doc.createdAt ?? now, updatedAt: now }));
  if (prev && sameContent(prev, next)) return prev;

  const key = `${col}/${id}`;
  pending.set(key, next);
  mem.get(col).set(id, next);
  emit(col);
  status.writing++;
  try {
    await enqueue(key, () => backend.set(col, id, plain(next)));
    return next;
  } catch (e) {
    if (pending.get(key) === next) {
      if (prev) mem.get(col).set(id, prev); else mem.get(col).delete(id);
      emit(col);
    }
    if (e?.code === 'invalid_argument') status.readOnly = true;
    throw Object.assign(new Error(dbErrorMessage(e)), { code: e?.code, cause: e });
  } finally {
    if (pending.get(key) === next) pending.delete(key);
    status.writing--;
  }
}

/** Write many documents of one collection with limited parallelism. Returns per-document results. */
export async function putMany(col, docs, { onProgress } = {}) {
  const results = [];
  let i = 0, doneCount = 0;
  const worker = async () => {
    while (i < docs.length) {
      const doc = docs[i++];
      try { results.push({ id: doc.id, ok: true, doc: await put(col, doc) }); }
      catch (e) { results.push({ id: doc.id, ok: false, error: e }); }
      onProgress?.(++doneCount, docs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, docs.length) }, worker));
  return results;
}

export async function remove(col, id) {
  const prev = get(col, id);
  if (!prev) return;
  const key = `${col}/${id}`;
  pending.set(key, null);
  mem.get(col).delete(id);
  emit(col);
  status.writing++;
  try {
    await enqueue(key, () => backend.delete(col, id));
  } catch (e) {
    if (pending.get(key) === null) { mem.get(col).set(id, prev); emit(col); }
    throw Object.assign(new Error(dbErrorMessage(e)), { code: e?.code, cause: e });
  } finally {
    if (pending.get(key) === null) pending.delete(key);
    status.writing--;
  }
}

/** Merge fields into `settings/main`. */
export async function saveSettings(patch) {
  return put('settings', { ...settings(), ...patch, id: 'main' });
}

/** `cb(collection)` after every change; `'*'` signals a status change. */
export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const api = { COLLECTIONS, status, init, list, get, all, settings, put, putMany, remove, saveSettings, subscribe, newId, clone };
export default api;
