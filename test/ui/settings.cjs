// The Settings tab in a real browser: the settings home, every section and
// sub-view, on the operator's test account and on an ordinary new account.
//
//   1. a .dev.vars file as described in test/ui-check.cjs (DASHBOARD_PASSWORD=local-test-password)
//   2. npx wrangler dev --port 8832 --persist-to <a new empty directory>
//   3. node test/ui/settings.cjs <directory for screenshots> http://127.0.0.1:8832
//
// Covers: the home list with a summary per section and the flags that need
// attention; opening each section and sub-view (the address follows, reload
// and Back land where expected, the heading gets the focus); saving each kind
// of change and the summaries updating; refusals shown beside the control (a
// ZIP code, coordinates, a place whose times cannot be computed, numbers out
// of range, passwords); phones (options, consent, the two-step adding with
// the shown code, removing); reminders and their scheduled list; calendar;
// language; texting; sign-in; your data; nothing typed lost, scroll and focus
// kept on a redraw; the disabled states of an account without texting; no
// sideways scrolling at 360 px; the wide layout; no console or CSP errors.
// Exits 0 when every step passed.
const { chromium } = require('playwright');
const out = process.argv[2] || '.';
const base = process.argv[3] || 'http://127.0.0.1:8832';
const ADMIN_PASSWORD = 'local-test-password';
const ACCOUNT_PASSWORD = 'a good long password';
const H = { 'x-betaharah': '1' };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let page;
  const watch = p => {
    p.setDefaultTimeout(10000);
    p.on('pageerror', e => errors.push('pageerror: ' + e.message));
    p.on('console', m => {
      if (m.type() === 'error' && !/status of (40[0-9]|429|50[23])/.test(m.text())) errors.push('console: ' + m.text());
    });
  };
  const step = async (name, fn) => {
    try {
      await fn();
      console.log('ok  ', name);
    } catch (e) {
      console.log('FAIL', name, '-', e.message.split('\n')[0]);
      errors.push(name);
      await page.screenshot({ path: out + '/settings-fail-' + errors.length + '.png', fullPage: true }).catch(() => undefined);
    }
  };
  const noSideways = async label => {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) throw new Error((label || 'the page') + ' is ' + wide + 'px wider than the screen');
  };
  const state = async () => (await (await page.request.get(base + '/api/state', { headers: H })).json()).state;
  const savedIn = key => page.waitForSelector(`#status-${key}.saved`, { timeout: 8000 });
  const hash = () => page.evaluate(() => location.hash);
  const expectHash = async h => {
    for (let i = 0; i < 40 && (await hash()) !== h; i += 1) await page.waitForTimeout(50);
    if ((await hash()) !== h) throw new Error('address is ' + (await hash()) + ', expected ' + h);
  };
  const title = () => page.textContent('#st-title');
  const expectTitle = async text => {
    await page.waitForSelector(`#st-title:has-text("${text}")`);
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'st-title');
  };
  const summary = async id => (await page.textContent(`#st-nav-${id} .st-summary`)).trim();
  /** Opens a section from the home list (on a phone: back to the home first). */
  const openSection = async (id, heading) => {
    if ((await hash()) !== '#settings') {
      await page.evaluate(() => (location.hash = '#settings'));
      await page.waitForSelector('#st-home-title');
    }
    await page.click(`#st-nav-${id}`);
    await expectHash('#settings/' + id);
    await expectTitle(heading);
  };
  const backToHome = async () => {
    await page.click('#st-back');
    await expectHash('#settings');
    await page.waitForSelector('.st.at-home');
  };

  // ===================== the test account =====================

  const context = await browser.newContext({ viewport: { width: 390, height: 860 } });
  page = await context.newPage();
  watch(page);

  await step('open the test account on Settings', async () => {
    const r1 = await page.request.post(base + '/api/admin/login', { headers: H, data: { password: ADMIN_PASSWORD } });
    if (!r1.ok()) throw new Error('admin login ' + r1.status());
    const r2 = await page.request.post(base + '/api/admin/demo', { headers: H });
    if (!r2.ok()) throw new Error('demo ' + r2.status());
    await page.goto(base + '/app/#settings');
    await page.waitForSelector('nav.tabs button[aria-selected="true"]:has-text("Settings")');
    await page.waitForSelector('.st.at-home');
  });

  await step('home: eight sections, each with a summary of its state', async () => {
    const ids = await page.$$eval('.st-sections a.st-nav', as => as.map(a => a.getAttribute('href')));
    const want = ['location', 'phones', 'reminders', 'calendar', 'language', 'texting', 'security', 'data'].map(x => '#settings/' + x);
    if (JSON.stringify(ids) !== JSON.stringify(want)) throw new Error('sections: ' + ids.join(' '));
    const s = await state();
    const sunset = s.grid.days.find(d => d.date === s.grid.today).sunset;
    const checks = {
      location: 'Lakewood, NJ · sunset today ' + sunset,
      phones: '2 phones · reminders on for both',
      reminders: '5 of 5 kinds on · nothing sent on Shabbat or Yom Tov',
      calendar: 'Not in a calendar app · titles in words',
      language: 'Halachic terms in English letters',
      texting: 'Text (888) 555-0100 · ' + s.sms.usedThisMonth + ' of ' + s.sms.monthlyLimit + ' texts used this month',
      security: 'A code by text · no password',
    };
    for (const [id, text] of Object.entries(checks)) if ((await summary(id)) !== text) throw new Error(id + ': ' + (await summary(id)));
    if (!(await page.textContent('.st-account')).includes('Signed in with (732) 555-0100')) throw new Error('no account line');
    if (await page.locator('.st-sections .st-flag').count()) throw new Error('a flag on a healthy account');
    if (await page.locator('.st-attention').count()) throw new Error('customs flagged though confirmed');
    await noSideways('home');
    await page.screenshot({ path: out + '/settings-home-390.png', fullPage: true });
  });

  // ----- Location -----

  await step('location: opens as its own view, the address follows, the heading has the focus', async () => {
    await openSection('location', 'Location');
    if (await page.isVisible('#st-home-title')) throw new Error('the list is still shown on a phone');
    const times = await page.textContent('.st-times');
    if (!/Sunrise\s*\d/.test(times) || !/Sunset\s*\d/.test(times)) throw new Error('times: ' + times);
  });

  await step('location: reload and Back land where expected', async () => {
    await page.reload();
    await page.waitForSelector('#st-title:has-text("Location")');
    await expectHash('#settings/location');
    await page.goBack();
    await expectHash('#settings');
    await page.waitForSelector('.st.at-home');
    await page.goForward();
    await expectHash('#settings/location');
    await page.waitForSelector('#st-title:has-text("Location")');
  });

  await step('location: from the list saves at once; what is typed in the ZIP box is kept', async () => {
    await page.fill('#zip', '087');
    await page.selectOption('#place', { label: 'Brooklyn, NY' });
    await savedIn('location');
    await page.waitForSelector('#loc-current:has-text("Brooklyn, NY")');
    if ((await page.inputValue('#zip')) !== '087') throw new Error('the typed ZIP code was lost');
    if ((await state()).app.place.name !== 'Brooklyn, NY') throw new Error('not saved');
  });

  await step('location: an unknown ZIP code is refused beside the box', async () => {
    await page.fill('#zip', '00000');
    await page.click('#zip-find');
    await page.waitForSelector('#zip-error:has-text("No place was found")');
    if ((await page.getAttribute('#zip', 'aria-invalid')) !== 'true') throw new Error('not marked invalid');
  });

  await step('location: a ZIP code sets the place, and the home summary follows', async () => {
    await page.fill('#zip', '08701');
    await page.click('#zip-find');
    await savedIn('location');
    await page.waitForSelector('#loc-current:has-text("Lakewood")');
    await backToHome();
    if (!(await summary('location')).startsWith('Lakewood')) throw new Error('summary: ' + (await summary('location')));
  });

  await step('location: coordinates are checked; a place without times keeps the old one', async () => {
    await openSection('location', 'Location');
    await page.click('#loc-adv summary');
    await page.fill('#place-latitude', '123');
    await page.click('#place-save');
    await page.waitForSelector('#place-latitude[aria-invalid="true"]');
    await page.fill('#place-name', 'Far north');
    await page.fill('#place-latitude', '89.5');
    await page.fill('#place-longitude', '0');
    await page.fill('#place-timeZone', 'UTC');
    await page.click('#place-save');
    await page.waitForSelector('.st-refused:has-text("Far north was not saved")');
    await page.waitForSelector('#status-location.error');
    if (!(await page.textContent('#loc-current')).includes('Lakewood')) throw new Error('the place changed');
    if (!(await state()).app.place.name.startsWith('Lakewood')) throw new Error('the server changed the place');
    if (!(await page.evaluate(() => document.getElementById('loc-adv').open))) throw new Error('Advanced closed on the redraw');
    await noSideways('location');
  });

  // ----- Phones -----

  await step('phones: a compact row per phone, each opening its own view', async () => {
    await openSection('phones', 'Phones');
    if ((await page.locator('.st-phone').count()) !== 2) throw new Error('rows');
    await page.click('#phone-row-17325550199');
    await expectHash('#settings/phones/17325550199');
    await expectTitle('Spouse (example)');
    await page.reload();
    await page.waitForSelector('#st-title:has-text("Spouse (example)")');
  });

  await step('phones: Back from another tab returns to the open phone', async () => {
    await page.click('nav.tabs button:has-text("Today")');
    await page.waitForSelector('nav.tabs button[aria-selected="true"]:has-text("Today")');
    await page.goBack();
    await page.waitForSelector('nav.tabs button[aria-selected="true"]:has-text("Settings")');
    await page.waitForSelector('#st-title:has-text("Spouse (example)")');
    await expectHash('#settings/phones/17325550199');
  });

  await step('phones: an option saves, keeping scroll, focus and what is typed', async () => {
    await page.fill('#name-17325550199', 'Spouse (example)');
    await page.locator('#rem-17325550199-onah').scrollIntoViewIfNeeded();
    await page.focus('#rem-17325550199-onah');
    const y = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Space');
    await savedIn('phones');
    const y2 = await page.evaluate(() => window.scrollY);
    if (Math.abs(y2 - y) > 4) throw new Error('scrolled from ' + y + ' to ' + y2);
    if ((await page.evaluate(() => document.activeElement.id)) !== 'rem-17325550199-onah') throw new Error('focus was lost');
    if ((await state()).phones[1].reminders.includes('onah')) throw new Error('not saved');
    if ((await page.getAttribute('#rem-17325550199-onah', 'role')) !== 'switch') throw new Error('not a switch');
    await page.keyboard.press('Space');
    await savedIn('phones');
    if (!(await state()).phones[1].reminders.includes('onah')) throw new Error('not saved back');
  });

  await step('phones: reminders off, then on with the consent wording first', async () => {
    await page.click('label[for="texts-17325550199"]');
    await savedIn('phones');
    if ((await state()).phones[1].texts) throw new Error('still on');
    if (await page.locator('#phone-kinds').count()) throw new Error('kinds shown while off');
    await page.click('label[for="texts-17325550199"]');
    await page.waitForSelector('#consent-text-17325550199:has-text("Message and data rates may apply")');
    if ((await state()).phones[1].texts) throw new Error('turned on before the consent');
    await page.click('#consent-ok-17325550199');
    await savedIn('phones');
    if (!(await state()).phones[1].texts) throw new Error('not on');
  });

  await step('phones: a test text is simulated', async () => {
    await page.click('#test-17325550199');
    await page.waitForSelector('#status-phones.saved:has-text("simulated")');
  });

  await step('phones: adding a phone in two steps, with the code shown in the test account', async () => {
    await page.click('#st-back');
    await expectHash('#settings/phones');
    await page.click('#phone-add-row');
    await expectHash('#settings/phones/add');
    await expectTitle('Add a phone');
    await page.fill('#add-number', '12');
    await page.click('#add-send');
    await page.waitForSelector('#add-number[aria-invalid="true"]');
    await page.fill('#add-number', '(732) 555-0150');
    await page.click('#add-send');
    await page.waitForSelector('.st-add .alert:has-text("instead of being texted")');
    const code = ((await page.textContent('.st-add .alert-title')).match(/\d{6}/) || [])[0];
    if (!code) throw new Error('no code shown');
    await page.fill('#add-code', '000000'.replace(/./g, (c, i) => (code[i] === '0' ? '1' : '0')));
    await page.click('#add-confirm');
    await page.waitForSelector('#add-code[aria-invalid="true"]');
    await page.fill('#add-code', code);
    await page.click('#add-confirm');
    await expectHash('#settings/phones/17325550150');
    await page.waitForSelector('#st-title:has-text("(732) 555-0150")');
  });

  await step('phones: removing a phone asks first, then returns to the list', async () => {
    await page.click('#remove-17325550150');
    await page.click('dialog button:has-text("Cancel")');
    if ((await state()).phones.length !== 3) throw new Error('removed without asking');
    await page.click('#remove-17325550150');
    await page.click('dialog button:has-text("Remove phone")');
    await expectHash('#settings/phones');
    await page.waitForSelector('#phone-row-17325550150', { state: 'detached' });
    if ((await state()).phones.length !== 2) throw new Error('not removed');
    await noSideways('phones');
  });

  // ----- Reminders -----

  await step('reminders: a switch per kind; the home summary follows', async () => {
    await openSection('reminders', 'Reminders');
    await page.click('#rem-hefsek');
    await savedIn('reminders');
    if ((await state()).app.reminders.hefsek.on) throw new Error('not off');
    await backToHome();
    if (!(await summary('reminders')).startsWith('4 of 5 kinds on')) throw new Error('summary: ' + (await summary('reminders')));
    await openSection('reminders', 'Reminders');
    await page.click('#rem-hefsek');
    await savedIn('reminders');
  });

  await step('reminders: a timing opens in its row, saves, and refuses a number out of range', async () => {
    if ((await page.textContent('#rem-when-hefsek')) !== '2 hours before sunset, on each day it can be done.') throw new Error('timing: ' + (await page.textContent('#rem-when-hefsek')));
    await page.click('#rem-open-hefsek');
    if ((await page.getAttribute('#rem-open-hefsek', 'aria-expanded')) !== 'true') throw new Error('not expanded');
    await page.fill('#rem-hefsek-min', '100');
    await page.press('#rem-hefsek-min', 'Tab');
    await savedIn('reminders');
    if ((await state()).app.reminders.hefsek.minutesBeforeSunset !== 100) throw new Error('not saved');
    await page.waitForSelector('#rem-when-hefsek:has-text("1 hour 40 minutes before sunset")');
    await page.fill('#rem-hefsek-min', '5');
    await page.press('#rem-hefsek-min', 'Tab');
    await page.waitForSelector('#rem-hefsek-min-error:has-text("from 20 to 600")');
    if ((await page.inputValue('#rem-hefsek-min')) !== '5') throw new Error('the refused value was not kept');
    await page.fill('#rem-hefsek-min', '120');
    await page.press('#rem-hefsek-min', 'Tab');
    await savedIn('reminders');
    await page.click('#rem-open-bedikot');
    await page.fill('#rem-bedikot-morning', '07:30');
    await page.press('#rem-bedikot-morning', 'Tab');
    await savedIn('reminders');
    const b = (await state()).app.reminders.bedikot;
    if (b.morningHour !== 7 || b.morningMinute !== 30) throw new Error('time not saved');
    await page.waitForSelector('#rem-when-bedikot:has-text("7:30 AM")');
  });

  await step('reminders: Shabbat and Yom Tov, wording, and the advanced options', async () => {
    await page.click('label[for="rem-rest"]');
    await savedIn('reminders');
    if ((await state()).app.reminders.beforeRestDays) throw new Error('rest days not saved');
    await page.click('label[for="rem-rest"]');
    await savedIn('reminders');
    if (!(await page.textContent('#rem-style-group')).includes('M night: Thu Nov 26')) throw new Error('no discreet example');
    await page.click('label[for="r-sms-style-discreet"]');
    await savedIn('reminders');
    if ((await state()).app.reminders.style !== 'discreet') throw new Error('wording not saved');
    await page.click('label[for="r-sms-style-plain"]');
    await savedIn('reminders');
    await page.click('#rem-adv summary');
    await page.fill('#rem-hefsek-days', '99');
    await page.press('#rem-hefsek-days', 'Tab');
    await page.waitForSelector('#rem-hefsek-days-error');
    await page.fill('#rem-hefsek-days', '12');
    await page.press('#rem-hefsek-days', 'Tab');
    await savedIn('reminders');
    if ((await state()).app.reminders.hefsekMaxDays !== 12) throw new Error('days not saved');
    await noSideways('reminders');
  });

  await step('reminders: what is scheduled, as its own view', async () => {
    await page.click('#rem-scheduled');
    await expectHash('#settings/reminders/scheduled');
    await expectTitle('Scheduled reminders');
    await page.waitForSelector('.st-tl-item .st-tl-time');
    await page.reload();
    await page.waitForSelector('#st-title:has-text("Scheduled reminders")');
    await page.click('#st-back');
    await expectHash('#settings/reminders');
    await expectTitle('Reminders');
  });

  // ----- Calendar -----

  await step('calendar: subscription link, discreet titles, and removing the link', async () => {
    await openSection('calendar', 'Calendar');
    if (await page.locator('#cal-google').count()) throw new Error('Google offered where it is not available');
    await page.click('#link-create');
    await savedIn('calendar');
    await page.waitForSelector('#cal-link code.copy');
    await page.click('label[for="r-cal-style-discreet"]');
    await savedIn('calendar');
    if ((await state()).app.calendar.style !== 'discreet') throw new Error('style not saved');
    await backToHome();
    if ((await summary('calendar')) !== 'Subscription link · discreet titles') throw new Error('summary: ' + (await summary('calendar')));
    await openSection('calendar', 'Calendar');
    await page.click('label[for="r-cal-style-words"]');
    await savedIn('calendar');
    await page.fill('#cal-name', '');
    await page.press('#cal-name', 'Tab');
    await page.waitForSelector('#cal-name-error');
    await page.fill('#cal-name', 'Our calendar');
    await page.press('#cal-name', 'Tab');
    await savedIn('calendar');
    if ((await state()).app.calendar.name !== 'Our calendar') throw new Error('name not saved');
    await page.click('#cal-more summary');
    await page.click('#link-remove');
    await page.click('dialog button:has-text("Remove link")');
    await savedIn('calendar');
    await page.waitForSelector('#link-create');
    await noSideways('calendar');
  });

  // ----- Language -----

  await step('language: Hebrew terms, with the example and the summaries following', async () => {
    await openSection('language', 'Language');
    await page.click('label[for="r-terms-he"]');
    await savedIn('language');
    await page.waitForSelector('#lang-example .st-sample:has-text("הפסק")');
    await backToHome();
    if ((await summary('language')) !== 'Halachic terms in Hebrew script') throw new Error('summary: ' + (await summary('language')));
    if (!(await summary('reminders')).includes('שבת')) throw new Error('reminders summary not in Hebrew terms: ' + (await summary('reminders')));
    await page.setViewportSize({ width: 360, height: 800 });
    for (const id of ['', 'location', 'phones', 'phones/17325550100', 'phones/add', 'reminders', 'reminders/scheduled', 'calendar', 'language', 'texting', 'security', 'data']) {
      await page.evaluate(p => (location.hash = '#settings' + (p ? '/' + p : '')), id);
      await page.waitForTimeout(120);
      await noSideways((id || 'home') + ' at 360 px in Hebrew terms');
    }
    await page.screenshot({ path: out + '/settings-reminders-360-he.png', fullPage: true });
    await page.evaluate(() => (location.hash = '#settings/language'));
    await page.click('label[for="r-terms-en"]');
    await savedIn('language');
    await page.waitForSelector('#lang-example .st-sample:has-text("hefsek taharah")');
  });

  await step('no sideways scrolling at 360 px in English terms', async () => {
    for (const id of ['', 'location', 'phones', 'phones/17325550199', 'phones/add', 'reminders', 'reminders/scheduled', 'calendar', 'language', 'texting', 'security', 'data']) {
      await page.evaluate(p => (location.hash = '#settings' + (p ? '/' + p : '')), id);
      await page.waitForTimeout(120);
      await noSideways((id || 'home') + ' at 360 px');
    }
    await page.setViewportSize({ width: 390, height: 860 });
  });

  // ----- Texting, sign-in, your data -----

  await step('texting: the number, the usage and the commands', async () => {
    await openSection('texting', 'Texting');
    const t = await page.textContent('.st-body');
    if (!t.includes('(888) 555-0100')) throw new Error('no number');
    if (!/Texts simulated this month: \d+ of \d+/.test(t)) throw new Error('no usage');
    for (const w of ['1', '9', '0', 'MENU', 'STATUS', 'HISTORY', 'LOCATION', 'CUSTOMS', 'REMINDERS', 'PHONES', 'ADD', 'CALENDAR', 'WEB', 'SETUP', 'DELETE ACCOUNT', 'STOP', 'START']) {
      if ((await page.locator(`.st-commands kbd:text-is("${w}")`).count()) !== 1) throw new Error('missing ' + w);
    }
  });

  await step('sign-in: password errors beside their fields; sign-out everywhere asks first', async () => {
    await openSection('security', 'Sign-in and security');
    await page.fill('#npw1', 'short');
    await page.click('#pw-save');
    await page.waitForSelector('#npw1[aria-invalid="true"]');
    await page.fill('#npw1', ACCOUNT_PASSWORD);
    await page.fill('#npw2', 'a different password');
    await page.click('#pw-save');
    await page.waitForSelector('#npw2[aria-invalid="true"]');
    await page.click('#sign-out-all');
    await page.waitForSelector('dialog:has-text("Sign out everywhere?")');
    await page.click('dialog button:has-text("Cancel")');
    await page.waitForSelector('dialog', { state: 'detached' });
  });

  await step('your data: download, guided setup, links, and the typed DELETE', async () => {
    await openSection('data', 'Your data');
    await page.waitForSelector('a#data-export[href="/api/export"]');
    for (const href of ['/help', '/privacy', '/terms']) if (!(await page.locator(`#data-links a[href="${href}"]`).count())) throw new Error('no link to ' + href);
    await page.click('#delete-account');
    await page.fill('dialog input', 'delete');
    await page.click('dialog button:has-text("Delete my account")');
    await page.waitForSelector('dialog .error:has-text("capital letters")');
    await page.click('dialog button:has-text("Cancel")');
    await page.waitForSelector('dialog', { state: 'detached' });
    await page.click('#open-setup');
    await page.waitForSelector('#setup-leave');
    await page.click('#setup-leave');
    await page.waitForTimeout(300);
    if (await page.locator('dialog').count()) await page.click('dialog button[type=submit]');
    await page.waitForSelector('nav.tabs');
  });

  // ----- wide screens -----

  for (const scheme of ['light', 'dark']) {
    await step(`wide (1280 px, ${scheme}): the list stays beside the open section`, async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.click('nav.tabs button:has-text("Settings")');
      await page.evaluate(() => (location.hash = '#settings'));
      await page.waitForSelector('.st.at-home');
      if (!(await page.isVisible('#st-title:has-text("Location")'))) throw new Error('no section beside the list');
      if (await page.isVisible('#st-back')) throw new Error('a back control beside the list');
      await page.screenshot({ path: `${out}/settings-home-1280-${scheme}.png`, fullPage: true });
      await page.click('#st-nav-reminders');
      await expectTitle('Reminders');
      if (!(await page.isVisible('#st-home-title'))) throw new Error('the list was hidden');
      if ((await page.getAttribute('#st-nav-reminders', 'aria-current')) !== 'page') throw new Error('not marked current');
      await page.screenshot({ path: `${out}/settings-reminders-1280-${scheme}.png`, fullPage: true });
      await noSideways('wide');
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await context.close();

  // ===================== an ordinary new account (no texting on this site) =====================

  const c2 = await browser.newContext({ viewport: { width: 390, height: 860 } });
  page = await c2.newPage();
  watch(page);

  await step('a new account from an invitation', async () => {
    const admin = await c2.request.post(base + '/api/admin/login', { headers: H, data: { password: ADMIN_PASSWORD } });
    if (!admin.ok()) throw new Error('admin login ' + admin.status());
    const inv = await c2.request.post(base + '/api/admin/invites', { headers: H, data: { kind: 'setup', number: '+17324440101' } });
    if (!inv.ok()) throw new Error('invite ' + inv.status() + ' ' + (await inv.text()));
    const link = (await inv.json()).link.replace(/^https?:\/\/[^/]+/, base);
    await page.goto(link);
    await page.fill('#number', '732-444-0101');
    await page.fill('#pw1', ACCOUNT_PASSWORD);
    await page.fill('#pw2', ACCOUNT_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForSelector('#setup-leave');
    const w = await page.request.post(base + '/api/welcome', { headers: H });
    if (!w.ok()) throw new Error('welcome ' + w.status());
    await page.goto(base + '/app/#settings');
    await page.reload();
    await page.waitForSelector('.st.at-home');
  });

  await step('new account: the home flags what is missing', async () => {
    if ((await summary('location')) !== 'Not chosen yet') throw new Error('location: ' + (await summary('location')));
    await page.waitForSelector('#st-nav-location .st-flag.warn');
    await page.waitForSelector('.st-attention:has-text("customs are not confirmed")');
    if ((await summary('texting')) !== 'Not available on this site yet') throw new Error('texting: ' + (await summary('texting')));
    if ((await summary('phones')) !== '1 phone · texting not available here') throw new Error('phones: ' + (await summary('phones')));
    if ((await summary('security')) !== 'Password') throw new Error('security: ' + (await summary('security')));
    await noSideways('new home');
    await page.screenshot({ path: out + '/settings-home-new-390.png', fullPage: true });
  });

  await step('new account: the customs link goes to the Customs tab', async () => {
    await page.click('#st-go-customs');
    await page.waitForSelector('nav.tabs button[aria-selected="true"]:has-text("Customs")');
    await page.click('nav.tabs button:has-text("Settings")');
    await page.waitForSelector('.st.at-home');
  });

  await step('new account: choosing a location clears its flag', async () => {
    await openSection('location', 'Location');
    await page.waitForSelector('.st-hero.none');
    await page.selectOption('#place', { label: 'Lakewood, NJ' });
    await savedIn('location');
    await page.waitForSelector('#loc-current:has-text("Lakewood, NJ")');
    await backToHome();
    if (await page.locator('#st-nav-location .st-flag').count()) throw new Error('still flagged');
  });

  await step('new account: disabled controls say why', async () => {
    await openSection('phones', 'Phones');
    await page.waitForSelector('.muted-row:has-text("once text messaging is available")');
    await page.click('#phone-row-17324440101');
    if (!(await page.isDisabled('#texts-17324440101'))) throw new Error('reminders switch enabled');
    if (!(await page.textContent('#texts-17324440101-help')).includes('not available on this site')) throw new Error('no reason');
    if (!(await page.isDisabled('#test-17324440101'))) throw new Error('test text enabled');
    await page.waitForSelector('#phone-remove:has-text("only phone on the account")');
    await openSection('reminders', 'Reminders');
    await page.waitForSelector('.st-note:has-text("not available on this site")');
    await openSection('texting', 'Texting');
    await page.waitForSelector('.st-body:has-text("not available on this site yet")');
    await openSection('calendar', 'Calendar');
    if (await page.locator('#cal-google').count()) throw new Error('Google offered');
  });

  await step('new account: the password can be changed, not removed without texting', async () => {
    await openSection('security', 'Sign-in and security');
    if (await page.locator('#pw-remove').count()) throw new Error('remove offered without texting');
    await page.waitForSelector('#sec-password:has-text("cannot be removed")');
    await page.click('#pw-change');
    await page.waitForSelector('#npw1');
    await page.click('#pw-cancel');
    await page.waitForSelector('#pw-change');
  });

  await step('new account: deleting it with the typed DELETE', async () => {
    await openSection('data', 'Your data');
    await page.click('#delete-account');
    await page.fill('dialog input', 'DELETE');
    await page.click('dialog button:has-text("Delete my account")');
    await page.waitForURL(base + '/');
  });

  await browser.close();
  if (errors.length) {
    console.log('\n' + errors.length + ' problem(s):\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  console.log('\nall steps passed');
})();
