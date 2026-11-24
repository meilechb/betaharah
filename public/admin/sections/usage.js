/* Usage and cost: counts today and this month against the limits, an estimate in dollars, and 30 days of history. */
import { button, card, h, selectField, setFieldError, skeleton, textField } from '/app/lib.js';
import { call, dayLabel, dollars, draft, num, run, S, saved } from '../state.js';

const SVG = 'http://www.w3.org/2000/svg';

let history = null; // { days: [...] } once loaded
let historyError = '';
let loading = false;
let series = 'textsSent';

export const SERIES = [
  { value: 'textsSent', label: 'Texts sent', unit: ['text sent', 'texts sent'] },
  { value: 'codesSent', label: 'Sign-in codes', unit: ['sign-in code', 'sign-in codes'] },
  { value: 'textsReceived', label: 'Texts received', unit: ['text received', 'texts received'] },
  { value: 'signups', label: 'New accounts', unit: ['new account', 'new accounts'] },
  { value: 'deletions', label: 'Deleted accounts', unit: ['deleted account', 'deleted accounts'] },
];

const redrawMe = () => window.dispatchEvent(new CustomEvent('admin:section', { detail: 'usage' }));

/** The loaded history ({ days }), or null; and its error. */
export const historyState = () => ({ history, error: historyError });

/** Loads the 30-day history (once, or again with force). */
export async function loadHistory(force) {
  if (loading || ((history || historyError) && !force)) return;
  loading = true;
  try {
    history = await call('GET', '/api/admin/history?days=30');
    historyError = '';
  } catch (e) {
    historyError = e.message || 'The history could not be loaded.';
  } finally {
    loading = false;
    redrawMe();
  }
}

function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.append(c);
  return el;
}

