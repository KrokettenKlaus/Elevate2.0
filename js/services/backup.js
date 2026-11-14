// JSON backup: export of every collection and the checks for restoring one.
import store, { COLLECTIONS } from '../store/index.js';
import { today } from '../domain/dates.js';
import { cap, hasRuntime } from './caps.js';

export const BACKUP_FORMAT = 'elevate-backup';

export function buildBackup() {
  const collections = {};
  for (const c of COLLECTIONS) collections[c] = store.list(c);
  return { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), collections };
}

export function parseBackup(text) {
  let data;
  try { data = JSON.parse(String(text).replace(/^﻿/, '')); }
  catch (e) { return { error: `Datei ist kein gültiges JSON: ${e.message}` }; }
  if (data?.format !== BACKUP_FORMAT || !data.collections || typeof data.collections !== 'object') return { error: 'Das ist kein Elevate-Backup.' };
  const collections = {};
  let skipped = 0;
  for (const c of COLLECTIONS) {
    const list = Array.isArray(data.collections[c]) ? data.collections[c] : [];
    collections[c] = list.filter(d => d && typeof d === 'object' && typeof d.id === 'string' && /^[A-Za-z0-9_.~:@+-]{1,200}$/.test(d.id));
    skipped += list.length - collections[c].length;
  }
  return { exportedAt: data.exportedAt ?? null, collections, skipped };
}

/**
 * Offer a file to the viewer. In the artifact this goes through the `downloads`
 * capability (the viewer confirms); locally a normal download link works.
 * Resolves 'saved' | 'declined' | 'unavailable'.
 */
export async function saveFile(filename, text) {
  if (hasRuntime()) {
    const downloads = await cap('downloads');
    if (!downloads) return 'unavailable';
    try { await downloads.save({ filename, data: text }); return 'saved'; }
    catch (e) {
      if (e?.code === 'declined') return 'declined';
      if (e?.code === 'rate_limited') throw new Error('Es ist bereits eine Speichern-Anfrage offen. Bitte kurz warten.');
      if (['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(e?.code)) return 'unavailable';
      throw new Error(`Speichern fehlgeschlagen${e?.message ? `: ${e.message}` : '.'}`);
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'saved';
}

export const backupFilename = () => `elevate-backup-${today()}.json`;

/** Flat CSV of all ticks – handy for a spreadsheet. */
export function ticksCsv() {
  const cols = ['date', 'grade', 'style', 'route', 'area', 'place', 'attempts', 'note'];
  const cell = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const rows = [...store.list('ticks')].sort((a, b) => a.date.localeCompare(b.date)).map(t => cols.map(c => cell(t[c])).join(';'));
  return `﻿${cols.join(';')}\n${rows.join('\n')}\n`;
}
