// Tests (benchmarks) and the body-weight series.
import store, { clone, newId } from '../store/index.js';
import { fmtD, today, wd } from '../domain/dates.js';
import { bodyweightAt } from '../domain/hangboard.js';
import { TEST_LABEL, TEST_TYPES, describeTest, testSeries, testValue } from '../domain/tests.js';
import { $$, emptyState, esc, fmtNum, fmtPct, h } from '../ui/dom.js';
import { toast } from '../ui/dialog.js';
import { formDialog } from '../ui/forms.js';
import { lineChart } from '../ui/charts.js';
import { badge, btn, card, kpi } from '../ui/view.js';

export const meta = { id: 'tests', title: 'Tests', sub: 'Benchmarks, Referenz vor der Verletzung und Körpergewicht' };

const tests = () => store.list('tests');
const weights = () => [...store.list('bodyweight')].sort((a, b) => a.date.localeCompare(b.date));

export function render(root) {
  root.replaceChildren();
  const bw = weights();
  const bwNow = bodyweightAt(bw, today());
  const all = [...tests()].sort((a, b) => b.date.localeCompare(a.date));
  const series = testSeries(tests(), bwNow?.kg ?? null);

  const refHang = tests().find(t => t.isReference && t.type === 'max_hang');
  const refPull = tests().find(t => t.isReference && t.type === 'max_pullup');
  const hangSeries = refHang ? series.find(s => s.key === `max_hang|${refHang.protocol.edge_mm}`) : null;
  const lastHang = hangSeries?.pts.at(-1);
  const pullSeries = series.find(s => s.key === 'max_pullup');
  const lastPull = pullSeries?.pts.at(-1);
  const refHangV = refHang ? testValue(refHang).value : null;
  const refPullV = refPull ? testValue(refPull).value : null;

  root.append(h('div', { class: 'kpis' },
    kpi('Körpergewicht', bwNow ? `${fmtNum(bwNow.kg, 1)} kg` : '–', bwNow ? `Stand ${fmtD(bwNow.date)}` : 'noch kein Eintrag', 'accent'),
    kpi('Max Hang – Referenz', refHangV != null ? fmtPct(refHangV) : '–', refHang ? describeTest(refHang) : 'keine Referenz hinterlegt'),
    kpi('Max Hang – aktuell', lastHang?.y != null ? fmtPct(lastHang.y) : '–', lastHang ? `${fmtD(lastHang.date)}${refHangV ? ` · ${fmtNum(lastHang.y / refHangV * 100)} % der Referenz` : ''}` : `noch kein Test auf ${refHang?.protocol.edge_mm ?? 25} mm`),
    kpi('Max Pull-up – Referenz', refPull ? `${refPull.protocol.reps} × +${fmtNum(refPull.protocol.load_kg, 1)} kg` : '–', refPullV != null ? `≈ ${fmtPct(refPullV)} KG als 1RM` : ''),
    kpi('Max Pull-up – aktuell', lastPull ? `${lastPull.test.protocol.reps} × +${fmtNum(lastPull.test.protocol.load_kg, 1)} kg` : '–', lastPull ? `${fmtD(lastPull.date)}${refPullV && lastPull.y ? ` · ${fmtNum(lastPull.y / refPullV * 100)} % der Referenz` : ''}` : 'noch kein Test')));

  // ---- body weight
  const bwChart = h('div', { class: 'chart' });
  const bwList = h('div', { class: 'table-wrap' });
  root.append(h('div', { class: 'grid-2' },
    card('Körpergewicht', { hint: 'Grundlage für alle %-Werte', actions: btn('+ Eintrag', () => openWeightEditor(), 'small primary') }, bwChart),
    card('Einträge', {}, bwList)));
  lineChart(bwChart, [{ name: 'Körpergewicht', color: 'var(--accent)', pts: bw.map(e => ({ date: e.date, y: Number(e.kg) })) }], { unit: ' kg', zeroBased: false, height: 200, empty: 'Noch kein Körpergewicht eingetragen' });
  if (bw.length) {
    bwList.innerHTML = `<table><thead><tr><th>Datum</th><th class="r">kg</th><th class="r">Veränderung</th></tr></thead><tbody>${[...bw].reverse().slice(0, 8).map((e, i, arr) => {
      const prev = arr[i + 1];
      const diff = prev ? Number(e.kg) - Number(prev.kg) : null;
      return `<tr class="click" data-id="${esc(e.id)}"><td>${wd(e.date)}, ${fmtD(e.date)}</td><td class="r"><b>${fmtNum(e.kg, 1)}</b></td><td class="r">${diff == null ? '' : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${fmtNum(Math.abs(diff), 1)}`}</td></tr>`;
    }).join('')}</tbody></table>`;
    $$('tr.click', bwList).forEach(tr => tr.addEventListener('click', () => openWeightEditor(store.get('bodyweight', tr.dataset.id))));
  } else bwList.append(h('div', { class: 'chart-empty' }, 'Noch kein Eintrag'));

  // ---- benchmark series
  root.append(h('div', { class: 'toolbar' }, h('h2', { class: 'section-title' }, 'Benchmarks'), h('span', { class: 'hint' }, 'Tests auf unterschiedlichen Leisten werden getrennt dargestellt.'), h('span', { class: 'grow' }), btn('+ Test', () => openTestEditor(), 'primary')));
  if (!all.length) root.append(emptyState('Noch keine Tests', 'Trage einen Max Hang oder Max Pull-up ein, um ihn mit der Referenz von vor der Verletzung zu vergleichen.'));
  const grid = h('div', { class: 'grid-2' });
  for (const s of series) {
    const chart = h('div', { class: 'chart' });
    const numeric = s.pts.filter(p => p.y != null);
    const unit = (s.reference ?? s.pts[0])?.unit ?? '';
    grid.append(card(s.label, { hint: unit }, chart,
      h('ul', { class: 'ex-list test-list' }, [...(s.reference ? [s.reference] : []), ...s.pts].reverse().map(p => h('li', { class: 'click', onclick: () => openTestEditor(p.test) },
        h('span', { class: 'n' }, p.test.dateApprox ? `ca. ${fmtD(p.date)}` : fmtD(p.date), ' ', p.test.isReference ? badge('Referenz', 'ref') : null),
        h('span', { class: 'd' }, describeTest(p.test), p.y != null ? ` · ${fmtNum(p.y, 0)} ${p.unit}` : ''))))));
    const refLines = s.reference?.y != null ? [{ y: s.reference.y, label: `Referenz ${fmtNum(s.reference.y)} ${s.reference.unit}`, cls: 'ref' }] : [];
    if (numeric.length || refLines.length) {
      const pts = numeric.length ? numeric : [];
      if (pts.length) lineChart(chart, [{ name: s.label, color: 'var(--m-hangboard)', pts }], { refLines, zeroBased: false, height: 190, tipFn: hits => `<div class="t">${fmtD(hits[0].date)}</div>${esc(describeTest(hits[0].test))}<br><b>${fmtNum(hits[0].y, 1)} ${esc(hits[0].unit)}</b>` });
      else chart.append(h('div', { class: 'chart-empty' }, `Referenz: ${fmtNum(s.reference.y)} ${s.reference.unit}. Der erste eigene Test erscheint hier als Punkt über der Linie – oder darunter.`));
    } else chart.append(h('div', { class: 'chart-empty' }, 'Frei beschriebener Test – trage einen Zahlenwert ein, um einen Verlauf zu sehen.'));
  }
  root.append(grid);
}

/* ---------- editors ---------- */
export function openWeightEditor(entry = null) {
  return formDialog({
    title: entry ? 'Körpergewicht bearbeiten' : 'Körpergewicht eintragen', size: 'sm',
    fields: [
      { key: 'date', label: 'Datum', type: 'date', required: true, width: 'half' },
      { key: 'kg', label: 'Gewicht (kg)', type: 'number', required: true, min: 30, max: 200, step: 0.1, width: 'half' },
    ],
    value: entry ? clone(entry) : { date: today(), kg: bodyweightAt(weights(), today())?.kg ?? '' },
    onSave: async v => {
      const id = `bw-${v.date.replaceAll('-', '')}`;
      if (entry && entry.id !== id) await store.remove('bodyweight', entry.id);
      await store.put('bodyweight', { ...v, id });
      toast('Körpergewicht gespeichert');
    },
    onDelete: entry ? () => store.remove('bodyweight', entry.id) : null,
  });
}

const flat = t => ({ ...t, p_edge: t.protocol?.edge_mm, p_time: t.protocol?.time_s, p_load: t.protocol?.load_kg, p_reps: t.protocol?.reps, p_text: t.protocol?.text });

export function openTestEditor(test = null, preset = {}) {
  const settings = store.settings();
  const value = test ? flat(clone(test)) : flat({ date: today(), type: 'max_hang', protocol: { edge_mm: 25, time_s: 5 }, bodyweight_kg: bodyweightAt(weights(), today())?.kg ?? null, ...preset });
  const isHang = v => v.type === 'max_hang', isPull = v => v.type === 'max_pullup', isFree = v => !isHang(v) && !isPull(v);
  return formDialog({
    title: test ? `Test – ${TEST_LABEL[test.type] ?? test.type}` : 'Neuer Test',
    intro: test?.isReference ? 'Referenzwert von vor der Verletzung. Das Körpergewicht zum Testzeitpunkt ist geschätzt und kann hier korrigiert werden.' : null,
    fields: [
      { key: 'date', label: 'Datum', type: 'date', required: true, width: 'third' },
      { key: 'type', label: 'Testart', type: 'select', options: TEST_TYPES.map(t => [t, TEST_LABEL[t]]), width: 'third' },
      { key: 'bodyweight_kg', label: 'Körpergewicht (kg)', type: 'number', step: 0.1, width: 'third', hint: 'am Testtag' },
      { key: 'name', label: 'Name des Tests', type: 'text', width: 'full', showIf: v => v.type === 'custom', list: tests().filter(t => t.type === 'custom').map(t => t.name) },
      { key: 'p_edge', label: 'Leiste (mm)', type: 'number', min: 4, step: 1, width: 'third', showIf: isHang, default: settings.defaultEdge ?? 20 },
      { key: 'p_time', label: 'Zeit (s)', type: 'number', min: 1, step: 1, width: 'third', showIf: isHang },
      { key: 'p_reps', label: 'Wiederholungen', type: 'number', min: 1, step: 1, width: 'third', showIf: isPull },
      { key: 'p_load', label: 'Zusatzgewicht (kg)', type: 'number', step: 0.5, width: 'third', showIf: v => isHang(v) || isPull(v), hint: 'beidarmig, negativ = entlastet' },
      { key: 'p_text', label: 'Protokoll', type: 'text', width: 'full', showIf: isFree, placeholder: 'Wie wurde getestet?' },
      { key: 'result', label: 'Ergebnis', type: 'text', width: 'half', showIf: isFree, placeholder: 'frei beschrieben' },
      { key: 'value', label: 'Zahlenwert', type: 'number', step: 'any', width: 'third', showIf: isFree, hint: 'für den Verlauf' },
      { key: 'unit', label: 'Einheit', type: 'text', width: 'third', showIf: isFree, placeholder: 'z. B. Wdh., s' },
      { key: 'note', label: 'Notiz', type: 'textarea', rows: 2, width: 'full' },
      { key: 'isReference', label: 'Referenz', type: 'check', text: 'als Referenzlinie in den Diagrammen zeigen', width: 'half' },
      { key: 'dateApprox', label: 'Datum', type: 'check', text: 'nur ungefähr bekannt', width: 'half' },
    ],
    value,
    onSave: async v => {
      const { p_edge, p_time, p_load, p_reps, p_text, ...doc } = v;
      doc.protocol = doc.type === 'max_hang' ? { edge_mm: p_edge, time_s: p_time, load_kg: p_load ?? 0 }
        : doc.type === 'max_pullup' ? { reps: p_reps, load_kg: p_load ?? 0 }
        : { text: p_text ?? '' };
      if (doc.type === 'max_hang' && !(doc.protocol.edge_mm > 0)) throw new Error('Bitte die Leistengröße angeben.');
      if (doc.type === 'max_pullup' && !(doc.protocol.reps > 0)) throw new Error('Bitte die Wiederholungen angeben.');
      if (doc.type === 'custom' && !doc.name) throw new Error('Bitte dem Test einen Namen geben.');
      if (doc.bodyweightAssumed && test && Number(test.bodyweight_kg) !== Number(doc.bodyweight_kg)) doc.bodyweightAssumed = false;
      if (!doc.id) doc.id = newId('tests');
      await store.put('tests', doc);
      toast(test ? 'Test aktualisiert' : 'Test gespeichert');
    },
    onDelete: test ? () => store.remove('tests', test.id) : null,
  });
}

export const openNew = preset => openTestEditor(null, preset);
