// Einstellungen: goal and target pyramid, training defaults, backup and data.
import store, { COLLECTIONS } from '../store/index.js';
import { fmtD, isDate, today } from '../domain/dates.js';
import { GRADES, compareGrades, normalizeGrade } from '../domain/grades.js';
import { MODES, MODE_LABEL } from '../domain/hangboard.js';
import { $$, fmtNum, h, icon, local } from '../ui/dom.js';
import { confirmDialog, guarded, toast } from '../ui/dialog.js';
import { datalist, field, seg, selectInput } from '../ui/forms.js';
import { btn, card, facts } from '../ui/view.js';
import { backupFilename, buildBackup, saveFile, ticksCsv } from '../services/backup.js';
import { hasRuntime } from '../services/caps.js';
import { openSummerEditor } from './plan.js';

export const meta = { id: 'prefs', title: 'Einstellungen', sub: 'Ziel, Vorgaben, Backup und Daten' };

const COL_LABEL = {
  climb_sessions: 'Klettersessions', ticks: 'Ticks', projects: 'Projekte', hangboard_sessions: 'Hangboard-Einheiten', strength_sessions: 'Kraft & Prävention',
  endurance_activities: 'Ausdauer-Einheiten', bodyweight: 'Körpergewicht', tests: 'Tests', plan_blocks: 'Trainingsblöcke', plan_templates: 'Wochenvorlagen',
  plan_units: 'Geplante Einheiten', reviews: 'Wochenreviews', settings: 'Einstellungen',
};

