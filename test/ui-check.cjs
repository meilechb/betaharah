// The end-to-end check of the whole site in a real browser, to run before every deploy.
//
//   1. a .dev.vars file with DASHBOARD_PASSWORD=local-test-password and an ENCRYPTION_KEY
//      (printf 'DASHBOARD_PASSWORD=local-test-password\nENCRYPTION_KEY=local-test-key-0123456789abcdef0123456789\n' > .dev.vars)
//   2. npx wrangler dev --port 8821 --persist-to <a new empty directory>     (another terminal; a fresh database each run)
//   3. node test/ui-check.cjs <directory for screenshots> http://127.0.0.1:8821
//
// What it covers, in order:
//   - the public pages: the landing page (loosely: it loads, one h1, the links, no errors, no sideways
//     scrolling; its wording belongs to test/ui/landing.cjs), Help, Privacy and Terms (text-only use as
//     built, the GeoNames credit);
//   - the operator, through the API only (the console page is covered by test/ui/admin.cjs);
//   - a new account by invitation, through the whole guided setup: ZIP codes against the real lookup
//     (unknown, a place where the times cannot be computed, a good one), leaving midway and resuming
//     after a reload, customs, dates with Undo, the calendar link, phones, the last screen;
//   - the dashboard: Today (status, calendar before recording, the marks against the dates recorded and
//     the rules of docs/HALACHA.md), recording with Undo, a slow and a failing request, two tabs, an
//     expired session; Log; Customs with the Hebrew-terms toggle; Settings loosely (test/ui/settings.cjs
//     has the detail); keyboard use, focus, a dialog, reduced motion, 200% zoom;
//   - the test account: banner; Today by day and at night (the box agrees with the headline);
//     "Try a text" walking through MENU, CUSTOMS, REMINDERS, LOCATION with a ZIP, ADD, CALENDAR LINK,
//     WEB (whose link then signs in, and leaves the address), and DELETE ACCOUNT with NO and then YES;
//   - privacy on the page: the address bar, the page title, what is kept in the browser, what is left
//     on screen after signing out;
//   - signing out and back in with the password, downloading the data, deleting the account;
//   - every tab at 360, 390 and 1280 px, light and dark, with screenshots, and in Hebrew terms at 360 px.
// The per-area checks (test/ui/auth.cjs, test/ui/dashboard.cjs) go into more detail and stay.
// Needs Playwright with Chromium. Exits 0 when every step passed.
const { chromium } = require('playwright');
const fs = require('fs');

const out = process.argv[2] || '.';
const base = (process.argv[3] || 'http://127.0.0.1:8821').replace(/\/$/, '');
const ADMIN_PASSWORD = 'local-test-password';
const ACCOUNT_PASSWORD = 'a good long password';
const H = { 'x-betaharah': '1' };
fs.mkdirSync(out, { recursive: true });

