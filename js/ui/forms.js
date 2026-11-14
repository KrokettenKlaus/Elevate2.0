// Form controls and a declarative form dialog for the simple editors.
import { GRADES, normalizeGrade } from '../domain/grades.js';
import { $, h, icon } from './dom.js';
import { confirmDialog, openDialog, toast } from './dialog.js';

let uid = 0;
const nextId = p => `${p}-${++uid}`;

/** <label> wrapper. Controls made of buttons use a <div> so the label does not click them. */
export function field(label, control, { hint, cls = '', block = false } = {}) {
  const tag = block || control.classList?.contains('seg') || control.classList?.contains('rpe') ? 'div' : 'label';
  return h(tag, { class: `field ${cls}` }, h('span', { class: 'lbl' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function selectInput(options, value, attrs = {}) {
  const el = h('select', attrs, options.map(o => {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v }, label);
  }));
  if (value != null) el.value = value;
  return el;
}

/** Segmented control. `el.getValue()` / `el.setValue(v)`. */
export function seg(options, value, onChange, { allowNone = false, cls = '' } = {}) {
  let current = value ?? null;
  const el = h('div', { class: `seg ${cls}`, role: 'group' });
  const paint = () => [...el.children].forEach(b => { const on = b.dataset.v === String(current); b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  for (const o of options) {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    el.append(h('button', { type: 'button', dataset: { v: String(v) }, onclick: () => {
      current = allowNone && String(current) === String(v) ? null : v;
      paint();
      onChange?.(current);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } }, label));
  }
  el.getValue = () => current;
  el.setValue = v => { current = v; paint(); };
  paint();
  return el;
}

const RPE_WORDS = ['', 'sehr leicht', 'leicht', 'locker', 'moderat', 'etwas anstrengend', 'anstrengend', 'hart', 'sehr hart', 'extrem hart', 'maximal'];

/** RPE 1–10 as a row of buttons; click the active value again to clear it. */
export function rpeScale(value) {
  const word = h('span', { class: 'rpe-word' });
  const scale = seg([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], value ?? null, v => { word.textContent = v ? RPE_WORDS[v] : 'keine Angabe'; }, { allowNone: true, cls: 'rpe-seg' });
  word.textContent = value ? RPE_WORDS[value] : 'keine Angabe';
  const el = h('div', { class: 'rpe' }, scale, word);
  el.getValue = () => { const v = scale.getValue(); return v == null ? null : Number(v); };
  el.setValue = v => { scale.setValue(v); word.textContent = v ? RPE_WORDS[v] : 'keine Angabe'; };
  return el;
}

/** Shared <datalist>; returns its id for the `list` attribute. */
export function datalist(id, values) {
  let el = document.getElementById(id);
  if (!el) { el = h('datalist', { id }); document.body.append(el); }
  el.replaceChildren(...[...new Set(values.filter(Boolean))].map(v => h('option', { value: v })));
  return id;
}

export const readNum = el => (el.value === '' || el.value == null ? null : Number(String(el.value).replace(',', '.')));
export const readText = el => el.value.trim();

function buildControl(f, value) {
  const id = nextId('f');
  switch (f.type) {
    case 'select': {
      const el = selectInput(f.options, value ?? f.options[0]?.[0] ?? f.options[0], { id });
      return { el, get: () => el.value };
    }
    case 'seg': {
      const el = seg(f.options, value ?? null, null, { allowNone: !!f.allowNone });
      return { el, get: () => el.getValue() };
    }
    case 'rpe': {
      const el = rpeScale(value);
      return { el, get: () => el.getValue() };
    }
    case 'check': {
      const box = h('input', { type: 'checkbox', id, checked: !!value });
      return { el: h('span', { class: 'chk' }, box, f.text ?? ''), get: () => box.checked, inline: true };
    }
    case 'textarea': {
      const el = h('textarea', { id, rows: f.rows ?? 3, placeholder: f.placeholder ?? '' });
      el.value = value ?? '';
      return { el, get: () => el.value.trim() };
    }
    case 'number': {
      const el = h('input', { type: 'number', id, inputmode: 'decimal', min: f.min, max: f.max, step: f.step ?? 'any', placeholder: f.placeholder ?? '', value: value ?? '' });
      return { el, get: () => readNum(el) };
    }
    case 'date': {
      const el = h('input', { type: 'date', id, value: value ?? '' });
      return { el, get: () => el.value || null };
    }
    case 'grade': {
      const el = h('input', { type: 'text', id, list: datalist('dl-grades', GRADES), placeholder: f.placeholder ?? 'z. B. 7b+', value: value ?? '', autocomplete: 'off', class: 'grade-input' });
      return { el, get: () => (el.value.trim() ? normalizeGrade(el.value) ?? el.value.trim() : null), validate: () => (!el.value.trim() || normalizeGrade(el.value) ? null : `„${el.value}“ ist kein Grad zwischen 5a und 9c.`) };
    }
    default: {
      const el = h('input', { type: 'text', id, placeholder: f.placeholder ?? '', value: value ?? '', list: f.list ? datalist(`dl-${f.key}`, f.list) : null, autocomplete: 'off' });
      return { el, get: () => el.value.trim() };
    }
  }
}

/**
 * Declarative form dialog.
 * fields: [{ key, label, type, options, placeholder, hint, required, width: 'full'|'half'|'third'|'two-thirds', showIf(values), default, … }]
 * onSave(values) may throw; onDelete() is offered when given.
 */
export function formDialog({ title, fields, value = {}, onSave, onDelete, deleteText, saveLabel = 'Speichern', size = 'md', intro, extraButtons = [] }) {
  const controls = new Map();
  const wraps = new Map();
  const grid = h('div', { class: 'form-grid' });
  for (const f of fields) {
    if (f.type === 'heading') { const el = h('h3', { class: 'form-heading w-full' }, f.label); grid.append(el); wraps.set(f, el); continue; }
    const c = buildControl(f, value[f.key] ?? f.default);
    controls.set(f.key, c);
    const wrap = field(f.label, c.el, { hint: f.hint, cls: `w-${f.width ?? 'half'}${c.inline ? ' inline' : ''}` });
    wraps.set(f, wrap);
    grid.append(wrap);
  }
  const read = () => {
    const out = {};
    for (const [k, c] of controls) out[k] = c.get();
    return out;
  };
  const refresh = () => {
    const vals = read();
    for (const [f, wrap] of wraps) if (f.showIf) wrap.hidden = !f.showIf(vals);
  };
  grid.addEventListener('input', refresh);
  grid.addEventListener('change', refresh);
  refresh();

  const d = openDialog({
    title, size,
    body: [intro ? h('p', { class: 'hint dlg-intro' }, intro) : null, grid],
    foot: [
      onDelete ? h('button', { type: 'button', class: 'btn ghost danger', onclick: async () => {
        if (!await confirmDialog({ title: 'Eintrag löschen?', text: deleteText ?? 'Der Eintrag wird endgültig gelöscht.' })) return;
        try { await onDelete(); d.close(); toast('Gelöscht'); } catch (e) { toast(e.message, true); }
      } }, icon('trash', 16), 'Löschen') : null,
      ...extraButtons,
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => d.close() }, 'Abbrechen'),
      h('button', { type: 'submit', class: 'btn primary' }, saveLabel),
    ],
    onSubmit: async () => {
      const vals = read();
      for (const f of fields) {
        if (!controls.has(f.key) || wraps.get(f).hidden) continue;
        const c = controls.get(f.key);
        const v = vals[f.key];
        const problem = c.validate?.() ?? (f.required && (v == null || v === '') ? `Bitte „${f.label}“ ausfüllen.` : null);
        if (problem) { toast(problem, true); $('input,select,textarea,button', wraps.get(f))?.focus(); return; }
      }
      const hidden = fields.filter(f => controls.has(f.key) && wraps.get(f).hidden).map(f => f.key);
      for (const k of hidden) delete vals[k];
      await onSave({ ...value, ...vals });
      d.close();
    },
  });
  return { ...d, controls, read };
}
