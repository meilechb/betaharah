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
  // The test account (two phones), with a few texts from its phones; the second phone replies STOP.
  if ((await api('POST', '/api/admin/demo', null, op)).status !== 200) throw new Error('could not open the test account');
  for (const [from, text] of [['(732) 555-0100', '?'], ['(732) 555-0100', 'MENU'], ['(732) 555-0199', 'STOP']]) {
    if ((await api('POST', '/api/admin/simulate', { from, text }, op)).status !== 200) throw new Error('could not text ' + text + ' from the test account');
  }
  const suffix = String(Date.now()).slice(-4).replace(/^0/, '1');
  for (const n of ['21', '22', '23']) {
    const number = '+1732' + suffix.slice(0, 1) + n + suffix.slice(1);
    const inv = await api('POST', '/api/admin/invites', { kind: 'setup', number, days: 7 }, op);
    if (inv.status !== 200) continue;
    await api('POST', '/api/auth/setup', { number, password: 'a good long password', invite: new URL(inv.json.link).searchParams.get('invite') });
  }
  // the console's starting point for the steps below
  const state = (await api('GET', '/api/admin/state', null, op)).json;
  await api('PUT', '/api/admin/config', { ...state.config, signup: 'open', smsEnabled: true, textSignup: false, contactName: '', allowedPrefixes: ['+1'], rcsEnabled: false }, op);
  await api('PUT', '/api/admin/secrets', { telnyxApiKey: '', telnyxPublicKey: '', telnyxNumber: '', rcsAgentId: '', googleClientId: '', googleClientSecret: '' }, op);
  await api('PUT', '/api/admin/notes', { tollFreeSubmitted: false, tollFreeVerified: false, centsPerText: 1 }, op);
}

