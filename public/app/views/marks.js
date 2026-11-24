/*
 * The small marks that stand for the kinds of days (in the month calendar,
 * its legend, "Coming up", the Log, and the console's calculation test).
 * Each mark has a shape or a letter as well as a colour, so colour is never
 * the only signal. Marks are decorative (aria-hidden): the text next to them,
 * or the label of the day, says what they mean.
 *
 * What she recorded and what the calendar works out are kept apart: a tick
 * (H✓) for a hefsek taharah that was recorded, and M✓ for an immersion that
 * was (recording one is optional); "H?" for the day a hefsek taharah can be
 * done, which was not; an outlined M for a mikvah night, whether it is ahead
 * or past (once it is over she is taken to have immersed); dashed for what is
 * only expected. In words, the same with a label (stateTag) instead of the
 * server's " (projected)".
 */
import { h, icon, tag } from '../lib.js';
import { t } from '../store.js';
import { term } from './shared.js';

/** The number of a clean day, from the event's key ("clean:<id>:<n>"). */
export const cleanDayNumber = e => {
  const m = /:(\d)$/.exec(e.key || '');
  return m ? Number(m[1]) : null;
};

/** Whether a timed event is at night (its window crosses midnight, or its title says so). */
export function isNight(e) {
  if (e.kind === 'mikvah') return true;
  if (e.startDate && e.endDate && e.startDate !== e.endDate) return true;
  return /\((night|לילה)\)/.test(e.title || '');
}

/** Whether an event is done (its title carries ✓). */
export const isDone = e => (e.title || '').includes('✓');

/** Recorded by her: the start of a period, and a hefsek taharah or immersion that was recorded. */
export const wasRecorded = e => e.kind === 'flow' || isDone(e);

/** The server's title without its " (projected)": the pages say it with a label instead. */
export const plainTitle = e => (e.title || '').replace(' (projected)', '');

/** A short label beside a title: what she recorded, the day a hefsek taharah can be done (not recorded), or what is expected. */
export function stateTag(e) {
  if (wasRecorded(e)) return tag('recorded', 'ok');
  if (e.kind === 'hefsek') return tag('not recorded', 'warn');
  if (e.projected) return tag('expected', 'info');
  return null;
}

/** An event in words, for the label of a day of the calendar. */
export function spoken(e) {
  const title = plainTitle(e);
  if (wasRecorded(e)) return title + ' (recorded)';
  if (e.kind === 'hefsek') return title + ' (not recorded: the day it can be done)';
  return e.projected ? title + ' (expected)' : title;
}

const PROJECTED = 'Projected: ';

/** The server's sentence that says what a projected event assumes ("This assumes ..."), or ''. */
export function assumption(e) {
  if (!e.projected || !e.description) return '';
  const line = e.description.split('\n').find(l => l.startsWith(PROJECTED));
  return line ? cap1(line.slice(PROJECTED.length)) : '';
}

/**
 * The lines of an event's description, as a page shows them (the server's
 * descriptions do not repeat the event's date or hours). opts.noAssumption:
 * the assumption is said once above the rows.
 */
