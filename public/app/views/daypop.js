/*
 * The small popup of a day on the home calendar, beside the day it belongs to.
 *
 *   - one short line at the top: what is expected that day (worked out, not recorded);
 *   - what is recorded on that day, one row each, with Edit and Delete
 *     (Delete asks once, in the popup; Edit changes the date and day or night
 *     in place: the entry is recorded again and the old one removed);
 *   - for today or an earlier day, what can be added, the likeliest first:
 *     the hefsek taharah on a day it can be done, then "A period began" (by day
 *     or at night, asked only for a day before today), then "More" (the full form).
 *     A future day has nothing to add.
 * One tap records; the popup closes and the server's sentence (with Undo) is
 * shown under the month. Up and Down move between the popup's buttons.
 */
import { api, button, h } from '../lib.js';
import { S, adopt, render, t } from '../store.js';
import { entryMark, isDone, isNight, plainTitle, wasRecorded } from './marks.js';
import { addDays, attempt, today } from './shared.js';
import { openRecord, recordNow } from './record.js';
import { dateText, dayWord, spokenDate } from './dates.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const timed = kind => kind === 'flow' || kind === 'stain' || kind === 'broken';

/** What the popup is doing: asking day or night for a period ('ask'), editing or deleting an entry. */
let ui = { date: null, ask: false, edit: null, del: null, error: '' };
const fresh = date => ({ date, ask: false, edit: null, del: null, error: '' });

// ---------- the entries recorded on a date ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CIVIL = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2}), (\d{4})/;

/** The civil date of an entry: its own field when the server sends one, otherwise read from its text. */
export function entryDate(e) {
  if (e.date) return e.date;
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(e.text || '');
  if (iso) return iso[1];
  const m = CIVIL.exec(e.text || '');
  if (!m) return null;
  return m[3] + '-' + String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0') + '-' + m[2].padStart(2, '0');
}

/** 'day', 'night', a clock time, or '' (a hefsek taharah, an immersion). */
export function entryPart(e) {
  if (e.part) return e.part;
  if (!timed(e.kind)) return '';
  const text = e.text || '';
  const time = /\b(\d{1,2}:\d{2} ?[AP]M)\b/.exec(text);
  if (time) return time[1];
  if (/evening|at night|\bnight\b/i.test(text)) return 'night';
  return 'day';
}

const partWords = part => (part === 'day' ? 'by day' : part === 'night' ? 'at night' : part ? 'at ' + part : '');

function entriesOn(date) {
  return (S.entries || []).filter(e => entryDate(e) === date);
}

// ---------- recording, deleting, editing ----------

function recorded(result) {
  adopt(result.state);
}

function remove(e, btn) {
  attempt(() => api('DELETE', '/api/entries/' + encodeURIComponent(e.id)), {
    button: btn,
    done: r => {
      recorded(r);
      ui = fresh(ui.date);
      render();
      const first = document.querySelector('#day-pop button');
      if (first) first.focus({ preventScroll: true });
    },
    fail: message => {
      ui.error = message;
      render();
    },
  });
}

/** Edit: the entry is recorded again on the new date (and day or night), then the old one is removed. */
function saveEdit(e, btn) {
  const ed = ui.edit;
  const body = { kind: e.kind, date: ed.date };
  if (timed(e.kind)) body.part = ed.part === 'night' ? 'night' : 'day';
  if (e.note) body.note = e.note;
  if (ed.date === entryDate(e) && (!timed(e.kind) || body.part === entryPart(e))) {
    ui = fresh(ui.date);
    render();
    return;
  }
  attempt(
    async () => {
      const made = await api('POST', '/api/entries', body);
      return api('DELETE', '/api/entries/' + encodeURIComponent(e.id)).catch(() => made);
    },
    {
      button: btn,
      done: r => {
        recorded(r);
        ui = fresh(ed.date);
        render();
        document.getElementById('day-' + ed.date)?.focus({ preventScroll: true });
      },
      fail: message => {
        ui.error = message;
        render();
      },
    },
  );
}

// ---------- the parts of the popup ----------

function expectedLine(events) {
  const shown = events.filter(e => !wasRecorded(e));
  if (shown.length === 0) return null;
  return h('p', { class: 'pop-expected', id: 'pop-expected' }, shown.map(plainTitle).join(' · '));
}

