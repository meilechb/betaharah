// Drives the calculation test in a real browser against a locally running app:
// the operator console's "Calculation test" through a whole scenario, and the
// home page's "Try it".
//
//   1. a .dev.vars with DASHBOARD_PASSWORD=local-test-password (see test/ui-check.cjs)
//   2. npx wrangler dev --port 8871 --persist-to <a new empty directory>
//   3. node test/ui/sandbox.cjs <directory for screenshots> http://127.0.0.1:8871
//
// Console: blank, a period, the next month's marks, the hefsek, the count day
// by day, an immersion refused as too early (with the sentence a person gets),
// the immersion, a second, third and fourth period and the pattern alert, a
// custom changed, a date removed, the scenario copied, cleared, pasted back,
// and kept across a reload; at 360 px with no sideways scrolling.
// Home page: a period, then the hefsek taharah and the immersion; 360 px with
// no sideways scrolling; the keyboard; the request failing; no JavaScript.
// Any console error, page error or refused request fails the run (except the
// answers the steps provoke on purpose). Exits 0 only when every step passed.
const { chromium } = require('playwright');
const out = process.argv[2];
const base = (process.argv[3] || 'http://127.0.0.1:8871').replace(/\/$/, '');
const PASSWORD = 'local-test-password';

const failures = [];

function watch(page, allowed) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (allowed && allowed.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  return errors;
}

async function run(name, page, fn) {
  try {
    await fn();
    console.log('ok  ', name);
  } catch (e) {
    console.log('FAIL', name, '-', e.message.split('\n')[0]);
    failures.push(name);
    if (out) await page.screenshot({ path: `${out}/sandbox-fail-${failures.length}.png`, fullPage: true }).catch(() => undefined);
  }
}

const sideways = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ---------- the console ----------

