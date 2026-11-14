// Ausdauer: running and cycling, imported from COROS or entered by hand.
import store, { clone, newId } from '../store/index.js';
import { addDays, fmtD, fmtDs, today, wd, weekStart } from '../domain/dates.js';
import { MANUAL_SPORTS, RPE_BASIS_LABEL, SPORT_LABEL, moduleForSport, pace, speed, suggestRpe } from '../domain/endurance.js';
import { srpe } from '../domain/load.js';
import { $, $$, emptyState, esc, fmtDur, fmtNum, h, icon, legend, moduleChip, moduleColor, moduleLabel } from '../ui/dom.js';
import { copyText, openDialog, toast } from '../ui/dialog.js';
import { field, formDialog, seg, selectInput } from '../ui/forms.js';
import { barChart, tipKey } from '../ui/charts.js';
import { btn, card, kpi } from '../ui/view.js';
import { hasRuntime } from '../services/caps.js';
import { corosErrorMessage, defaultSince, fetchActivities } from '../services/coros.js';

export const meta = { id: 'endurance', title: 'Ausdauer', sub: 'Laufen und Rad – aus Coros oder von Hand' };

const SOURCE_LABEL = { coros: 'Coros', strava: 'Strava' };
const imported = a => a?.source === 'coros' || a?.source === 'strava';

const acts = () => store.list('endurance_activities');
const sorted = () => [...acts()].sort((a, b) => b.date.localeCompare(a.date) || String(b.startTime ?? '').localeCompare(String(a.startTime ?? '')));
let filter = 'all';
const MODS = ['run', 'ride', 'other'];