function entryRow(e, close) {
  const label = S.labels.kinds[e.kind] || e.kind;
  const part = partWords(entryPart(e));
  if (ui.del === e.id) {
    return h(
      'li',
      { class: 'pop-entry asking' },
      h('span', { class: 'pop-what' }, 'Delete ' + label.toLowerCase() + '?'),
      h(
        'span',
        { class: 'pop-acts' },
        button({ label: 'Delete', variant: 'danger', size: 'sm', attrs: { id: 'pop-del-yes' }, onclick: ev => remove(e, ev.currentTarget) }),
        button({ label: 'Keep', size: 'sm', attrs: { id: 'pop-del-no' }, onclick: () => ((ui.del = null), render(), document.getElementById('pop-delete-' + e.id)?.focus()) }),
      ),
    );
  }
  if (ui.edit && ui.edit.id === e.id) {
    const ed = ui.edit;
    return h(
      'li',
      { class: 'pop-entry editing' },
      h('span', { class: 'pop-what' }, entryMark(e.kind), h('span', {}, label)),
      h(
        'div',
        { class: 'pop-edit' },
        h('label', { class: 'visually-hidden', for: 'pop-edit-date' }, 'Date'),
        h('input', { type: 'date', id: 'pop-edit-date', value: ed.date, max: today(), min: S.grid ? S.grid.days[0].date : null, oninput: ev => (ed.date = ev.target.value) }),
        timed(e.kind)
          ? h(
              'span',
              { class: 'pop-parts', role: 'group', 'aria-label': 'Day or night' },
              ['day', 'night'].map(p =>
                button({
                  label: p === 'day' ? 'Day' : 'Night',
                  size: 'sm',
                  attrs: { id: 'pop-edit-' + p, 'aria-pressed': String(ed.part === p) },
                  onclick: () => {
                    ed.part = p;
                    render();
                    document.getElementById('pop-edit-' + p)?.focus();
                  },
                }),
              ),
            )
          : null,
      ),
      h(
        'span',
        { class: 'pop-acts' },
        button({ label: 'Save', variant: 'primary', size: 'sm', attrs: { id: 'pop-edit-save' }, onclick: ev => saveEdit(e, ev.currentTarget) }),
        button({ label: 'Cancel', size: 'sm', attrs: { id: 'pop-edit-cancel' }, onclick: () => ((ui.edit = null), (ui.error = ''), render(), document.getElementById('pop-edit-' + e.id)?.focus()) }),
      ),
    );
  }
  return h(
    'li',
    { class: 'pop-entry' },
    h('span', { class: 'pop-what' }, entryMark(e.kind), h('span', {}, label + (part ? ', ' + part : ''))),
    h(
      'span',
      { class: 'pop-acts' },
      button({
        label: 'Edit',
        size: 'sm',
        variant: 'link',
        attrs: { id: 'pop-edit-' + e.id, 'aria-label': 'Edit ' + label.toLowerCase() },
        onclick: () => {
          const p = entryPart(e);
          ui.edit = { id: e.id, date: entryDate(e), part: p === 'night' ? 'night' : 'day' };
          ui.del = null;
          ui.error = '';
          render();
          document.getElementById('pop-edit-date')?.focus();
        },
      }),
      button({
        label: 'Delete',
        size: 'sm',
        variant: 'link',
        attrs: { id: 'pop-delete-' + e.id, 'aria-label': 'Delete ' + label.toLowerCase() },
        onclick: () => {
          ui.del = e.id;
          ui.edit = null;
          render();
          document.getElementById('pop-del-no')?.focus();
        },
      }),
    ),
  );
}