async function console_(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: out ? 2 : 1 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  // 401 before signing in; 400 for refused input the steps send on purpose
  const errors = watch(page, /status of (400|401)/);
  const step = (name, fn) => run('console: ' + name, page, fn);
  const headline = () => page.textContent('#calc-headline');
  const waitHeadline = text => page.waitForFunction(t => (document.getElementById('calc-headline') || {}).textContent === t, text);
  const settled = () => page.waitForFunction(() => !document.querySelector('.calc-cal.busy'));
  const setToday = async (date, part) => {
    await page.fill('#calc-today', date);
    await page.dispatchEvent('#calc-today', 'change');
    await settled();
    if (part && (await page.getAttribute('#calc-part-' + part, 'aria-pressed')) !== 'true') {
      await page.click('#calc-part-' + part);
      await settled();
    }
    await page.waitForFunction(d => (document.getElementById('calc-today') || {}).value === d, date);
  };
  /** Shows the month of a date with the month buttons, as the operator would. */
  const showMonth = async date => {
    for (let k = 0; k < 8 && (await page.locator('#calc-day-' + date).count()) === 0; k++) {
      const shown = await page.evaluate(() => document.querySelector('table.month button.day').id.slice(9, 16));
      await page.click(date.slice(0, 7) < shown ? '#calc-prev' : '#calc-next');
    }
  };
  const add = async (date, kind, how) => {
    await showMonth(date);
    await page.click('#calc-day-' + date);
    await page.check('#r-calc-kind-' + kind);
    if (how) await page.check('#r-calc-how-' + how);
    await page.click('#calc-add');
    await settled();
    await page.waitForSelector('.calc-recorded, .calc-refused');
  };
  const logCount = () => page.locator('#calc-entries li').count();

  await step('signs in and opens a blank calendar', async () => {
    await page.goto(base + '/admin/');
    await page.fill('#pw', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForSelector('.app-bar');
    await page.click('#nav-calc');
    await page.waitForSelector('#page-title:text-is("Calculation test")');
    await page.waitForSelector('#calc-headline');
    if (!(await page.textContent('.calc-note')).includes('This runs the same calculation as people’s accounts, and saves nothing.')) throw new Error('no note');
    await setToday('2026-11-18', 'day');
    if ((await headline()) !== 'Tehorah') throw new Error('not blank: ' + (await headline()));
    if (!(await page.textContent('#calc-log-title')).includes('No dates yet')) throw new Error('the Log is not empty');
    if ((await page.locator('table.month .mk').count()) !== 0) throw new Error('marks on a blank calendar');
  });

  await step('a period: recorded, the hefsek projected, the next month marked', async () => {
    await add('2026-11-10', 'flow', 'day');
    const msg = await page.textContent('.calc-recorded');
    if (!/^Recorded: flow Tue Nov 10 by day\. Hefsek from Sat Nov 14\./.test(msg)) throw new Error('message: ' + msg);
    await waitHeadline('Niddah, before the hefsek taharah');
    if ((await page.locator('#calc-day-2026-11-10 .mk.flow').count()) !== 1) throw new Error('no flow mark');
    // the hefsek could be done from Nov 14; the next possible day is today
    if ((await page.locator('#calc-day-2026-11-18 .mk.hefsek.projected').count()) !== 1) throw new Error('no projected hefsek today');
    await page.click('#calc-next');
    await page.waitForSelector('#calc-month-title:text-is("December 2026")');
    // onah beinonit, day 30 and 31 from Nov 10
    if ((await page.locator('#calc-day-2026-12-09 .mk.onah').count()) < 1) throw new Error('no onah on Dec 9');
    if ((await page.locator('#calc-day-2026-12-10 .mk.onah').count()) < 1) throw new Error('no onah on Dec 10');
    await page.click('#calc-day-2026-12-09');
    const detail = await page.textContent('.day-detail');
    if (!/Onah beinonit/.test(detail)) throw new Error('the day does not say why it is marked');
    if (await logCount() !== 1) throw new Error('the Log does not list it');
  });

  await step('the hefsek, then the count day by day', async () => {
    await add('2026-11-14', 'hefsek');
    await waitHeadline('Seven clean days: day 4');
    await page.click('#calc-next-onah');
    await settled();
    if ((await page.getAttribute('#calc-part-night', 'aria-pressed')) !== 'true') throw new Error('not night');
    await page.click('#calc-next-onah');
    await waitHeadline('Seven clean days: day 5');
    await page.click('#calc-next-day');
    await waitHeadline('Seven clean days: day 6');
  });

  await step('an immersion too early is refused with the sentence a person gets, and not kept', async () => {
    const before = await logCount();
    await add('2026-11-17', 'mikvah');
    const text = await page.textContent('.calc-refused');
    if (!/^Not recorded: the count is not complete\. Mikvah night is Sat Nov 21 after \d+:\d\d (AM|PM)\.$/.test(text.trim())) throw new Error('refusal: ' + text);
    if ((await logCount()) !== before) throw new Error('the refused date was kept');
  });

  await step('mikvah night, then the immersion', async () => {
    await page.click('#calc-next-day');
    await waitHeadline('Seven clean days: day 7');
    await page.click('#calc-next-onah');
    await waitHeadline('Mikvah night');
    await add('2026-11-21', 'mikvah');
    await waitHeadline('Tehorah');
  });

  await step('three more periods 28 days apart: a pattern alert', async () => {
    await setToday('2027-01-06', 'day');
    await page.click('#calc-prev');
    await add('2026-12-08', 'flow', 'day');
    await page.click('#calc-to-today');
    await add('2027-01-05', 'flow', 'day');
    await setToday('2027-02-03', 'day');
    await add('2027-02-02', 'flow', 'day');
    await page.waitForSelector('#calc-alerts .alert:has-text("Three intervals in a row of 29 days, by day. A veset kavua for the interval may have been established. Ask a rav.")');
    if ((await logCount()) !== 6) throw new Error('not six dates in the Log');
  });

  await step('a custom changed is worked out at once', async () => {
    if (!(await page.textContent('#calc-upcoming')).includes('Or Zarua')) throw new Error('no Or Zarua before');
    await page.selectOption('#calc-c-orZarua', 'no');
    await settled();
    await page.waitForFunction(() => !document.getElementById('calc-upcoming').textContent.includes('Or Zarua'));
    if (!(await page.textContent('.calc-customs .tag')).includes('1 changed')) throw new Error('not marked as changed');
    await page.selectOption('#calc-c-orZarua', 'yes');
    await settled();
    await page.waitForFunction(() => document.getElementById('calc-upcoming').textContent.includes('Or Zarua'));
  });

  let copied = '';
  await step('the scenario is copied, cleared, and pasted back', async () => {
    await page.click('#calc-copy');
    await page.waitForSelector('.toast:has-text("The scenario was copied")');
    copied = await page.evaluate(() => navigator.clipboard.readText());
    const s = JSON.parse(copied);
    if (s.entries.length !== 6 || s.today.date !== '2027-02-03') throw new Error('copied: ' + copied.slice(0, 80));
    const before = await headline();
    await page.click('#calc-reset');
    await page.click('dialog button:has-text("Start over")');
    await page.waitForFunction(() => document.querySelectorAll('#calc-entries li').length === 0);
    await page.click('#calc-paste-box summary');
    await page.fill('#calc-paste', 'not a scenario');
    await page.click('#calc-load');
    await page.waitForSelector('#calc-paste-error:has-text("This is not a scenario copied from this page.")');
    await page.fill('#calc-paste', copied);
    await page.click('#calc-load');
    await page.waitForFunction(() => document.querySelectorAll('#calc-entries li').length === 6);
    if ((await headline()) !== before) throw new Error('not the same picture after pasting');
  });

  await step('a reload keeps the scenario', async () => {
    await page.reload();
    await page.waitForSelector('#calc-entries li');
    await page.waitForFunction(() => document.querySelectorAll('#calc-entries li').length === 6);
    if ((await page.inputValue('#calc-today')) !== '2027-02-03') throw new Error('today was lost');
  });

  await step('removing a date works it out again', async () => {
    await page.click('#calc-remove-5');
    await settled();
    await page.waitForFunction(() => document.querySelectorAll('#calc-entries li').length === 5);
    if ((await page.locator('#calc-alerts .alert:has-text("Three intervals")').count()) !== 0) throw new Error('the pattern alert stayed');
  });

  await step('a place by ZIP code, and Hebrew script', async () => {
    await page.selectOption('#calc-place', '');
    await page.fill('#calc-zip', '11219');
    await page.click('.calc-zip button[type=submit]');
    await page.waitForSelector('#calc-place-used:has-text("Brooklyn")');
    await page.click('#calc-terms-he');
    await settled();
    await page.waitForFunction(() => /[֐-׿]/.test(document.getElementById('calc-entries').textContent));
    await page.click('#calc-terms-en');
    await settled();
  });

  if (out) {
    for (const [width, scheme] of [[1280, 'light'], [1280, 'dark'], [390, 'light'], [390, 'dark']]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/console-calc-${width}-${scheme}.png`, fullPage: true });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  }

  await step('at 360 px: no sideways scrolling, and a day can still be added', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(200);
    const wide = await sideways(page);
    if (wide > 0) throw new Error('scrolls sideways by ' + wide + 'px');
    await page.click('#calc-remove-4');
    await settled();
    await page.waitForFunction(() => document.querySelectorAll('#calc-entries li').length === 4);
  });

  if (errors.length) {
    failures.push('console: errors');
    console.log('FAIL console: errors -', errors.join('; '));
  }
  await context.close();
}

// ---------- the home page ----------

async function home(browser) {
  for (const [width, scheme] of [[1280, 'light'], [1280, 'dark'], [390, 'light'], [360, 'dark']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: out ? 2 : 1 });
    const page = await context.newPage();
    const errors = watch(page);
    const step = (name, fn) => run(`home ${width}px: ${name}`, page, fn);
    await step('a period, then the hefsek taharah and the immersion', async () => {
      await page.goto(base + '/#try');
      await page.waitForSelector('#try-start');
      if (await page.locator('#try-fallback').count()) throw new Error('the fallback sentence stayed');
      const today = await page.getAttribute('#try-start', 'max');
      const start = new Date(Date.parse(today + 'T00:00:00Z') - 8 * 86400000).toISOString().slice(0, 10);
      await page.fill('#try-start', start);
      await page.click('#try-go');
      await page.waitForSelector('.try-headline');
      if ((await page.textContent('.try-headline')) !== 'Niddah, before the hefsek taharah') throw new Error(await page.textContent('.try-headline'));
      if ((await page.locator(`#try-day-${start} .mk.flow`).count()) !== 1) throw new Error('no flow mark');
      await page.click('#try-add');
      await page.waitForFunction(() => /after the hefsek taharah|Seven clean days/.test(document.querySelector('.try-headline').textContent));
      if ((await page.locator('.try-cal .mk.clean').count()) === 0) throw new Error('no clean days on the calendar');
      // the immersion is after today: make that day today, then add it
      await page.click('#try-jump');
      await page.waitForSelector('#try-add:not([disabled])');
      await page.click('#try-add');
      await page.waitForFunction(() => document.querySelector('.try-headline').textContent === 'Tehorah');
      if (!(await page.isVisible('#try-signup'))) throw new Error('no button to sign up');
      const text = await page.textContent('#try');
      for (const word of [/\bserver\b/i, /\bengine\b/i, /\bAPI\b/, /algorithm/i]) if (word.test(text)) throw new Error('technical wording: ' + word);
      if (!text.includes('Nothing you enter here is saved.')) throw new Error('does not say nothing is saved');
      const wide = await sideways(page);
      if (wide > 0) throw new Error('scrolls sideways by ' + wide + 'px');
      if (out) {
        await page.evaluate(() => document.querySelectorAll('.reveal-pending').forEach(e => e.classList.add('revealed')));
        await page.locator('#try').screenshot({ path: `${out}/home-try-${width}-${scheme}.png` });
      }
    });
    await step('a date in the future is refused with the sentence a person gets', async () => {
      const today = await page.inputValue('#try-next-date');
      const later = new Date(Date.parse(today + 'T00:00:00Z') + 40 * 86400000).toISOString().slice(0, 10);
      await page.fill('#try-next-date', later);
      await page.dispatchEvent('#try-next-date', 'change');
      await page.click('#try-add');
      await page.waitForSelector('#try-form-error:has-text("Not recorded: that time has not come yet.")');
    });
    if (errors.length) {
      failures.push(`home ${width}px: errors`);
      console.log(`FAIL home ${width}px: errors -`, errors.join('; '));
    }
    await context.close();
  }

  // the keyboard
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = watch(page);
    await run('home: by keyboard alone', page, async () => {
      await page.goto(base + '/#try');
      await page.waitForSelector('#try-start');
      await page.focus('#try-place');
      await page.keyboard.press('Tab');
      if ((await page.evaluate(() => document.activeElement.id)) !== 'try-start') throw new Error('Tab does not reach the date');
      await page.focus('#try-start-part-day');
      await page.keyboard.press('ArrowRight'); // at night
      if (!(await page.isChecked('#try-start-part-night'))) throw new Error('the arrow keys do not choose night');
      await page.focus('#try-go');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.try-headline');
      const first = await page.evaluate(() => document.querySelector('.try .month .day[tabindex="0"]').id);
      await page.focus('#' + first);
      await page.keyboard.press('ArrowRight');
      const next = await page.evaluate(() => document.activeElement.id);
      if (next === first || !next.startsWith('try-day-')) throw new Error('the arrow keys do not move between days');
      const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      if (outline === 'none') throw new Error('no visible focus on a day');
    });
    if (errors.length) failures.push('home keyboard: errors: ' + errors.join('; '));
    await context.close();
  }

  // the request failing
  {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    const errors = watch(page, /status of 500/);
    await run('home: the calculation failing shows a plain sentence and a link to sign up', page, async () => {
      await page.route('**/api/try', route => (route.request().method() === 'POST' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }) : route.continue()));
      await page.goto(base + '/#try');
      await page.waitForSelector('#try-start');
      await page.click('#try-go');
      await page.waitForSelector('#try-error:has-text("The calendar could not be shown just now.")');
      if ((await page.locator('#try-error a[href="/app/"]').count()) !== 1) throw new Error('no link to sign up');
    });
    await run('home: the choices failing to load leave the sentence and its link', page, async () => {
      await page.unroute('**/api/try');
      await page.route('**/api/try', route => route.abort());
      await page.goto(base + '/?again#try');
      await page.waitForLoadState('networkidle');
      if (!(await page.isVisible('#try-fallback a[href="/app/"]'))) throw new Error('no sentence with a link');
    });
    for (const e of errors) if (!/net::ERR_FAILED|Failed to load resource/.test(e)) failures.push('home failing: ' + e);
    await context.close();
  }

  // without JavaScript
  {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, javaScriptEnabled: false });
    const page = await context.newPage();
    await run('home: without JavaScript, a sentence and a link to sign up', page, async () => {
      await page.goto(base + '/#try');
      if (!(await page.isVisible('#try-fallback a[href="/app/"]'))) throw new Error('no sentence with a link');
      const wide = await sideways(page);
      if (wide > 0) throw new Error('scrolls sideways by ' + wide + 'px');
    });
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  await console_(browser);
  await home(browser);
  await browser.close();
  if (failures.length) {
    console.log('FAILED: ' + failures.length);
    process.exit(1);
  }
  console.log('ok: every step passed');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
