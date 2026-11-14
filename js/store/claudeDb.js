// Production backend: the artifact's `db` capability (runtime contract 0.2.96).
//
// Rules followed here:
//  - `db` is the namespace resolved by `claude.use("db")`; it is only called, never modified.
//  - one subscription per collection, opened once at start, never from render code
//  - loading is time-limited (10 s); the listener is kept and never re-created
//  - the store above guarantees one write at a time per document

const LOAD_TIMEOUT_MS = 10_000;

const wait = ms => new Promise(r => setTimeout(r, ms));

/** `unavailable` is transient: retry a write exactly once after a short random delay. */
async function withRetry(fn) {
  try { return await fn(); }
  catch (e) {
    if (e?.code !== 'unavailable') throw e;
    await wait(400 + Math.random() * 800);
    return fn();
  }
}

export function createClaudeDb(db) {
  const unsubscribers = [];
  return {
    name: 'claude',

    /**
     * @param collections string[]
     * @param handlers { onData(col, docs, definitive), onError(col, err), onStale(pendingCols), onDefinitive() }
     * @returns Promise<void> – resolves once every collection has answered or the timeout fired
     */
    open(collections, { onData, onError, onStale, onDefinitive }) {
      return new Promise(resolve => {
        const awaitingFirst = new Set(collections);      // no snapshot at all yet
        const awaitingConfirmed = new Set(collections);  // no confirmed (non-cache) snapshot yet
        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; resolve(); } };
        const timer = setTimeout(() => { onStale([...awaitingConfirmed]); done(); }, LOAD_TIMEOUT_MS);
        const settle = col => {
          awaitingFirst.delete(col);
          if (awaitingConfirmed.delete(col) && awaitingConfirmed.size === 0) {
            clearTimeout(timer);
            onStale([]);
            onDefinitive();
          }
          if (awaitingConfirmed.size === 0) done();
        };

        for (const col of collections) {
          const unsub = db.collection(col).onSnapshot(
            snap => {
              const docs = snap.docs.map(d => ({ ...d.data(), id: d.id }));
              const definitive = !snap.metadata?.fromCache;
              onData(col, docs, definitive);
              if (definitive) settle(col); else awaitingFirst.delete(col);
            },
            err => {
              // Terminal for this listener. Loading ends; the collection keeps what it has.
              onError(col, err);
              awaitingFirst.delete(col);
              awaitingConfirmed.delete(col);
              if (awaitingConfirmed.size === 0) { clearTimeout(timer); done(); }
            },
          );
          unsubscribers.push(unsub);
        }
      });
    },

    set: (col, id, data) => withRetry(() => db.doc(`${col}/${id}`).set(data)),
    delete: (col, id) => withRetry(() => db.doc(`${col}/${id}`).delete()),
    close() { unsubscribers.splice(0).forEach(u => u()); },
  };
}

/** German copy for a rejected write, by error code. */
export function dbErrorMessage(e) {
  switch (e?.code) {
    case 'invalid_argument': return 'Speichern abgelehnt – keine Schreibrechte oder ungültige Daten.';
    case 'quota_exceeded': return 'Speicher voll – bitte alte Einträge löschen.';
    case 'resource_exhausted': return 'Zu viele Zugriffe auf einmal – bitte kurz warten und erneut speichern.';
    case 'revoked':
    case 'not_granted':
    case 'capability_disabled':
    case 'capability_removed': return 'Die Datenbank ist in dieser Ansicht nicht mehr verfügbar.';
    case 'unavailable': return 'Datenbank gerade nicht erreichbar – bitte erneut versuchen.';
    default: return e?.message ? `Speichern fehlgeschlagen: ${e.message}` : 'Speichern fehlgeschlagen.';
  }
}