export function render(root) {
  root.replaceChildren();
  const all = sorted();
  const settings = store.settings();
  const t = today();
  const lastSync = settings.corosLastSync;
  root.append(h('div', { class: 'toolbar' },
    seg([['all', 'Alle'], ['run', 'Laufen'], ['ride', 'Rad'], ['other', 'Sonstiges']], filter, v => { filter = v; render(root); }),
    h('span', { class: 'hint' }, lastSync ? `Coros zuletzt abgeglichen: ${fmtD(lastSync)}` : 'Coros noch nie abgeglichen'),
    h('span', { class: 'grow' }),
    btn('Coros synchronisieren', () => openSync(), '', 'sync'),
    btn('+ Manuell', () => openEditor(), 'primary')));

  if (!all.length) {
    root.append(emptyState('Noch keine Ausdauer-Einheiten', 'Hole deine Läufe und Radtouren von deiner Coros-Uhr oder trage eine Einheit von Hand ein.',
      h('div', { class: 'row center' }, btn('Coros synchronisieren', () => openSync(), 'primary', 'sync'), btn('+ Manuell', () => openEditor()))));
    return;
  }

  const inRange = (from, m) => all.filter(a => a.date >= from && a.date <= t && (!m || a.module === m));
  const sum = (list, key) => list.reduce((a, x) => a + (Number(x[key]) || 0), 0);
  const ws = weekStart(t), d28 = addDays(t, -27);
  root.append(h('div', { class: 'kpis' },
    kpi('Laufen – diese Woche', `${fmtNum(sum(inRange(ws, 'run'), 'distance_km'), 1)} km`, `${fmtDur(sum(inRange(ws, 'run'), 'duration_min'))} · ${inRange(ws, 'run').length} Einheiten`, 'accent-run'),
    kpi('Rad – diese Woche', `${fmtNum(sum(inRange(ws, 'ride'), 'distance_km'), 1)} km`, `${fmtDur(sum(inRange(ws, 'ride'), 'duration_min'))} · ${inRange(ws, 'ride').length} Einheiten`),
    kpi('Laufen – 28 Tage', `${fmtNum(sum(inRange(d28, 'run'), 'distance_km'), 0)} km`, `${fmtNum(sum(inRange(d28, 'run'), 'elevation_m'))} Hm`),
    kpi('Rad – 28 Tage', `${fmtNum(sum(inRange(d28, 'ride'), 'distance_km'), 0)} km`, `${fmtNum(sum(inRange(d28, 'ride'), 'elevation_m'))} Hm`),
    kpi('Ohne RPE', fmtNum(all.filter(a => !a.rpe).length), 'zählen nicht zur Belastung')));

  // weekly hours, last 12 weeks
  const chart = h('div', { class: 'chart' });
  root.append(card('Stunden pro Woche', { hint: 'letzte 12 Wochen', actions: legend(MODS.map(m => ({ color: moduleColor(m), label: moduleLabel(m) }))) }, chart));
  const weeks = [];
  for (let w = addDays(ws, -77); w <= ws; w = addDays(w, 7)) {
    const list = all.filter(a => a.date >= w && a.date <= addDays(w, 6));
    const by = Object.fromEntries(MODS.map(m => [m, sum(list.filter(a => a.module === m), 'duration_min') / 60]));
    weeks.push({ label: fmtDs(w), strong: w === ws, segs: MODS.map(m => ({ v: by[m], color: moduleColor(m) })),
      tip: `<div class="t">Woche ab ${fmtD(w)}</div>${MODS.filter(m => by[m]).map(m => `${tipKey(moduleColor(m))}${moduleLabel(m)} <b>${fmtNum(by[m], 1)} h</b>`).join('<br>') || 'keine Einheit'}` });
  }
  barChart(chart, weeks, { height: 190, yFmt: v => `${fmtNum(v, 1)} h` });

  // table
  const list = all.filter(a => filter === 'all' || a.module === filter);
  const table = h('div', { class: 'table-wrap' });
  table.innerHTML = `<table><thead><tr><th>Datum</th><th>Sportart</th><th>Name</th><th class="r">Dauer</th><th class="r">Distanz</th><th class="r">Tempo</th><th class="r">Hm</th><th class="r">Ø / max HF</th><th class="r">RPE</th><th class="r">sRPE</th><th>Quelle</th></tr></thead><tbody>${list.map(a => {
    const tempo = a.module === 'run' ? (pace(a.duration_min, a.distance_km) ? `${pace(a.duration_min, a.distance_km)} /km` : '') : (speed(a.duration_min, a.distance_km) ? `${fmtNum(speed(a.duration_min, a.distance_km), 1)} km/h` : '');
    const load = srpe(a);
    return `<tr class="click" data-id="${esc(a.id)}"><td>${wd(a.date)}, ${fmtD(a.date)}</td><td><span class="mchip" style="--c:${moduleColor(a.module)}"><i></i>${esc(SPORT_LABEL[a.sport] ?? a.sport ?? '')}</span></td><td>${esc(a.name ?? '')}</td><td class="r">${fmtDur(a.duration_min)}</td><td class="r">${a.distance_km ? `${fmtNum(a.distance_km, 1)} km` : ''}</td><td class="r">${tempo}</td><td class="r">${a.elevation_m ? fmtNum(a.elevation_m) : ''}</td><td class="r">${a.avg_hr ? `${fmtNum(a.avg_hr)}${a.max_hr ? ` / ${fmtNum(a.max_hr)}` : ''}` : ''}</td><td class="r">${a.rpe ? `<b>${a.rpe}</b>` : '<span class="warn-text">fehlt</span>'}</td><td class="r">${load ? fmtNum(load) : ''}</td><td class="raw">${SOURCE_LABEL[a.source] ?? 'manuell'}</td></tr>`;
  }).join('')}</tbody></table>`;
  $$('tr.click', table).forEach(tr => tr.addEventListener('click', () => openEditor(store.get('endurance_activities', tr.dataset.id))));
  root.append(card(`${list.length} Einheiten`, {}, list.length ? table : h('div', { class: 'chart-empty' }, 'Keine Einheiten in diesem Filter.')));
}

