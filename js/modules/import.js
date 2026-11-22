// Import: pick a file → it is parsed in the browser → preview with corrections → write.
// Idempotent: stable ids from the source; existing entries are skipped or, on request, overwritten.
import store, { COLLECTIONS } from '../store/index.js';
import { fmtD, wd } from '../domain/dates.js';
import { GRIPS, GRIP_LABEL, HB_TYPES, HB_TYPE_LABEL, MODES, MODE_LABEL, describeBlock, isOneArm } from '../domain/hangboard.js';
import { KIND_LABEL } from '../domain/strength.js';
import { TEST_LABEL } from '../domain/tests.js';
import { parseRehabBoard } from '../import/rehabboard.js';
import { parseHangboardTxt, toDocument } from '../import/hangboardTxt.js';
import { parseBackup } from '../services/backup.js';
import { fmtNum, h, icon } from '../ui/dom.js';
import { guarded, toast } from '../ui/dialog.js';
import { seg, selectInput } from '../ui/forms.js';
import { badge, btn, card } from '../ui/view.js';

export const meta = { id: 'import', title: 'Import', sub: 'Daten aus RehabBoard, Hangboard.txt oder einem Backup übernehmen' };

const COL_LABEL = {
  climb_sessions: 'Klettersessions', ticks: 'Ticks', projects: 'Projekte', hangboard_sessions: 'Hangboard-Einheiten', strength_sessions: 'Kraft & Prävention',
  endurance_activities: 'Ausdauer-Einheiten', bodyweight: 'Körpergewicht', tests: 'Tests', plan_blocks: 'Trainingsblöcke', plan_templates: 'Wochenvorlagen',
  plan_units: 'Geplante Einheiten', reviews: 'Wochenreviews', settings: 'Einstellungen',
};

// The preview lives here, outside the DOM: the view is re-rendered while documents are written.
const S = { rehab: null, hang: null, backup: null, busy: null, root: null };

/* ---------- shared ---------- */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter(k => k !== 'createdAt' && k !== 'updatedAt' && v[k] != null).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
/** new | same | differs – compared with what is stored under the same id. */
function statusOf(col, doc) {
  const cur = store.get(col, doc.id);
  if (!cur) return 'new';
  return stable(cur) === stable(doc) ? 'same' : 'differs';
}
const STATUS_BADGE = { new: ['neu', 'st-new'], same: ['vorhanden', 'cat'], differs: ['vorhanden – weicht ab', 'st-differs'] };
const statusBadge = s => badge(STATUS_BADGE[s][0], STATUS_BADGE[s][1]);
const willWrite = (status, include, overwrite) => include && (status === 'new' || (status === 'differs' && overwrite));

function filePicker(id, accept, label, onText) {
  const input = h('input', { type: 'file', id, accept, class: 'file-input', onchange: async () => {
    const file = input.files?.[0];
    if (!file) return;
    try { onText(await file.text(), file.name); }
    catch (e) { toast(`Datei konnte nicht gelesen werden: ${e.message}`, true); }
    rerender();
  } });
  return h('label', { class: 'btn file-btn', for: id }, icon('import', 16), label, input);
}

/** Re-render from the preview state and keep the scroll position of long lists. */
function rerender() {
  if (!S.root?.isConnected) return;
  const tops = [...S.root.querySelectorAll('.table-wrap.tall')].map(e => e.scrollTop);
  render(S.root);
  [...S.root.querySelectorAll('.table-wrap.tall')].forEach((e, i) => { e.scrollTop = tops[i] ?? 0; });
}

function progressEl(key) {
  if (S.busy?.key !== key) return null;
  return h('div', { class: 'sync-progress' }, h('span', { class: 'spinner' }), h('span', {}, `${S.busy.done} von ${S.busy.total} geschrieben …`));
}

async function writeAll(key, jobs) {
  const total = jobs.reduce((a, j) => a + j.docs.length, 0);
  S.busy = { key, done: 0, total };
  rerender();
  let ok = 0;
  const failed = [];
  try {
    for (const job of jobs) {
      const base = S.busy.done;
      const res = await store.putMany(job.col, job.docs, { onProgress: n => { S.busy.done = base + n; } });
      S.busy.done = base + job.docs.length;
      ok += res.filter(r => r.ok).length;
      failed.push(...res.filter(r => !r.ok));
    }
  } finally { S.busy = null; }
  if (failed.length) toast(`${failed.length} Einträge konnten nicht gespeichert werden: ${failed[0].error.message}`, true);
  else toast(`${ok} Einträge importiert`);
  rerender();
  return { ok, failed };
}

