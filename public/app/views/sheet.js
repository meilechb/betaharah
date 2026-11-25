/*
 * A sheet: a native modal <dialog> outside the page's root (so a redraw of
 * the page leaves it alone). A bottom sheet on a phone, a panel on a wide
 * screen (dashboard.css). Escape, a click outside and Close close it; the
 * focus then goes back to the control that opened it.
 */
import { button, h } from '../lib.js';

/**
 * openSheet({ id, title, body: close => nodes, opener, className, focus })
 * opener: the id of the control to focus afterwards; focus: the id to focus first.
 */
export function openSheet(o) {
  const old = document.getElementById(o.id);
  if (old) old.remove();
  let dlg = null;
  const close = () => {
    if (dlg && dlg.open) dlg.close();
  };
  dlg = h(
    'dialog',
    { class: 'sheet-dialog' + (o.className ? ' ' + o.className : ''), id: o.id, 'aria-labelledby': o.id + '-title' },
    h(
      'div',
      { class: 'sheet-inner' },
      h('div', { class: 'sheet-head' }, h('h2', { id: o.id + '-title' }, o.title), button({ label: 'Close', icon: 'close', size: 'sm', attrs: { id: o.id + '-close' }, onclick: close })),
      h('div', { class: 'sheet-body' }, o.body(close)),
    ),
  );
  dlg.addEventListener('click', e => {
    if (e.target === dlg) close();
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    const el = o.opener ? document.getElementById(o.opener) : null;
    if (el) el.focus();
    if (o.onclose) o.onclose();
  });
  document.body.append(dlg);
  dlg.showModal();
  const first = o.focus ? document.getElementById(o.focus) : null;
  if (first) first.focus();
  return close;
}