/* ---------- manual entry / edit ---------- */
export function openEditor(act = null, preset = {}) {
  const last = sorted().find(a => !imported(a)) ?? sorted()[0];
  const sports = [...new Set([...MANUAL_SPORTS, ...(act?.sport ? [act.sport] : [])])];
  return formDialog({
    title: act ? (act.name || 'Einheit bearbeiten') : 'Ausdauer-Einheit eintragen',
    intro: imported(act) ? `Aus ${SOURCE_LABEL[act.source]} importiert (ID ${act.corosId ?? act.stravaId}). Du kannst die RPE und alle Werte anpassen; ein erneuter Import überschreibt sie nicht.` : null,
    fields: [
      { key: 'date', label: 'Datum', type: 'date', required: true, width: 'third' },
      { key: 'sport', label: 'Sportart', type: 'select', options: sports.map(s => [s, SPORT_LABEL[s] ?? s]), width: 'third' },
      { key: 'name', label: 'Name', type: 'text', width: 'third', placeholder: 'z. B. Morgenlauf' },
      { key: 'duration_min', label: 'Dauer (min)', type: 'number', required: true, min: 1, step: 1, width: 'third', hint: 'Bewegungszeit' },
      { key: 'distance_km', label: 'Distanz (km)', type: 'number', min: 0, step: 0.01, width: 'third' },
      { key: 'elevation_m', label: 'Höhenmeter', type: 'number', min: 0, step: 1, width: 'third' },
      { key: 'avg_hr', label: 'Ø Herzfrequenz', type: 'number', min: 30, max: 240, step: 1, width: 'third' },
      { key: 'max_hr', label: 'Max. Herzfrequenz', type: 'number', min: 30, max: 240, step: 1, width: 'third' },
      { key: 'rpe', label: 'Anstrengung (RPE)', type: 'rpe', width: 'full' },
      { key: 'notes', label: 'Notizen', type: 'textarea', rows: 2, width: 'full' },
    ],
    value: act ? clone(act) : { date: today(), sport: last?.sport && MANUAL_SPORTS.includes(last.sport) ? last.sport : 'Run', source: 'manual', ...preset },
    onSave: async v => {
      const doc = { ...v, module: moduleForSport(v.sport), source: v.source ?? 'manual' };
      if (!doc.name) doc.name = SPORT_LABEL[doc.sport] ?? doc.sport;
      if (!doc.id) doc.id = newId('endurance_activities');
      await store.put('endurance_activities', doc);
      toast(act ? 'Einheit aktualisiert' : 'Einheit gespeichert');
    },
    onDelete: act ? () => store.remove('endurance_activities', act.id) : null,
    deleteText: imported(act) ? `Die Einheit wird hier gelöscht. Beim nächsten ${SOURCE_LABEL[act.source]}-Abgleich im selben Zeitraum wird sie wieder vorgeschlagen.` : undefined,
  });
}