export function render(root) {
  S.root = root;
  root.replaceChildren(
    h('p', { class: 'hint lead' }, 'Jeder Import zeigt zuerst eine Vorschau. Geschrieben wird erst nach deiner Bestätigung. Ein Import lässt sich beliebig oft wiederholen: Vorhandene Einträge werden an ihrer ID erkannt und übersprungen.'),
    rehabCard(), hangCard(), backupCard());
}

/* ============ RehabBoard ============ */
function rehabCard() {
  const st = S.rehab;
  const head = [filePicker('import-rehab', '.json,application/json', st ? 'Andere Datei wählen' : 'sessions.json wählen', (text, name) => {
    const parsed = parseRehabBoard(text);
    S.rehab = { name, ...parsed, include: new Set(parsed.sessions.map(s => s.id)), testInclude: new Set(parsed.tests.map(t => t.id)), overwrite: false };
  })];
  if (!st) {
    return card('RehabBoard', { hint: 'data/sessions.json → Kraft & Prävention', actions: head },
      h('p', { class: 'import-help' }, 'Wähle die Datei ', h('code', {}, 'RehabBoard/data/sessions.json'), '. Alle Sitzungen werden 1:1 übernommen: IDs, Originalnotizen und Übungsnamen bleiben unverändert. Übungen der Kategorie „Test“ werden zusätzlich als Test vorgeschlagen.'));
  }
  if (!st.stats) return card('RehabBoard', { hint: st.name, actions: head }, st.errors.map(e => notice('warn', e)));

  const rows = st.sessions.map(s => ({ s, status: statusOf('strength_sessions', s) }));
  const testDoc = ({ sourceName, ...doc }) => doc;
  const tests = st.tests.map(t => ({ t, status: statusOf('tests', testDoc(t)) }));
  const count = k => rows.filter(r => r.status === k).length;
  const toWrite = rows.filter(r => willWrite(r.status, st.include.has(r.s.id), st.overwrite));
  const testsToWrite = tests.filter(r => willWrite(r.status, st.testInclude.has(r.t.id), st.overwrite));

  const over = h('input', { type: 'checkbox', id: 'import-rehab-overwrite', checked: st.overwrite, onchange: () => { st.overwrite = over.checked; rerender(); } });
  const table = h('table', { class: 'preview' }, h('thead', {}, h('tr', {}, ['', 'Datum', 'Art', 'Übungen', 'Status'].map(t => h('th', {}, t)))),
    h('tbody', {}, rows.map(({ s, status }) => {
      const check = h('input', { type: 'checkbox', checked: st.include.has(s.id), 'aria-label': 'importieren', onchange: () => { check.checked ? st.include.add(s.id) : st.include.delete(s.id); rerender(); } });
      const kind = selectInput([['home', KIND_LABEL.home], ['physio', KIND_LABEL.physio]], s.kind, { 'aria-label': 'Art', onchange: () => { s.kind = kind.value; rerender(); } });
      return h('tr', { class: st.include.has(s.id) ? '' : 'off' },
        h('td', {}, check), h('td', {}, `${wd(s.date)}, ${fmtD(s.date)}`), h('td', {}, kind),
        h('td', { class: 'ellip', title: s.exercises.map(e => e.name).join(', ') }, h('b', {}, String(s.exercises.length)), ` · ${s.exercises.map(e => e.name).slice(0, 5).join(', ')}${s.exercises.length > 5 ? ' …' : ''}`),
        h('td', {}, statusBadge(status)));
    })));

  const testTable = tests.length ? h('table', { class: 'preview' }, h('thead', {}, h('tr', {}, ['', 'Datum', 'Übung in der Sitzung', 'Testart', 'Status'].map(t => h('th', {}, t)))),
    h('tbody', {}, tests.map(({ t, status }) => {
      const check = h('input', { type: 'checkbox', checked: st.testInclude.has(t.id), 'aria-label': 'als Test übernehmen', onchange: () => { check.checked ? st.testInclude.add(t.id) : st.testInclude.delete(t.id); rerender(); } });
      const type = selectInput(['pullup_test', 'stuetz_test', 'custom'].map(k => [k, TEST_LABEL[k]]), t.type, { 'aria-label': 'Testart', onchange: () => { t.type = type.value; if (t.type === 'custom') t.name = t.sourceName; else delete t.name; rerender(); } });
      return h('tr', { class: st.testInclude.has(t.id) ? '' : 'off' }, h('td', {}, check), h('td', {}, fmtD(t.date)), h('td', {}, t.sourceName), h('td', {}, type), h('td', {}, statusBadge(status)));
    }))) : null;

  return card('RehabBoard', { hint: st.name, actions: head },
    h('div', { class: 'import-summary' },
      h('b', {}, `${st.stats.total} Sitzungen`), h('span', {}, `${st.stats.home} Eigentraining · ${st.stats.physio} Physio`), h('span', {}, `${fmtD(st.stats.from)} – ${fmtD(st.stats.to)}`),
      h('span', {}, `${fmtNum(st.stats.exercises)} Übungen`), h('span', {}, `${count('new')} neu · ${count('same')} vorhanden · ${count('differs')} abweichend`)),
    st.errors.map(e => notice('warn', e)),
    count('differs') ? notice('info', 'Abweichende Einträge wurden in Elevate bereits bearbeitet (zum Beispiel um Dauer und RPE ergänzt). Sie werden nur überschrieben, wenn du das unten ankreuzt.') : null,
    h('div', { class: 'table-wrap tall' }, table),
    testTable ? [h('h3', { class: 'chart-sub' }, 'Als Test vorschlagen'), h('p', { class: 'hint' }, 'Diese Übungen bleiben in der Sitzung und werden zusätzlich unter „Tests“ angelegt, wenn du sie angekreuzt lässt.'), h('div', { class: 'table-wrap' }, testTable)] : null,
    progressEl('rehab'),
    h('div', { class: 'import-foot' },
      h('label', { class: 'chk' }, over, 'Vorhandene, abweichende Einträge überschreiben'), h('span', { class: 'grow' }),
      btn('Verwerfen', () => { S.rehab = null; rerender(); }, 'ghost'),
      h('button', { type: 'button', class: 'btn primary', disabled: !!S.busy || !(toWrite.length + testsToWrite.length), onclick: guarded(() => writeAll('rehab', [{ col: 'strength_sessions', docs: toWrite.map(r => r.s) }, { col: 'tests', docs: testsToWrite.map(({ t }) => testDoc(t)) }])) },
        `${toWrite.length} Sitzungen${testsToWrite.length ? ` und ${testsToWrite.length} Tests` : ''} importieren`)));
}

