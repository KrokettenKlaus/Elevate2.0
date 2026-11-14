// Development backend: one localStorage entry per collection.
// Only used when the artifact runtime (`window.claude`) is absent or offers no db.

const PREFIX = 'elevate2:';

function read(col) {
  try {
    const raw = localStorage.getItem(PREFIX + col);
    const map = raw ? JSON.parse(raw) : {};
    return map && typeof map === 'object' ? map : {};
  } catch (_) { return {}; }
}

function write(col, map) {
  try { localStorage.setItem(PREFIX + col, JSON.stringify(map)); }
  catch (e) { throw Object.assign(new Error('Lokaler Speicher voll oder gesperrt.'), { code: 'quota_exceeded', cause: e }); }
}

export function createLocalDb() {
  let onStorage = null;
  return {
    name: 'local',

    async open(collections, { onData, onStale, onDefinitive }) {
      for (const col of collections) onData(col, Object.values(read(col)), true);
      onStale([]);
      onDefinitive();
      // keep several tabs of the dev server in sync
      onStorage = ev => {
        if (!ev.key?.startsWith(PREFIX)) return;
        const col = ev.key.slice(PREFIX.length);
        if (collections.includes(col)) onData(col, Object.values(read(col)), true);
      };
      try { window.addEventListener('storage', onStorage); } catch (_) { /* not in a browser */ }
    },

    async set(col, id, data) {
      const map = read(col);
      map[id] = data;
      write(col, map);
    },

    async delete(col, id) {
      const map = read(col);
      delete map[id];
      write(col, map);
    },

    close() { if (onStorage) window.removeEventListener('storage', onStorage); },
  };
}
