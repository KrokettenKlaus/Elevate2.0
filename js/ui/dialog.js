// Dialogs, confirmations, toasts and the chart tooltip.
// The artifact frame has no alert/confirm/prompt – everything is built here.
import { h, icon } from './dom.js';

/**
 * Open a modal dialog.
 * @param opts { title, body, foot?, onSubmit?, size?: 'sm'|'md'|'lg', onClose? }
 * @returns { dlg, form, body, close() }
 */
export function openDialog({ title, body, foot, onSubmit, size = 'md', onClose }) {
  const bodyEl = h('div', { class: 'dlg-body' }, body);
  const form = h('form', { method: 'dialog', novalidate: true, class: 'dlg-form' },
    h('div', { class: 'dlg-head' },
      h('h2', {}, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Schließen', onclick: () => dlg.close() }, icon('close'))),
    bodyEl,
    foot ? h('div', { class: 'dlg-foot' }, foot) : null);
  const dlg = h('dialog', { class: `dlg dlg-${size}` }, form);
  let busy = false;
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (busy || !onSubmit) return;
    busy = true;
    form.classList.add('busy');
    try { await onSubmit(ev); }
    catch (e) { console.error(e); toast(e.message || 'Das hat nicht geklappt.', true); }
    finally { busy = false; form.classList.remove('busy'); }
  });
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, form, body: bodyEl, close: () => dlg.close() };
}

/** Replacement for window.confirm(). Resolves true / false. */
export function confirmDialog({ title = 'Sicher?', text = '', ok = 'Löschen', cancel = 'Abbrechen', danger = true }) {
  return new Promise(resolve => {
    let answer = false;
    const d = openDialog({
      title, size: 'sm',
      body: h('p', { class: 'confirm-text' }, text),
      foot: [
        h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => d.close() }, cancel),
        h('button', { type: 'submit', class: `btn ${danger ? 'danger-solid' : 'primary'}` }, ok),
      ],
      onSubmit: () => { answer = true; d.close(); },
      onClose: () => resolve(answer),
    });
    d.form.querySelector('button[type=submit]').focus();
  });
}

/* ---------- Toast (popover, so it stays above open dialogs) ---------- */
let toastEl = null, toastTimer = null;
export function toast(msg, isError = false) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status' });
    try { toastEl.popover = 'manual'; } catch (_) { /* older browsers */ }
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.className = `toast${isError ? ' err' : ''}`;
  try { if (toastEl.matches(':popover-open')) toastEl.hidePopover(); toastEl.showPopover(); }
  catch (_) { toastEl.classList.add('open'); }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    try { toastEl.hidePopover(); } catch (_) { toastEl.classList.remove('open'); }
  }, isError ? 4200 : 2600);
}

/* ---------- Tooltip for charts ---------- */
let tipEl = null;
export function showTip(evt, html) {
  if (!tipEl) { tipEl = h('div', { class: 'tooltip', hidden: true }); document.body.append(tipEl); }
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  let x = evt.clientX + 14, y = evt.clientY + 14;
  if (x + r.width > innerWidth - 8) x = Math.max(8, evt.clientX - r.width - 14);
  if (y + r.height > innerHeight - 8) y = Math.max(8, evt.clientY - r.height - 14);
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${y}px`;
}
export const hideTip = () => { if (tipEl) tipEl.hidden = true; };

/** Run an async action from a click handler and report failures as a toast. */
export function guarded(fn) {
  return async (...args) => {
    try { await fn(...args); }
    catch (e) { console.error(e); toast(e.message || 'Das hat nicht geklappt.', true); }
  };
}

/** Copy text from inside a click handler; falls back to a selectable text field. */
export async function copyText(text, okMsg = 'Kopiert') {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch (_) {
    const ta = h('textarea', { class: 'copy-fallback', rows: 12, readonly: true });
    ta.value = text;
    const d = openDialog({ title: 'Text kopieren', body: [h('p', { class: 'hint' }, 'Automatisches Kopieren ist hier nicht erlaubt. Markiere den Text und kopiere ihn mit Strg+C.'), ta], foot: [h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn primary', onclick: () => d.close() }, 'Fertig')] });
    ta.focus(); ta.select();
  }
}