/* ============ Hangboard.txt ============ */
function parseHang(text, name, opts) {
  const settings = store.settings();
  const options = { year: 2026, defaultEdge: settings.defaultEdge ?? 20, strengthMode: settings.strengthModeDefault ?? 'lift_one_arm', ...opts };
  const parsed = parseHangboardTxt(text, options);
  S.hang = { name, text, options, ...parsed, include: new Set(parsed.sessions.map(s => s.id)), overwrite: false };
}

function hangCard() {
  const st = S.hang;
  const head = [filePicker('import-hang', '.txt,text/plain', st ? 'Andere Datei wählen' : 'Hangboard.txt wählen', (text, name) => parseHang(text, name, {}))];
  if (!st) {
    return card('Hangboard-Notizen', { hint: 'Hangboard.txt → Hangboard', actions: head },
      h('p', { class: 'import-help' }, 'Wähle die Datei ', h('code', {}, 'Hangboard.txt'), ' aus dem Projektordner. Die Notizen werden Zeile für Zeile gelesen. Jede Originalzeile bleibt gespeichert; was nicht erkannt wird, landet in den Notizen der Einheit und ist in der Vorschau markiert.'));
  }
  const rows = st.sessions.map(s => ({ s, status: statusOf('hangboard_sessions', toDocument(s)) }));
  const count = k => rows.filter(r => r.status === k).length;
  const toWrite = rows.filter(r => willWrite(r.status, st.include.has(r.s.id), st.overwrite));
  const over = h('input', { type: 'checkbox', id: 'import-hang-overwrite', checked: st.overwrite, onchange: () => { st.overwrite = over.checked; rerender(); } });
  const year = h('input', { type: 'number', id: 'import-hang-year', min: 2000, max: 2100, step: 1, value: st.options.year, onchange: () => { parseHang(st.text, st.name, { ...st.options, year: Number(year.value) || 2026 }); rerender(); } });
  const edge = h('input', { type: 'number', id: 'import-hang-edge', min: 4, max: 60, step: 1, value: st.options.defaultEdge, onchange: () => { parseHang(st.text, st.name, { ...st.options, defaultEdge: Number(edge.value) || 20 }); rerender(); } });
  const strengthBlocks = st.sessions.filter(s => s.type === 'Strength').flatMap(s => s.blocks);
  const allMode = strengthBlocks.length && strengthBlocks.every(b => b.mode === strengthBlocks[0].mode) ? strengthBlocks[0].mode : null;
  const modeSeg = seg(MODES.map(m => [m, MODE_LABEL[m]]), allMode, v => {
    for (const b of strengthBlocks) { b.mode = v; b.side = isOneArm(v) ? 'each' : 'both'; }
    st.options.strengthMode = v;
    rerender();
  });

  const list = h('div', { class: 'hang-preview' }, rows.map(({ s, status }) => {
    const on = st.include.has(s.id);
    const check = h('input', { type: 'checkbox', checked: on, 'aria-label': 'importieren', onchange: () => { check.checked ? st.include.add(s.id) : st.include.delete(s.id); rerender(); } });
    const type = selectInput(HB_TYPES.map(t => [t, HB_TYPE_LABEL[t]]), s.type, { 'aria-label': 'Typ', onchange: () => { s.type = type.value; rerender(); } });
    const dur = h('input', { type: 'number', min: 0, step: 5, placeholder: 'min', value: s.duration_min ?? '', title: 'Dauer in Minuten (optional)', 'aria-label': 'Dauer', class: 'tiny', onchange: () => { s.duration_min = dur.value === '' ? null : Number(dur.value); rerender(); } });
    const rpe = selectInput([['', 'RPE'], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)])], s.rpe ? String(s.rpe) : '', { 'aria-label': 'RPE', class: 'tiny', onchange: () => { s.rpe = rpe.value ? Number(rpe.value) : null; rerender(); } });
    const blocks = s.blocks.map(b => {
      const flagged = s.review.find(r => b.raw.split('\n').includes(r.raw));
      const cells = [h('code', { class: 'raw-line' }, b.raw)];
      if (b.mode === 'pullup') cells.push(h('span', { class: 'hint' }, MODE_LABEL.pullup), h('span'));
      else {
        const mode = selectInput(MODES.map(m => [m, MODE_LABEL[m]]), b.mode, { 'aria-label': 'Ausführungsart', onchange: () => { b.mode = mode.value; b.side = b.switching ? 'alternating' : isOneArm(b.mode) ? 'each' : 'both'; rerender(); } });
        const grip = selectInput(GRIPS.map(g => [g, GRIP_LABEL[g]]), b.grip, { 'aria-label': 'Griff', onchange: () => { b.grip = grip.value; rerender(); } });
        cells.push(mode, grip);
      }
      cells.push(h('span', { class: 'b-desc' }, describeBlock(s.type, b)), flagged ? h('span', { class: 'flag', title: flagged.reason }, icon('warn', 14), flagged.reason) : h('span'));
      return h('div', { class: `hp-block${flagged ? ' flagged' : ''}` }, cells);
    });
    const loose = s.review.filter(r => !s.blocks.some(b => b.raw.split('\n').includes(r.raw)));
    return h('div', { class: `hp-session${on ? '' : ' off'}` },
      h('div', { class: 'hp-head' }, check, h('b', {}, `${wd(s.date)}, ${fmtD(s.date)}`), type, h('span', { class: 'hint' }, s.warmup ? 'aufgewärmt' : 'ohne Aufwärmen'), h('span', { class: 'grow' }), dur, rpe, statusBadge(status)),
      blocks,
      loose.map(r => h('div', { class: 'hp-block flagged note' }, h('code', { class: 'raw-line' }, r.raw), h('span', { class: 'flag' }, icon('warn', 14), `${r.reason} → kommt in die Notizen`))));
  }));

  return card('Hangboard-Notizen', { hint: st.name, actions: head },
    h('div', { class: 'import-summary' },
      h('b', {}, `${st.stats.sessions} Einheiten`), h('span', {}, Object.entries(st.stats.byType).map(([k, v]) => `${v} × ${HB_TYPE_LABEL[k]}`).join(' · ')),
      h('span', {}, `${st.stats.blocks} Blöcke aus ${st.stats.lines} Zeilen`), h('span', {}, `${count('new')} neu · ${count('same')} vorhanden · ${count('differs')} abweichend`),
      st.stats.review ? h('span', { class: 'warn-text' }, `${st.stats.review} Zeilen zu prüfen`) : null),
    st.orphans.length ? notice('warn', `Zeilen vor der ersten Kopfzeile wurden nicht zugeordnet: ${st.orphans.join(' | ')}`) : null,
    h('div', { class: 'import-options' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Jahr'), year),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Leiste (mm), wenn nicht angegeben'), edge),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Ausführung der Maximalkraft-Einheiten'), modeSeg,
        h('span', { class: 'hint' }, 'Offen: Wurden die Sätze vom 06.09. bis 25.10. einarmig gehoben oder beidarmig am Board gehangen? Hier für alle setzen oder unten pro Zeile ändern.'))),
    list,
    progressEl('hang'),
    h('div', { class: 'import-foot' },
      h('label', { class: 'chk' }, over, 'Vorhandene, abweichende Einträge überschreiben'), h('span', { class: 'grow' }),
      btn('Verwerfen', () => { S.hang = null; rerender(); }, 'ghost'),
      h('button', { type: 'button', class: 'btn primary', disabled: !!S.busy || !toWrite.length, onclick: guarded(async () => {
        await writeAll('hang', [{ col: 'hangboard_sessions', docs: toWrite.map(r => toDocument(r.s)) }]);
        if (st.options.strengthMode) await store.saveSettings({ strengthModeDefault: st.options.strengthMode });
      }) }, `${toWrite.length} Einheiten importieren`)));
}