/* ---------- COROS sync with preview ---------- */
export function openSync() {
  const settings = store.settings();
  const since = h('input', { type: 'date', id: 'coros-since', value: defaultSince(settings.corosLastSync), max: today() });
  const details = h('input', { type: 'checkbox', id: 'coros-details', checked: true });
  const others = h('input', { type: 'checkbox', id: 'coros-others', checked: !!settings.includeOtherSports });
  const status = h('div', { class: 'sync-status' });
  const content = h('div', { class: 'sync-content' });
  const actions = h('div', { class: 'row' });
  let controller = null;
  let result = null;

  const d = openDialog({
    title: 'Coros synchronisieren', size: 'xl',
    body: [
      h('p', { class: 'hint dlg-intro' }, 'Holt alle Aktivitäten seit dem gewählten Datum über deinen Coros-Connector. Bereits importierte Aktivitäten werden an ihrer Coros-ID erkannt und übersprungen. Geschrieben wird erst nach deiner Bestätigung.'),
      h('div', { class: 'row' }, field('Aktivitäten seit', since),
        h('label', { class: 'field inline' }, h('span', { class: 'lbl' }, 'Genauigkeit'), h('span', { class: 'chk' }, details, 'Höhenmeter und Trainingsbelastung laden (ein Abruf pro neuer Einheit)')),
        h('label', { class: 'field inline' }, h('span', { class: 'lbl' }, 'Andere Sportarten'), h('span', { class: 'chk' }, others, 'als „Sonstiges“ anbieten – z. B. Wandern oder Kraft von der Uhr'))),
      status, content,
    ],
    foot: [h('span', { class: 'grow' }), actions],
    onClose: () => controller?.abort(),
  });

  const fetchBtn = btn('Aktivitäten abrufen', run, 'primary', 'sync');
  const cancelBtn = btn('Abbrechen', () => d.close(), 'ghost');
  actions.append(cancelBtn, fetchBtn);

  if (!hasRuntime()) {
    status.append(notice('info', 'Du bist in der lokalen Version. Der Coros-Abruf läuft über den Connector von claude.ai und funktioniert nur im Artifact auf claude.ai. Hier kannst du Einheiten von Hand eintragen.'));
    fetchBtn.disabled = true;
  }

  async function run() {
    controller?.abort();
    controller = new AbortController();
    fetchBtn.disabled = true;
    content.replaceChildren();
    status.replaceChildren(h('div', { class: 'sync-progress' }, h('span', { class: 'spinner' }), h('span', { class: 'msg' }, 'Verbinde mit Coros …')));
    try {
      const knownIds = new Set(acts().map(a => a.id));
      result = await fetchActivities({ since: since.value || null, withDetails: details.checked, knownIds, wantDetail: a => a.module !== 'other' || others.checked, signal: controller.signal, onProgress: msg => { const m = $('.msg', status); if (m) m.textContent = msg; } });
      status.replaceChildren(...result.notes.map(n => notice('info', n)));
      preview();
    } catch (e) {
      console.error(e);
      status.replaceChildren(notice('warn', corosErrorMessage(e)));
      const diag = e.diagnostics ?? null;
      if (diag) content.replaceChildren(diagnosticsBox(diag));
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.lastChild.textContent = 'Erneut abrufen';
    }
  }

  function preview() {
    const { activities } = result;
    const zones = store.settings().hrZones ?? null;
    const existing = new Set(acts().map(a => a.id));
    const known = activities.filter(a => existing.has(a.id));
    const fresh = activities.filter(a => !existing.has(a.id) && (a.module !== 'other' || others.checked));
    const ignored = activities.length - known.length - fresh.length;
    const hrMax = store.settings().hrMax;
    const rows = fresh.map(a => {
      const sug = suggestRpe({ ...a, zones, hrMax });
      return { a, sug, include: true };
    });
    const summary = h('div', { class: 'import-summary' },
      h('b', {}, `${fresh.length} neu`), h('span', {}, `${known.length} bereits vorhanden – übersprungen`),
      ignored ? h('span', {}, `${ignored} andere Sportarten ignoriert`) : null,
      fresh.some(a => a.module === 'other') ? h('span', {}, 'Kraft- und Klettereinheiten von der Uhr zählen doppelt, wenn du sie auch hier einträgst') : null);
    content.replaceChildren(summary);
    if (!fresh.length) {
      content.append(h('div', { class: 'chart-empty' }, activities.length ? 'Alles schon importiert – nichts zu tun.' : 'Coros hat für diesen Zeitraum keine Aktivitäten geliefert.'), diagnosticsBox(result.diagnostics));
      actions.replaceChildren(btn('Schließen', () => finish(0), 'primary'), fetchBtn);
      return;
    }
    const table = h('table', { class: 'preview' }, h('thead', {}, h('tr', {}, ['', 'Datum', 'Sportart', 'Name', 'Dauer', 'Distanz', 'Hm', 'Ø HF', 'Zuordnung', 'RPE', 'Grundlage'].map(t => h('th', {}, t)))));
    const body = h('tbody');
    for (const r of rows) {
      const check = h('input', { type: 'checkbox', checked: true, 'aria-label': 'importieren', onchange: () => { r.include = check.checked; tr.classList.toggle('off', !r.include); count(); } });
      const mod = selectInput([['run', 'Laufen'], ['ride', 'Rad'], ['other', 'Sonstiges']], r.a.module, { onchange: () => { r.a.module = mod.value; } });
      const rpe = selectInput([['', '–'], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)])], r.sug.rpe ? String(r.sug.rpe) : '', { class: 'rpe-select', onchange: () => { r.rpe = rpe.value ? Number(rpe.value) : null; r.touched = true; } });
      r.rpe = r.sug.rpe;
      const tr = h('tr', {},
        h('td', {}, check), h('td', {}, `${wd(r.a.date)}, ${fmtD(r.a.date)}`), h('td', {}, SPORT_LABEL[r.a.sport] ?? r.a.sport), h('td', {}, r.a.name),
        h('td', { class: 'r' }, fmtDur(r.a.duration_min)), h('td', { class: 'r' }, r.a.distance_km ? `${fmtNum(r.a.distance_km, 1)} km` : ''),
        h('td', { class: 'r' }, r.a.elevation_m != null ? fmtNum(r.a.elevation_m) : ''), h('td', { class: 'r' }, r.a.avg_hr ? fmtNum(r.a.avg_hr) : '–'), h('td', {}, mod), h('td', {}, rpe), h('td', { class: 'raw' }, RPE_BASIS_LABEL[r.sug.basis]));
      body.append(tr);
    }
    table.append(body);
    content.append(h('div', { class: 'table-wrap tall' }, table), diagnosticsBox(result.diagnostics));
    const importBtn = btn('', doImport, 'primary');
    const count = () => { const n = rows.filter(r => r.include).length; importBtn.textContent = `${n} Aktivitäten importieren`; importBtn.disabled = !n; };
    count();
    actions.replaceChildren(cancelBtn, fetchBtn, importBtn);

    async function doImport() {
      importBtn.disabled = true;
      const docs = rows.filter(r => r.include).map(r => {
        const { trainingLoad, ...doc } = r.a;
        return { ...doc, rpe: r.rpe ?? null, rpeSuggested: r.sug.rpe ?? null, rpeBasis: r.sug.basis };
      });
      const res = await store.putMany('endurance_activities', docs, { onProgress: (n, total) => { importBtn.textContent = `${n} von ${total} …`; } });
      const failed = res.filter(x => !x.ok);
      await store.saveSettings({ corosLastSync: today(), includeOtherSports: others.checked });
      if (failed.length) toast(`${failed.length} Aktivitäten konnten nicht gespeichert werden: ${failed[0].error.message}`, true);
      finish(res.length - failed.length);
    }
  }

  async function finish(n) {
    if (n === 0 && result) await store.saveSettings({ corosLastSync: today() }).catch(() => {});
    d.close();
    if (n) toast(`${n} Aktivitäten importiert`);
  }
  return d;
}

function notice(kind, text) {
  return h('div', { class: `notice ${kind}` }, icon(kind === 'warn' ? 'warn' : 'info', 16), h('span', {}, text));
}

/** What the connector answered, without any activity data – useful when the mapping needs work. */
function diagnosticsBox(diag) {
  const text = JSON.stringify(diag, null, 2);
  return h('details', { class: 'table-toggle' }, h('summary', {}, 'Technische Details zum Abruf'),
    h('pre', { class: 'raw-block' }, text),
    btn('Details kopieren', () => copyText(text), 'small', 'copy'));
}

export const openNew = preset => openEditor(null, preset);
export { moduleChip };
