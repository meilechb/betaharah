// Drives the public page, the operator's console and the dashboard in a real
// browser against a locally running app.
//
//   1. printf 'DASHBOARD_PASSWORD=local-test-password\nENCRYPTION_KEY=local-test-key-0123456789abcdef0123456789\n' > .dev.vars
//   2. npx wrangler dev --port 8799 --persist-to <a new empty directory>     (in another terminal; a fresh database each time)
//   3. node test/ui-check.cjs <directory for screenshots> http://127.0.0.1:8799
//
// Text messaging is not set up in a local run, so the account is made the
// way the operator makes one before texting works: an invitation for one
// number, with a password. Sign-in by texted code is covered by the server
// tests. Needs Playwright with Chromium. Exits 0 when every step passed.
const { chromium } = require('playwright');
const out = process.argv[2];
const base = process.argv[3];
const PASSWORD = 'local-test-password';
const ACCOUNT_PASSWORD = 'a good long password';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // The browser logs refused requests (a wrong password, a repeated entry, the request after signing out);
  // those refusals are what the steps below check for. Anything else, such as a blocked script or style, is an error.
  page.on('console', m => {
    if (m.type() === 'error' && !/status of (40[0134]|429)/.test(m.text())) errors.push('console: ' + m.text());
  });
  const step = async (name, fn) => {
    try {
      await fn();
      console.log('ok  ', name);
    } catch (e) {
      console.log('FAIL', name, '-', e.message.split('\n')[0]);
      errors.push(name);
      await page.screenshot({ path: out + '/fail-' + errors.length + '.png', fullPage: true }).catch(() => undefined);
      console.log('     the page says:', ((await page.textContent('#root').catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 300));
    }
  };
  const noSideways = async () => {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) throw new Error('the page is ' + wide + 'px wider than the screen');
  };
  const text = sel => page.textContent(sel);

  // ----- the public pages -----

  await page.goto(base + '/');
  await step('landing page', async () => {
    const h1 = await text('h1');
    if (!h1.includes('mikvah calendar')) throw new Error('headline: ' + h1);
    const color = await page.evaluate(() => getComputedStyle(document.querySelector('.button.primary')).backgroundColor);
    if (color === 'rgba(0, 0, 0, 0)') throw new Error('the stylesheet did not load');
    for (const href of ['/app/', '/help', '/privacy', '/terms']) if ((await page.locator(`a[href="${href}"]`).count()) === 0) throw new Error('no link to ' + href);
    await noSideways();
  });
  await page.screenshot({ path: out + '/landing.png', fullPage: true });

  for (const [path, heading, phrase] of [
    ['/help', 'Help', 'Recording by text message'],
    ['/privacy', 'Privacy', 'What encryption does not do'],
    ['/terms', 'Terms', 'It is not a rav'],
  ]) {
    await step('page ' + path, async () => {
      await page.goto(base + path);
      if ((await text('h1')).trim() !== heading) throw new Error('heading');
      if (!(await text('main')).includes(phrase)) throw new Error('missing: ' + phrase);
      const max = await page.evaluate(() => getComputedStyle(document.querySelector('main')).maxWidth);
      if (max !== '720px') throw new Error('the stylesheet did not load');
      await noSideways();
    });
  }
  await page.screenshot({ path: out + '/terms.png', fullPage: true });

  // ----- the operator's console -----

  let inviteLink = '';
  await step('operator: wrong password, then sign in', async () => {
    await page.goto(base + '/admin/');
    await page.waitForSelector('form.login #pw');
    await page.fill('#pw', 'not the password');
    await page.click('button[type=submit]');
    await page.waitForSelector('.alert.bad:has-text("Wrong password")');
    await page.fill('#pw', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForSelector('h2:has-text("Status")');
    const status = await text('#root');
    if (!status.includes('Text messaging is off or not set up')) throw new Error('status');
  });
  await step('operator: save the contact and the sign-up rule', async () => {
    await page.selectOption('#signup', 'invite');
    await page.fill('#cname', 'Local Tester');
    await page.click('form.card button:has-text("Save")');
    await page.waitForSelector('.toast:has-text("Saved")');
    if ((await page.inputValue('#cname')) !== 'Local Tester') throw new Error('not kept');
  });
  await step('operator: invitation for one number', async () => {
    await page.fill('#inum', '(732) 555-0101');
    await page.click('button:has-text("Create invitation")');
    await page.waitForSelector('.alert.ok code.copy');
    inviteLink = (await text('.alert.ok code.copy')).trim();
    if (!/\/app\/\?invite=[A-Za-z0-9_-]{32}$/.test(inviteLink)) throw new Error('link: ' + inviteLink);
    await page.waitForSelector('ul.list .title:has-text("For one number")');
    await noSideways();
  });
  await page.screenshot({ path: out + '/admin.png', fullPage: true });
  await step('the contact appears on the public pages', async () => {
    await page.goto(base + '/privacy');
    if (!(await text('main')).includes('Local Tester')) throw new Error('contact missing');
  });

  // ----- signing in -----

  await step('sign-in page without an invitation', async () => {
    await page.goto(base + '/app/');
    await page.waitForSelector('form.login');
    const t = await text('form.login');
    if (!t.includes('New accounts are by invitation')) throw new Error('no invitation note');
    if (!t.includes('Sign-in by text message is not available yet')) throw new Error('no note about texting');
    await noSideways();
  });
  await page.screenshot({ path: out + '/signin.png', fullPage: true });
  await step('a made-up invitation is refused', async () => {
    await page.goto(base + '/app/?invite=' + 'x'.repeat(32));
    await page.waitForSelector('.alert.bad:has-text("not valid any more")');
  });
  await step('set up the account from the invitation', async () => {
    await page.goto(inviteLink.replace(/^https?:\/\/[^/]+/, base));
    await page.waitForSelector('h2:has-text("Set up your account")');
    await page.fill('#number', '732-555-0101');
    await page.fill('#pw1', ACCOUNT_PASSWORD);
    await page.fill('#pw2', 'something else entirely');
    await page.click('button[type=submit]');
    await page.waitForSelector('.alert.bad:has-text("not the same")');
    await page.fill('#pw2', ACCOUNT_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForSelector('nav.tabs');
    if (page.url().includes('invite=')) throw new Error('the invitation is still in the address');
  });

  // ----- the dashboard -----

  await step('getting started: nothing yet', async () => {
    const t = await text('#root');
    if (!t.includes('Getting started')) throw new Error('no checklist');
    if (!t.includes('Nothing can be calculated until a location is chosen')) throw new Error('no location note');
    if ((await page.locator('ul.checklist li.done').count()) !== 0) throw new Error('something is marked done');
  });
  await step('choose a location', async () => {
    await page.click('button:has-text("Choose your location")');
    await page.selectOption('#place', { label: 'Lakewood, NJ' });
    await page.click('button:has-text("Save location")');
    await page.waitForSelector('.toast:has-text("Location saved")');
  });
  await step('today: status and dates, in English', async () => {
    await page.click('nav.tabs button:has-text("Today")');
    await page.waitForSelector('.status .headline');
    if ((await text('.status .headline')).trim() !== 'Tehorah') throw new Error('headline');
    const today = await text('header.top .today');
    if (!/^\w+, \d+ \w+( I{1,2})? 57\d\d · (day|night) · \w{3} \d+, 20\d\d$/.test(today.trim())) throw new Error('today: ' + today);
  });
  await step('customs: all 11 choices plus nightfall, in English', async () => {
    await page.click('nav.tabs button:has-text("Customs")');
    const n = await page.locator('form.card fieldset').count();
    if (n !== 12) throw new Error('fieldsets ' + n);
    const t = await text('form.card');
    for (const s of ['Onah beinonit: which day', 'The onah of the Or Zarua', 'How the veset haflagah is counted', 'Days to wait before the hefsek taharah', 'Nightfall, for the time of immersion', 'Day 30 and day 31', 'Chabad custom']) {
      if (!t.includes(s)) throw new Error('missing ' + s);
    }
    if (/[֐-׿]/.test(t)) throw new Error('Hebrew letters while English is chosen');
    if (/\{[a-z_]+\}/.test(t)) throw new Error('an unfilled term');
  });
  await step('switch the terms to Hebrew: terms change, sentences stay English', async () => {
    await page.click('.toggle button:has-text("עברית")');
    await page.waitForSelector('legend:has-text("עונה בינונית: which day")');
    const t = await text('form.card');
    for (const s of ['Days to wait before the הפסק טהרה', 'The עונה of the אור זרוע', 'How the וסת ההפלגה is counted', 'צאת הכוכבים, for the time of טבילה']) if (!t.includes(s)) throw new Error('missing ' + s);
    if (/\{[a-z_]+\}/.test(t)) throw new Error('an unfilled term');
    if ((await page.getAttribute('html', 'dir')) === 'rtl') throw new Error('the page turned right-to-left');
    await noSideways();
  });
  await page.screenshot({ path: out + '/customs-hebrew.png', fullPage: true });
  await step('save the customs', async () => {
    await page.locator('label.choice:has-text("Not observed")').first().click();
    await page.click('button:has-text("Save and confirm")');
    await page.waitForSelector('.toast:has-text("Your customs are saved")');
    await page.waitForSelector('p:has-text("Last saved:")');
  });
  await step('record a flow now (Hebrew terms)', async () => {
    await page.click('nav.tabs button:has-text("Today")');
    await page.click('.actions button:has-text("ראייה")');
    await page.click('button[type=submit]:has-text("Record")');
    await page.waitForSelector('.toast:has-text("Recorded: flow")');
    const head = (await text('.status .headline')).trim();
    if (head !== 'נדה, before the הפסק טהרה') throw new Error('headline: ' + head);
    await page.waitForSelector('ul.list .title:has-text("הפסק טהרה (by")');
  });
  await step('a repeat is refused', async () => {
    await page.click('.actions button:has-text("ראייה")');
    await page.click('button[type=submit]:has-text("Record")');
    await page.waitForSelector('.toast.bad:has-text("Already recorded")');
    await page.click('button:has-text("Cancel")');
  });
  await page.screenshot({ path: out + '/today-hebrew.png', fullPage: true });
  await step('back to English terms, from Settings', async () => {
    await page.click('nav.tabs button:has-text("Settings")');
    await page.click('.toggle button:has-text("English")');
    await page.waitForSelector('.toggle button[aria-pressed="true"]:has-text("English")');
    await page.click('nav.tabs button:has-text("Today")');
    const head = (await text('.status .headline')).trim();
    if (head !== 'Niddah, before the hefsek taharah') throw new Error('headline: ' + head);
    await page.waitForSelector('ul.list .title:has-text("Hefsek taharah (by")');
    await page.waitForSelector('ul.list .title:has-text("Seven clean days: day 1 (projected)")');
    await page.waitForSelector('ul.list .title:has-text("Mikvah night (after")');
  });
  await page.screenshot({ path: out + '/today.png', fullPage: true });
  await step('the log lists the entry', async () => {
    await page.click('nav.tabs button:has-text("Log")');
    await page.waitForSelector('ul.list .title:has-text("Flow: ")');
    if (!(await text('#root')).includes('Recorded on the website')) throw new Error('source');
  });
  await step('settings: phones, calendar, reminders, sign-in, data', async () => {
    await page.click('nav.tabs button:has-text("Settings")');
    const t = await text('#root');
    for (const s of ['(732) 555-0101', 'this phone', 'not verified', 'Text messaging is not available on this site yet', 'Subscription link', 'Coming reminders', 'Signed in with (732) 555-0101', 'Download my data', 'Delete my account']) {
      if (!t.includes(s)) throw new Error('missing: ' + s);
    }
    if (/\{[a-z_]+\}/.test(t)) throw new Error('an unfilled term');
    await noSideways();
  });
  let feedUrl = '';
  await step('create a calendar link; the feed opens without signing in', async () => {
    await page.click('button:has-text("Create a subscription link")');
    await page.waitForSelector('.toast:has-text("The link is ready")');
    feedUrl = (await text('section.card code.copy')).trim();
    if (!/\/cal\/[A-Za-z0-9_-]{32}\.ics$/.test(feedUrl)) throw new Error('link: ' + feedUrl);
    const res = await fetch(feedUrl.replace(/^https?:\/\/[^/]+/, base));
    const body = await res.text();
    if (res.status !== 200 || !res.headers.get('content-type').startsWith('text/calendar')) throw new Error('feed status ' + res.status);
    if (!body.includes('SUMMARY:Flow (')) throw new Error('feed has no flow');
  });
  await step('change the reminders and the calendar look', async () => {
    await page.selectOption('#style', 'discreet');
    await page.click('button:has-text("Save appearance")');
    await page.waitForSelector('.toast:has-text("Saved")');
    const body = await (await fetch(feedUrl.replace(/^https?:\/\/[^/]+/, base))).text();
    if (!body.includes('SUMMARY:•') || body.includes('DESCRIPTION')) throw new Error('the feed did not turn discreet');
    await page.selectOption('#sms-style', 'discreet');
    await page.click('button:has-text("Save reminders")');
    await page.waitForSelector('.toast:has-text("Reminders saved")');
  });
  await page.screenshot({ path: out + '/settings.png', fullPage: true });
  await step('the password form is offered right after signing in', async () => {
    await page.waitForSelector('#npw1');
    if (!(await text('#root')).includes('A password is set. You can change it here.')) throw new Error('note');
  });
  await step('downloading the data', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Download my data")')]);
    if (download.suggestedFilename() !== 'betaharah-export.json') throw new Error('file name ' + download.suggestedFilename());
  });
  await step('sign out, and back in with the password', async () => {
    await page.click('button:has-text("Sign out"):not(:has-text("everywhere"))');
    await page.waitForSelector('form.login');
    await page.fill('#number', '(732) 555-0101');
    await page.fill('#pw', 'the wrong password');
    await page.click('button[type=submit]');
    await page.waitForSelector('.alert.bad:has-text("Wrong number or password")');
    await page.fill('#pw', ACCOUNT_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForSelector('nav.tabs');
    await page.click('nav.tabs button:has-text("Today")');
    await page.waitForSelector('.status .headline');
    await page.click('nav.tabs button:has-text("Settings")');
  });
  await step('a wide screen', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(base + '/');
    await noSideways();
    await page.screenshot({ path: out + '/landing-wide.png', fullPage: true });
    await page.goto(base + '/app/#settings');
    await page.waitForSelector('h2:has-text("Location")');
    await noSideways();
    await page.setViewportSize({ width: 420, height: 900 });
  });
  await step('delete the account', async () => {
    page.once('dialog', d => d.accept('DELETE'));
    await page.click('button:has-text("Delete my account")');
    await page.waitForURL(base + '/');
    await page.goto(base + '/app/');
    await page.waitForSelector('form.login');
    const res = await fetch(feedUrl.replace(/^https?:\/\/[^/]+/, base));
    if (res.status !== 404) throw new Error('the calendar link still answers: ' + res.status);
  });

  await browser.close();
  if (errors.length) {
    console.log('\nPROBLEMS:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('\nall steps passed');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