/** What can be added on a day, the likeliest first. */
function addItems(date, events, entries, niddah, close) {
  const isToday = date === today();
  const items = [];
  // the hefsek taharah, on a day it can be done: in a niddah period with no hefsek taharah recorded,
  // from the last day of the wait (the customs' minimum days, counted from the Hebrew date the period began)
  const all = S.grid ? S.grid.events : [];
  const flow = all.filter(e => e.kind === 'flow' && e.startDate <= date).pop();
  const wait = Number(S.halachic && S.halachic.settings && S.halachic.settings.minWaitDays) || 5;
  const earliest = flow ? addDays(flow.startDate, wait - 1 + (isNight(flow) ? 1 : 0)) : null;
  const hasHefsek = flow && all.some(e => e.kind === 'hefsek' && isDone(e) && e.startDate >= flow.startDate);
  if (flow && niddah && !hasHefsek && date >= earliest) {
    items.push(
      button({
        label: cap(t('{hefsek} done')),
        className: 'pop-item',
        attrs: { id: 'pop-add-hefsek' },
        onclick: ev => recordNow({ kind: 'hefsek', date }, ev.currentTarget, 'day', () => close(true, true)),
      }),
    );
  }
  const flows = entries.filter(e => e.kind === 'flow').map(entryPart);
  const flowParts = ['day', 'night'].filter(p => !flows.includes(p));
  if (flowParts.length) {
    if (ui.ask) {
      items.push(
        h(
          'div',
          { class: 'pop-ask', role: 'group', 'aria-label': 'A period began' },
          flowParts.map(p =>
            button({
              label: p === 'day' ? 'By day' : 'At night',
              className: 'pop-item',
              attrs: { id: 'pop-add-flow-' + p },
              onclick: ev => recordNow({ kind: 'flow', date, part: p }, ev.currentTarget, 'day', () => close(true, true)),
            }),
          ),
        ),
      );
    } else {
      items.push(
        button({
          label: 'A period began',
          className: 'pop-item',
          attrs: { id: 'pop-add-flow' },
          onclick: ev => {
            // Today: now. An earlier day: by day or at night.
            if (isToday) {
              recordNow({ kind: 'flow', when: 'now' }, ev.currentTarget, 'day', () => close(true, true));
              return;
            }
            ui.ask = true;
            render();
            document.querySelector('#day-pop .pop-ask button')?.focus();
          },
        }),
      );
    }
  }
  items.push(button({ label: 'More', variant: 'link', className: 'pop-item pop-more', attrs: { id: 'pop-more' }, onclick: () => openRecord({ mode: 'other', date }, 'day-' + date) }));
  return items;
}

/** Up and Down move between the popup's buttons. */
function onPopKey(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (e.target && e.target.tagName === 'INPUT') return;
  const list = [...document.querySelectorAll('#day-pop button:not([disabled])')];
  const at = list.indexOf(document.activeElement);
  if (list.length === 0) return;
  e.preventDefault();
  const next = list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
  next.focus();
}

/** The popup of a date. ctx: { date, events, niddah, close(keepFocus) } */
export function dayPopup(ctx) {
  const { date, events, niddah, close } = ctx;
  if (ui.date !== date) ui = fresh(date);
  const past = date <= today();
  const entries = entriesOn(date);
  const adds = past ? addItems(date, events, entries, niddah, close) : [];
  const expected = expectedLine(events);
  return h(
    'div',
    { class: 'day-pop', id: 'day-pop', role: 'dialog', 'aria-label': spokenDate(date), tabindex: '-1', onkeydown: onPopKey },
    h('p', { class: 'pop-date' }, h('strong', {}, dayWord(date, false)), ' ', h('span', { lang: S.terms === 'he' ? 'he' : null }, dateText(date, false))),
    expected,
    entries.length ? h('ul', { class: 'pop-entries', id: 'pop-entries' }, entries.map(e => entryRow(e, close))) : null,
    ui.error ? h('p', { class: 'error pop-error', role: 'alert' }, ui.error) : null,
    adds.length ? h('div', { class: 'pop-adds', id: 'pop-adds' }, adds) : null,
    !expected && !entries.length && !adds.length ? h('p', { class: 'pop-expected muted' }, 'Nothing expected.') : null,
  );
}

/** Puts the popup beside its day, inside the month and the screen: under the day, or above it when there is no room below. */
export function placePopup(date) {
  const pop = document.getElementById('day-pop');
  const day = document.getElementById('day-' + date);
  const box = pop ? pop.offsetParent : null;
  if (!pop || !day || !box) return;
  const b = box.getBoundingClientRect();
  const d = day.getBoundingClientRect();
  const w = pop.offsetWidth;
  const hgt = pop.offsetHeight;
  const gap = 4;
  let left = d.left + d.width / 2 - w / 2 - b.left;
  left = Math.max(0, Math.min(left, b.width - w));
  let top = d.bottom + gap - b.top;
  const below = window.innerHeight - d.bottom;
  if (below < hgt + gap && d.top > hgt + gap) top = d.top - hgt - gap - b.top;
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
  pop.classList.add('placed');
  // keep it on screen when it opened near the bottom
  const r = pop.getBoundingClientRect();
  if (r.bottom > window.innerHeight) window.scrollBy(0, r.bottom - window.innerHeight + 8);
  else if (r.top < 0) window.scrollBy(0, r.top - 8);
}