(async () => {
  await seed();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
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
  /** Opens a page of the console by its address, as the navigation does. */
  const open = async id => {
    await page.evaluate(x => (location.hash = x), id);
    await page.waitForSelector(`.page#${id}`);
  };
  const stepStatus = async key => page.locator(`#overview .setup-card li.step:has(.step-title:text-is("${key}")) .tag`).first().textContent();
  const waitStep = (key, word) =>
    page.waitForFunction(
      ([k, w]) => [...document.querySelectorAll('#overview .setup-card li.step')].some(li => li.querySelector('.step-title').textContent === k && li.querySelector('.tag').textContent === w),
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
    if (!(await page.textContent('.app-bar')).includes('Signed in until')) throw new Error('no session time');
    await noSideways();
  });

  // ----- summary, steps, status -----
  await step('summary, setup steps and status are shown', async () => {
    if ((await page.locator('#overview .stat').count()) !== 4) throw new Error('not four stat tiles');
    if (!/\d+ setup steps? left/.test(await page.textContent('#overview p.lead'))) throw new Error('no summary line');
    if ((await page.locator('#overview .setup-card li.step').count()) !== 9) throw new Error('not nine steps');
    await page.waitForSelector('#overview .empty, #overview svg.chart');
    if ((await stepStatus('Contact details for the public pages')) !== 'Needs you') throw new Error('contact step');
    if (!(await page.textContent('#overview')).includes('Password sign-in and invitations only')) throw new Error('status');
    // on a phone the section switcher changes the page
    await page.selectOption('#section-switch', 'accounts');
    await page.waitForSelector('#page-title:text-is("Accounts")');
    if (!page.url().endsWith('#accounts')) throw new Error('switcher');
    if ((await page.getAttribute('#nav-accounts', 'aria-current')) !== 'page') throw new Error('aria-current');
  });

  // ----- usage -----
  await step('usage: counts, price, chart and table', async () => {
    await open('usage');
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
    await page.click('#usage summary:has-text("Show as a table")');
    await page.waitForSelector('#usage details[open] table');
    await noSideways();
  });

  // ----- accounts -----
  await step('accounts: listed by id and dates, searched, sorted, deleted with DELETE typed', async () => {
    await open('accounts');
    await page.waitForSelector('#accounts table.accounts tbody tr');
    if (!(await page.textContent('#accounts')).includes('The dates people record are encrypted. This console does not show them.')) throw new Error('no privacy note');
    const before = await page.locator('#accounts table.accounts tbody tr').count();
    if (before < 3) throw new Error('only ' + before + ' accounts');
    const id = (await page.textContent('#accounts table.accounts tbody tr >> nth=0 >> .mono')).trim();
    await page.fill('#acc-q', id.slice(2, 9));
    await page.waitForFunction(() => document.querySelectorAll('#accounts table.accounts tbody tr').length === 1);
    await page.fill('#acc-q', '');
    await page.waitForFunction(n => document.querySelectorAll('#accounts table.accounts tbody tr').length === n, before);
    await page.selectOption('#acc-sort', 'oldest');
    await page.waitForFunction(i => document.querySelector('#accounts table.accounts tbody tr:last-child .mono').textContent.trim() === i, id);
    await page.selectOption('#acc-sort', 'newest');
    await page.waitForFunction(i => document.querySelector('#accounts table.accounts tbody tr:first-child .mono').textContent.trim() === i, id);
    await page.click('#accounts table.accounts tbody tr >> nth=0 >> button:has-text("Delete")');
    await page.waitForSelector('dialog[open] h2:has-text("Delete this account")');
    await page.fill('dialog input', 'delete');
    await page.click('dialog button[type=submit]');
    await page.waitForSelector('dialog .error:has-text("Nothing has been deleted")');
    await page.fill('dialog input', 'DELETE');
    await page.click('dialog button[type=submit]');
    await toast('The account was deleted');
    await page.waitForFunction(n => document.querySelectorAll('#accounts table.accounts tbody tr').length === n - 1, before);
    await noSideways();
  });

  // ----- one account -----
  await step('accounts: one account opened, its phones and texts, no recorded dates, Back, not found', async () => {
    await open('accounts');
    await page.waitForSelector('#accounts table.accounts tbody tr');
    const testRow = page.locator('#accounts table.accounts tbody tr:has(.tag:text-is("test account"))');
    const testId = (await testRow.locator('.mono').textContent()).trim();
    // the id is a link, and Open goes to the same address
    if ((await testRow.locator('a.mono').getAttribute('href')) !== '#accounts/' + testId) throw new Error('the id is not a link');
    const [res] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/admin/accounts/' + testId)), testRow.locator('a:has-text("Open")').click()]);
    if (res.status() !== 200) throw new Error('status ' + res.status());
    await page.waitForSelector('#page-title:text-is("One account")');
    if (!page.url().endsWith('#accounts/' + testId)) throw new Error('address: ' + page.url());
    await page.waitForSelector('#accounts ul.phones > li');
    const phones = page.locator('#accounts ul.phones > li');
    if ((await phones.count()) !== 2) throw new Error('not two phones');
    const first = await phones.nth(0).textContent();
    const second = await phones.nth(1).textContent();
    for (const w of ['(732) 555-0100', 'Verified', 'Reminders agreed', 'No STOP']) if (!first.includes(w)) throw new Error('first phone: no "' + w + '"');
    for (const w of ['(732) 555-0199', 'Replied STOP']) if (!second.includes(w)) throw new Error('second phone: no "' + w + '"');
    // every fact has an icon next to its words
    if ((await page.locator('#accounts ul.flags li.flag svg').count()) !== 6) throw new Error('facts without icons');
    if (!(await page.textContent('#accounts')).includes('Not used.')) throw new Error('no Google line');
    const texts = page.locator('#accounts ul.messages > li');
    if ((await texts.count()) < 5) throw new Error('only ' + (await texts.count()) + ' texts');
    const newest = await texts.nth(0).textContent();
    if (!newest.includes('Received from the phone ending 0199') || !newest.includes('STOP') || !newest.includes('Status: simulated')) throw new Error('newest text: ' + newest);
    if ((await texts.locator('.title:has-text("Sent to the phone ending 0100")').count()) < 2) throw new Error('no sent texts');
    // no recorded date: apart from the texts themselves, no date appears on the page
    const rest = await page.evaluate(() => {
      const copy = document.querySelector('.page#accounts').cloneNode(true);
      copy.querySelectorAll('ul.messages').forEach(n => n.remove());
      return copy.textContent;
    });
    if (!rest.includes('Recorded dates, customs and settings are not shown.')) throw new Error('no sentence about the dates');
    if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}\b|\b\d{1,2}\/\d{1,2}\b|\b20\d\d-\d\d-\d\d\b/.test(rest)) throw new Error('a date appears outside the texts');
    await noSideways();
    // Back returns to the list
    await page.goBack();
    await page.waitForSelector('#page-title:text-is("Accounts")');
    await page.waitForSelector('#accounts table.accounts tbody tr');
    if (!page.url().endsWith('#accounts')) throw new Error('back: ' + page.url());
    // the row opens by keyboard too
    await page.focus('#accounts table.accounts tbody tr:has(.tag:text-is("test account")) a.mono');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#page-title:text-is("One account")');
    await page.waitForSelector('#accounts ul.phones > li');
    await page.click('#accounts p.back a');
    await page.waitForSelector('#accounts table.accounts tbody tr');
    // a made-up id shows the server's message
    await page.evaluate(() => (location.hash = 'accounts/noSuchAccount123'));
    await page.waitForSelector('#accounts .alert.bad:has-text("This account no longer exists, or it cannot be read.")');
    await page.click('#accounts p.back a');
    await page.waitForSelector('#accounts table.accounts tbody tr');
  });

  await step('accounts: an account that signs in with Google (response rewritten)', async () => {
    await page.route('**/api/admin/accounts/googleExample1', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          account: { id: 'googleExample1', test: false, phones: [{ number: '+17325550142', verified: false, texts: false, optedOut: false }], googleEmail: 'someone@example.com', googleName: 'Example Person', messages: [] },
        }),
      }),
    );
    await page.evaluate(() => (location.hash = 'accounts/googleExample1'));
    await page.waitForSelector('#accounts dl.facts dd:text-is("someone@example.com")');
    await page.waitForSelector('#accounts dl.facts dd:text-is("Example Person")');
    const phone = await page.textContent('#accounts ul.phones > li');
    for (const w of ['Not verified', 'Reminders not agreed', 'No STOP']) if (!phone.includes(w)) throw new Error('phone: no "' + w + '"');
    await page.waitForSelector('#accounts p:has-text("No texts to or from this account")');
    await page.unroute('**/api/admin/accounts/googleExample1');
    await page.click('#accounts p.back a');
    await page.waitForSelector('#accounts table.accounts tbody tr');
  });

  await step('accounts: deleted from the opened account', async () => {
    const before = await page.locator('#accounts table.accounts tbody tr').count();
    const row = page.locator('#accounts table.accounts tbody tr:not(:has(.tag:text-is("test account"))) >> nth=0');
    const id = (await row.locator('.mono').textContent()).trim();
    await row.locator('a:has-text("Open")').click();
    await page.waitForSelector('#accounts h2:has-text("Delete this account")');
    if ((await page.locator('#accounts ul.phones > li').count()) !== 1) throw new Error('not one phone');
    await page.click('#accounts button:has-text("Delete this account")');
    await page.waitForSelector('dialog[open] h2:has-text("Delete this account")');
    await page.fill('dialog input', 'DELETE');
    await page.click('dialog button[type=submit]');
    await toast('The account was deleted');
    await page.waitForFunction(() => location.hash === '#accounts');
    await page.waitForFunction(n => document.querySelectorAll('#accounts table.accounts tbody tr').length === n - 1, before);
    if ((await page.locator(`#accounts table.accounts .mono:text-is("${id}")`).count()) !== 0) throw new Error('still listed');
  });

  // ----- settings -----
  await step('sign-up by text: off at first, the simulator says so, the help line points to the guide', async () => {
    await open('settings');
    if (await page.isChecked('#textSignup')) throw new Error('sign-up by text is on');
    const note = await page.textContent('#textSignup-note');
    for (const w of ['Leave it off until the toll-free verification covers signing up by text', 'docs/OPERATOR.md', 'Suggested answers for the toll-free verification form']) if (!note.includes(w)) throw new Error('note: no "' + w + '"');
    if (!(await page.textContent('#settings .caps')).includes('except to HELP and START')) throw new Error('caps: HELP and START');
    await open('simulator');
    await page.waitForSelector('#simulator .alert:has-text("Sign-up by text is off under Site settings.")');
  });

  await step('settings: field errors, a lock-out warning, then saved', async () => {
    await open('settings');
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
    // sign-up by text on, for the simulator below
    await page.check('#textSignup');
    await page.click('button:has-text("Save settings")');
    await toast('Settings saved');
    if ((await page.inputValue('#cname')) !== 'Local Tester') throw new Error('not kept');
    if (!(await page.isChecked('#textSignup'))) throw new Error('sign-up by text not saved');
    await open('overview');
    if ((await stepStatus('Contact details for the public pages')) !== 'Done') throw new Error('contact step not done');
    if ((await stepStatus('Sign-up policy chosen')) !== 'Done') throw new Error('sign-up step not done');
  });

  // ----- donations -----
  await step('donations: no page at first; two links and a note, the field messages, saved, previewed; removed again', async () => {
    const status = async path => (await fetch(base + path)).status;
    const publicDonate = async () => (await (await fetch(base + '/api/public')).json()).donate;
    if ((await status('/donate')) !== 404) throw new Error('/donate exists before anything is saved');
    if ((await publicDonate()) !== false) throw new Error('/api/public says donate before anything is saved');
    await open('settings');
    await page.waitForSelector('#donate-card');
    const intro = await page.textContent('#donate-card');
    for (const w of ['appears once a link or note is saved', 'handled by the linked service', 'No Donate page yet']) if (!intro.includes(w)) throw new Error('card: no "' + w + '"');
    if ((await page.locator('#don-preview').count()) !== 0) throw new Error('a preview link before anything is saved');
    // two rows, filled wrongly first
    await page.click('#don-add');
    if ((await page.evaluate(() => document.activeElement && document.activeElement.id)) !== 'don-label-1') throw new Error('Add a link did not move to the new label');
    await page.fill('#don-label-1', 'PayPal');
    await page.fill('#don-url-1', 'http://www.paypal.com/donate');
    await page.click('#don-add');
    await page.fill('#don-url-2', 'https://me:secret@buy.stripe.com/x');
    await page.fill('#don-note', 'Zelle: give@example.org\nCheques: 1 Main St, Lakewood NJ');
    await page.click('button:has-text("Save settings")');
    await page.waitForSelector('#don-row-1 .error:has-text("must begin with https://")');
    await page.waitForSelector('#don-row-2 .error:has-text("needs a label")');
    await page.waitForSelector('#don-row-2 .error:has-text("must not contain a user name or password")');
    if ((await page.getAttribute('#don-url-1', 'aria-invalid')) !== 'true') throw new Error('the address is not marked invalid');
    if ((await page.evaluate(() => document.activeElement && document.activeElement.id)) !== 'don-url-1') throw new Error('focus is not on the first wrong field');
    if ((await status('/donate')) !== 404) throw new Error('saved although the fields were wrong');
    // a third row, then removed: the add button takes the focus
    await page.click('#don-add');
    await page.click('#don-remove-3');
    if ((await page.locator('#donate-card fieldset.give-row').count()) !== 2) throw new Error('the row was not removed');
    if ((await page.evaluate(() => document.activeElement && document.activeElement.id)) !== 'don-add') throw new Error('focus after removing a row');
    // a message from the server lands beside its field (the page's own check is skipped for this one request)
    await page.fill('#don-url-1', 'https://www.paypal.com/donate/?hosted_button_id=LOCALTEST');
    await page.fill('#don-label-2', 'Card <b>(Stripe)</b>');
    await page.fill('#don-url-2', 'https://buy.stripe.com/test_local');
    await page.route('**/api/admin/config', async route => {
      const body = JSON.parse(route.request().postData());
      body.donate.links[1].url = 'https://buy.stripe.com/a b';
      await route.continue({ postData: JSON.stringify(body) });
    });
    await page.click('button:has-text("Save settings")');
    await page.waitForSelector('#don-row-2 .error:has-text("must not contain spaces")');
    if ((await page.textContent('#don-row-2 .error')).includes('donate.links')) throw new Error('the field name is shown to the operator');
    await page.unroute('**/api/admin/config');
    // (an earlier "Settings saved" toast may still be on screen, so wait for this save's answer and the redraw)
    const [answer] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/admin/config')), page.click('button:has-text("Save settings")')]);
    if (answer.status() !== 200) throw new Error('save answered ' + answer.status());
    await page.waitForSelector('#don-status:has-text("Published")');
    if ((await page.locator('#donate-card .error').count()) !== 0) throw new Error('messages left after saving');
    if ((await status('/donate')) !== 200) throw new Error('/donate does not answer 200 after saving');
    if ((await publicDonate()) !== true) throw new Error('/api/public does not say donate after saving');
    await noSideways();
    // the preview opens the saved page
    const preview = page.locator('#don-preview');
    if ((await preview.getAttribute('href')) !== '/donate') throw new Error('no preview link');
    const [tab] = await Promise.all([context.waitForEvent('page'), preview.click()]);
    await tab.waitForLoadState();
    const buttons = await tab.$$eval('a.give-link', as => as.map(a => [a.textContent, a.getAttribute('href'), a.getAttribute('rel')]));
    if (JSON.stringify(buttons) !== JSON.stringify([['PayPal', 'https://www.paypal.com/donate/?hosted_button_id=LOCALTEST', 'noopener noreferrer'], ['Card <b>(Stripe)</b>', 'https://buy.stripe.com/test_local', 'noopener noreferrer']])) throw new Error('the page shows ' + JSON.stringify(buttons));
    if (!(await tab.textContent('.give-note')).includes('Cheques: 1 Main St, Lakewood NJ')) throw new Error('no note on the page');
    await tab.close();
    if (out) await page.locator('#donate-card').screenshot({ path: out + '/admin-donations-360.png' });
    // removed again: no links and no note, and the page is gone
    await page.click('#don-remove-2');
    await page.click('#don-remove-1');
    await page.fill('#don-note', '');
    await page.click('button:has-text("Save settings")');
    await page.waitForSelector('#don-status:has-text("No Donate page yet")');
    if ((await status('/donate')) !== 404) throw new Error('/donate still answers after removing everything');
    if ((await publicDonate()) !== false) throw new Error('/api/public still says donate');
  });

  // ----- keys -----
  await step('keys: checks without keys, a wrong number, saved, cleared, notes to self, RCS switch', async () => {
    await open('keys');
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
    await open('overview');
    if (!(await page.textContent('#overview')).includes('From (888) 444-0100')) throw new Error('status did not change');
    await open('keys');
    await page.click('button[aria-label="Clear the saved Telnyx API key"]');
    await page.click('dialog button:has-text("Clear it")');
    await toast('Cleared');
    if ((await page.locator('label[for="k-telnyxApiKey"] .tag').textContent()) !== 'not saved') throw new Error('not cleared');
    await page.check('#note-tollFreeSubmitted');
    await toast('Noted');
    await open('overview');
    await waitStep('Texting number: toll-free verification', 'Waiting');
    await open('keys');
    await page.check('#note-tollFreeVerified');
    await page.waitForFunction(() => document.querySelector('#note-tollFreeVerified').checked && !document.querySelector('[aria-busy=true]'));
    await page.waitForTimeout(300);
    await open('overview');
    await waitStep('Texting number: toll-free verification', 'Done');
    await open('keys');
    await page.check('#rcsEnabled');
    await toast('RCS is switched on');
    await page.uncheck('#rcsEnabled');
    await toast('RCS is switched off');
    await noSideways();
  });

  await step('keys: both Google redirect addresses, labelled and copyable', async () => {
    await open('keys');
    const signIn = (await page.textContent('#redirect-signin')).trim();
    const calendar = (await page.textContent('#redirect-calendar')).trim();
    if (!signIn.endsWith('/api/auth/google/callback')) throw new Error('sign-in address: ' + signIn);
    if (!calendar.endsWith('/api/google/callback')) throw new Error('calendar address: ' + calendar);
    if (!(await page.textContent('.redirect:has(#redirect-signin) .redirect-label')).includes('Sign in with Google')) throw new Error('sign-in label');
    if (!(await page.textContent('.redirect:has(#redirect-calendar) .redirect-label')).includes('Google Calendar')) throw new Error('calendar label');
    if (!(await page.textContent('#keys')).includes('Both go on the same OAuth client, as authorized redirect URIs.')) throw new Error('no sentence about the client');
    for (const [label, value] of [['Sign in with Google', signIn], ['Google Calendar', calendar]]) {
      await page.click(`button[aria-label="Copy the ${label} redirect address"]`);
      await toast(`The ${label} redirect address was copied`);
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      if (copied !== value) throw new Error('copied ' + copied);
    }
  });

  // ----- invitations -----
  await step('invitations: both kinds, the link shown once, cancel', async () => {
    await open('invites');
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
    // a word for sign-up by text
    await page.check('#r-ikind-word');
    await page.fill('#iword', 'ab');
    await page.click('button:has-text("Create invitation")');
    await page.waitForSelector('#invites .error:has-text("6 to 24 letters")');
    const word = 'Ui' + Date.now().toString(36);
    await page.fill('#iword', word);
    await page.click('button:has-text("Create invitation")');
    await page.waitForSelector(`#invites .alert.ok code.copy:has-text("JOIN ${word.toUpperCase()}")`);
    const count = await page.locator('#invites ul.list li').count();
    await page.click('#invites ul.list li >> nth=0 >> button:has-text("Cancel")');
    await page.click('dialog button:has-text("Cancel the invitation")');
    await toast('The invitation was cancelled');
    await page.waitForFunction(n => document.querySelectorAll('#invites ul.list li').length === n - 1, count);
  });

  // ----- the text simulator -----
  await step('simulator: a complete sign-up by text, then DELETE ACCOUNT', async () => {
    await open('simulator');
    if ((await page.locator('#simulator .alert:has-text("Sign-up by text is off")').count()) !== 0) throw new Error('the note stayed after switching it on');
    // the HELP and START replies as filed (docs/OPERATOR.md)
    const words = await page.textContent('#simulator dl.texting-words');
    if (!words.includes('Betaharah: text ? for commands. Help: admin@betaharah.com. Reply STOP to opt out.')) throw new Error('HELP wording');
    if (!words.includes("Betaharah: you're subscribed to reminder texts. Message frequency varies. Msg&data rates may apply. Reply ? for help, STOP to opt out.")) throw new Error('START wording');
    const n = String(10 + (Date.now() % 80)).padStart(2, '0');
    await page.click('button:has-text("Start over with another number")');
    await page.fill('#sim-from', '(732) 555-01' + n);
    const say = async (text, expect) => {
      const before = await page.locator('#sim-log .sim-msg.site').count();
      await page.fill('#sim-text', text);
      await page.click('.sim-form button[type=submit]');
      await page.waitForFunction(b => document.querySelectorAll('#sim-log .sim-msg.site').length > b, before);
      if (expect) await page.waitForSelector(`#sim-log .sim-msg.site:has-text("${expect}")`);
    };
    await say('JOIN', 'Step 1 of 3');
    await say('08701', 'Lakewood, NJ 08701');
    // the RCS buttons send their text
    const before = await page.locator('#sim-log .sim-msg.site').count();
    await page.click('#sim-log .sim-msg.site:last-child .chip:has-text("A:")');
    await page.waitForFunction(b => document.querySelectorAll('#sim-log .sim-msg.site').length > b, before);
    await page.waitForSelector('#sim-log .sim-msg.me:has-text("A")');
    await say('1 11/19 day', 'Recorded');
    await say('MENU', 'Words:');
    await noSideways();
    await page.screenshot({ path: out + '/admin-simulator.png', fullPage: false });
    await say('DELETE ACCOUNT');
    await say('YES');
    // the account list reloads after the deletion and redraws the page; wait for it before typing
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    await page.fill('#sim-from', '(732) 444-0101');
    await page.fill('#sim-text', 'JOIN');
    await page.click('.sim-form button[type=submit]');
    await page.waitForSelector('#simulator .error:has-text("reserved for fiction")');
    await page.fill('#sim-from', '(732) 555-0150');
  });

  // ----- tools -----
  await step('tools: the test text needs texting; the pages are linked', async () => {
    await open('tools');
    if (!(await page.isDisabled('button:has-text("Send a test text")'))) throw new Error('test text enabled without texting');
    if (!/^Texts sent this month: [\d,]+ of at most [\d,]+\.$/.test((await page.textContent('#month-total')).trim())) throw new Error('no monthly total');    for (const href of ['/', '/help', '/privacy', '/terms', '/sms-opt-in-1.png', '/sms-opt-in-2.png', '/app/']) {
      if ((await page.locator(`#tools a[href$="${href}"]`).count()) === 0) throw new Error('no link to ' + href);
    }
  });

  // ----- the test account -----
  await step('test account: open, reset, delete', async () => {
    await open('test');
    await page.click('button:has-text("Open the test account")');
    await page.waitForURL(/\/app\/$/);
    await page.goto(base + '/admin/#test');
    await page.waitForSelector('.page#test .tag:has-text("exists")');
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
    await open('overview');
    const navPos = await page.evaluate(() => getComputedStyle(document.querySelector('.side-nav')).position);
    if (navPos !== 'sticky') throw new Error('no side navigation on a wide screen');
    await page.click('#nav-usage');
    await page.waitForSelector('#page-title:text-is("Usage and cost")');
    await noSideways();
    await page.click('#nav-accounts');
    await page.waitForSelector('#accounts table.data-table thead th');
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
