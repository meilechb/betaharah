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
// scrolling at 360 px. Exits 0 when every step passed.
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
      if (!label || !label.includes(e.title)) throw new Error(e.startDate + ' does not mention ' + e.title + ': ' + label);
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
    if (!detail.includes(target.title)) throw new Error('details do not list ' + target.title);
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

  await step('legend opens', async () => {
    await page.click('#cal-legend');
    await page.waitForSelector('ul.legend li:has-text("Dashed: projected")', { state: 'visible' });
  });

  // ----- recording -----

  await step('a refusal is shown next to the form', async () => {
    await page.click('#rec-kind-mikvah');
    await page.click('#rec-submit');
    await page.waitForSelector('.record-card .rec-error');
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
    await page.waitForSelector('.record-card .rec-done');
    const msg = await page.textContent('.rec-done');
    if (!/Recorded/i.test(msg)) throw new Error('confirmation: ' + msg);
  });

  await step('the entry is in the Log with its note, and can be removed', async () => {
    await tab('Log');
    const row = page.locator('li.entry:has-text("checked by the browser test")');
    await row.waitFor();
    await row.locator('button:has-text("Options")').click();
    await row.locator('button:has-text("Remove this entry")').click();
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

  // ----- Try a text -----

  await step('Try a text: a typed text and its reply', async () => {
    await tab('Today');
    await page.fill('#demo-text', '9');
    await page.click('#demo-send');
    await page.waitForSelector('#demo-thread .msg.in .bubble:has-text("9")');
    await page.waitForSelector('#demo-thread .msg.out');
    const tagText = await page.textContent('#demo-thread .msg.out .tag');
    if (tagText !== 'simulated') throw new Error('status tag: ' + tagText);
    if ((await page.inputValue('#demo-text')) !== '') throw new Error('the box was not emptied');
  });

  await step('Try a text: a quick button', async () => {
    const before = await page.locator('#demo-thread .msg').count();
    await page.click('#demo-q-q');
    await page.waitForFunction(n => document.querySelectorAll('#demo-thread .msg').length > n, before);
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
    await page.waitForSelector('dialog[open] h2:has-text("Leave without saving your customs?")');
    await page.click('dialog button:has-text("Stay and save")');
    await page.waitForSelector('dialog', { state: 'detached' });
    if ((await page.getAttribute('nav.tabs button:has-text("Customs")', 'aria-selected')) !== 'true') throw new Error('left the tab');
  });

  await step('customs: save and confirm', async () => {
    await page.click('#cu-save');
    await page.waitForSelector('.toast:has-text("Your customs are saved")');
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

  await browser.close();
  if (errors.length) {
    console.log('\n' + errors.length + ' problem(s):\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  console.log('\nall steps passed');
})();