/** A bar chart of one count per day, drawn with DOM calls. Hovering or focusing a bar shows its value above the chart. */
export function chart(days, key, unit) {
  // A narrower drawing on a phone, so that its text stays readable.
  const W = window.innerWidth < 640 ? 340 : 640;
  const H = window.innerWidth < 640 ? 200 : 180;
  const top = 12;
  const bottom = 24;
  const left = 34;
  const values = days.map(d => d[key]);
  const max = Math.max(1, ...values);
  const nice = max <= 4 ? (max % 2 === 0 ? max : max + 1) : Math.ceil(max / 10) * 10;
  const plotH = H - top - bottom;
  const slot = (W - left) / days.length;
  const barW = Math.max(2, slot - 2); // a 2px gap between bars
  const readout = h('p', { class: 'chart-readout', 'aria-live': 'polite' }, 'Point at a bar, or move to it with the Tab key, to see its number.');
  const show = d => readout.replaceChildren(h('strong', {}, dayLabel(d.day, true) + ': '), num(d[key]) + ' ' + (d[key] === 1 ? unit[0] : unit[1]));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `${unit[1]} per day for the last ${days.length} days; the most on one day was ${num(max)}.` });
  // recessive grid: the baseline, the middle and the top
  for (const f of [0, 0.5, 1]) {
    const y = top + plotH * (1 - f);
    root.append(svg('line', { x1: left, x2: W, y1: y, y2: y, class: f === 0 ? 'axis' : 'grid' }));
    const label = svg('text', { x: left - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' });
    label.textContent = num(Math.round(nice * f));
    root.append(label);
  }
  days.forEach((d, i) => {
    const v = d[key];
    const bh = (v / nice) * plotH;
    const x = left + i * slot + 1;
    const y = top + plotH - bh;
    const g = svg('g', { class: 'bar-hit', tabindex: '0', role: 'img', 'aria-label': `${dayLabel(d.day, true)}: ${num(v)} ${v === 1 ? unit[0] : unit[1]}` });
    g.append(svg('rect', { x: left + i * slot, y: top, width: slot, height: plotH, class: 'hit' }));
    if (v > 0) {
      // a bar with rounded top corners, anchored to the baseline
      const r = Math.min(4, barW / 2, bh);
      g.append(svg('path', { class: 'bar', d: `M${x},${top + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${top + plotH} Z` }));
    }
    const t = svg('title');
    t.textContent = `${dayLabel(d.day, true)}: ${num(v)}`;
    g.append(t);
    g.addEventListener('mouseenter', () => show(d));
    g.addEventListener('focus', () => show(d));
    root.append(g);
  });
  for (const i of [0, Math.floor(days.length / 2), days.length - 1]) {
    const label = svg('text', { x: left + i * slot + slot / 2, y: H - 6, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle' });
    label.textContent = dayLabel(days[i].day);
    root.append(label);
  }
  return h('div', { class: 'chart-wrap' }, readout, root);
}

function table(days) {
  return h(
    'details',
    { class: 'chart-table' },
    h('summary', {}, 'Show the numbers as a table'),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Day (UTC)'), SERIES.map(s => h('th', { scope: 'col', class: 'n' }, s.label)))),
        h('tbody', {}, days.slice().reverse().map(d => h('tr', {}, h('th', { scope: 'row' }, dayLabel(d.day, true)), SERIES.map(s => h('td', { class: 'n' }, num(d[s.value])))))),
      ),
    ),
  );
}

function historyPart() {
  if (historyError) return h('div', {}, h('p', { class: 'muted' }, historyError), button({ label: 'Try again', size: 'sm', onclick: () => loadHistory(true) }));
  if (!history) return skeleton({ lines: 4, label: 'Loading the last 30 days' });
  const chosen = SERIES.find(s => s.value === series);
  const total = history.days.reduce((n, d) => n + d[series], 0);
  return h(
    'div',
    {},
    selectField({
      id: 'series',
      label: 'What the chart shows',
      value: series,
      options: SERIES.map(s => ({ value: s.value, label: s.label })),
      onchange: e => {
        series = e.target.value;
        redrawMe();
      },
    }),
    h('p', { class: 'small muted' }, chosen.label + ' in the last 30 days: ' + num(total) + '.'),
    chart(history.days, series, chosen.unit),
    table(history.days),
    S.counts.since ? h('p', { class: 'help' }, 'Daily counts began today. Earlier days show only the accounts that still exist, on the days they were made.') : null,
  );
}

function priceForm() {
  const f = textField({
    id: 'price',
    label: 'Price of one text, in cents',
    type: 'text',
    inputmode: 'decimal',
    wide: false,
    value: draft.price,
    help: 'Used only for the estimate. Telnyx charges about 1 cent for each text, sent or received. See your Telnyx invoice for the real amount.',
    oninput: e => {
      draft.price = e.target.value;
      setFieldError(f, '');
    },
  });
  return h(
    'form',
    {
      class: 'price-form',
      novalidate: true,
      onsubmit: e => {
        e.preventDefault();
        const v = Number(String(draft.price).replace(',', '.').replace('¢', '').trim());
        if (!Number.isFinite(v) || v < 0 || v > 100 || String(draft.price).trim() === '') {
          setFieldError(f, 'Write a number of cents from 0 to 100, for example 1 or 0.8.');
          f.control.focus();
          return;
        }
        run(() => call('PUT', '/api/admin/notes', { centsPerText: v }), saved('Price saved.', { priceSaved: true }), e.submitter);
      },
    },
    f,
    h('div', { class: 'actions' }, button({ label: 'Save price', type: 'submit', size: 'sm' })),
  );
}

export function usagePage() {
  const t = S.counts.today;
  const m = S.counts.month;
  const price = S.notes.centsPerText;
  const cost = (m.textsSent + m.textsReceived) * price;
  const row = (label, today, month) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', { class: 'n', 'data-label': 'Today' }, today), h('td', { class: 'n', 'data-label': 'This month' }, month));
  return [
    h(
      'div',
      { class: 'grid-2 usage-top' },
      card(
        { title: 'Today and this month', icon: 'calendar' },
        h(
          'table',
          { class: 'data-table compact usage' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Count'), h('th', { scope: 'col', class: 'n' }, 'Today'), h('th', { scope: 'col', class: 'n' }, 'This month'))),
          h(
            'tbody',
            {},
            row('Texts sent', num(t.textsSent), num(m.textsSent) + ' of ' + num(S.config.monthlyMessageLimit)),
            row('Of those, sign-in codes', num(S.usage.codesToday) + ' of ' + num(S.config.dailyCodeLimit), num(m.codesSent)),
            row('Texts received', num(t.textsReceived), num(m.textsReceived)),
            row('New accounts', num(t.signups), num(m.signups)),
            row('Deleted accounts', num(t.deletions), num(m.deletions)),
          ),
        ),
        h('p', { class: 'help' }, 'Days and months begin at midnight UTC (7 PM in New York in winter, 8 PM in summer), as the limits do.'),
      ),
      card(
        { title: 'Cost', icon: 'download' },
        h('div', { class: 'big-number' }, dollars(cost)),
        h('p', { class: 'muted' }, 'Estimated cost of texts this month: ' + num(m.textsSent + m.textsReceived) + ' texts sent and received, at ' + price + (price === 1 ? ' cent' : ' cents') + ' each. Telnyx also charges about $1 a month for the number.'),
        h('p', { class: 'muted' }, 'At the monthly limit of ' + num(S.config.monthlyMessageLimit) + ' texts, sending alone would cost about ' + dollars(S.config.monthlyMessageLimit * price) + '.'),
        priceForm(),
      ),
    ),
    card({ title: 'The last 30 days', icon: 'list' }, historyPart()),
  ];
}