// Numbers for this run, so that a second run against the same database does not meet its own accounts.
const BLOCK = 2000 + Math.floor(Math.random() * 7000);
const NUMBER = '+1732444' + String(BLOCK).padStart(4, '0');
const LOCAL = NUMBER.slice(2);
const PRETTY = `(${LOCAL.slice(0, 3)}) ${LOCAL.slice(3, 6)}-${LOCAL.slice(6)}`;
const isoDaysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const problems = [];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  let page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  const watch = p => {
    p.on('pageerror', e => errors.push('pageerror: ' + e.message));
    // Refusals the steps ask for (a wrong password, a repeat, a refused place, an expired session) are logged by
    // the browser as failed requests; anything else on the console, such as a blocked script or style, is an error.
    p.on('console', m => {
      if (m.type() === 'error' && !/status of (40[0-9]|429)|net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
    });
  };
  watch(page);

  const step = async (name, fn) => {
    const before = errors.length;
    try {
      await fn();
      if (errors.length > before) throw new Error(errors.slice(before).join(' | '));
      console.log('ok  ', name);
    } catch (e) {
      console.log('FAIL', name, '-', e.message.split('\n')[0]);
      problems.push(name);
      await page.screenshot({ path: `${out}/FAIL-${problems.length}.png`, fullPage: true }).catch(() => undefined);
      console.log('     the page says:', ((await page.textContent('body').catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 300));
    }
  };
  const noSideways = async (p, label) => {
    const wide = await (p || page).evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) throw new Error((label || 'the page') + ' is ' + wide + 'px wider than the screen');
  };
  const has = async (sel, phrase, p) =>
    (p || page).waitForFunction(([s, x]) => [...document.querySelectorAll(s)].some(el => el.textContent.includes(x)), [sel, phrase], { timeout: 10000 }).catch(() => {
      throw new Error(`no "${phrase}" in ${sel}`);
    });
  const heading = phrase => has('#setup-title, form.login h2, .card.login h2', phrase);
  const api = async (method, path, data, p) => {
    const r = await (p || page).request.fetch(base + path, { method, data, headers: H });
    const body = await r.json().catch(() => null);
    if (!r.ok()) throw new Error(method + ' ' + path + ' ' + r.status() + ' ' + JSON.stringify(body));
    return body;
  };
  const state = async p => (await api('GET', '/api/state', undefined, p)).state;
  const tab = async (name, p) => {
    const q = p || page;
    await q.click(`nav.tabs button:has-text("${name}")`);
    await q.waitForSelector(`nav.tabs button[aria-selected="true"]:has-text("${name}")`);
  };
  /** Opens a Settings section. On a narrow screen an open section hides the list, so go back to the list first. */
  const settingsSection = async id => {
    if (!(await page.isVisible('#st-nav-' + id))) await page.click('#st-back');
    await page.click('#st-nav-' + id);
    await page.waitForSelector('#st-pane-' + id);
  };
  const shot = (label, p) => (p || page).screenshot({ path: `${out}/${label}.png`, fullPage: true });

  // ===================== the public pages =====================

  await step('landing page: loads, one heading, links to the app and the three pages, no sideways scrolling at 360 px', async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    const r = await page.goto(base + '/');
    if (r.status() !== 200) throw new Error('status ' + r.status());
    if ((await page.locator('h1').count()) !== 1) throw new Error('not one h1');
    for (const href of ['/app/', '/help', '/privacy', '/terms']) if ((await page.locator(`a[href="${href}"]`).count()) === 0) throw new Error('no link to ' + href);
    await noSideways();
    await shot('01-landing-360');
    await page.setViewportSize({ width: 390, height: 844 });
  });

  for (const [path, title, phrases] of [
    ['/help', 'Help', ['Recording by text message', 'Using it by text only', 'MENU', 'LOCATION 08701', 'ADD', 'JOIN NRMAAABZ', 'WEB', 'DELETE ACCOUNT', 'does not text a number that has not texted it', 'GeoNames', 'CC BY 4.0', 'It does not give halachic rulings']],
    ['/privacy', 'Privacy', ['What encryption does not do', 'Signing up by text', 'texting ADD', 'No mobile information is shared with third parties or affiliates for marketing or promotional purposes.']],
    ['/terms', 'Terms', ['It does not give halachic rulings', 'Message frequency varies', 'Message and data rates may apply', 'STOP', 'START', 'HELP', 'REMINDERS ON']],
  ]) {
    await step('page ' + path + ': the text-only use as built, at 360 px', async () => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(base + path);
      if ((await page.textContent('h1')).trim() !== title) throw new Error('heading');
      if ((await page.title()) !== title + ' · Betaharah') throw new Error('title ' + (await page.title()));
      const text = await page.textContent('main');
      for (const p of phrases) if (!text.includes(p)) throw new Error('missing: ' + p);
      if (/!/.test(text.replace(/<!--.*?-->/g, ''))) throw new Error('an exclamation mark');
      if ((await page.evaluate(() => getComputedStyle(document.querySelector('main')).maxWidth)) !== '720px') throw new Error('the stylesheet did not load');
      await noSideways();
      await page.setViewportSize({ width: 390, height: 844 });
    });
  }

  // ===================== the operator, by the API =====================

  let inviteLink = '';
  await step('operator: sign in, sign-up by invitation, an invitation for one number', async () => {
    await api('POST', '/api/admin/login', { password: ADMIN_PASSWORD });
    const st = await api('GET', '/api/admin/state');
    await api('PUT', '/api/admin/config', { ...st.config, signup: 'invite' });
    inviteLink = (await api('POST', '/api/admin/invites', { kind: 'setup', number: NUMBER })).link;
    if (!/\/app\/\?invite=[A-Za-z0-9_-]{32}$/.test(inviteLink)) throw new Error('link: ' + inviteLink);
  });

  // ===================== a new account, by invitation, through the guided setup =====================

  await step('sign-in page: the note that sign-up is by invitation; a made-up invitation is explained', async () => {
    await page.goto(base + '/app/');
    await has('form.login', 'New accounts are by invitation');
    await page.goto(base + '/app/?invite=' + 'x'.repeat(32));
    await has('.alert.bad', 'not valid any more');
    await noSideways();
  });

  await step('invitation: two different passwords are explained at the field; then the account opens into the setup', async () => {
    await page.goto(inviteLink.replace(/^https?:\/\/[^/]+/, base));
    await heading('Set up your account');
    await page.fill('#number', LOCAL);
    await page.fill('#pw1', ACCOUNT_PASSWORD);
    await page.fill('#pw2', 'something else entirely');
    await page.click('button[type=submit]');
    await has('.field .error', 'not the same');
    await page.fill('#pw2', ACCOUNT_PASSWORD);
    await page.click('button[type=submit]');
    await heading('Welcome to Betaharah');
    if (page.url().includes('invite=')) throw new Error('the invitation is still in the address');
    await shot('10-setup-welcome');
  });

  await step('setup: ZIP codes against the real lookup, and a place where the times cannot be computed', async () => {
    await page.click('#setup-start');
    await heading('Where do you live?');
    await page.fill('#setup-zip', '123');
    await page.click('#setup-zip-go');
    await has('.field .error', 'Enter a 5-digit US ZIP code');
    await page.fill('#setup-zip', '00001');
    await page.click('#setup-zip-go');
    await has('.field .error', 'No place was found for that code.');
    await page.fill('#setup-zip', '99501');
    await page.click('#setup-zip-go');
    await has('#setup-chosen', 'Anchorage, AK 99501');
    await page.click('#setup-save-place');
    await has('.setup-error', 'the times cannot be calculated');
    await has('.setup-error', 'The location was not saved.');
    if ((await state()).app.place !== null) throw new Error('Anchorage was saved');
    await shot('11-setup-place-refused');
    await page.fill('#setup-zip', '08701');
    await page.click('#setup-zip-go');
    await has('#setup-chosen', 'Lakewood, NJ 08701');
    await page.click('#setup-save-place');
    await heading('Location saved');
    await has('.setup .alert.ok', 'sunset there: ');
    if ((await state()).app.place.name !== 'Lakewood, NJ 08701') throw new Error('not saved');
  });

  await step('setup: leaving midway and coming back resumes where it stopped; the browser keeps only step names', async () => {
    await page.click('#setup-main');
    await heading('Your customs');
    await page.reload();
    await heading('Your customs');
    const kept = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
    const keys = Object.keys(kept);
    if (keys.some(k => k !== 'betaharah.setup')) throw new Error('unexpected storage: ' + keys.join(', '));
    if (kept['betaharah.setup'] && /\d{5,}/.test(kept['betaharah.setup'])) throw new Error('a phone number in storage: ' + kept['betaharah.setup']);
    await page.goto(base + '/help');
    await page.goBack();
    await heading('Your customs');
  });

  await step('setup: the terms switch, then the customs, all four parts, confirmed on saving', async () => {
    await page.click('#setup-terms-he');
    for (let i = 0; i < 20 && (await state()).app.terms !== 'he'; i += 1) await page.waitForTimeout(200);
    if ((await state()).app.terms !== 'he') throw new Error('the terms did not change');
    if ((await page.evaluate(() => getComputedStyle(document.body).direction)) !== 'ltr') throw new Error('the page turned right-to-left');
    await page.click('#setup-terms-en');
    for (let i = 0; i < 20 && (await state()).app.terms !== 'en'; i += 1) await page.waitForTimeout(200);
    if ((await state()).app.terms !== 'en') throw new Error('the terms did not change back');
    await page.click('#setup-main');
    for (let part = 1; part <= 4; part += 1) {
      await has('.setup-count', 'Customs, part ' + part + ' of 4');
      if (part < 4) await page.click('#setup-customs-next');
    }
    await page.click('#setup-confirm-customs');
    await heading('Last period');
    if (!(await state()).halachic.confirmedAt) throw new Error('not confirmed');
  });

  const FLOW = isoDaysAgo(20);
  const HEFSEK = addDays(FLOW, 5); // day 6: after the five days of waiting
  const MIKVAH = addDays(HEFSEK, 7); // the evening of the seventh clean day
  await step('setup: the dates, each confirmed by the server, with Undo by its id', async () => {
    await page.fill('#sd-date', FLOW);
    await page.check('#r-sd-part-day');
    await page.click('#sd-record');
    await heading('Hefsek taharah done?');
    await has('#sd-recorded', 'Recorded');
    await page.fill('#sd-date', HEFSEK);
    await page.click('#sd-record');
    // the immersion is not asked for
    await heading('Your recent dates');
    await page.click('#sd-undo');
    await heading('Hefsek taharah done?');
    await has('#sd-note', 'Removed.');
    if ((await state()).entryCount !== 1) throw new Error('Undo did not remove the hefsek');
    await page.fill('#sd-date', HEFSEK);
    await page.click('#sd-record');
    await heading('Your recent dates');
    if (/immersion/i.test(await page.textContent('.setup-card'))) throw new Error('the setup mentions the immersion');
    if ((await state()).entryCount !== 2) throw new Error('entries');
    await page.click('#setup-main');
  });

  await step('setup: a calendar subscription link; phones while texting is off; the last screen', async () => {
    await heading('Calendar app');
    await page.click('#sc-link');
    await has('code.copy', '/cal/');
    await page.click('#setup-main');
    await heading('Text reminders');
    await has('.setup-card', 'not available yet');
    await page.click('#setup-main');
    await heading('Spouse’s phone');
    await page.click('#setup-main');
    await heading('Setup done');
    await noSideways();
    await shot('12-setup-done');
    await page.click('#setup-finish');
    await page.waitForSelector('nav.tabs');
    const st = await state();
    if (!st.account.welcomed) throw new Error('not marked welcomed');
    if (await page.evaluate(() => localStorage.getItem('betaharah.setup'))) throw new Error('the setup’s storage was not cleared');
  });

  // ===================== the dashboard =====================

  await step('today: status with the next step, then the calendar, then coming up, in the page’s order', async () => {
    const st = await state();
    if (st.status.phase !== 'tehorah') throw new Error('phase ' + st.status.phase);
    if ((await page.textContent('#status-headline')).trim() !== 'Tehorah') throw new Error('headline');
    const order = await page.evaluate(() => ['.status-card', '.calendar-card', '.upcoming-card'].map(s => document.querySelector(s)).map(el => (el ? el.getBoundingClientRect().top + scrollY : -1)));
    if (order.some(x => x < 0) || !(order[0] < order[1] && order[1] < order[2])) throw new Error('order on a phone: ' + order.join(', '));
    // A tehorah woman sees the next onat perishah next to the status.
    await page.waitForSelector('.status-card .next-line');
    // One thing to do next, in the status card; no floating button and no form until asked for.
    if ((await page.textContent('.status-card #next-step')).trim() !== 'A period began') throw new Error('next step: ' + (await page.textContent('#next-step')));
    await page.waitForSelector('.status-card #next-earlier:has-text("It began earlier")');
    if (await page.locator('#record-jump, #record-panel, #rec-suggested').count()) throw new Error('a floating button or an open form');
    await noSideways();
    await shot('20-today-390');
  });

  await step('today: the calendar marks agree with the dates recorded and with docs/HALACHA.md', async () => {
    const st = await state();
    const on = (date, kind) => st.grid.events.filter(e => e.kind === kind && e.startDate === date);
    if (!on(FLOW, 'flow').length) throw new Error('no flow on ' + FLOW);
    if (!on(HEFSEK, 'hefsek').length) throw new Error('no hefsek on ' + HEFSEK);
    for (let n = 1; n <= 7; n += 1) {
      const e = on(addDays(HEFSEK, n), 'clean_day')[0];
      if (!e || !new RegExp('day ' + n + '\\b').test(e.title)) throw new Error('clean day ' + n + ' is not on ' + addDays(HEFSEK, n));
    }
    if (!on(MIKVAH, 'mikvah').length) throw new Error('no immersion on the evening of ' + MIKVAH);
    // Onah beinonit, defaults days 30 and 31 for the whole date: the flow was by day, so day 30 is FLOW + 29.
    const d30 = addDays(FLOW, 29);
    const d31 = addDays(FLOW, 30);
    const onot = st.upcoming.filter(u => u.kind === 'onah');
    for (const [date, label] of [[d30, 'day 30'], [d31, 'day 31']]) {
      if (!onot.some(u => u.date === date && /\(day\)/.test(u.title))) throw new Error('no day onah on ' + date + ' (' + label + ')');
      if (!onot.some(u => u.endDate === date && /\(night\)/.test(u.title))) throw new Error('no night onah ending on ' + date + ' (' + label + ', the whole date)');
    }
    // Veset hachodesh: the same Hebrew date next month, in the same onah (day).
    const days = st.grid.days;
    const flowDay = days.find(d => d.date === FLOW);
    const next = days.find(d => d.date > FLOW && d.hebrewDay === flowDay.hebrewDay && d.hebrewMonth !== flowDay.hebrewMonth);
    if (flowDay.hebrewDay !== '30' && next && !onot.some(u => u.date === next.date && /\(day\)/.test(u.title))) throw new Error('no veset hachodesh by day on ' + next.date);
    // The page labels today.
    const label = await page.getAttribute(`#day-${st.grid.today}`, 'aria-label');
    if (!label.includes('Today')) throw new Error('today is not labelled');
  });

  await step('today: the day detail has its date, Hebrew date, sunrise and sunset on one line; a mikvah night is "after" nightfall', async () => {
    if (await page.locator('.day-detail .date-change').count()) throw new Error('the sentence about when the Hebrew date ends is still there');
    await has('.day-detail .detail-head .sun-times', 'Sunrise');
    if ((await page.locator('.day-detail .detail-head .sun-times .hebrew-date').count()) !== 1) throw new Error('no Hebrew date in the line');
    await has('#day-panel h4', 'What happened?');
    const st = await state();
    const m = st.upcoming.find(u => u.kind === 'mikvah');
    if (m && !/after \d/.test(m.when)) throw new Error('mikvah when: ' + m.when);
  });

  await step('recording: a slow request shows the button busy; a failed one says what happened; nothing is recorded', async () => {
    await page.route('**/api/entries', async route => {
      await new Promise(r => setTimeout(r, 1500));
      await route.abort('failed');
    });
    await page.click('#next-step');
    await page.waitForSelector('#next-step[aria-busy="true"]', { timeout: 1200 });
    await has('.status-card .rec-error', 'could not be reached');
    await page.unroute('**/api/entries');
    if ((await state()).entryCount !== 2) throw new Error('something was recorded');
    await shot('21-record-failed');
  });

  await step('recording: then it works, with the server’s sentence, and Undo removes exactly that entry', async () => {
    await page.click('#next-step');
    await has('.status-card .rec-done', 'Recorded: flow');
    const st = await state();
    if (st.entryCount !== 3 || st.status.phase !== 'before_hefsek') throw new Error('not recorded: ' + st.status.phase);
    // During a niddah period the next onat perishah is not next to the task of the day.
    if ((await page.locator('.status-card .next-line').count()) !== 0) throw new Error('next onat perishah shown during niddah');
    await page.click('#rec-undo');
    await has('.rec-done', 'Removed');
    const after = await state();
    if (after.entryCount !== 2 || after.status.phase !== 'tehorah') throw new Error('Undo: ' + after.entryCount);
  });

  await step('two tabs: the second, still showing the old state, is told that the entry exists already', async () => {
    const second = await context.newPage();
    watch(second);
    await second.goto(base + '/app/#today');
    await second.waitForSelector('#next-step');
    await page.click('#next-step');
    await has('.rec-done', 'Recorded: flow');
    await second.click('#next-step');
    await has('.status-card .rec-error', 'Already recorded', second);
    await second.close();
    await page.click('#rec-undo');
    await has('.rec-done', 'Removed');
  });

  await step('an expired session in the middle of a form: back to sign-in with a note, then in again with the password', async () => {
    await page.click('#next-else');
    await page.click('#rec-kind-stain');
    await page.route('**/api/entries', route => route.fulfill({ status: 401, json: { error: 'Please sign in.' } }));
    await page.click('#rec-submit');
    await has('.alert', 'Please sign in again.');
    await page.unroute('**/api/entries');
    if ((await page.locator('#status-headline').count()) !== 0) throw new Error('the account is still on screen');
    await page.click('text=Use a password').catch(() => undefined);
    await page.fill('#number', LOCAL);
    await page.fill('#pw', ACCOUNT_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForSelector('nav.tabs');
  });

  await step('keyboard: the tabs move with the arrow keys, and the focus can be seen', async () => {
    await page.focus('#tab-today');
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('nav.tabs button[aria-selected="true"]:has-text("Log")');
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      const s = getComputedStyle(el);
      return { id: el.id, outline: s.outlineStyle, width: s.outlineWidth, shadow: s.boxShadow };
    });
    if (focus.id !== 'tab-log') throw new Error('focus on ' + focus.id);
    if ((focus.outline === 'none' || focus.width === '0px') && focus.shadow === 'none') throw new Error('no visible focus');
    // The browser's Back button returns to the tab before, and Forward to this one.
    await page.goBack();
    await page.waitForSelector('nav.tabs button[aria-selected="true"]:has-text("Today")');
    await page.goForward();
    await page.waitForSelector('nav.tabs button[aria-selected="true"]:has-text("Log")');
  });

  await step('log: the entries, newest period first; removing asks in a dialog that keeps the focus; Escape keeps the entry', async () => {
    await page.waitForSelector('li.entry');
    if ((await page.locator('li.entry').count()) !== 2) throw new Error('entries ' + (await page.locator('li.entry').count()));
    const first = page.locator('li.entry').first();
    await first.locator('button[aria-label^="Options for"]').click();
    await first.locator('button:has-text("Remove")').click();
    await page.waitForSelector('dialog[open]');
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
    if (!(await page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest('dialog[open]'))))) throw new Error('the focus left the dialog');
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]', { state: 'detached' });
    if ((await page.locator('li.entry').count()) !== 2) throw new Error('an entry went');
    await shot('22-log-390');
  });

  await step('customs: the Hebrew-terms toggle changes the terms everywhere and keeps the page left-to-right', async () => {
    await tab('Customs');
    await page.click('#terms-he');
    await page.waitForSelector('#terms-he[aria-pressed="true"]');
    await has('.panel', 'אור זרוע');
    await tab('Today');
    const head = (await page.textContent('#status-headline')).trim();
    if (head !== 'טהורה') throw new Error('headline ' + head);
    if ((await page.evaluate(() => getComputedStyle(document.body).direction)) !== 'ltr') throw new Error('rtl');
    if (/\{[a-z_]+\}/.test(await page.textContent('#root'))) throw new Error('an unfilled term');
    await page.setViewportSize({ width: 360, height: 800 });
    for (const name of ['Today', 'Log', 'Customs', 'Settings']) {
      await tab(name);
      await noSideways(null, name + ' in Hebrew terms');
      await shot('23-' + name.toLowerCase() + '-360-hebrew');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await tab('Customs');
    await page.click('#terms-en');
    await page.waitForSelector('#terms-en[aria-pressed="true"]');
  });

  await step('settings (loosely): the tab opens and shows the signed-in number; the header has Sign out', async () => {
    await tab('Settings');
    await has('.panel', PRETTY);
    await has('header.dash-top #top-sign-out', 'Sign out');
    await noSideways();
  });

  await step('download my data', async () => {
    await settingsSection('data');
    await page.waitForSelector('a:has-text("Download my data")');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Download my data")')]);
    const file = await download.path();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.entries) || data.entries.length !== 2) throw new Error('entries in the file');
  });

  await step('sign out: nothing of the account is left on screen, in the title or in the browser; then in again', async () => {
    await settingsSection('security');
    await page.click('#sign-out');
    await page.waitForSelector('form.login');
    const text = await page.textContent('body');
    for (const s of [PRETTY, LOCAL, 'Tehorah', 'Kislev', 'Lakewood']) if (text.includes(s)) throw new Error('left on screen: ' + s);
    if (/\d{7}|\?.*(k|invite)=/.test(page.url())) throw new Error('address: ' + page.url());
    if ((await page.title()) !== 'Betaharah') throw new Error('title ' + (await page.title()));
    const kept = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)));
    if (kept.length) throw new Error('kept in the browser: ' + kept.join(', '));
    await page.click('text=Use a password').catch(() => undefined);
    await page.fill('#number', LOCAL);
    await page.fill('#pw', 'the wrong password');
    await page.click('button[type=submit]');
    await has('.field .error', 'Wrong number or password.');
    await page.fill('#pw', ACCOUNT_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForSelector('nav.tabs');
  });

  // ----- the same account, walked through a period with the day buttons and the next-step button -----
  // Time cannot be stepped, so each phase is reached with dates in the past.

  const WALK_FLOW = isoDaysAgo(16);
  const longDate = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
  /** Chooses a day on the calendar, moving back a month when it is not shown. */
  const pickDay = async date => {
    await tab('Today');
    for (let k = 0; k < 4 && !(await page.locator('#day-' + date).count()); k += 1) await page.click('#cal-prev');
    await page.click('#day-' + date);
    await page.waitForSelector(`#day-${date}[aria-pressed="true"]`);
  };
  /** Records with a button of the chosen day and waits for the server's sentence. */
  const dayButton = async (date, id) => {
    await pickDay(date);
    await page.click('#' + id);
    await has('#day-panel .rec-done', 'Recorded');
    return state();
  };
  const removeAll = async () => {
    for (const e of (await state()).entries) await api('DELETE', '/api/entries/' + encodeURIComponent(e.id));
    await page.goto('about:blank');
    await page.goto(base + '/app/#today');
    await page.waitForSelector('#status-headline');
  };
  const noProjected = async () => {
    const text = await page.textContent('#root');
    if (/\(projected\)/.test(text)) throw new Error('"(projected)" on the page');
    const labels = await page.$$eval('[aria-label]', els => els.map(e => e.getAttribute('aria-label')).filter(l => l.includes('(projected)')));
    if (labels.length) throw new Error('"(projected)" in a label: ' + labels[0]);
  };
  const walkShot = async name => {
    await noSideways();
    await shot(name);
  };

  await step('walk: tehorah, "It began earlier" opens the form preset to a flow on another date', async () => {
    await removeAll();
    if ((await state()).status.phase !== 'tehorah') throw new Error('not tehorah');
    await page.click('#next-earlier');
    await page.waitForSelector('#record-panel #rec-kind-flow[aria-pressed="true"]');
    if (!(await page.isChecked('#r-rec-mode-other'))) throw new Error('not on another time');
    if ((await page.inputValue('#rec-date')) !== (await state()).grid.today) throw new Error('the date is not today');
    if ((await page.evaluate(() => document.activeElement.id)) !== 'rec-date') throw new Error('the focus is not on the date');
    await page.click('#rec-close');
    await page.waitForSelector('#record-panel', { state: 'detached' });
    await walkShot('50-walk-tehorah');
  });

  let walkHefsek = '';
  await step('walk: a period with the day button; the hefsek day is "H?" and "not recorded", the rest "expected"', async () => {
    const st = await dayButton(WALK_FLOW, 'dp-add-flow-day');
    if (st.status.phase !== 'before_hefsek') throw new Error('phase ' + st.status.phase);
    const hefsek = st.grid.events.find(e => e.kind === 'hefsek' && e.projected);
    walkHefsek = hefsek.startDate;
    await pickDay(walkHefsek);
    if ((await page.textContent(`#day-${walkHefsek} .mk.hefsek.projected`)) !== 'H?') throw new Error('the hefsek day is not H?');
    if (!(await page.getAttribute('#day-' + walkHefsek, 'aria-label')).includes('not recorded')) throw new Error('the day does not say "not recorded"');
    await page.waitForSelector('#day-events .ev.hefsek .tag:text-is("not recorded")');
    await page.waitForSelector('#up-steps .up-hefsek .tag:text-is("not recorded")');
    await page.waitForSelector('#up-steps .up-clean_day .tag:text-is("expected")');
    await page.waitForSelector('#up-steps .up-mikvah .tag:text-is("expected")');
    await has('#up-assume', 'If the hefsek taharah is done on the first day it can be.');
    await noProjected();
    // The next step: the hefsek taharah, only while it can be done today.
    const canToday = st.today.part === 'day' && walkHefsek <= st.today.civilDate;
    if (canToday && (await page.textContent('#next-step')).trim() !== 'Hefsek taharah done') throw new Error('next step: ' + (await page.textContent('#next-step')));
    if (!canToday && (await page.locator('#next-step').count())) throw new Error('a next-step button while the hefsek cannot be done today');
    await walkShot('51-walk-before-hefsek');
  });

  await step('walk: the hefsek taharah with the day button: the count, with no button to press', async () => {
    const st = await dayButton(isoDaysAgo(3), 'dp-add-hefsek');
    if (st.status.phase !== 'counting') throw new Error('phase ' + st.status.phase);
    if ((await page.textContent(`#day-${isoDaysAgo(3)} .mk.hefsek.done`)) !== 'H✓') throw new Error('the recorded hefsek is not H✓');
    await page.waitForSelector('#day-events .ev.hefsek .tag:text-is("recorded")');
    if (await page.locator('#next-step').count()) throw new Error('a next-step button in the count');
    await noProjected();
    await walkShot('52-walk-counting');
    await page.click('#rec-undo');
    await has('#day-panel .rec-done', 'Removed');
  });

  await step('walk: a hefsek taharah a week ago: the seventh clean day by day, then the mikvah night with its time and no button', async () => {
    try {
      const st = await dayButton(isoDaysAgo(7), 'dp-add-hefsek');
      if (st.status.phase === 'counting') {
        // By day the seventh clean day is still counted; there is nothing to press until the night.
        if (st.status.day !== 7) throw new Error('day ' + st.status.day);
        if (await page.locator('#next-step').count()) throw new Error('a next-step button on the seventh clean day');
        return;
      }
      if (st.status.phase !== 'mikvah_tonight') throw new Error('phase ' + st.status.phase);
      await has('#status-headline', 'Mikvah night');
      await has('#status-detail', 'Immersion after ');
      if (await page.locator('#next-step').count()) throw new Error('a button on the mikvah night');
    } finally {
      for (const e of (await state()).entries.filter(x => x.kind !== 'flow')) await api('DELETE', '/api/entries/' + encodeURIComponent(e.id));
    }
  });

  const WALK_HEFSEK = addDays(WALK_FLOW, 5);
  const WALK_MIKVAH = addDays(WALK_HEFSEK, 7);
  await step('walk: the mikvah night passed with no immersion recorded: tehorah, and nothing asks about it', async () => {
    const st = await dayButton(WALK_HEFSEK, 'dp-add-hefsek');
    if (st.status.phase !== 'tehorah') throw new Error('phase ' + st.status.phase);
    if ((await page.textContent('#next-step')).trim() !== 'A period began') throw new Error('next step: ' + (await page.textContent('#next-step')));
    await pickDay(WALK_MIKVAH);
    if ((await page.textContent(`#day-${WALK_MIKVAH} .mk.mikvah.plan`)) !== 'M') throw new Error('the mikvah night is not an outlined M');
    if (await page.locator('#day-events .ev.mikvah .tag').count()) throw new Error('a label on the past mikvah night');
    const words = await page.textContent('#root');
    if (/immersed|not recorded: |no immersion/i.test(words)) throw new Error('something asks about the immersion');
    await walkShot('53-walk-after-mikvah-night');
  });

  await step('walk: a new period after the count: no note, and the earlier mikvah night is an ordinary one', async () => {
    const st = await dayButton(isoDaysAgo(1), 'dp-add-flow-day');
    if (st.status.phase !== 'before_hefsek') throw new Error('phase ' + st.status.phase);
    if (st.alerts.length) throw new Error('an alert: ' + JSON.stringify(st.alerts));
    const night = st.grid.events.find(e => e.kind === 'mikvah' && e.startDate === WALK_MIKVAH);
    if (!night || !/^Mikvah night \(after /.test(night.title)) throw new Error('the earlier night: ' + JSON.stringify(night));
    if (await page.locator('#record-missing-immersion').count()) throw new Error('a button to record the immersion');
    await removeAll();
  });

  let feed = '';
  await step('delete the account: typed confirmation, then gone, and its calendar link answers no more', async () => {
    feed = (await state()).calendar.link;
    await tab('Settings');
    await settingsSection('data');
    await page.click('button:has-text("Delete my account")');
    await page.waitForSelector('dialog[open]');
    await page.fill('dialog[open] input', 'delete');
    await page.click('dialog[open] button[type=submit]');
    await has('dialog .error', 'Nothing has been deleted');
    await page.fill('dialog[open] input', 'DELETE');
    await page.click('dialog[open] button[type=submit]');
    await page.waitForURL(base + '/');
    const r = await page.request.get(feed.replace(/^https?:\/\/[^/]+/, base));
    if (r.status() !== 404) throw new Error('the calendar link answers ' + r.status());
    await page.goto(base + '/app/');
    await page.waitForSelector('form.login');
  });

  // ===================== the test account =====================

  const placeAt = localHour => {
    // A place at 30° N whose local time now is about `localHour`, with a fixed-offset time zone.
    const now = new Date();
    let lon = (localHour - (now.getUTCHours() + now.getUTCMinutes() / 60)) * 15;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    const offset = Math.max(-12, Math.min(12, Math.round(lon / 15)));
    lon = offset * 15 + (lon - offset * 15) / 4; // keep the clock and the sun close
    return { name: 'Test place', latitude: 30, longitude: Math.round(lon * 100) / 100, timeZone: offset === 0 ? 'Etc/GMT' : 'Etc/GMT' + (offset > 0 ? '-' : '+') + Math.abs(offset), elevation: 0 };
  };
  const openDemo = async () => {
    await api('POST', '/api/admin/login', { password: ADMIN_PASSWORD });
    await api('POST', '/api/admin/demo');
    // A new load of the page (going to the same address with another #tab would only change the tab).
    await page.goto('about:blank');
  };
  const atPlace = async place => {
    const st = await state();
    await api('PUT', '/api/app', { ...st.app, place });
    await page.goto('about:blank');
    await page.goto(base + '/app/#today');
    await page.waitForSelector('#status-headline');
    return state();
  };

  await step('test account: the banner, and Today by day: the box is today’s and agrees with the headline', async () => {
    await openDemo();
    await page.goto(base + '/app/#today');
    await has('.demo-banner', 'This is the test account. Nothing here is sent to a real phone.');
    const st = await atPlace(placeAt(12.5));
    if (st.today.part !== 'day') throw new Error('expected day, the place is ' + JSON.stringify(st.today));
    await has('.today-box h3', 'Today, ');
    if (st.status.phase === 'counting') {
      if (!(await page.textContent('#status-headline')).includes('day ' + st.status.day)) throw new Error('headline');
      await has('.today-box .ti-title', 'day ' + st.status.day);
    }
    await shot('30-demo-day');
  });

  for (const [hour, label] of [
    [21.5, 'in the evening'],
    [2.5, 'after midnight'],
  ]) {
    await step('test account: Today at night, ' + label + ': the box describes the night that has begun, as the headline does', async () => {
      const st = await atPlace(placeAt(hour));
      if (st.today.part !== 'night') throw new Error('expected night: ' + JSON.stringify(st.today));
      await has('.today-box.night h3', 'Tonight, ');
      if (await page.locator('.today-box .night-note').count()) throw new Error('the sentence about the Hebrew date is still there');
      await has('.date-line .hebrew', 'The night of');
      if (st.status.phase === 'counting') {
        const n = st.status.day;
        if (!(await page.textContent('#status-headline')).includes('day ' + n)) throw new Error('headline');
        const titles = await page.$$eval('.today-box .ti-title', els => els.map(e => e.textContent));
        if (titles.some(x => /clean days: day/.test(x) && !x.includes('day ' + n))) throw new Error('the box shows another day: ' + titles.join(' | '));
      }
      await shot('31-demo-night-' + label.replace(/ /g, '-'));
    });
  }

  await step('test account: back to Lakewood', async () => {
    const st = await state();
    const lakewood = st.places.find(p => p.name === 'Lakewood, NJ');
    await atPlace(lakewood);
  });

  /** Sends a text from the box; returns the replies the server gave, after the page has shown them. */
  let replies = [];
  const sendText = async (text, click) => {
    if (!click) await page.fill('#demo-text', text);
    const [res] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/demo/text')), click ? click() : page.click('#demo-send')]);
    replies = ((await res.json()) || {}).replies || [];
    if (replies.length) await has('#demo-thread .msg.out .bubble', replies[replies.length - 1].text.split(/https?:/)[0].slice(0, 30));
    return replies;
  };
  const lastReply = async () => (replies.length ? replies[replies.length - 1].text : '');

  await step('Try a text: MENU, then a button under its reply', async () => {
    await sendText('MENU');
    if (!(await lastReply()).startsWith('Words: STATUS')) throw new Error('MENU reply: ' + (await lastReply()));
    await page.waitForSelector('.reply-extras .chip');
    await sendText(null, () => page.click('.reply-extras .chip >> nth=0'));
    if (!replies.length) throw new Error('no reply to the button');
    await shot('32-try-a-text');
  });

  await step('Try a text: CUSTOMS, REMINDERS, and LOCATION with a ZIP code', async () => {
    await sendText('CUSTOMS');
    if (!/Customs/i.test(await lastReply())) throw new Error('CUSTOMS: ' + (await lastReply()));
    await sendText('REMINDERS');
    if (!/remind/i.test(await lastReply())) throw new Error('REMINDERS: ' + (await lastReply()));
    await sendText('LOCATION 11219');
    if (!/Brooklyn|11219/.test(await lastReply())) throw new Error('LOCATION: ' + (await lastReply()));
    if (!(await state()).app.place.name.includes('11219')) throw new Error('the location was not saved');
  });

  await step('Try a text: ADD and CALENDAR LINK', async () => {
    await sendText('ADD');
    if (!/JOIN [A-Z]{8}/.test(await lastReply())) throw new Error('ADD: ' + (await lastReply()));
    await sendText('CALENDAR LINK');
    await has('.demo-link', '/cal/');
  });

  let signInLink = '';
  await step('Try a text: WEB gives a sign-in link; after signing out it signs in once and leaves the address', async () => {
    await sendText('WEB');
    signInLink = (await page.textContent('.demo-link code')).trim();
    if (!/\/app\/\?k=[A-Za-z0-9_-]{24,64}$/.test(signInLink)) throw new Error('link: ' + signInLink);
    await api('POST', '/api/auth/logout', {});
    await page.goto(signInLink.replace(/^https?:\/\/[^/]+/, base));
    await page.waitForSelector('nav.tabs');
    if (page.url().includes('k=')) throw new Error('the token is still in the address');
    await api('POST', '/api/auth/logout', {});
    await page.goto(signInLink.replace(/^https?:\/\/[^/]+/, base));
    await has('.alert.bad', 'This sign-in link expired or was used');
    if (page.url().includes('k=')) throw new Error('the token is still in the address');
    await openDemo();
    await page.goto(base + '/app/#today');
    await page.waitForSelector('#demo-text');
  });

  await step('Try a text: DELETE ACCOUNT asks first; NO keeps it; YES deletes it and signs out with a note', async () => {
    await sendText('DELETE ACCOUNT');
    if (!/Reply YES to delete/.test(await lastReply())) throw new Error('DELETE ACCOUNT: ' + (await lastReply()));
    await sendText('NO');
    await state();
    await sendText('DELETE ACCOUNT');
    await page.fill('#demo-text', 'YES');
    await page.click('#demo-send');
    await page.waitForSelector('form.login');
    await has('.alert', 'The account was deleted');
    if (page.url().includes('note=')) throw new Error('the note is still in the address');
  });

  // ===================== every tab, at three widths, light and dark; reduced motion; 200% zoom =====================

  await step('every tab at 360, 390 and 1280 px, light and dark, with no sideways scrolling', async () => {
    await openDemo();
    for (const width of [360, 390, 1280]) {
      for (const scheme of ['light', 'dark']) {
        const c = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
        await c.addCookies(await context.cookies());
        const p = await c.newPage();
        watch(p);
        for (const name of ['today', 'log', 'customs', 'settings']) {
          await p.goto(base + '/app/#' + name);
          await p.waitForSelector('nav.tabs');
          await p.waitForTimeout(150);
          await noSideways(p, name + ' at ' + width + ' px ' + scheme);
          await shot(`40-${name}-${width}-${scheme}`, p);
        }
        await c.close();
      }
    }
  });

  await step('reduced motion turns the transitions off; 200% zoom (320 px wide) needs no sideways scrolling', async () => {
    const c = await browser.newContext({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    await c.addCookies(await context.cookies());
    const p = await c.newPage();
    watch(p);
    await p.goto(base + '/app/#today');
    await p.waitForSelector('#status-headline');
    const dur = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dur').trim());
    if (!/^0(ms|s)?$/.test(dur)) throw new Error('--dur is ' + dur);
    for (const name of ['today', 'log', 'customs', 'settings']) {
      await p.goto(base + '/app/#' + name);
      await p.waitForSelector('nav.tabs');
      await noSideways(p, name + ' at 200%');
    }
    await shot('41-today-200-percent', p);
    await c.close();
  });

  await browser.close();
  if (problems.length) {
    console.log('\n' + problems.length + ' problem(s):\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('\nall steps passed');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
