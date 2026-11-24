// The signed-in dashboard in a real browser, on the operator's test account.
//
//   1. a .dev.vars file as described in test/ui-check.cjs (DASHBOARD_PASSWORD=local-test-password)
//   2. npx wrangler dev --port 8812 --persist-to <a new empty directory>
//   3. node test/ui/dashboard.cjs <directory for screenshots> http://127.0.0.1:8812
//
// Covers: the month calendar (navigation, choosing a day, keyboard, events on
// the right days), recording and removing an entry, a refusal shown next to the
// form, Customs (edit, discard, the leave guard, save), the Settings tab (its sections: settings.cjs), the
// test-account banner and "Try a text", both forms of the terms, and no sideways
// scrolling at 360 px; Today's "Text this number" and the screen without a location;
// accounts signed in with Google or with no phone (state rewritten in the browser);
// the header's Sign out; a failed load. Exits 0 when every step passed.
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
    try {
      await fn();
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
  const tab = async name => {
    await page.click(`nav.tabs button:has-text("${name}")`);
    await page.waitForSelector(`nav.tabs button[aria-selected="true"]:has-text("${name}")`);
  };
  const state = async () => (await (await page.request.get(base + '/api/state', { headers: H })).json()).state;

  await step('open the test account', async () => {
    const r1 = await page.request.post(base + '/api/admin/login', { headers: H, data: { password: ADMIN_PASSWORD } });
    if (!r1.ok()) throw new Error('admin login ' + r1.status());
    const r2 = await page.request.post(base + '/api/admin/demo', { headers: H });
    if (!r2.ok()) throw new Error('demo ' + r2.status());
    await page.goto(base + '/app/#today');
    await page.waitForSelector('nav.tabs');
  });

  // ----- the banner and the header -----

  await step('test-account banner and date line', async () => {
    const banner = await page.textContent('.demo-banner');
    if (!banner.includes('This is the test account. Nothing here is sent to a real phone.')) throw new Error('banner: ' + banner);
    const line = await page.textContent('.date-line');
    if (!/Kislev|Tevet|Shevat|Adar|Nisan|Iyar|Sivan|Tamuz|Av|Elul|Tishrei|Cheshvan/.test(line)) throw new Error('no Hebrew date: ' + line);
    if (!/sunset \d/.test(line)) throw new Error('no sunset: ' + line);
    await page.waitForSelector('.status-card .headline');
  });

  // ----- the month calendar -----

  const s0 = await state();
  const today = s0.grid.today;
  const monthName = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });

  await step('calendar shows this month with today outlined and chosen', async () => {
    const title = await page.textContent('#cal-title');
    if (title !== monthName(today)) throw new Error('title ' + title);
    const cur = await page.getAttribute(`#day-${today}`, 'aria-current');
    if (cur !== 'date') throw new Error('today is not marked');
    if ((await page.getAttribute(`#day-${today}`, 'aria-pressed')) !== 'true') throw new Error('today is not chosen');
    await page.waitForSelector('#detail-title');
  });

  await step('calendar events are on the right days', async () => {
    const month = today.slice(0, 7);
    const events = s0.grid.events.filter(e => e.startDate.startsWith(month));
    if (events.length === 0) throw new Error('the test account has no events this month');
    for (const e of events) {
      const label = await page.getAttribute(`#day-${e.startDate}`, 'aria-label');
      const title = e.title.replace(' (projected)', '');
      if (!label || !label.includes(title)) throw new Error(e.startDate + ' does not mention ' + title + ': ' + label);
      if (label.includes('(projected)')) throw new Error(e.startDate + ' says "(projected)": ' + label);
      const marks = await page.locator(`#day-${e.startDate} .marks .mk`).count();
      if (marks === 0) throw new Error('no mark on ' + e.startDate);
    }
    // a day with nothing on it has no marks
    const empty = s0.grid.days.find(d => d.date.startsWith(month) && !s0.grid.events.some(e => e.startDate <= d.date && e.endDate >= d.date));
    if (empty && (await page.locator(`#day-${empty.date} .marks .mk`).count()) !== 0) throw new Error('marks on an empty day ' + empty.date);
  });

  await step('choosing a day shows its details', async () => {
    const mikvah = s0.grid.events.find(e => e.kind === 'mikvah' && e.startDate.slice(0, 7) === today.slice(0, 7));
    const target = mikvah || s0.grid.events.find(e => e.startDate.slice(0, 7) === today.slice(0, 7));
    await page.click(`#day-${target.startDate}`);
    await page.waitForSelector(`#day-${target.startDate}[aria-pressed="true"]`);
    const detail = await page.textContent('.day-detail');
    if (!detail.includes(target.title.replace(' (projected)', ''))) throw new Error('details do not list ' + target.title);
    if (!/Sunrise \d/.test(detail)) throw new Error('no sunrise in the details');
  });

  await step('arrow keys move between days', async () => {
    await page.click(`#day-${today}`);
    await page.keyboard.press('ArrowRight');
    const next = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
    await page.waitForSelector(`#day-${next}[aria-pressed="true"]`);
    const focused = await page.evaluate(() => document.activeElement.id);
    if (focused !== 'day-' + next) throw new Error('focus is on ' + focused);
    await page.keyboard.press('ArrowLeft');
    await page.waitForSelector(`#day-${today}[aria-pressed="true"]`);
  });

  await step('previous and next month, and back to today', async () => {
    await page.click('#cal-prev');
    const prevTitle = await page.textContent('#cal-title');
    if (prevTitle === monthName(today)) throw new Error('the month did not change');
    await page.click('#cal-next');
    await page.click('#cal-next');
    const nextTitle = await page.textContent('#cal-title');
    if (nextTitle === monthName(today) || nextTitle === prevTitle) throw new Error('next month: ' + nextTitle);
    await page.click('#cal-today');
    if ((await page.textContent('#cal-title')) !== monthName(today)) throw new Error('Today did not come back');
  });

  await step('legend: always shown under the month, in two groups', async () => {
    await page.waitForSelector('#legend-recorded h4:text-is("Recorded")', { state: 'visible' });
    await page.waitForSelector('#legend-worked-out h4:text-is("Worked out")', { state: 'visible' });
    const recorded = await page.textContent('#legend-recorded');
    for (const p of ['Flow or stain', 'Hefsek taharah', 'Immersion']) if (!recorded.includes(p)) throw new Error('recorded group: no ' + p);
    const worked = await page.textContent('#legend-worked-out');
    for (const p of ['Hefsek taharah due', 'Seven clean days', 'Mikvah night', 'Veset onah', 'Or Zarua only', 'Expected']) if (!worked.includes(p)) throw new Error('worked-out group: no ' + p);
    // how a day is drawn: one closed "More"
    if (await page.locator('#legend-more[open]').count()) throw new Error('"More" is open');
    if (await page.locator('#cal-legend .legend-days li:visible').count()) throw new Error('the notes on how a day is drawn are shown');
    if ((await page.textContent('#legend-recorded .mk.hefsek.done')) !== 'H✓') throw new Error('no H✓ in the legend');
    if ((await page.textContent('#legend-worked-out .mk.hefsek.projected')) !== 'H?') throw new Error('no H? in the legend');
    if ((await page.locator('#legend-worked-out .mk.mikvah.plan').count()) !== 1) throw new Error('no outlined M in the legend');
  });

  await step('the recorded hefsek taharah and immersion are marked with a tick; the planned mikvah night is outlined', async () => {
    const hefsek = s0.grid.events.find(e => e.kind === 'hefsek' && e.title.includes('✓') && e.startDate.slice(0, 7) === today.slice(0, 7));
    if (hefsek) {
      if ((await page.textContent(`#day-${hefsek.startDate} .mk.hefsek`)) !== 'H✓') throw new Error('the recorded hefsek is not H✓');
      await page.click(`#day-${hefsek.startDate}`);
      await page.waitForSelector('#day-events .ev.hefsek .tag:text-is("recorded")');
    }
    const plan = s0.grid.events.find(e => e.kind === 'mikvah' && !e.title.includes('✓') && e.startDate.slice(0, 7) === today.slice(0, 7));
    if (plan && (await page.textContent(`#day-${plan.startDate} .mk.mikvah.plan`)) !== 'M') throw new Error('the mikvah night is not an outlined M');
    await page.click(`#day-${today}`);
  });

  // ----- where things stand: the next step -----

  await step('where things stand, in the clean days: no button to press, only "Record something else"; no floating button', async () => {
    const st = await state();
    if (st.status.phase !== 'counting') throw new Error('the test account is not in the clean days: ' + st.status.phase);
    if (await page.locator('#next-step').count()) throw new Error('a next-step button in the clean days');
    await page.waitForSelector('.status-card #next-else:has-text("Record something else")');
    await page.waitForSelector('.status-card .today-box .ti-title');
    if (await page.locator('#record-jump').count()) throw new Error('the floating Record button is still there');
    const fixed = await page.$$eval('.panel-today button', els => els.filter(el => getComputedStyle(el).position === 'fixed').length);
    if (fixed) throw new Error(fixed + ' fixed buttons on Today');
    if (await page.locator('#record-panel').count()) throw new Error('the form is open before it was asked for');
    if (/\(projected\)/.test(await page.textContent('#root'))) throw new Error('"(projected)" on the page');
  });

  // ----- recording -----

  await step('"Record something else" opens the form under the status card; Close closes it', async () => {
    await page.click('#next-else');
    await page.waitForSelector('#record-panel #rec-kind-flow');
    const order = await page.evaluate(() => [document.querySelector('.status-card'), document.getElementById('record-panel'), document.querySelector('.calendar-card')].map(el => el.getBoundingClientRect().top));
    if (!(order[0] < order[1] && order[1] < order[2])) throw new Error('the form is not under the status card: ' + order.join(', '));
    await page.click('#rec-close');
    await page.waitForSelector('#record-panel', { state: 'detached' });
    if ((await page.evaluate(() => document.activeElement.id)) !== 'next-else') throw new Error('the focus did not go back to the link');
  });

  await step('a refusal is shown next to the form', async () => {
    await page.click('#next-else');
    await page.click('#rec-kind-mikvah');
    await page.click('#rec-submit');
    await page.waitForSelector('#record-panel .rec-error');
  });

  await step('record an entry for another time', async () => {
    await page.click('#rec-kind-stain');
    await page.click('#r-rec-mode-other');
    await page.fill('#rec-date', today);
    await page.click('#rec-submit');
    await page.waitForSelector('#rec-error-how, .record-card fieldset.how.invalid');
    await page.click('#r-rec-how-day');
    await page.fill('#rec-note', 'checked by the browser test');
    await page.click('#rec-submit');
    await page.waitForSelector('.status-card .rec-done');
    const msg = await page.textContent('.rec-done');
    if (!/Recorded/i.test(msg)) throw new Error('confirmation: ' + msg);
    if (await page.locator('#record-panel').count()) throw new Error('the form stayed open');
  });

  await step('the day panel: one click records on that day, a refusal is shown beside the buttons, Undo removes it', async () => {
    const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
    if (!(await page.locator('#day-' + yesterday).count())) await page.click('#cal-prev');
    await page.click('#day-' + yesterday);
    await page.waitForSelector('#day-panel h4:text-is("What happened?")');
    for (const id of ['dp-add-flow-day', 'dp-add-flow-night', 'dp-add-hefsek']) await page.waitForSelector('#' + id);
    // the immersion is under "Other things to add"
    if (await page.locator('#dp-add-mikvah:visible').count()) throw new Error('the immersion is a one-click button');
    const note = await page.textContent('#day-panel .day-night-note');
    if (note !== 'Night: after sunset.') throw new Error('note: ' + note);
    const before = (await state()).entryCount;
    await page.click('#day-more summary');
    await page.click('#dp-add-mikvah');
    await page.waitForSelector('#day-panel .rec-error');
    if ((await state()).entryCount !== before) throw new Error('the refused immersion was recorded');
    await page.click('#dp-add-stain-day');
    await page.waitForSelector('#day-panel .rec-done');
    if ((await state()).entryCount !== before + 1) throw new Error('not recorded');
    await page.click('#rec-undo');
    await page.waitForSelector('#day-panel .rec-done:has-text("Removed")');
    if ((await state()).entryCount !== before) throw new Error('Undo did not remove it');
    // a future day shows only what is marked on it
    const later = new Date(Date.parse(today + 'T12:00:00Z') + 2 * 86400000).toISOString().slice(0, 10);
    await page.click('#cal-today');
    if (!(await page.locator('#day-' + later).count())) await page.click('#cal-next');
    await page.click('#day-' + later);
    await page.waitForSelector('#day-panel h4:text-is("On this day")');
    if (await page.locator('#dp-add-flow-day').count()) throw new Error('buttons to record on a future day');
    await page.click('#cal-today');
  });

  await step('the entry is in the Log with its note, and can be removed', async () => {
    await tab('Log');
    const row = page.locator('li.entry:has-text("checked by the browser test")');
    await row.waitFor();
    await row.locator('button[aria-label^="Options for"]').click();
    await row.locator('button:has-text("Remove")').click();
    await page.waitForSelector('dialog[open] h2:has-text("Remove this entry?")');
    await page.click('dialog button:has-text("Remove entry")');
    await page.waitForSelector('dialog', { state: 'detached' });
    await page.waitForSelector('li.entry:has-text("checked by the browser test")', { state: 'detached' });
  });

  await step('a past entry can be started from the Log', async () => {
    await page.click('#rec-open');
    await page.waitForSelector('#rec-kind-flow');
    await page.click('#rec-kind-hefsek');
    await page.waitForSelector('#rec-date');
    await page.click('#rec-cancel');
  });

  await step('coming up: until the mikvah night, then each onah with its reasons shown', async () => {
    await tab('Today');
    await page.waitForSelector('#up-steps h3:text-is("Until mikvah night")');
    await page.waitForSelector('#up-steps .up-clean_day.group');
    await page.waitForSelector('#up-onot h3:text-is("Onot of separation")');
    const first = await page.textContent('#up-onot .up-row .up-desc');
    if (!/beinonit|haflagah|hachodesh/i.test(first)) throw new Error('no reason shown: ' + first);
    if (await page.locator('#up-onot details').count()) throw new Error('reasons hidden behind a toggle');
  });

  // ----- Try a text -----

  await step('Try a text: a typed text and its reply', async () => {
    await tab('Today');
    await page.fill('#demo-text', 'status');
    await page.click('#demo-send');
    await page.waitForSelector('#demo-thread .msg.in .bubble:has-text("status")');
    await page.waitForSelector('#demo-thread .msg.out');
    const tagText = await page.textContent('#demo-thread .msg.out .tag');
    if (tagText !== 'simulated') throw new Error('status tag: ' + tagText);
    if ((await page.inputValue('#demo-text')) !== '') throw new Error('the box was not emptied');
  });

  await step('Try a text: the options of the reply are buttons; a quick button', async () => {
    // the reply to "status" ends with its options, shown as buttons that send the option
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
    // no digit commands are offered
    if (await page.locator('.quick-btn strong:text-matches("^[0-9?]$")').count()) throw new Error('a digit is offered');
  });

  await step('the texts are in the Log, marked simulated', async () => {
    await tab('Log');
    await page.waitForSelector('.messages-card .msg .tag:has-text("simulated")');
  });

  // ----- Customs -----

  await step('customs: change, discard', async () => {
    await tab('Customs');
    await page.click('#cu-orZarua');
    const other = page.locator('#cu-orZarua-body label.choice:has(input:not(:checked))').first();
    await other.click();
    await page.waitForSelector('.save-bar.dirty:has-text("Unsaved changes")');
    await page.waitForSelector('#cu-row-orZarua .tag:has-text("Changed")');
    await page.click('#cu-discard');
    await page.waitForSelector('.save-bar.dirty', { state: 'detached' });
  });

  await step('customs: leaving with unsaved changes asks first', async () => {
    await page.locator('#cu-orZarua-body label.choice:has(input:not(:checked))').first().click();
    await page.click('nav.tabs button:has-text("Today")');
    await page.waitForSelector('dialog[open] h2:has-text("Leave without saving?")');
    await page.click('dialog button:has-text("Stay")');
    await page.waitForSelector('dialog', { state: 'detached' });
    if ((await page.getAttribute('nav.tabs button:has-text("Customs")', 'aria-selected')) !== 'true') throw new Error('left the tab');
  });

  await step('customs: save and confirm', async () => {
    await page.click('#cu-save');
    await page.waitForSelector('.toast:has-text("Customs saved")');
    await page.waitForSelector('.save-bar', { state: 'detached' });
    await page.waitForSelector('p:has-text("Last saved:")');
  });

  await step('Hebrew terms keep an unsaved change and stay left-to-right', async () => {
    await page.locator('#cu-orZarua-body label.choice:has(input:not(:checked))').first().click();
    await page.click('#terms-he');
    await page.waitForSelector('#terms-he[aria-pressed="true"]');
    await page.waitForSelector('.choice-title:has-text("אור זרוע")');
    await page.waitForSelector('.save-bar.dirty');
    const dir = await page.evaluate(() => getComputedStyle(document.body).direction);
    if (dir !== 'ltr') throw new Error('direction ' + dir);
    await page.click('#cu-discard');
  });

  for (const width of [360]) {
    await step('no sideways scrolling at ' + width + ' px in Hebrew terms', async () => {
      await page.setViewportSize({ width, height: 800 });
      for (const name of ['Today', 'Log', 'Customs', 'Settings']) {
        await tab(name);
        await page.waitForTimeout(100);
        await noSideways(name);
        await page.screenshot({ path: out + '/dash-' + name.toLowerCase() + '-' + width + '-he.png', fullPage: true });
      }
    });
  }

  await step('back to English terms', async () => {
    await tab('Customs');
    await page.click('#terms-en');
    await page.waitForSelector('#terms-en[aria-pressed="true"]');
    await page.waitForSelector('.choice-title:has-text("Or Zarua")');
  });

  await step('no sideways scrolling at 360 px in English terms', async () => {
    for (const name of ['Today', 'Log', 'Customs', 'Settings']) {
      await tab(name);
      await page.waitForTimeout(100);
      await noSideways(name);
      await page.screenshot({ path: out + '/dash-' + name.toLowerCase() + '-360-en.png', fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 860 });
  });

  // ----- Settings -----

  // Each Settings section has its own check in test/ui/settings.cjs; here only that the tab opens.
  await step('settings: the tab opens with its list of sections', async () => {
    await tab('Settings');
    await page.waitForSelector('#st-nav-location');
    const rows = await page.locator('[id^="st-nav-"]').count();
    if (rows !== 8) throw new Error('sections listed: ' + rows);
    await page.click('#st-nav-texting');
    await page.waitForSelector('#st-pane-texting');
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
      for (const name of ['Today', 'Log', 'Customs', 'Settings']) {
        await tab(name);
        await page.waitForTimeout(100);
        await noSideways(name);
        await page.screenshot({ path: `${out}/dash-${name.toLowerCase()}-${w}-${scheme}.png`, fullPage: true });
      }
    });
  }

  await page.emulateMedia({ colorScheme: 'light' });

  // ----- Today explains texting; Today without a location; accounts without a phone -----
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
  /** As an ordinary account where texting works (not the test account, whose "Try a text" shows the number already). */
  const REAL = s => ({ ...s, demo: false, sms: { ...s.sms, simulated: false } });
  const GOOGLE_ONLY = s => ({ ...REAL(s), account: { ...s.account, number: null, method: 'google', hasPassword: false, googleEmail: 'ada@example.com' }, phones: [] });
  const PHONE_AND_GOOGLE = s => ({ ...REAL(s), account: { ...s.account, number: null, method: 'google', hasPassword: false, googleEmail: 'ada@example.com' }, phones: s.phones.slice(0, 1).map(p => ({ ...p, me: false })) });
  /** A fresh load of Today (not only a change of the hash), so that /api/state is asked again. */
  const openToday = async () => {
    await page.goto('about:blank');
    await page.goto(base + '/app/#today');
    await page.waitForSelector('nav.tabs button[aria-selected="true"]:has-text("Today")');
  };
  const noLeftovers = async label => {
    const text = await page.textContent('#root');
    const m = /\b(undefined|null|NaN)\b/.exec(text);
    if (m) throw new Error((label || 'the page') + ' shows "' + m[1] + '"');
  };
  const hashIs = async want => {
    for (let i = 0; i < 40 && (await page.evaluate(() => location.hash)) !== want; i += 1) await page.waitForTimeout(50);
    const got = await page.evaluate(() => location.hash);
    if (got !== want) throw new Error('address is ' + got + ', expected ' + want);
  };

  await step('today: the test account shows "Try a text", not a second card with the number', async () => {
    await unshape();
    await openToday();
    await page.waitForSelector('#demo-text');
    if (await page.locator('#text-card').count()) throw new Error('both cards shown');
  });

  await step('today: "Text this number" with the number, the main options and a link to Texting', async () => {
    await reshape(REAL);
    await openToday();
    await page.waitForSelector('#text-card h2:has-text("Text this number"), #text-card :text("Text this number")');
    const s = await state();
    const number = s.sms.number.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
    if ((await page.textContent('#text-number')).trim() !== number) throw new Error('number: ' + (await page.textContent('#text-number')));
    if ((await page.getAttribute('#text-number', 'href')) !== 'sms:' + s.sms.number) throw new Error('not a text link');
    const options = await page.$$eval('#text-card kbd', k => k.map(x => x.textContent));
    if (options.join(' ') !== 'PERIOD HEFSEK STATUS MORE') throw new Error('options: ' + options.join(' '));
    if (!(await page.textContent('#text-note')).includes('Every text ends with its options; answer by word.')) throw new Error('no line on options');
    await noLeftovers('today');
    await page.click('#text-all');
    await hashIs('#settings/texting');
    await page.waitForSelector('#st-pane-texting');
  });

  await step('today: no "Text this number" while the account has no phone; nothing breaks for a Google account', async () => {
    await reshape(GOOGLE_ONLY);
    await openToday();
    await page.waitForSelector('.status-card .headline');
    if (await page.locator('#text-card').count()) throw new Error('shown without a phone');
    await noLeftovers('today, Google, no phone');
    await reshape(PHONE_AND_GOOGLE);
    await openToday();
    await page.waitForSelector('#text-card');
    await noLeftovers('today, phone and Google');
    for (const name of ['Log', 'Customs', 'Settings']) {
      await tab(name);
      await noLeftovers(name + ', phone and Google');
    }
  });

  await step('today: without a location, the reason and a button to Settings, Location', async () => {
    await reshape(s => ({ ...REAL(s), status: null, grid: null, upcoming: [] }));
    await openToday();
    await page.waitForSelector('#no-location:text-is("Nothing can be calculated until a location is chosen.")');
    await page.waitForSelector('#text-card');
    await noSideways('today without a location');
    await page.click('#choose-location');
    await hashIs('#settings/location');
    await page.waitForSelector('#st-title:has-text("Location")');
    await unshape();
  });

  // ----- the header's Sign out -----

  await step('header: a quiet "Sign out" that fits at 360 px', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openToday();
    const btn = page.locator('header.dash-top #top-sign-out');
    if ((await btn.textContent()).trim() !== 'Sign out') throw new Error('label: ' + (await btn.textContent()));
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
    const wide = await page.locator('header.dash-top').boundingBox();
    if (wide.height > 120) throw new Error('header is ' + wide.height + ' px high at 1280 px');
    await page.setViewportSize({ width: 390, height: 860 });
  });

  await step('header: leaving with unsaved customs asks first; then Sign out signs out', async () => {
    await tab('Customs');
    if (!(await page.isVisible('#cu-orZarua-body label.choice'))) await page.click('#cu-orZarua');
    await page.locator('#cu-orZarua-body label.choice:has(input:not(:checked))').first().click();
    await page.waitForSelector('.save-bar.dirty');
    await page.click('#top-sign-out');
    await page.waitForSelector('dialog[open]');
    await page.click('dialog button:has-text("Stay")');
    await page.waitForSelector('dialog', { state: 'detached' });
    await page.click('#cu-discard');
    await page.waitForSelector('.save-bar.dirty', { state: 'detached' });
    await page.click('#top-sign-out');
    await page.waitForSelector('form.login');
    const r = await page.request.get(base + '/api/state', { headers: H });
    if (r.status() !== 401) throw new Error('still signed in: ' + r.status());
    if (/Kislev|Tevet|Shevat|Adar|Nisan|Iyar|Sivan|Tamuz|Elul|Tishrei|Cheshvan/.test(await page.textContent('body'))) throw new Error('the account is still on screen');
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
        // The refused /api/public is logged by the browser; anything else is an error.
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
