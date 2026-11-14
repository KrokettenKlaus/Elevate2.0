// Access to the artifact runtime capabilities. Locally `window.claude` does not
// exist, so every capability resolves to null and the feature hides itself.

export const hasRuntime = () => typeof window !== 'undefined' && typeof window.claude?.use === 'function';

/** Resolve a capability namespace (`db`, `user`, `mcp`, `sample`, `downloads`) or null. */
export async function cap(name) {
  if (!hasRuntime()) return null;
  try { return await window.claude.use(name); }
  catch (e) { console.warn(`claude.use("${name}") failed`, e); return null; }
}

export const wait = ms => new Promise(r => setTimeout(r, ms));
