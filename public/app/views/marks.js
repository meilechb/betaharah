/*
 * The small marks that stand for the kinds of days (in the month calendar,
 * its legend, "Coming up" and the Log). Each mark has a shape or a letter as
 * well as a colour, so colour is never the only signal. Marks are decorative
 * (aria-hidden): the text next to them, or the label of the day, says what
 * they mean.
 */
import { h, icon } from '../lib.js';
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
      // The day a hefsek taharah can be done is not one that was recorded: a question mark says so.
      glyph = e.projected ? 'H?' : 'H';
      if (e.projected) classes.push('wide');
      break;
    case 'clean_day':
      glyph = String(o.number || cleanDayNumber(e) || '');
      break;
    case 'mikvah':
      glyph = 'M';
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

/** The entries of the legend: a mark and what it means. */
export function legendItems() {
  return [
    [mark({ kind: 'flow' }), cap1(t('{flow} or {stain}: the start of a period'))],
    [mark({ kind: 'hefsek' }), cap1(t('{hefsek}, recorded'))],
    [mark({ kind: 'hefsek', projected: true }), cap1(t('the day the {hefsek} can be done (not recorded)'))],
    [mark({ kind: 'clean_day' }, { number: 1 }), t('Day 1 to 7 of the {clean_days}')],
    [mark({ kind: 'mikvah' }), term('mikvah_night')],
    [mark({ kind: 'onah' }, { night: false }), cap1(t('{veset_onah} by day'))],
    [mark({ kind: 'onah' }, { night: true }), cap1(t('{veset_onah} at night'))],
    [mark({ kind: 'onah', light: true }, { night: true }), cap1(t('{or_zarua} only (lighter, outlined)'))],
    [mark({ kind: 'clean_day', projected: true }, { number: 3 }), t('Dashed: projected, not recorded. It assumes the {hefsek} is done on the first day it can be.')],
  ];
}

const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);

/** The legend, as a list. */
export function legend() {
  return h(
    'ul',
    { class: 'legend' },
    legendItems().map(([m, text]) => h('li', {}, m, h('span', {}, text))),
    h('li', {}, h('span', { class: 'legend-day rest', 'aria-hidden': 'true' }, '7'), h('span', {}, t('Shaded, with a bar on top: {shabbat} or {yom_tov}'))),
    h('li', {}, h('span', { class: 'legend-day today', 'aria-hidden': 'true' }, '7'), h('span', {}, 'Outlined: today')),
    h('li', { class: 'legend-note' }, h('span', {}, t('Each day shows the Hebrew date of its daytime. A Hebrew date begins at {sunset} the evening before, so a night belongs to the next day’s Hebrew date. A mark for a night is on the day whose evening it begins.'))),
  );
}
