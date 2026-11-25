// The signed-in dashboard in a real browser, on the operator's test account.
//
//   1. a .dev.vars file as described in test/ui-check.cjs (DASHBOARD_PASSWORD=local-test-password)
//   2. npx wrangler dev --port 8812 --persist-to <a new empty directory>
//   3. node test/ui/dashboard.cjs <directory for screenshots> http://127.0.0.1:8812
//
// Covers: the home screen (only the header, the status line, the month, the hint and Key), the
// month calendar (the three Dates settings, navigation, keyboard across a month boundary, events
// on the right days, the tinted niddah days), the Key, a day's popup (the menu by what is expected, record with one tap, Edit and Delete,
// Undo, a refusal in the full form, outside tap and Escape, inside the screen at 360 px), the menu (every entry,
// the way back to the calendar, Escape, the browser's Back), the alerts on "Coming up" with the
// count on Menu, the Log, Customs (edit, discard, the leave guard, save), the Settings page (its
// sections: settings.cjs), "Try a text", both forms of the terms, no sideways scrolling at 360 px;
// the Texting page and the home without a location; accounts signed in with Google or with no
// phone (state rewritten in the browser); Sign out in the menu; a failed load. Exits 0 when every
// step passed.
const { chromium } = require('playwright');
const out = process.argv[2] || '.';
const base = process.argv[3] || 'http://127.0.0.1:8812';
const ADMIN_PASSWORD = 'local-test-password';
const H = { 'x-betaharah': '1' };

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 860 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/status of (40[0-9]|429)/.test(m.text())) errors.push('console: ' + m.text());
  });
  const step = async (name, fn) => {
    const before = errors.length;
    try {
      await fn();
      if (errors.length > before) throw new Error(errors.slice(before).join(' | '));
      console.log('ok  ', name);
    } catch (e) {
      console.log('FAIL', name, '-', e.message.split('\n')[0]);
      errors.push(name);
      await page.screenshot({ path: out + '/dash-fail-' + errors.length + '.png', fullPage: true }).catch(() => undefined);
    }
  };
  const noSideways = async label => {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) throw new Error((label || 'the page') + ' is ' + wide + 'px wider than the screen');
  };
  const state = async () => (await (await page.request.get(base + '/api/state', { headers: H })).json()).state;
  const pageIs = id => page.waitForSelector('main.page-' + id);
  /** Opens a page from the menu. */
  const menuTo = async id => {
    await page.click('#menu-button');
    await page.waitForSelector('dialog#menu[open]');
    await page.click('dialog#menu #menu-' + id);
    await pageIs(id);
  };
  const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const monthName = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const isNight = e => e.kind === 'mikvah' || e.startDate !== e.endDate || /\(night\)/.test(e.title);
  /** The days of the Hebrew month a date is in, as the grid has them. */
  const hebrewMonthOf = (s, date) => {
    const days = s.grid.days;
    let at = days.findIndex(d => d.date === date);
    let a = at;
    while (a > 0 && !days[a].monthStart) a -= 1;
    let b = at + 1;
    while (b < days.length && !days[b].monthStart) b += 1;
    return days.slice(a, b);
  };
  /** Shows a date's month (with the previous and next buttons), closing a popup first. */
  const showMonthOf = async date => {
    if (await page.locator('#day-pop').count()) {
      await page.keyboard.press('Escape');
      await page.waitForSelector('#day-pop', { state: 'detached' });
    }
    for (let k = 0; k < 6 && !(await page.locator('#day-' + date).count()); k += 1) {
      const first = await page.$eval('table.month button.day', b => b.id.slice(4));
      await page.click(date < first ? '#cal-prev' : '#cal-next');
    }
  };
  /** Opens a day's popup. */
  const openDay = async date => {
    await showMonthOf(date);
    await page.click('#day-' + date);
    await page.waitForSelector('#day-pop.placed');
    await page.waitForSelector(`#day-${date}[aria-expanded="true"]`);
  };
  const closePop = async () => {
    if (await page.locator('#day-pop').count()) {
      await page.keyboard.press('Escape');
      await page.waitForSelector('#day-pop', { state: 'detached' });
    }
  };
  /** The popup inside the screen. */
  const popInside = async label => {
    const r = await page.$eval('#day-pop', el => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: window.innerWidth, h: window.innerHeight };
    });
    if (r.left < 0 || r.right > r.w || r.top < 0 || r.bottom > r.h) throw new Error((label || 'the popup') + ' is outside the screen: ' + JSON.stringify(r));
  };
  const popItems = () => page.$$eval('#day-pop .pop-item', els => els.map(e => e.id));

  // The state the server sends is rewritten in the browser for the cases the test account is not.
  let shapeOf = null;
  let routed = false;
  const reshape = async shape => {
    shapeOf = shape;
    if (routed) return;
    routed = true;
    await page.route('**/api/state', async route => {
      const r = await route.fetch();
      const json = await r.json();
      if (shapeOf && json && json.state) json.state = shapeOf(JSON.parse(JSON.stringify(json.state)));
      await route.fulfill({ response: r, json });
    });
  };
  const unshape = async () => {
    shapeOf = null;
    if (routed) await page.unroute('**/api/state');
    routed = false;
  };
  /** A fresh load of the home (not only a change of the hash), so that /api/state is asked again. */
  const openHome = async () => {
    await page.goto('about:blank');
    await page.goto(base + '/app/#today');
    await page.waitForSelector('#cal-title, #no-location');
  };
  const hashIs = async want => {
    for (let i = 0; i < 40 && (await page.evaluate(() => location.hash)) !== want; i += 1) await page.waitForTimeout(50);
    const got = await page.evaluate(() => location.hash);
    if (got !== want) throw new Error('address is ' + got + ', expected ' + want);
  };
  const noLeftovers = async label => {
    const text = await page.textContent('#root');
    const m = /\b(undefined|null|NaN)\b/.exec(text);
    if (m) throw new Error((label || 'the page') + ' shows "' + m[1] + '"');
  };

  await step('open the test account', async () => {
    const r1 = await page.request.post(base + '/api/admin/login', { headers: H, data: { password: ADMIN_PASSWORD } });
    if (!r1.ok()) throw new Error('admin login ' + r1.status());
    const r2 = await page.request.post(base + '/api/admin/demo', { headers: H });
    if (!r2.ok()) throw new Error('demo ' + r2.status());
    await page.goto(base + '/app/');
    await page.waitForSelector('#cal-title');
  });

  const s0 = await state();
  const today = s0.grid.today;

  // ----- the home screen -----

  await step('home: only the header, the status line, the month, the hint and Key', async () => {
    if (await page.locator('nav.tabs, .demo-banner, .date-line').count()) throw new Error('tabs, the banner or the date line are still there');
    if ((await page.textContent('#demo-tag')).trim() !== 'Test account') throw new Error('no "Test account" tag');
    if ((await page.textContent('#menu-button')).trim() !== 'Menu') throw new Error('Menu: ' + (await page.textContent('#menu-button')));
    if ((await page.textContent('#status-headline')).trim() !== s0.status.headline) throw new Error('headline');
    if (s0.status.detail && (await page.textContent('#status-detail')).trim() !== s0.status.detail) throw new Error('detail');
    if (await page.locator('.status-line button, .status-line a').count()) throw new Error('a button in the status line');
    for (const sel of ['.upcoming-card', '#up-steps', '#cal-legend', '.legend-groups', '#record-panel', '.record-form', '#text-card', '.demo-card', '#demo-text', '.onboarding', '.alert', '#day-pop', '.today-box'])
      if (await page.locator('#root ' + sel).count()) throw new Error(sel + ' is on the home screen');
    const kids = await page.$$eval('main.page-today .home > *', els => els.map(e => e.className));
    if (kids.join('|') !== 'status-line|cal-wrap') throw new Error('home holds: ' + kids.join(', '));
    if ((await page.textContent('#cal-hint')).trim() !== 'Choose a day') throw new Error('hint: ' + (await page.textContent('#cal-hint')));
    await page.waitForSelector('#cal-key:text-is("Key")');
    const words = await page.evaluate(() => document.getElementById('root').innerText.split(/\s+/).filter(x => /[A-Za-z]/.test(x)).length);
    console.log('     words on the home screen:', words);
    if (words > 60) throw new Error(words + ' words on the home screen');
    // An empty hash and #calendar are the calendar too.
    await page.goto(base + '/app/#calendar');
    await page.waitForSelector('main.page-today #cal-title');
    await noSideways('home');
  });

  // ----- the month calendar, by Hebrew month (the default) -----

  const hm = hebrewMonthOf(s0, today);
  await step('calendar: pages by Hebrew month; the title, the civil span, the large Hebrew and small civil numbers', async () => {
    const title = (await page.textContent('#cal-title')).trim();
    if (!new RegExp('^' + hm[0].hebrewMonth + ' \\d{4}$').test(title)) throw new Error('title ' + title);
    if (!/^[A-Z][a-z]{2}( – [A-Z][a-z]{2})? \d{4}$|^[A-Z][a-z]{2} \d{4} – [A-Z][a-z]{2} \d{4}$/.test((await page.textContent('#cal-sub')).trim())) throw new Error('civil span ' + (await page.textContent('#cal-sub')));
    const d = s0.grid.days.find(x => x.date === today);
    if ((await page.textContent(`#day-${today} .cd`)).trim() !== d.hebrewDay) throw new Error('the large number is not the Hebrew day');
    if ((await page.textContent(`#day-${today} .hd`)).trim() !== String(Number(today.slice(8))) && !/^[A-Z][a-z]{2} 1$/.test((await page.textContent(`#day-${today} .hd`)).trim())) throw new Error('the small number is not the civil day');
    // every day of the Hebrew month, and no other, has a button
    for (const x of hm) if (!(await page.locator('#day-' + x.date).count())) throw new Error('no ' + x.date);
    const n = await page.locator('table.month button.day').count();
    if (n !== hm.length) throw new Error(n + ' days for a month of ' + hm.length);
    const first = s0.grid.days.find(x => x.date.slice(8) === '01' && hm.some(y => y.date === x.date));
    if (first && (await page.textContent(`#day-${first.date} .hd`)).trim() !== new Date(first.date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' }) + ' 1') throw new Error('the 1st of the civil month has no month name');
    if ((await page.getAttribute(`#day-${today}`, 'aria-current')) !== 'date') throw new Error('today is not marked');
    if (!(await page.getAttribute(`#day-${today}`, 'aria-label')).startsWith('Today, ')) throw new Error('today is not labelled');
    if (await page.locator('#cal-today').count()) throw new Error('"Today" shown on this month');
  });

  await step('calendar events are on the right days', async () => {
    const inMonth = new Set(hm.map(x => x.date));
    const events = s0.grid.events.filter(e => inMonth.has(e.startDate));
    if (events.length === 0) throw new Error('the test account has no events this month');
    for (const e of events) {
      const label = await page.getAttribute(`#day-${e.startDate}`, 'aria-label');
      const title = e.title.replace(' (projected)', '');
      if (!label || !label.includes(title)) throw new Error(e.startDate + ' does not mention ' + title + ': ' + label);
      if (label.includes('(projected)')) throw new Error(e.startDate + ' says "(projected)": ' + label);
      if ((await page.locator(`#day-${e.startDate} .marks .mk`).count()) === 0) throw new Error('no mark on ' + e.startDate);
    }
    const empty = hm.find(d => !s0.grid.events.some(e => e.startDate <= d.date && e.endDate >= d.date));
    if (empty && (await page.locator(`#day-${empty.date} .marks .mk`).count()) !== 0) throw new Error('marks on an empty day ' + empty.date);
    // no words beside the marks on a phone
    if (await page.locator('table.month .cw:visible').count()) throw new Error('words beside the marks at 390 px');
  });

  await step('calendar: the niddah days are tinted from the day the period began through its mikvah night', async () => {
    const flows = s0.grid.events.filter(e => e.kind === 'flow');
    const f = flows[flows.length - 1];
    const m = s0.grid.events.find(e => e.kind === 'mikvah' && e.startDate >= f.startDate);
    if (!f || !m) throw new Error('the test account has no period with a mikvah night');
    await showMonthOf(f.startDate);
    let seen = 0;
    for (let d = addDays(f.startDate, -1); d <= addDays(m.startDate, 1); d = addDays(d, 1)) {
      if (!(await page.locator('#day-' + d).count())) continue;
      const inside = d >= f.startDate && d <= m.startDate;
      const cls = await page.getAttribute('#day-' + d, 'class');
      if (cls.includes('niddah') !== inside) throw new Error(d + (inside ? ' is not tinted' : ' is tinted'));
      const label = await page.getAttribute('#day-' + d, 'aria-label');
      if (label.includes('Niddah day') !== inside) throw new Error(d + ': the label does not say so: ' + label);
      if (inside) seen += 1;
    }
    if (seen < 3) throw new Error('only ' + seen + ' tinted days shown');
    const bg = await page.$eval('table.month .day.niddah', el => getComputedStyle(el).backgroundColor);
    const plain = await page.$eval('table.month .day:not(.niddah):not(.rest):not(.today)', el => getComputedStyle(el).backgroundColor);
    if (bg === plain) throw new Error('the tint does not show');
    await page.screenshot({ path: out + '/dash-home-tinted-390.png' });
  });

  const yesterday = addDays(today, -1);

  await step('the popup of a future day: what is expected, nothing to add; Escape closes it and the focus goes back to the day', async () => {
    const inMonth = new Set(hm.map(x => x.date));
    const target = s0.grid.events.find(e => e.startDate > today && inMonth.has(e.startDate)) || { startDate: addDays(today, 2) };
    await openDay(target.startDate);
    if (await page.locator('#day-pop .pop-item, #pop-entries').count()) throw new Error('something to add or edit on a future day');
    if (target.title && !(await page.textContent('#pop-expected')).includes(target.title.replace(' (projected)', ''))) throw new Error('the popup does not say ' + target.title);
    const d = s0.grid.days.find(x => x.date === target.startDate);
    const date = (await page.textContent('#day-pop .pop-date')).trim();
    if (!date.endsWith(d.hebrewDay + ' ' + d.hebrewMonth)) throw new Error('date ' + date);
    if (!/^(Tomorrow|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) /.test(date)) throw new Error('no weekday word: ' + date);
    await popInside();
    await page.screenshot({ path: out + '/dash-pop-future-390.png' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#day-pop', { state: 'detached' });
    if ((await page.evaluate(() => document.activeElement.id)) !== 'day-' + target.startDate) throw new Error('the focus did not go back to the day');
    // tapping the day again closes it; so does a tap outside
    await page.click('#day-' + target.startDate);
    await page.waitForSelector('#day-pop.placed');
    await page.click('#day-' + target.startDate);
    await page.waitForSelector('#day-pop', { state: 'detached' });
    await page.click('#day-' + target.startDate);
    await page.waitForSelector('#day-pop.placed');
    await page.mouse.click(5, 5);
    await page.waitForSelector('#day-pop', { state: 'detached' });
  });

  await step('the popup stays inside the screen at 360 px, in the first and last column and the last row', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await showMonthOf(today);
    const days = await page.$$eval('table.month tbody tr', rows =>
      rows.map(r => [...r.querySelectorAll('td')].map(td => (td.querySelector('button.day') ? td.querySelector('button.day').id.slice(4) : null))),
    );
    const firstCol = days.map(r => r[0]).find(Boolean);
    const lastCol = days.map(r => r[6]).filter(Boolean).pop();
    const lastRow = days[days.length - 1].filter(Boolean);
    for (const date of [firstCol, lastCol, lastRow[0], lastRow[lastRow.length - 1]]) {
      await openDay(date);
      await popInside('the popup of ' + date);
      await closePop();
    }
    await noSideways('360 px with a popup');
    await page.screenshot({ path: out + '/dash-pop-edge-360.png' });
    await page.setViewportSize({ width: 390, height: 860 });
  });

  await step('arrow keys move between days, and across a month boundary', async () => {
    await showMonthOf(today);
    const firstDay = await page.$eval('table.month button.day', b => b.id.slice(4));
    const before = await page.textContent('#cal-title');
    await page.focus('#day-' + firstDay);
    await page.keyboard.press('ArrowLeft');
    const prev = addDays(firstDay, -1);
    await page.waitForFunction(id => document.activeElement && document.activeElement.id === id, 'day-' + prev);
    if ((await page.textContent('#cal-title')) === before) throw new Error('the month did not change');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(id => document.activeElement && document.activeElement.id === id, 'day-' + firstDay);
    if ((await page.textContent('#cal-title')) !== before) throw new Error('did not come back');
    if (await page.locator('#day-pop').count()) throw new Error('the arrow keys opened the popup');
    // Enter opens the popup; Up and Down move in it
    await page.focus('#day-' + yesterday).catch(() => undefined);
    if ((await page.evaluate(() => document.activeElement.id)) === 'day-' + yesterday) {
      await page.keyboard.press('Enter');
      await page.waitForSelector('#day-pop.placed');
      const a = await page.evaluate(() => document.activeElement.id);
      await page.keyboard.press('ArrowDown');
      const b = await page.evaluate(() => document.activeElement.id);
      if (a === b || !b.startsWith('pop-')) throw new Error('Down did not move in the popup: ' + a + ' ' + b);
      await closePop();
    }
  });

  await step('previous and next month, and "Today" only when another month is shown', async () => {
    const here = await page.textContent('#cal-title');
    await page.click('#cal-prev');
    const prevTitle = await page.textContent('#cal-title');
    if (prevTitle === here) throw new Error('the month did not change');
    await page.waitForSelector('#cal-today');
    await page.click('#cal-next');
    await page.click('#cal-next');
    const nextTitle = await page.textContent('#cal-title');
    if (nextTitle === here || nextTitle === prevTitle) throw new Error('next month: ' + nextTitle);
    await page.click('#cal-today');
    if ((await page.textContent('#cal-title')) !== here) throw new Error('Today did not come back');
    if (await page.locator('#cal-today').count()) throw new Error('"Today" still shown');
  });

  await step('Key: the legend in a sheet, in two groups; Escape closes it and the focus goes back to Key', async () => {
    await page.click('#cal-key');
    await page.waitForSelector('dialog#key-sheet[open] #legend-recorded h4:text-is("Recorded")');
    await page.waitForSelector('#legend-worked-out h4:text-is("Worked out")', { state: 'visible' });
    const recorded = await page.textContent('#legend-recorded');
    for (const p of ['Flow or stain', 'Hefsek taharah', 'Immersion']) if (!recorded.includes(p)) throw new Error('recorded group: no ' + p);
    const worked = await page.textContent('#legend-worked-out');
    for (const p of ['Hefsek taharah due', 'Seven clean days', 'Mikvah night', 'Onas havest', 'Or Zarua only', 'Expected', 'Niddah days']) if (!worked.includes(p)) throw new Error('worked-out group: no ' + p);
    if (await page.locator('#legend-more[open]').count()) throw new Error('"More" is open');
    if ((await page.textContent('#legend-recorded .mk.hefsek.done')) !== 'H✓') throw new Error('no H✓ in the legend');
    if ((await page.textContent('#legend-worked-out .mk.hefsek.projected')) !== 'H?') throw new Error('no H? in the legend');
    if ((await page.locator('#legend-worked-out .mk.mikvah.plan').count()) !== 1) throw new Error('no outlined M in the legend');
    await page.screenshot({ path: out + '/dash-key-390.png' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog#key-sheet', { state: 'detached' });
    if ((await page.evaluate(() => document.activeElement.id)) !== 'cal-key') throw new Error('the focus did not go back to Key');
  });

  await step('the recorded hefsek taharah is marked with a tick, and its popup shows it with Edit and Delete; the planned mikvah night is outlined', async () => {
    const inMonth = new Set(hm.map(x => x.date));
    const hefsek = s0.grid.events.find(e => e.kind === 'hefsek' && e.title.includes('✓') && inMonth.has(e.startDate));
    if (hefsek) {
      if ((await page.textContent(`#day-${hefsek.startDate} .mk.hefsek`)) !== 'H✓') throw new Error('the recorded hefsek is not H✓');
      await openDay(hefsek.startDate);
      await page.waitForSelector('#pop-entries li:has-text("Hefsek taharah")');
      await page.waitForSelector('#pop-entries button:text-is("Edit")');
      await page.waitForSelector('#pop-entries button:text-is("Delete")');
      if (await page.locator('#pop-add-hefsek').count()) throw new Error('a second hefsek taharah offered');
      await closePop();
    }
    const plan = s0.grid.events.find(e => e.kind === 'mikvah' && !e.title.includes('✓') && inMonth.has(e.startDate));
    if (plan && (await page.textContent(`#day-${plan.startDate} .mk.mikvah.plan`)) !== 'M') throw new Error('the mikvah night is not an outlined M');
    if (/\(projected\)/.test(await page.textContent('#root'))) throw new Error('"(projected)" on the page');
  });

  // ----- recording in a day's popup -----

  await step('an empty earlier day: the menu, the likeliest first; one tap (with day or night) records, the popup closes, the calendar updates, Undo removes it', async () => {
    await openDay(yesterday);
    const items = await popItems();
    // in the clean days nothing else is expected to be recorded: "A period began" first, then More
    if (items.join() !== 'pop-add-flow,pop-more') throw new Error('items: ' + items.join());
    if (await page.locator('#pop-entries').count()) throw new Error('an entry shown on an empty day');
    await page.screenshot({ path: out + '/dash-pop-empty-390.png' });
    const before = (await state()).entryCount;
    const headline = await page.textContent('#status-headline');
    await page.click('#pop-add-flow');
    await page.waitForSelector('#pop-add-flow-day');
    await page.waitForSelector('#pop-add-flow-night');
    await page.click('#pop-add-flow-day');
    await page.waitForSelector('#cal-said .rec-done');
    try {
      if (await page.locator('#day-pop').count()) throw new Error('the popup stayed open');
      if ((await state()).entryCount !== before + 1) throw new Error('not recorded');
      if ((await page.textContent('#status-headline')) === headline) throw new Error('the page did not change');
      await page.screenshot({ path: out + '/dash-pop-recorded-390.png' });
    } finally {
      await page.click('#rec-undo');
    }
    await page.waitForSelector('#cal-said .rec-done:has-text("Removed")');
    if ((await state()).entryCount !== before) throw new Error('Undo did not remove it');
    if ((await page.textContent('#status-headline')) !== headline) throw new Error('the page did not go back');
  });

  await step('the full form: "More" opens it as a page; Cancel goes back to the calendar and its day', async () => {
    await openDay(today);
    await page.click('#pop-more');
    await pageIs('record');
    await hashIs('#record');
    await page.waitForSelector('#rec-kind-flow');
    await page.waitForSelector('#back-home:has-text("Calendar")');
    await page.click('#rec-kind-hefsek');
    await page.click('#rec-cancel');
    await pageIs('today');
    if ((await page.evaluate(() => document.activeElement.id)) !== 'day-' + today) throw new Error('the focus is not on the day');
  });

  await step('the full form: a refusal is shown in it; an entry for another time with a note', async () => {
    await openDay(today);
    await page.click('#pop-more');
    await pageIs('record');
    await page.click('#rec-kind-mikvah');
    await page.click('#rec-submit');
    await page.waitForSelector('#record-panel .rec-error');
    await page.click('#rec-kind-stain');
    await page.click('#r-rec-mode-other');
    await page.fill('#rec-date', yesterday);
    await page.click('#rec-submit');
    await page.waitForSelector('.record-card fieldset.how.invalid');
    await page.click('#r-rec-how-day');
    await page.fill('#rec-note', 'checked by the browser test');
    await page.click('#rec-submit');
    await page.waitForSelector('main.page-record .rec-done');
    if (!/Recorded/i.test(await page.textContent('.rec-done'))) throw new Error('confirmation');
    if (await page.locator('#record-panel').count()) throw new Error('the form stayed open');
    await page.click('#back-home');
    await pageIs('today');
  });

  await step('a recorded day: the entry in a line with Edit and Delete; Edit changes it in place; Delete asks once', async () => {
    await openDay(yesterday);
    await page.waitForSelector('#pop-entries li:has-text("Stain, by day")');
    await page.screenshot({ path: out + '/dash-pop-entry-390.png' });
    // Edit: by day to at night
    await page.click('#pop-entries button[aria-label="Edit stain"]');
    await page.waitForSelector('#pop-edit-date');
    if ((await page.inputValue('#pop-edit-date')) !== yesterday) throw new Error('the date to edit');
    await page.click('#pop-edit-night');
    await page.waitForSelector('#pop-edit-night[aria-pressed="true"]');
    await popInside('the popup while editing');
    await page.click('#pop-edit-save');
    await page.waitForSelector('#pop-entries li:has-text("Stain, at night")');
    const st = await state();
    const stains = st.entries.filter(e => e.kind === 'stain');
    if (stains.length !== 1 || !/evening|night/i.test(stains[0].text) || stains[0].note !== 'checked by the browser test') throw new Error('edit: ' + JSON.stringify(stains));
    // Delete asks once; Keep keeps it
    await page.click('#pop-entries button[aria-label="Delete stain"]');
    await page.waitForSelector('#pop-entries li:has-text("Delete stain?")');
    await page.click('#pop-del-no');
    await page.waitForSelector('#pop-entries li:has-text("Stain, at night")');
    await closePop();
  });

  await step('the day a hefsek taharah can be done: offered first (the popup of a day before the hefsek, rewritten state)', async () => {
    // The test account is in the clean days; the state is rewritten so that yesterday is the hefsek day.
    await reshape(s => {
      const flow = s.grid.events.filter(e => e.kind === 'flow').pop();
      const events = s.grid.events.filter(e => !(e.kind === 'hefsek' && e.startDate >= flow.startDate) && !(e.kind === 'clean_day' && e.startDate >= flow.startDate) && !(e.kind === 'mikvah' && e.startDate >= flow.startDate));
      events.push({ ...flow, key: 'hefsek:test', kind: 'hefsek', title: 'Hefsek taharah (projected)', description: '', projected: true, allDay: false, startDate: yesterday, endDate: yesterday, start: '3:00 PM', end: '4:30 PM' });
      events.push({ ...flow, key: 'mikvah:test', kind: 'mikvah', title: 'Mikvah night (projected)', description: '', projected: true, allDay: false, startDate: addDays(yesterday, 7), endDate: addDays(yesterday, 7), start: '5:00 PM', end: '6:00 PM' });
      return { ...s, entries: s.entries.filter(e => e.kind !== 'hefsek' || !/Nov|Dec/.test(e.text)), grid: { ...s.grid, events } };
    });
    await openHome();
    await openDay(yesterday);
    const items = await popItems();
    if (items[0] !== 'pop-add-hefsek' || items[1] !== 'pop-add-flow') throw new Error('items: ' + items.join());
    if ((await page.textContent('#pop-add-hefsek')).trim() !== 'Hefsek taharah done') throw new Error('label');
    await page.screenshot({ path: out + '/dash-pop-hefsek-day-390.png' });
    await closePop();
    await unshape();
    await openHome();
  });

  // ----- the menu -----

  await step('menu: every entry opens its page with a way back to the calendar; Escape closes it; Back works', async () => {
    await closePop();
    await page.click('#menu-button');
    await page.waitForSelector('dialog#menu[open]');
    const items = await page.$$eval('dialog#menu .menu-item', els => els.map(e => (e.querySelector(':scope > span') || e).textContent.trim()));
    if (items.join('|') !== 'Calendar|Coming up|Log|Customs|Settings|Texting|Try a text|Help|Sign out') throw new Error('menu: ' + items.join('|'));
    if ((await page.getAttribute('#menu-help', 'href')) !== '/help') throw new Error('Help link');
    if ((await page.getAttribute('#menu-today', 'aria-current')) !== 'page') throw new Error('the calendar is not marked current');
    await page.screenshot({ path: out + '/dash-menu-390.png' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog#menu', { state: 'detached' });
    if ((await page.evaluate(() => document.activeElement.id)) !== 'menu-button') throw new Error('the focus did not go back to Menu');
    // by keyboard: Enter opens it, Tab moves in it, Enter chooses
    await page.focus('#menu-button');
    await page.keyboard.press('Enter');
    await page.waitForSelector('dialog#menu[open]');
    if ((await page.evaluate(() => document.activeElement.id)) !== 'menu-today') throw new Error('the focus is not on the current page');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await pageIs('coming');
    await page.waitForSelector('dialog#menu', { state: 'detached' });
    for (const id of ['coming', 'log', 'customs', 'settings', 'texting', 'try']) {
      await menuTo(id);
      if (id === 'settings') {
        if (!(await page.evaluate(() => location.hash)).startsWith('#settings')) throw new Error('address ' + (await page.evaluate(() => location.hash)));
      } else await hashIs('#' + id);
      await page.waitForSelector('#back-home:has-text("Calendar")');
      if (await page.locator('#cal-title').count()) throw new Error('the month is on ' + id);
      await noSideways(id);
    }
    await page.goBack();
    await pageIs('texting');
    await page.goBack();
    await pageIs('settings');
    await page.goForward();
    await pageIs('texting');
    await page.click('#back-home');
    await pageIs('today');
    await menuTo('log');
    await page.click('#home-link');
    await pageIs('today');
  });

  await step('alerts: a count on Menu, listed at the top of "Coming up", not on the home screen', async () => {
    await reshape(s => ({ ...s, alerts: [{ level: 'warn', text: 'A test notice from the browser check.' }] }));
    await openHome();
    if ((await page.textContent('#menu-button .menu-count')).trim() !== '1') throw new Error('no count on Menu');
    if (!(await page.getAttribute('#menu-button', 'aria-label')).includes('1 alert')) throw new Error('the count is not in the label');
    if (await page.locator('#root .alert').count()) throw new Error('the alert is on the home screen');
    await page.click('#menu-button');
    await page.waitForSelector('#menu-coming .menu-count');
    await page.click('#menu-coming');
    await pageIs('coming');
    await page.waitForSelector('#coming-alerts .alert:has-text("A test notice from the browser check.")');
    const order = await page.evaluate(() => [document.getElementById('coming-alerts'), document.getElementById('upcoming-card')].map(el => el.getBoundingClientRect().top));
    if (!(order[0] < order[1])) throw new Error('the alerts are not at the top');
    await page.screenshot({ path: out + '/dash-coming-alert-390.png', fullPage: true });
    await unshape();
    await openHome();
    const real = (await state()).alerts.length;
    if ((await page.locator('#menu-button .menu-count').count()) !== (real ? 1 : 0)) throw new Error('the count does not follow the alerts (' + real + ')');
  });

  await step('coming up: until the mikvah night, then each onah with its reasons; the calendar button opens that day', async () => {
    await menuTo('coming');
    await page.waitForSelector('#up-steps h3:text-is("Until mikvah night")');
    await page.waitForSelector('#up-steps .up-clean_day.group');
    await page.waitForSelector('#up-onot h3:text-is("Onos of separation")');
    const first = await page.textContent('#up-onot .up-row .up-desc');
    if (!/beinonis|haflagah|hachodesh/i.test(first)) throw new Error('no reason shown: ' + first);
    if (await page.locator('#up-onot details').count()) throw new Error('reasons hidden behind a toggle');
    await page.click('#up-onot .up-row button.up-show');
    await pageIs('today');
    await page.waitForSelector('#day-pop.placed');
    if (!(await page.evaluate(() => document.getElementById('day-pop').contains(document.activeElement)))) throw new Error('the focus is not in the popup');
    await closePop();
  });

  await step('the entry is in the Log with its note, and can be removed; a past entry can be started from the Log', async () => {
    await menuTo('log');
    const row = page.locator('li.entry:has-text("checked by the browser test")');
    await row.waitFor();
    await row.locator('button[aria-label^="Options for"]').click();
    await row.locator('button:has-text("Remove")').click();
    await page.waitForSelector('dialog[open] h2:has-text("Remove this entry?")');
    await page.click('dialog button:has-text("Remove entry")');
    await page.waitForSelector('dialog', { state: 'detached' });
    await page.waitForSelector('li.entry:has-text("checked by the browser test")', { state: 'detached' });
    await page.click('#rec-open');
    await page.waitForSelector('#rec-kind-flow');
    await page.click('#rec-kind-hefsek');
    await page.waitForSelector('#rec-date');
    await page.click('#rec-cancel');
  });

  // ----- Try a text -----

  await step('Try a text: a typed text and its reply', async () => {
    await menuTo('try');
    await page.fill('#demo-text', 'status');
    await page.click('#demo-send');
    await page.waitForSelector('#demo-thread .msg.in .bubble:has-text("status")');
    await page.waitForSelector('#demo-thread .msg.out');
    const tagText = await page.textContent('#demo-thread .msg.out .tag');
    if (tagText !== 'simulated') throw new Error('status tag: ' + tagText);
    if ((await page.inputValue('#demo-text')) !== '') throw new Error('the box was not emptied');
  });

  await step('Try a text: the options of the reply are buttons; a quick button', async () => {
    await page.waitForSelector('#demo-thread .msg.out .bubble:has-text("Reply: PERIOD, HEFSEK, HISTORY, MORE")');
    const labels = await page.$$eval('.reply-extras .chip', b => b.map(x => x.textContent.trim()));
    if (labels.join() !== 'PERIOD,HEFSEK,HISTORY,MORE') throw new Error('buttons: ' + labels.join());
    let before = await page.locator('#demo-thread .msg').count();
    await page.click('.reply-extras button[aria-label="Send MORE"]');
    await page.waitForFunction(n => document.querySelectorAll('#demo-thread .msg').length > n, before);
    await page.waitForSelector('#demo-thread .msg.in .bubble:has-text("MORE")');
    await page.waitForSelector('.reply-extras button[aria-label="Send OTHER ENTRIES"]');
    before = await page.locator('#demo-thread .msg').count();
    await page.click('#demo-q-MENU');
    await page.waitForFunction(n => document.querySelectorAll('#demo-thread .msg').length > n, before);
    if (await page.locator('.quick-btn strong:text-matches("^[0-9?]$")').count()) throw new Error('a digit is offered');
  });

  await step('the texts are in the Log, marked simulated', async () => {
    await menuTo('log');
    await page.waitForSelector('.messages-card .msg .tag:has-text("simulated")');
  });

  // ----- Customs -----

  await step('customs: change, discard', async () => {
    await menuTo('customs');
    await page.click('#cu-orZarua');
    await page.locator('#cu-orZarua-body label.choice:has(input:not(:checked))').first().click();
    await page.waitForSelector('.save-bar.dirty:has-text("Unsaved changes")');
    await page.waitForSelector('#cu-row-orZarua .tag:has-text("Changed")');
    await page.click('#cu-discard');
    await page.waitForSelector('.save-bar.dirty', { state: 'detached' });
  });

  await step('customs: leaving with unsaved changes asks first', async () => {
    await page.locator('#cu-orZarua-body label.choice:has(input:not(:checked))').first().click();
    await page.click('#back-home');
    await page.waitForSelector('dialog[open] h2:has-text("Leave without saving?")');
    await page.click('dialog button:has-text("Stay")');
    await page.waitForSelector('dialog', { state: 'detached' });
    await pageIs('customs');
    await page.click('#menu-button');
    await page.click('dialog#menu #menu-today');
    await page.waitForSelector('dialog[open] h2:has-text("Leave without saving?")');
    await page.click('dialog button:has-text("Stay")');
    await page.waitForSelector('dialog', { state: 'detached' });
    await pageIs('customs');
  });

  await step('customs: save and confirm', async () => {
    await page.click('#cu-save');
    await page.waitForSelector('.toast:has-text("Customs saved")');
    await page.waitForSelector('.save-bar', { state: 'detached' });
    await page.waitForSelector('p:has-text("Last saved:")');
  });

  const PAGES = ['today', 'coming', 'log', 'customs', 'settings', 'try'];
  await step('Hebrew terms keep an unsaved change and stay left-to-right; every page at 360 px', async () => {
    await page.locator('#cu-orZarua-body label.choice:has(input:not(:checked))').first().click();
    await page.click('#terms-he');
    await page.waitForSelector('#terms-he[aria-pressed="true"]');
    await page.waitForSelector('.choice-title:has-text("אור זרוע")');
    await page.waitForSelector('.save-bar.dirty');
    if ((await page.evaluate(() => getComputedStyle(document.body).direction)) !== 'ltr') throw new Error('direction');
    await page.click('#cu-discard');
    await page.setViewportSize({ width: 360, height: 800 });
    for (const name of PAGES) {
      await menuTo(name);
      await page.waitForTimeout(100);
      await noSideways(name);
      if (/\{[a-z_]+\}/.test(await page.textContent('#root'))) throw new Error('an unfilled term on ' + name);
      await page.screenshot({ path: out + '/dash-' + name + '-360-he.png', fullPage: true });
    }
  });

  await step('back to English terms; every page at 360 px', async () => {
    await menuTo('customs');
    await page.click('#terms-en');
    await page.waitForSelector('#terms-en[aria-pressed="true"]');
    await page.waitForSelector('.choice-title:has-text("Or Zarua")');
    for (const name of PAGES) {
      await menuTo(name);
      await page.waitForTimeout(100);
      await noSideways(name);
      await page.screenshot({ path: out + '/dash-' + name + '-360-en.png', fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 860 });
  });

  // ----- Settings -----

  await step('settings: the page opens with its list of sections', async () => {
    await menuTo('settings');
    await page.waitForSelector('#st-nav-location');
    const rows = await page.locator('[id^="st-nav-"]').count();
    if (rows !== 8) throw new Error('sections listed: ' + rows);
    await page.click('#st-nav-texting');
    await page.waitForSelector('#st-pane-texting');
  });

  // ----- the three Dates settings (S.app.dates, rewritten in the browser until the server sends it) -----

  const withDates = v => s => ({ ...s, app: { ...s.app, dates: v } });
  await step('dates "civil": pages by civil month, the civil day large, no Hebrew number; the keyboard across a month boundary', async () => {
    await reshape(withDates('civil'));
    await openHome();
    if ((await page.textContent('#cal-title')) !== monthName(today)) throw new Error('title ' + (await page.textContent('#cal-title')));
    if (await page.locator('#cal-sub').count()) throw new Error('a Hebrew span under the title');
    if ((await page.textContent(`#day-${today} .cd`)).trim() !== String(Number(today.slice(8)))) throw new Error('the large number is not the civil day');
    if (await page.locator('table.month .hd').count()) throw new Error('Hebrew numbers shown');
    const first = today.slice(0, 7) + '-01';
    if (await page.locator('#day-' + first).count()) {
      await page.focus('#day-' + first);
      await page.keyboard.press('ArrowUp');
      await page.waitForFunction(id => document.activeElement && document.activeElement.id === id, 'day-' + addDays(first, -7));
      if ((await page.textContent('#cal-title')) !== monthName(addDays(first, -7))) throw new Error('did not move to the month before');
    }
    await page.screenshot({ path: out + '/dash-home-civil-390.png' });
  });

  await step('dates "both": pages by civil month, the civil day large, the Hebrew day small', async () => {
    await reshape(withDates('both'));
    await openHome();
    if ((await page.textContent('#cal-title')) !== monthName(today)) throw new Error('title');
    if (!(await page.textContent('#cal-sub')).includes(s0.grid.days.find(d => d.date === today).hebrewMonth)) throw new Error('no Hebrew months under the title');
    if ((await page.textContent(`#day-${today} .cd`)).trim() !== String(Number(today.slice(8)))) throw new Error('large number');
    if ((await page.textContent(`#day-${today} .hd`)).trim() !== s0.grid.days.find(d => d.date === today).hebrewDay) throw new Error('small number');
    await openDay(yesterday);
    const want = 'Yesterday ' + new Date(yesterday + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) + ' · ' + s0.grid.days.find(d => d.date === yesterday).hebrewDay;
    if (!(await page.textContent('#day-pop .pop-date')).startsWith(want)) throw new Error('popup date ' + (await page.textContent('#day-pop .pop-date')));
    await closePop();
    await page.screenshot({ path: out + '/dash-home-both-390.png' });
  });

  await step('dates "hebrew" (and with no setting): Page Down and Up move by Hebrew month', async () => {
    await reshape(withDates('hebrew'));
    await openHome();
    const here = await page.textContent('#cal-title');
    if (!here.startsWith(hm[0].hebrewMonth)) throw new Error('title ' + here);
    await page.focus('#day-' + today);
    await page.keyboard.press('PageDown');
    await page.waitForFunction(t => document.getElementById('cal-title').textContent !== t, here);
    const next = await page.textContent('#cal-title');
    await page.keyboard.press('PageUp');
    await page.waitForFunction(t => document.getElementById('cal-title').textContent === t, here);
    if (next === here) throw new Error('no change');
    await unshape();
    await openHome();
    if ((await page.textContent('#cal-title')) !== here) throw new Error('the default is not the Hebrew month');
  });

  for (const [w, scheme] of [
    [390, 'light'],
    [1280, 'light'],
    [390, 'dark'],
    [1280, 'dark'],
  ]) {
    await step(`screenshots at ${w} px, ${scheme}`, async () => {
      await page.setViewportSize({ width: w, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      for (const name of PAGES) {
        await menuTo(name);
        await page.waitForTimeout(100);
        await noSideways(name);
        await page.screenshot({ path: `${out}/dash-${name}-${w}-${scheme}.png`, fullPage: true });
      }
      if (w === 1280) {
        // the popup next to its day, small; words beside the marks
        await menuTo('today');
        await openDay(yesterday);
        const day = await page.locator('#day-' + yesterday).boundingBox();
        const pop = await page.locator('#day-pop').boundingBox();
        if (pop.width > 320) throw new Error('the popup is ' + pop.width + ' px wide');
        if (Math.abs(pop.y - (day.y + day.height)) > 12 && Math.abs(pop.y + pop.height - day.y) > 12) throw new Error('the popup is not next to its day');
        await popInside();
        if ((await page.locator('table.month .cw:visible').count()) === 0) throw new Error('no words beside the marks at 1280 px');
        await page.screenshot({ path: `${out}/dash-pop-${w}-${scheme}.png` });
        await closePop();
      }
    });
  }

  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 860 });

  // ----- Texting; the home without a location; accounts without a phone -----

  /** As an ordinary account where texting works (not the test account). */
  const REAL = s => ({ ...s, demo: false, sms: { ...s.sms, simulated: false } });
  const GOOGLE_ONLY = s => ({ ...REAL(s), account: { ...s.account, number: null, method: 'google', hasPassword: false, googleEmail: 'ada@example.com' }, phones: [] });
  const PHONE_AND_GOOGLE = s => ({ ...REAL(s), account: { ...s.account, number: null, method: 'google', hasPassword: false, googleEmail: 'ada@example.com' }, phones: s.phones.slice(0, 1).map(p => ({ ...p, me: false })) });

  await step('texting: the test account has "Try a text" and no card with the number', async () => {
    await unshape();
    await openHome();
    await menuTo('texting');
    if (await page.locator('#text-card').count()) throw new Error('the card is shown on the test account');
    await page.waitForSelector('#texting-none');
  });

  await step('texting: "Text this number" with the number, the main options and a link to Texting; no "Try a text" in the menu', async () => {
    await reshape(REAL);
    await openHome();
    if (await page.locator('#demo-tag').count()) throw new Error('the test-account tag on an ordinary account');
    await page.click('#menu-button');
    if (await page.locator('#menu-try').count()) throw new Error('"Try a text" in the menu');
    await page.click('#menu-texting');
    await page.waitForSelector('#text-card :text("Text this number")');
    const s = await state();
    const number = s.sms.number.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
    if ((await page.textContent('#text-number')).trim() !== number) throw new Error('number');
    if ((await page.getAttribute('#text-number', 'href')) !== 'sms:' + s.sms.number) throw new Error('not a text link');
    const options = await page.$$eval('#text-card kbd', k => k.map(x => x.textContent));
    if (options.join(' ') !== 'PERIOD HEFSEK STATUS MORE') throw new Error('options: ' + options.join(' '));
    if (!(await page.textContent('#text-note')).includes('Every text ends with its options; answer by word.')) throw new Error('no line on options');
    await noLeftovers('texting');
    await page.click('#text-all');
    await hashIs('#settings/texting');
    await page.waitForSelector('#st-pane-texting');
  });

  await step('texting: no "Text this number" while the account has no phone; nothing breaks for a Google account', async () => {
    await reshape(GOOGLE_ONLY);
    await openHome();
    await menuTo('texting');
    if (await page.locator('#text-card').count()) throw new Error('shown without a phone');
    await noLeftovers('texting, Google, no phone');
    await reshape(PHONE_AND_GOOGLE);
    await openHome();
    await menuTo('texting');
    await page.waitForSelector('#text-card');
    for (const name of ['today', 'coming', 'log', 'customs', 'settings']) {
      await menuTo(name);
      await noLeftovers(name + ', phone and Google');
    }
  });

  await step('no location: the home shows the sentence and one button to Settings, Location, instead of the calendar', async () => {
    await reshape(s => ({ ...REAL(s), status: null, grid: null, upcoming: [] }));
    await openHome();
    await page.waitForSelector('#no-location:text-is("Nothing can be calculated until a location is chosen.")');
    if (await page.locator('#cal-title, .status-line, #text-card').count()) throw new Error('more than the sentence and the button');
    if ((await page.locator('main.page-today a, main.page-today button').count()) !== 1) throw new Error('not one button');
    await noSideways('home without a location');
    await page.screenshot({ path: out + '/dash-no-location-390.png' });
    await menuTo('coming');
    await noLeftovers('coming up without a location');
    await page.click('#back-home');
    await page.click('#choose-location');
    await hashIs('#settings/location');
    await page.waitForSelector('#st-title:has-text("Location")');
    await unshape();
  });

  // ----- the header and Sign out -----

  await step('header: one row that fits at 360 px; Menu is a 44 px target on the title’s line', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openHome();
    const btn = page.locator('#menu-button');
    const b = await btn.boundingBox();
    const t = await page.locator('header.dash-top h1').boundingBox();
    if (b.height < 44) throw new Error('only ' + b.height + ' px high');
    if (Math.abs(b.y + b.height / 2 - (t.y + t.height / 2)) > 12) throw new Error('not on the title’s line');
    if (b.x + b.width > 360) throw new Error('off the screen');
    if (b.x < t.x + t.width) throw new Error('overlaps the title');
    await noSideways('header at 360 px');
    await page.screenshot({ path: out + '/dash-header-360.png' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(100);
    if ((await page.locator('header.dash-top').boundingBox()).height > 80) throw new Error('header is more than one row at 1280 px');
    await page.setViewportSize({ width: 390, height: 860 });
  });

  await step('menu: Sign out with unsaved customs asks first; then signs out', async () => {
    await menuTo('customs');
    if (!(await page.isVisible('#cu-orZarua-body label.choice'))) await page.click('#cu-orZarua');
    await page.locator('#cu-orZarua-body label.choice:has(input:not(:checked))').first().click();
    await page.waitForSelector('.save-bar.dirty');
    await page.click('#menu-button');
    await page.click('#menu-sign-out');
    await page.waitForSelector('dialog[open] h2:has-text("Leave without saving?")');
    await page.click('dialog button:has-text("Stay")');
    await page.waitForSelector('dialog', { state: 'detached' });
    await page.click('#cu-discard');
    await page.waitForSelector('.save-bar.dirty', { state: 'detached' });
    await page.click('#menu-button');
    await page.click('#menu-sign-out');
    await page.waitForSelector('form.login');
    const r = await page.request.get(base + '/api/state', { headers: H });
    if (r.status() !== 401) throw new Error('still signed in: ' + r.status());
    if (/Kislev|Teves|Shvat|Adar|Nisan|Iyar|Sivan|Tamuz|Elul|Tishrei|Cheshvan/.test(await page.textContent('body'))) throw new Error('the account is still on screen');
    if (await page.locator('dialog').count()) throw new Error('a sheet was left open');
  });

  // ----- a page that cannot be loaded -----

  for (const [label, fulfil, heading] of [
    ['the site cannot be loaded', { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The site is being updated. Try again in a minute.' }) }, 'Could not load'],
    ['the site is not set up', { status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false }) }, 'Not set up yet'],
  ]) {
    await step('a failed load (' + label + '): the reason and "Back to the home page"', async () => {
      const c = await browser.newContext({ viewport: { width: 360, height: 800 } });
      const p = await c.newPage();
      const own = [];
      p.on('pageerror', e => own.push('pageerror: ' + e.message));
      p.on('console', m => {
        if (m.type() === 'error' && !/status of 503/.test(m.text())) own.push('console: ' + m.text());
      });
      await p.route('**/api/public', route => route.fulfill(fulfil));
      await p.goto(base + '/app/');
      await p.waitForSelector(`.card.login h2:has-text("${heading}")`);
      if (fulfil.status === 503) await p.waitForSelector('.alert:has-text("The site is being updated")');
      const a = p.locator('a:has-text("Back to the home page")');
      if ((await a.getAttribute('href')) !== '/') throw new Error('link: ' + (await a.getAttribute('href')));
      const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (wide > 1) throw new Error(wide + ' px wider than the screen');
      await p.screenshot({ path: out + '/dash-failed-' + (fulfil.status === 503 ? 'load' : 'setup') + '-360.png' });
      await c.close();
      if (own.length) throw new Error(own.join(' | '));
    });
  }

  await browser.close();
  if (errors.length) {
    console.log('\n' + errors.length + ' problem(s):\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  console.log('\nall steps passed');
})();
