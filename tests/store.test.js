// The production path cannot run locally, so the store is exercised here against a
// fake of the artifact `db` capability that enforces the contract's rules.
import test from 'node:test';
import assert from 'node:assert/strict';

const delay = ms => new Promise(r => setTimeout(r, ms));

function fakeDb() {
  const data = new Map();        // "col/id" → body
  const listeners = new Map();   // col → Set<next>
  const inFlight = new Map();    // "col/id" → number of running writes
  const stats = { subs: [], sets: [], deletes: [], maxParallelPerDoc: 0, failNext: null };
  const colOf = path => path.slice(0, path.indexOf('/'));
  const snapshot = col => {
    const docs = [...data].filter(([p]) => colOf(p) === col).map(([p, body]) => {
      const frozen = Object.freeze(structuredClone(body)); // delivered snapshots are frozen
      return { id: p.slice(col.length + 1), exists: true, data: () => frozen, metadata: { fromCache: false, hasPendingWrites: false } };
    });
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const notify = col => listeners.get(col)?.forEach(next => next(snapshot(col)));
  const write = async (path, fn, log) => {
    assert.match(path, /^[A-Za-z0-9_.~:@+-]+\/[A-Za-z0-9_.~:@+-]+$/, 'document path has two valid segments');
    inFlight.set(path, (inFlight.get(path) ?? 0) + 1);
    stats.maxParallelPerDoc = Math.max(stats.maxParallelPerDoc, inFlight.get(path));
    log.push(path);
    await delay(3);
    inFlight.set(path, inFlight.get(path) - 1);
    if (stats.failNext) { const e = stats.failNext; stats.failNext = null; throw e; }
    fn();
    notify(colOf(path));
  };
  return {
    stats, data,
    collection: col => ({
      onSnapshot(next) {
        stats.subs.push(col);
        if (!listeners.has(col)) listeners.set(col, new Set());
        listeners.get(col).add(next);
        setTimeout(() => next(snapshot(col)), 1);
        return () => listeners.get(col).delete(next);
      },
    }),
    doc: path => ({
      set(body) {
        assert.equal(Object.prototype.toString.call(body), '[object Object]');
        return write(path, () => data.set(path, structuredClone(body)), stats.sets);
      },
      delete: () => write(path, () => data.delete(path), stats.deletes),
    }),
  };
}

const db = fakeDb();
globalThis.window = { claude: { use: async name => (name === 'db' ? db : null) }, addEventListener() {} };
const { default: store, COLLECTIONS } = await import('../js/store/index.js');

async function settled() {
  for (let i = 0; i < 200; i++) {
    await delay(5);
    if (store.status.writing === 0 && store.settings().seeds?.referenceTests) return;
  }
  throw new Error('store did not settle');
}

test('store: picks the Claude db, subscribes once per collection and creates the defaults', async () => {
  await store.init();
  await settled();
  assert.equal(store.status.backend, 'claude');
  assert.equal(store.status.phase, 'ready');
  assert.deepEqual([...db.stats.subs].sort(), [...COLLECTIONS].sort()); // exactly one listener each

  const s = store.settings();
  assert.deepEqual(s.summer, { from: '06-01', to: '09-30' });
  assert.equal(s.defaultEdge, 20);
  assert.deepEqual(s.targetPyramid, { '8a': 1, '7c+': 2, '7c': 4, '7b+': 8 });
  assert.deepEqual(store.list('plan_templates').map(t => t.id).sort(), ['standard', 'summer']);
  assert.deepEqual(store.list('bodyweight').map(b => [b.date, b.kg]), [['2026-11-13', 75]]);
  const refs = store.list('tests');
  assert.equal(refs.length, 2);
  assert.ok(refs.every(t => t.isReference && t.dateApprox && t.date === '2026-04-01'));
  assert.ok(db.data.has('settings/main'));
  assert.equal(db.stats.maxParallelPerDoc, 1);
});

test('store: writes only on change, one at a time per document, and hands out frozen documents', async () => {
  const before = db.stats.sets.length;
  const doc = await store.put('projects', { id: 'pr-1', name: 'Test', grade: '7c+', status: 'aktiv' });
  assert.ok(doc.createdAt && doc.updatedAt);
  assert.equal(db.stats.sets.length, before + 1);

  await store.put('projects', { status: 'aktiv', grade: '7c+', name: 'Test', id: 'pr-1' }); // same content, other key order
  assert.equal(db.stats.sets.length, before + 1, 'unchanged document is not written again');

  // a burst of writes to one document is serialised
  await Promise.all([1, 2, 3, 4].map(n => store.put('projects', { ...store.get('projects', 'pr-1'), notes: `v${n}` })));
  assert.equal(db.stats.maxParallelPerDoc, 1);
  assert.equal(db.data.get('projects/pr-1').notes, 'v4');
  assert.equal(store.get('projects', 'pr-1').notes, 'v4');

  assert.throws(() => { store.get('projects', 'pr-1').notes = 'x'; }, TypeError);
  assert.throws(() => { store.list('projects').push({}); }, TypeError);
});

test('store: a rejected write is rolled back and reported with readable copy', async () => {
  db.stats.failNext = { code: 'quota_exceeded', message: 'collection full' };
  await assert.rejects(store.put('projects', { id: 'pr-2', name: 'Voll' }), e => e.code === 'quota_exceeded' && /Speicher voll/.test(e.message));
  assert.equal(store.get('projects', 'pr-2'), null);
  assert.equal(db.data.has('projects/pr-2'), false);

  // `unavailable` is retried exactly once
  db.stats.failNext = { code: 'unavailable', message: 'try again' };
  await store.put('projects', { id: 'pr-3', name: 'Zweiter Versuch' });
  assert.equal(db.data.get('projects/pr-3').name, 'Zweiter Versuch');
});

test('store: putMany, remove and deleted defaults stay deleted', async () => {
  const res = await store.putMany('ticks', Array.from({ length: 12 }, (_, i) => ({ id: `tk-${i}`, date: '2026-11-01', grade: '7a', style: 'RP' })));
  assert.equal(res.filter(r => r.ok).length, 12);
  assert.equal(store.list('ticks').length, 12);
  assert.equal(db.stats.maxParallelPerDoc, 1);

  await store.remove('ticks', 'tk-0');
  assert.equal(store.get('ticks', 'tk-0'), null);
  assert.equal(db.data.has('ticks/tk-0'), false);

  await store.remove('bodyweight', 'bw-20261113');
  const { ensureDefaults } = await import('../js/store/defaults.js');
  await ensureDefaults(store);
  assert.equal(store.list('bodyweight').length, 0, 'the seed is not created a second time');
});

test('strava: list arguments come from the tool schema only', async () => {
  const { buildListInput } = await import('../js/services/strava.js');
  assert.deepEqual(buildListInput(null, { since: '2026-11-01', page: 1 }), { input: {}, keys: {} });
  const epoch = buildListInput({ properties: { after: { type: 'integer' }, per_page: { type: 'integer', maximum: 30 }, page: { type: 'integer' } } }, { since: '2026-11-01', page: 2 });
  assert.deepEqual(epoch.input, { after: Date.UTC(2026, 10, 1) / 1000, per_page: 30, page: 2 });
  const iso = buildListInput({ properties: { start_date: { type: 'string', format: 'date' }, limit: { type: 'number' } } }, { since: '2026-11-01', page: 1 });
  assert.deepEqual(iso.input, { start_date: '2026-11-01', limit: 50 });
  const unknown = buildListInput({ properties: { foo: { type: 'string' } } }, { since: '2026-11-01', page: 1 });
  assert.deepEqual(unknown.input, {}); // nothing is guessed
});