export function applyTheme(theme = local.get('theme', 'system')) {
  if (hasRuntime()) return; // inside the artifact the viewer sets the theme
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function render(root) {
  const s = store.settings();
  root.replaceChildren(h('div', { class: 'grid-2' }, goalCard(s), trainingCard(s)), h('div', { class: 'grid-2' }, backupCard(), dataCard(s)), dangerCard());
}

/* ---------- goal + target pyramid ---------- */
function goalCard(s) {
  datalist('dl-grades', GRADES);
  const goal = h('input', { id: 'prefs-goal', class: 'grade-input', list: 'dl-grades', value: s.goalGrade ?? '8a', autocomplete: 'off' });
  const rowsEl = h('div', { class: 'rows', id: 'prefs-pyramid' });
  const row = (grade = '', count = '') => {
    const r = h('div', { class: 'pyr-edit' },
      h('input', { class: 'grade-input pg', list: 'dl-grades', placeholder: 'Grad', value: grade, autocomplete: 'off', 'aria-label': 'Grad' }),
      h('span', { class: 'x' }, '×'),
      h('input', { class: 'pc', type: 'number', min: 0, step: 1, placeholder: 'Anzahl', value: count, 'aria-label': 'Anzahl Begehungen' }),
      h('button', { type: 'button', class: 'icon-btn', title: 'Zeile entfernen', onclick: () => r.remove() }, icon('close', 16)));
    return r;
  };
  Object.entries(s.targetPyramid ?? {}).sort((a, b) => compareGrades(b[0], a[0])).forEach(([g, c]) => rowsEl.append(row(g, c)));
  const save = guarded(async () => {
    const goalGrade = normalizeGrade(goal.value);
    if (!goalGrade) throw new Error(`„${goal.value}“ ist kein Grad zwischen 5a und 9c.`);
    const targetPyramid = {};
    for (const r of $$('.pyr-edit', rowsEl)) {
      const raw = r.querySelector('.pg').value.trim(), n = Number(r.querySelector('.pc').value);
      if (!raw && !n) continue;
      const g = normalizeGrade(raw);
      if (!g) throw new Error(`„${raw}“ ist kein Grad zwischen 5a und 9c.`);
      if (n > 0) targetPyramid[g] = n;
    }
    await store.saveSettings({ goalGrade, targetPyramid });
    toast('Ziel und Soll-Pyramide gespeichert');
  });
  return card('Ziel und Soll-Pyramide', { hint: 'so viele Begehungen je Grad sollen unter dem Ziel stehen' },
    h('div', { class: 'row' }, field('Zielgrad', goal)),
    h('div', { class: 'section-head' }, h('h3', {}, 'Soll-Pyramide'), h('span', { class: 'hint' }, 'Platzhalter – gemeinsam mit Claude festlegen')),
    rowsEl,
    h('div', { class: 'add-row' }, btn('+ Grad', () => { const r = row(); rowsEl.append(r); r.querySelector('.pg').focus(); }), h('span', { class: 'grow' }), btn('Speichern', save, 'primary')));
}

/* ---------- training defaults ---------- */
function trainingCard(s) {
  const edge = h('input', { type: 'number', id: 'prefs-edge', min: 4, max: 60, step: 1, value: s.defaultEdge ?? 20 });
  const mode = selectInput(MODES.map(m => [m, MODE_LABEL[m]]), s.strengthModeDefault ?? 'lift_one_arm', { id: 'prefs-mode' });
  const hrMax = h('input', { type: 'number', id: 'prefs-hrmax', min: 120, max: 230, step: 1, placeholder: 'optional', value: s.hrMax ?? '' });
  const planStart = h('input', { type: 'date', id: 'prefs-planstart', value: s.planStart ?? '' });
  const others = h('input', { type: 'checkbox', id: 'prefs-others', checked: !!s.includeOtherSports });
  const summer = s.summer ?? {};
  const md = v => (v ? `${v.slice(3)}.${v.slice(0, 2)}.` : '–');
  const themeSeg = seg([['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']], local.get('theme', 'system'), v => { local.set('theme', v); applyTheme(v); });
  const save = guarded(async () => {
    if (planStart.value && !isDate(planStart.value)) throw new Error('Das Startdatum der Planung ist ungültig.');
    await store.saveSettings({
      defaultEdge: Number(edge.value) || 20, strengthModeDefault: mode.value, hrMax: hrMax.value === '' ? null : Number(hrMax.value),
      planStart: planStart.value || s.planStart, includeOtherSports: others.checked,
    });
    toast('Vorgaben gespeichert');
  });
  return card('Training', { hint: 'Vorgaben für neue Einträge und Auswertungen' },
    h('div', { class: 'form-grid' },
      field('Standard-Leiste (mm)', edge, { cls: 'w-half' }),
      field('Maximalkraft – übliche Ausführung', mode, { cls: 'w-half' }),
      field('Maximale Herzfrequenz', hrMax, { cls: 'w-half', hint: 'für den RPE-Vorschlag, wenn Coros keine Trainingsbelastung liefert' }),
      field('Planung gilt ab', planStart, { cls: 'w-half', hint: 'frühere Wochen zeigen keinen Soll-Ist-Abgleich' }),
      h('label', { class: 'field inline w-full' }, h('span', { class: 'lbl' }, 'Coros'), h('span', { class: 'chk' }, others, 'andere Sportarten beim Import als „Sonstiges“ anbieten')),
      h('div', { class: 'field w-full' }, h('span', { class: 'lbl' }, 'Sommer-Variante der Wochenvorlage'), h('div', { class: 'row center-y' }, h('span', {}, `${md(summer.from)} bis ${md(summer.to)}`), btn('Zeitraum ändern', () => openSummerEditor(), 'small'))),
      hasRuntime() ? null : h('div', { class: 'field w-full' }, h('span', { class: 'lbl' }, 'Darstellung'), themeSeg)),
    h('div', { class: 'add-row' }, h('span', { class: 'grow' }), btn('Speichern', save, 'primary')));
}

/* ---------- backup ---------- */
function backupCard() {
  const run = (label, name, build) => guarded(async () => {
    const res = await saveFile(name(), build());
    if (res === 'saved') toast(`${label} gespeichert`);
    else if (res === 'unavailable') toast('Speichern ist in dieser Ansicht nicht möglich.', true);
  });
  return card('Backup und Export', { hint: 'alle Daten als Datei' },
    h('p', { class: 'import-help' }, 'Das Backup enthält jede Sammlung als JSON und lässt sich unter „Import“ wieder einspielen. Im Artifact fragt claude.ai vor dem Speichern nach.'),
    h('div', { class: 'add-row' },
      btn('Backup speichern (JSON)', run('Backup', backupFilename, () => JSON.stringify(buildBackup(), null, 1)), 'primary', 'import'),
      btn('Ticks als CSV', run('Ticks', () => `elevate-ticks-${today()}.csv`, ticksCsv), '', 'import')));
}

/* ---------- data ---------- */
function dataCard(s) {
  const st = store.status;
  const total = COLLECTIONS.reduce((a, c) => a + store.list(c).length, 0);
  return card('Daten', { hint: st.backend === 'claude' ? 'Claude-Datenbank des Artifacts' : 'Lokaler Modus – nur in diesem Browser' },
    facts([
      ['Speicher', st.backend === 'claude' ? 'Claude-DB (nur du liest und schreibst)' : 'localStorage dieses Browsers'],
      ['Einträge gesamt', fmtNum(total)],
      ...COLLECTIONS.filter(c => c !== 'settings' && store.list(c).length).map(c => [COL_LABEL[c], fmtNum(store.list(c).length)]),
      ['Coros zuletzt abgeglichen', s.corosLastSync ? fmtD(s.corosLastSync) : 'noch nie'],
    ]));
}

/* ---------- danger zone ---------- */
function dangerCard() {
  const options = COLLECTIONS.filter(c => c !== 'settings' && store.list(c).length);
  if (!options.length) return null;
  const sel = selectInput(options.map(c => [c, `${COL_LABEL[c]} (${store.list(c).length})`]), options[0], { id: 'prefs-wipe' });
  const wipe = guarded(async () => {
    const col = sel.value, docs = store.list(col);
    if (!await confirmDialog({ title: `${COL_LABEL[col]} löschen?`, text: `Alle ${docs.length} Einträge in „${COL_LABEL[col]}“ werden endgültig gelöscht. Speichere vorher ein Backup, wenn du sie noch brauchst.`, ok: `${docs.length} Einträge löschen` })) return;
    for (const d of docs) await store.remove(col, d.id);
    toast(`${COL_LABEL[col]} gelöscht`);
  });
  return card('Bereich leeren', { hint: 'zum Beispiel vor einem erneuten Import', cls: 'danger-zone' },
    h('div', { class: 'row center-y' }, sel, btn('Alle Einträge löschen', wipe, 'danger', 'trash')));
}