/* ============ Backup ============ */
function backupCard() {
  const st = S.backup;
  const head = [filePicker('import-backup', '.json,application/json', st ? 'Andere Datei wählen' : 'Backup-Datei wählen', (text, name) => { S.backup = { name, ...parseBackup(text), overwrite: false }; })];
  if (!st) return card('Elevate-Backup', { hint: 'elevate-backup-….json → alle Bereiche', actions: head }, h('p', { class: 'import-help' }, 'Stellt ein Backup wieder her, das du unter „Einstellungen“ exportiert hast. Vorhandene Einträge bleiben, solange du das Überschreiben nicht ankreuzt.'));
  if (st.error) return card('Elevate-Backup', { hint: st.name, actions: head }, notice('warn', st.error));
  const rows = COLLECTIONS.map(col => {
    const docs = st.collections[col];
    const by = { new: 0, same: 0, differs: 0 };
    for (const d of docs) by[statusOf(col, d)]++;
    return { col, docs, by };
  }).filter(r => r.docs.length);
  const jobs = rows.map(r => ({ col: r.col, docs: r.docs.filter(d => willWrite(statusOf(r.col, d), true, st.overwrite)) })).filter(j => j.docs.length);
  const total = jobs.reduce((a, j) => a + j.docs.length, 0);
  const over = h('input', { type: 'checkbox', id: 'import-backup-overwrite', checked: st.overwrite, onchange: () => { st.overwrite = over.checked; rerender(); } });
  return card('Elevate-Backup', { hint: st.name, actions: head },
    h('div', { class: 'import-summary' }, h('b', {}, `${rows.reduce((a, r) => a + r.docs.length, 0)} Einträge`), st.exportedAt ? h('span', {}, `exportiert am ${fmtD(st.exportedAt.slice(0, 10))}`) : null, st.skipped ? h('span', { class: 'warn-text' }, `${st.skipped} ungültige Einträge übersprungen`) : null),
    h('div', { class: 'table-wrap' }, h('table', { class: 'preview' }, h('thead', {}, h('tr', {}, ['Bereich', 'im Backup', 'neu', 'vorhanden', 'abweichend'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
      h('tbody', {}, rows.map(r => h('tr', {}, h('td', {}, COL_LABEL[r.col]), h('td', { class: 'r' }, String(r.docs.length)), h('td', { class: 'r' }, h('b', {}, String(r.by.new))), h('td', { class: 'r' }, String(r.by.same)), h('td', { class: 'r' }, String(r.by.differs))))))),
    progressEl('backup'),
    h('div', { class: 'import-foot' },
      h('label', { class: 'chk' }, over, 'Vorhandene, abweichende Einträge überschreiben'), h('span', { class: 'grow' }),
      btn('Verwerfen', () => { S.backup = null; rerender(); }, 'ghost'),
      h('button', { type: 'button', class: 'btn primary', disabled: !!S.busy || !total, onclick: guarded(() => writeAll('backup', jobs)) }, `${total} Einträge wiederherstellen`)));
}

function notice(kind, text) {
  return h('div', { class: `notice ${kind}` }, icon(kind === 'warn' ? 'warn' : 'info', 16), h('span', {}, text));
}