export function describe(e, opts) {
  const o = opts || {};
  const d = e.description || '';
  return d
    .split('\n')
    .filter(l => !(o.noAssumption && l.startsWith(PROJECTED)))
    .map(l => (l.startsWith(PROJECTED) ? cap1(l.slice(PROJECTED.length)) : l))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

function filledIcon(name) {
  const svg = icon(name);
  svg.classList.add('filled');
  return svg;
}

/**
 * A mark for an event of the calendar (a grid event, or an upcoming item joined to one).
 *   mark(event)                   in the calendar
 *   mark({ kind: 'onah', ... })   in the legend
 */
export function mark(e, opts) {
  const o = opts || {};
  const classes = ['mk', e.kind === 'clean_day' ? 'clean' : e.kind];
  if (e.light) classes.push('light');
  if (e.projected) classes.push('projected');
  if (o.size) classes.push(o.size);
  let glyph;
  switch (e.kind) {
    case 'flow':
      glyph = filledIcon('droplet');
      break;
    case 'hefsek':
      // A tick for one that was recorded; a question mark for the day it can be done, which was not.
      if (isDone(e)) {
        glyph = 'H✓';
        classes.push('done', 'wide');
      } else {
        glyph = e.projected ? 'H?' : 'H';
        if (e.projected) classes.push('wide');
      }
      break;
    case 'clean_day':
      glyph = String(o.number || cleanDayNumber(e) || '');
      break;
    case 'mikvah':
      // Filled with a tick: recorded. Outlined: the night worked out (dashed while it is only expected).
      if (isDone(e)) {
        glyph = 'M✓';
        classes.push('done', 'wide');
      } else {
        glyph = 'M';
        if (!e.projected) classes.push('plan');
      }
      break;
    case 'onah': {
      const night = o.night !== undefined ? o.night : isNight(e);
      glyph = e.light ? icon(night ? 'moon' : 'sun') : filledIcon(night ? 'moon' : 'sun');
      break;
    }
    default:
      glyph = '•';
  }
  return h('span', { class: classes.join(' '), 'aria-hidden': 'true' }, glyph);
}

/** The mark of a kind of entry (the Log, the buttons that record one): what she records, with a tick where it has one. */
export function entryMark(kind) {
  if (kind === 'flow' || kind === 'stain') return mark({ kind: 'flow' });
  if (kind === 'broken') return h('span', { class: 'mk broken', 'aria-hidden': 'true' }, '×');
  return mark({ kind, title: '✓' });
}

const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The legend, always shown under the month, in two groups: what she
 * recorded, and what the calendar works out from it; one short line per
 * mark. How a day is drawn is under "More", closed.
 */
export function legend() {
  const item = (m, text) => h('li', {}, m, h('span', {}, text));
  return h(
    'div',
    { class: 'legend-groups', id: 'cal-legend' },
    h(
      'div',
      { class: 'legend-group', id: 'legend-recorded' },
      h('h4', {}, 'Recorded'),
      h(
        'ul',
        { class: 'legend' },
        item(mark({ kind: 'flow' }), cap1(t('{flow} or {stain}'))),
        item(mark({ kind: 'hefsek', title: '✓' }), cap1(t('{hefsek}'))),
        item(mark({ kind: 'mikvah', title: '✓' }), cap1(t('{immersion}'))),
      ),
    ),
    h(
      'div',
      { class: 'legend-group', id: 'legend-worked-out' },
      h('h4', {}, 'Worked out'),
      h(
        'ul',
        { class: 'legend' },
        item(mark({ kind: 'hefsek', projected: true }), cap1(t('{hefsek} due'))),
        item(mark({ kind: 'clean_day' }, { number: 1 }), cap1(t('{clean_days}'))),
        item(mark({ kind: 'mikvah' }), cap1(term('mikvah_night'))),
        item(h('span', { class: 'mk-pair' }, mark({ kind: 'onah' }, { night: false }), mark({ kind: 'onah' }, { night: true })), cap1(t('{veset_onah}'))),
        item(mark({ kind: 'onah', light: true }, { night: true }), cap1(t('{or_zarua} only'))),
        item(mark({ kind: 'clean_day', projected: true }, { number: 3 }), 'Expected'),
      ),
    ),
    h(
      'details',
      { class: 'legend-more', id: 'legend-more' },
      h('summary', {}, 'More'),
      h(
        'ul',
        { class: 'legend legend-days' },
        h('li', {}, h('span', { class: 'legend-day rest', 'aria-hidden': 'true' }, '7'), h('span', {}, t('{shabbat}, {yom_tov}'))),
        h('li', {}, h('span', { class: 'legend-day today', 'aria-hidden': 'true' }, '7'), h('span', {}, 'Today')),
        h('li', { class: 'legend-note' }, h('span', {}, t('A night is on the date it begins.'))),
      ),
    ),
  );
}
