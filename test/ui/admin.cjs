// Drives the operator's console in a real browser against a locally running app:
// every section and every action that does not need a real Telnyx or Google account.
//
//   1. a .dev.vars with DASHBOARD_PASSWORD=local-test-password (see test/ui-check.cjs)
//   2. npx wrangler dev --port 8813 --persist-to <a new empty directory>
//   3. node test/ui/admin.cjs <directory for screenshots> http://127.0.0.1:8813
//
// It makes its own accounts (invitations for one number, with a password), so it
// works on an empty database. Exits 0 when every step passed.
const { chromium } = require('playwright');
const out = process.argv[2];
const base = process.argv[3] || 'http://127.0.0.1:8813';
const PASSWORD = 'local-test-password';

async function api(method, path, body, cookie) {
  const res = await fetch(base + path, {
    method,
    headers: { 'x-betaharah': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  return { status: res.status, json: await res.json().catch(() => null), cookie: set ? set.split(';')[0] : null };
}

/** Accounts made the way the operator makes them before texting works. */
async function seed() {
  const op = (await api('POST', '/api/admin/login', { password: PASSWORD })).cookie;
  if (!op) throw new Error('could not sign in to seed');
  const suffix = String(Date.now()).slice(-4).replace(/^0/, '1');
  for (const n of ['21', '22', '23']) {
    const number = '+1732' + suffix.slice(0, 1) + n + suffix.slice(1);
    const inv = await api('POST', '/api/admin/invites', { kind: 'setup', number, days: 7 }, op);
    if (inv.status !== 200) continue;
    await api('POST', '/api/auth/setup', { number, password: 'a good long password', invite: new URL(inv.json.link).searchParams.get('invite') });
  }
  // the console's starting point for the steps below
  const state = (await api('GET', '/api/admin/state', null, op)).json;
  await api('PUT', '/api/admin/config', { ...state.config, signup: 'open', smsEnabled: true, contactName: '', allowedPrefixes: ['+1'], rcsEnabled: false }, op);
  await api('PUT', '/api/admin/secrets', { telnyxApiKey: '', telnyxPublicKey: '', telnyxNumber: '', rcsAgentId: '', googleClientId: '', googleClientSecret: '' }, op);
  await api('PUT', '/api/admin/notes', { tollFreeSubmitted: false, tollFreeVerified: false, centsPerText: 1 }, op);
}

(async () => {
  await seed();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/status of (40[0134]|409|429|502)/.test(m.text())) errors.push('console: ' + m.text());
  });
  const step = async (name, fn) => {
    try {
      await fn();
      console.log('ok  ', name);
    } catch (e) {
      console.log('FAIL', name, '-', e.message.split('\n')[0]);
      errors.push(name);
      await page.screenshot({ path: out + '/admin-fail-' + errors.length + '.png', fullPage: true }).catch(() => undefined);
    }
  };
  const noSideways = async () => {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) throw new Error('the page is ' + wide + 'px wider than the screen');
  };
  const toast = text => page.waitForSelector(`.toast:has-text("${text}")`);
  const section = id => `#${id}`;
  const stepStatus = async key => page.locator(`#setup li.step:has(.step-title:text-is("${key}")) .tag`).first().textContent();
  const waitStep = (key, word) =>
    page.waitForFunction(
      ([k, w]) => [...document.querySelectorAll('#setup li.step')].some(li => li.querySelector('.step-title').textContent === k && li.querySelector('.tag').textContent === w),
      [key, word],
    );

  // ----- sign-in -----
  await step('sign-in: empty, wrong, then right', async () => {
    await page.goto(base + '/admin/');
    await page.waitForSelector('form.login #pw');
    await page.click('button[type=submit]');
    await page.waitForSelector('.field .error:has-text("Type the operator password")');
    await page.fill('#pw', 'not the password');
    await page.click('button[type=submit]');
    await page.waitForSelector('.alert.bad:has-text("Wrong password")');
    await page.fill('#pw', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForSelector('h2:has-text("Status")');
    if (!(await page.textContent('.console-top')).includes('Signed in until')) throw new Error('no session time');
    await noSideways();
  });

  // ----- summary, steps, status -----
  await step('summary, setup steps and status are shown', async () => {
    const summary = await page.textContent(section('summary'));
    if (!/Setup: \d+ steps? left/.test(summary)) throw new Error('summary: ' + summary.slice(0, 80));
    if ((await page.locator('#setup li.step').count()) !== 9) throw new Error('not nine steps');
    if ((await stepStatus('Contact details for the public pages')) !== 'Needs you') throw new Error('contact step');
    if (!(await page.textContent(section('status'))).includes('Text messaging is off or not set up')) throw new Error('status');
    await page.click('#nav-accounts');
    if (!page.url().endsWith('#accounts')) throw new Error('nav');
    if ((await page.getAttribute('#nav-accounts', 'aria-current')) !== 'location') throw new Error('aria-current');
  });

  // ----- usage -----
  await step('usage: counts, price, chart and table', async () => {
    await page.locator(section('usage')).scrollIntoViewIfNeeded();
    await page.waitForSelector('#usage svg.chart');
    await page.fill('#price', 'a lot');
    await page.click('button:has-text("Save price")');
    await page.waitForSelector('#usage .error:has-text("number of cents")');
    await page.fill('#price', '0.8');
    await page.click('button:has-text("Save price")');
    await toast('Price saved');
    if (!(await page.textContent('#usage')).includes('0.8 cents each')) throw new Error('price not used');
    await page.selectOption('#series', 'signups');
    await page.waitForSelector('#usage p:has-text("New accounts in the last 30 days")');
    await page.focus('#usage .bar-hit >> nth=29');
    await page.waitForSelector('.chart-readout strong');
    await page.click('#usage summary:has-text("Show the numbers as a table")');
    await page.waitForSelector('#usage details[open] table');
    await noSideways();
  });

  // ----- accounts -----
  await step('accounts: listed by id and dates, searched, sorted, deleted with DELETE typed', async () => {
    await page.locator(section('accounts')).scrollIntoViewIfNeeded();
    await page.waitForSelector('#accounts ul.accounts li');
    if (!(await page.textContent('#accounts')).includes('Nobody, including you in this console, can read it here')) throw new Error('no privacy note');
    const before = await page.locator('#accounts ul.accounts li').count();
    if (before < 3) throw new Error('only ' + before + ' accounts');
    const id = (await page.textContent('#accounts ul.accounts li >> nth=0 >> .mono')).trim();
    await page.fill('#acc-q', id.slice(2, 9));
    await page.waitForFunction(() => document.querySelectorAll('#accounts ul.accounts li').length === 1);
    await page.fill('#acc-q', '');
    await page.waitForFunction(n => document.querySelectorAll('#accounts ul.accounts li').length === n, before);
    await page.selectOption('#acc-sort', 'oldest');
    await page.waitForFunction(i => document.querySelector('#accounts ul.accounts li:last-child .mono').textContent.trim() === i, id);
    await page.selectOption('#acc-sort', 'newest');
    await page.waitForFunction(i => document.querySelector('#accounts ul.accounts li:first-child .mono').textContent.trim() === i, id);
    await page.click('#accounts ul.accounts li >> nth=0 >> button:has-text("Delete")');
    await page.waitForSelector('dialog[open] h2:has-text("Delete this account")');
    await page.fill('dialog input', 'delete');
    await page.click('dialog button[type=submit]');
    await page.waitForSelector('dialog .error:has-text("Nothing has been deleted")');
    await page.fill('dialog input', 'DELETE');
    await page.click('dialog button[type=submit]');
    await toast('The account was deleted');
    await page.waitForFunction(n => document.querySelectorAll('#accounts ul.accounts li').length === n - 1, before);
    await noSideways();
  });

  // ----- settings -----
  await step('settings: field errors, a lock-out warning, then saved', async () => {
    await page.locator(section('settings')).scrollIntoViewIfNeeded();
    await page.fill('#prefixes', '1');
    await page.fill('#lim-dailyCodeLimit', '-3');
    await page.click('button:has-text("Save settings")');
    await page.waitForSelector('#settings .error:has-text("Each prefix is a +")');
    await page.waitForSelector('#settings .error:has-text("A whole number from 0")');
    await page.fill('#prefixes', '+1');
    await page.fill('#lim-dailyCodeLimit', '150');
    await page.fill('#cname', 'Local Tester');
    await page.selectOption('#signup', 'closed');
    await page.waitForSelector('#settings .alert:has-text("Nobody will be able to create an account")');
    await page.click('button:has-text("Save settings")');
    await page.waitForSelector('dialog[open] h2:has-text("Save settings that keep people out?")');
    await page.click('dialog button:has-text("Cancel")');
    await page.selectOption('#signup', 'open');
    await page.click('button:has-text("Save settings")');
    await toast('Settings saved');
    if ((await page.inputValue('#cname')) !== 'Local Tester') throw new Error('not kept');
    if ((await stepStatus('Contact details for the public pages')) !== 'Done') throw new Error('contact step not done');
    if ((await stepStatus('Sign-up policy chosen')) !== 'Done') throw new Error('sign-up step not done');
  });

  // ----- keys -----
  await step('keys: checks without keys, a wrong number, saved, cleared, notes to self, RCS switch', async () => {
    await page.locator(section('keys')).scrollIntoViewIfNeeded();
    await page.click('button:has-text("Check Telnyx")');
    await toast('Save the API key and the number first');
    await page.click('button:has-text("Check Google")');
    await toast('Save the client ID and the client secret first');
    await page.click('button:has-text("Check RCS agent")');
    await toast('Save the Telnyx API key and the RCS agent id first');
    await page.fill('#k-telnyxNumber', '12');
    await page.click('button:has-text("Save Telnyx keys")');
    await page.waitForSelector('#keys .error:has-text("not a phone number")');
    await page.fill('#k-telnyxApiKey', 'local-test-key');
    await page.fill('#k-telnyxPublicKey', 'local-public-key');
    await page.fill('#k-telnyxNumber', '+1 888 444 0100');
    await page.click('button:has-text("Save Telnyx keys")');
    await toast('Saved');
    if ((await page.inputValue('#k-telnyxApiKey')) !== '') throw new Error('the key was put back in the field');
    if ((await page.locator('label[for="k-telnyxApiKey"] .tag').textContent()) !== 'saved') throw new Error('not marked saved');
    if ((await page.content()).includes('local-test-key')) throw new Error('the key is on the page');
    if (!(await page.textContent('#status')).includes('Text messaging is on')) throw new Error('status did not change');
    await page.click('button[aria-label="Clear the saved Telnyx API key"]');
    await page.click('dialog button:has-text("Clear it")');
    await toast('Cleared');
    if ((await page.locator('label[for="k-telnyxApiKey"] .tag').textContent()) !== 'not saved') throw new Error('not cleared');
    await page.check('#note-tollFreeSubmitted');
    await waitStep('Texting number: toll-free verification', 'Waiting on someone else');
    await page.check('#note-tollFreeVerified');
    await waitStep('Texting number: toll-free verification', 'Done');
    await page.check('#rcsEnabled');
    await toast('RCS is switched on');
    await page.uncheck('#rcsEnabled');
    await toast('RCS is switched off');
    await noSideways();
  });

  // ----- invitations -----
  await step('invitations: both kinds, the link shown once, cancel', async () => {
    await page.locator(section('invites')).scrollIntoViewIfNeeded();
    await page.fill('#inum', '(732) 555-0142');
    await page.click('button:has-text("Create invitation")');
    await page.waitForSelector('#invites .error:has-text("reserved for fiction")');
    await page.fill('#inum', '(732) 444-0188');
    await page.fill('#inote', 'local test');
    await page.click('button:has-text("Create invitation")');
    await page.waitForSelector('#invites .alert.ok code.copy');
    const link = (await page.textContent('#invites .alert.ok code.copy')).trim();
    if (!/\/app\/\?invite=[A-Za-z0-9_-]{32}$/.test(link)) throw new Error('link: ' + link);
    await page.waitForSelector('#invites ul.list .title:has-text("For one number: local test")');
    await page.check('#r-ikind-signup');
    await page.fill('#iuses', '3');
    await page.click('button:has-text("Create invitation")');
    await page.waitForFunction(old => {
      const c = document.querySelector('#invites .alert.ok code.copy');
      return c && c.textContent.trim() !== old;
    }, link);
    await page.waitForSelector('#invites ul.list li:has-text("Used 0 of 3")');
    const count = await page.locator('#invites ul.list li').count();
    await page.click('#invites ul.list li >> nth=0 >> button:has-text("Cancel")');
    await page.click('dialog button:has-text("Cancel the invitation")');
    await toast('The invitation was cancelled');
    await page.waitForFunction(n => document.querySelectorAll('#invites ul.list li').length === n - 1, count);
  });

  // ----- tools -----
  await step('tools: the test text needs texting; the pages are linked', async () => {
    await page.locator(section('tools')).scrollIntoViewIfNeeded();
    if (!(await page.isDisabled('button:has-text("Send a test text")'))) throw new Error('test text enabled without texting');
    for (const href of ['/', '/help', '/privacy', '/terms', '/sms-opt-in-1.png', '/sms-opt-in-2.png', '/app/']) {
      if ((await page.locator(`#tools a[href$="${href}"]`).count()) === 0) throw new Error('no link to ' + href);
    }
  });

  // ----- the test account -----
  await step('test account: open, reset, delete', async () => {
    await page.locator(section('test')).scrollIntoViewIfNeeded();
    await page.click('button:has-text("Open the test account")');
    await page.waitForURL(/\/app\/$/);
    await page.goto(base + '/admin/#test');
    await page.waitForSelector('#test .tag:has-text("exists")');
    await page.click('#test button:has-text("Reset it")');
    await page.click('dialog button:has-text("Reset it")');
    await toast('The test account was reset');
    await page.click('#test button:has-text("Delete it")');
    await page.click('dialog button:has-text("Delete it")');
    await toast('The test account was deleted');
    await page.waitForSelector('#test .tag:has-text("none")');
  });

  // ----- wide, dark -----
  await step('wide and dark', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await noSideways();
    const navPos = await page.evaluate(() => getComputedStyle(document.querySelector('.console-nav')).position);
    if (navPos !== 'sticky') throw new Error('no side list on a wide screen');
    await page.screenshot({ path: out + '/admin-wide-dark.png', fullPage: true });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ colorScheme: 'light' });
  });

  // ----- sign out -----
  await step('sign out', async () => {
    await page.click('button:has-text("Sign out")');
    await page.waitForSelector('form.login .alert:has-text("You are signed out")');
    const r = await page.evaluate(() => fetch('/api/admin/state').then(x => x.status));
    if (r !== 401) throw new Error('still signed in: ' + r);
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
