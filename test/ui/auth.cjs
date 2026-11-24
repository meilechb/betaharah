// Drives the sign-in views and the guided setup in a real browser against a
// locally running app, and takes a screenshot of every screen.
//
//   npx wrangler dev --port 8811 --persist-to <a new empty directory>     (another terminal; a fresh database each time)
//   node test/ui/auth.cjs <directory for screenshots> http://127.0.0.1:8811 [quick]
//
// Runs the whole path five times: 390 px light and dark, 1280 px light and
// dark (with screenshots), and 360 px (checks only). "quick" runs only 390 px light.
// Texting is not set up locally, so stand-in Telnyx keys are saved (P.sms is
// then true) and every request that would send a text is answered here
// instead. Sign-in by code and by link get a real session by opening an
// account through an invitation in the background. Exits 0 when every step passed.
const { chromium } = require('playwright');
const fs = require('fs');

const out = process.argv[2];
const base = process.argv[3];
const quick = process.argv[4] === 'quick';
const ADMIN_PASSWORD = 'local-test-password';
const ACCOUNT_PASSWORD = 'a good long password';
const TEXTING = '+17329990000';
const CONSENT_CODE = 'By asking for a code you agree to receive it by text message at this number. Message and data rates may apply. Reminders are sent only if you turn them on later.';
const CONSENT_REMINDERS =
  'By saving, the owner of this phone agrees to receive the reminders chosen below by text message from Betaharah. Message frequency varies. Message and data rates may apply. Reply STOP to stop, HELP for help.';

fs.mkdirSync(out, { recursive: true });

const isoDaysAgo = n => {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
};

let failures = 0;
// A block of numbers for this run, so that a second run against the same database does not meet its own accounts.
const BLOCK = 1000 + Math.floor(Math.random() * 80) * 100;

async function variant(browser, name, width, scheme, offset, shots) {
  const context = await browser.newContext({ viewport: { width, height: width > 800 ? 900 : 844 }, colorScheme: scheme, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const req = context.request;
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/status of (40[0134]|429|502)/.test(m.text())) errors.push('console: ' + m.text());
  });
  const log = (ok, what, detail) => {
    console.log((ok ? 'ok  ' : 'FAIL') + ' [' + name + '] ' + what + (detail ? ' - ' + detail : ''));
    if (!ok) failures += 1;
  };
  const step = async (what, fn) => {
    try {
      await fn();
      log(true, what);
    } catch (e) {
      log(false, what, e.message.split('\n')[0]);
      await page.screenshot({ path: `${out}/${name}-FAIL-${failures}.png`, fullPage: true }).catch(() => undefined);
      console.log('     the page says:', ((await page.textContent('#root').catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 400));
    }
  };
  const shot = async label => {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) throw new Error(label + ': the page is ' + wide + 'px wider than the screen');
    if (shots) await page.screenshot({ path: `${out}/${name}-${label}.png`, fullPage: true });
  };
  const expectText = async (sel, phrase) => {
    await page.waitForFunction(([s, p]) => [...document.querySelectorAll(s)].some(el => el.textContent.includes(p)), [sel, phrase], { timeout: 8000 });
  };
  const heading = async phrase => expectText('#setup-title, form.login h2', phrase);
  const api = async (method, path, data) => {
    const r = await req.fetch(base + path, { method, data, headers: { 'x-betaharah': '1' } });
    const body = await r.json().catch(() => null);
    if (!r.ok()) throw new Error(method + ' ' + path + ' ' + r.status() + ' ' + JSON.stringify(body));
    return body;
  };
  const number = i => '+1732444' + String(BLOCK + offset * 20 + i);
  const local = n => n.slice(2); // "7324442001"
  /** Opens an account by a setup invitation in the background; the browser then has its session cookie. */
  const openAccount = async n => {
    const { link } = await api('POST', '/api/admin/invites', { kind: 'setup', number: n });
    const code = new URL(link).searchParams.get('invite');
    await api('POST', '/api/auth/setup', { invite: code, number: n, password: ACCOUNT_PASSWORD });
  };
  const signOut = async () => {
    await api('POST', '/api/auth/logout', {});
  };
  const config = async patch => {
    const st = await api('GET', '/api/admin/state');
    await api('PUT', '/api/admin/config', { ...st.config, ...patch });
  };

  // ----- the site: texting "works" (stand-in keys), sign-up open, texting sign-up on -----
  await step('operator settings', async () => {
    await api('POST', '/api/admin/login', { password: ADMIN_PASSWORD });
    await api('PUT', '/api/admin/secrets', { telnyxApiKey: 'stand-in', telnyxPublicKey: 'stand-in', telnyxNumber: TEXTING });
    await config({ signup: 'open', smsEnabled: true, textSignup: true, householdMonthlyLimit: 0, contactName: 'The site owner', contactEmail: 'owner@example.com' });
  });

  // Nothing is ever texted: code requests are answered here.
  let codeRequests = [];
  await page.route('**/api/auth/code', async route => {
    codeRequests.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ json: { ok: true } });
  });
  // A short wait before another code may be asked for, so the countdown can be seen to end.
  await page.route('**/api/public', async route => {
    const r = await route.fetch();
    const json = await r.json();
    await route.fulfill({ response: r, json: { ...json, resendSeconds: 4 } });
  });

  // ----- sign-in: the number -----
  await step('number screen: wording, consent, links, texting sign-up', async () => {
    await page.goto(base + '/app/');
    await heading('Sign in or sign up');
    const t = await page.textContent('form.login');
    if (!t.includes(CONSENT_CODE)) throw new Error('consent wording missing');
    for (const href of ['/terms', '/privacy', '/help']) if ((await page.locator(`form.login a[href="${href}"]`).count()) !== 1) throw new Error('no link to ' + href);
    const aside = await page.textContent('.auth-aside');
    if (!aside.includes('No internet at home? Text JOIN to (732) 999-0000 and set everything up by text.')) throw new Error('aside: ' + aside);
    const input = page.locator('#number');
    if ((await input.getAttribute('inputmode')) !== 'tel' || (await input.getAttribute('autocomplete')) !== 'tel' || (await input.getAttribute('type')) !== 'tel') throw new Error('keyboard attributes');
    if ((await page.evaluate(() => document.activeElement.id)) !== 'number') throw new Error('focus is not on the number');
    await shot('01-number');
  });

  await step('number screen: formats as typed, explains a short number next to the field', async () => {
    await page.locator('#number').pressSequentially('7324440101');
    if ((await page.inputValue('#number')) !== '(732) 444-0101') throw new Error('shown as ' + (await page.inputValue('#number')));
    await page.fill('#number', '+1 732.444.0101');
    await page.locator('#number').blur();
    if ((await page.inputValue('#number')) !== '(732) 444-0101') throw new Error('pasted form shown as ' + (await page.inputValue('#number')));
    await page.fill('#number', '732-444');
    await page.click('button[type=submit]');
    await expectText('.field .error', '10 digits');
    if ((await page.getAttribute('#number', 'aria-invalid')) !== 'true') throw new Error('not marked invalid');
    if ((await page.locator('form.login > .alert.bad').count()) !== 0) throw new Error('a banner was shown');
    await shot('02-number-error');
  });

  const signInNumber = number(1);
  await step('code screen: number shown formatted, countdown, help', async () => {
    codeRequests = [];
    await page.fill('#number', local(signInNumber));
    await page.click('button[type=submit]');
    await heading('Enter the code');
    if (codeRequests.length !== 1 || codeRequests[0].number !== signInNumber) throw new Error('code request: ' + JSON.stringify(codeRequests));
    const t = await page.textContent('form.login');
    const pretty = '(' + local(signInNumber).slice(0, 3) + ') ' + local(signInNumber).slice(3, 6) + '-' + local(signInNumber).slice(6);
    if (!t.includes('If this number can sign in here, a 6-digit code is on its way to ' + pretty + '.')) throw new Error('wording: ' + t.slice(0, 200));
    if (!t.includes('The code works for 10 minutes.')) throw new Error('code lifetime missing');
    if (!/You can ask for a new code in 0:0[1-4]\./.test(t)) throw new Error('countdown missing');
    const code = page.locator('#code');
    if ((await code.getAttribute('autocomplete')) !== 'one-time-code' || (await code.getAttribute('inputmode')) !== 'numeric') throw new Error('code attributes');
    if ((await page.evaluate(() => document.activeElement.id)) !== 'code') throw new Error('focus is not on the code');
    await page.click('details.auth-help summary');
    await expectText('details.auth-help', 'Wait a minute.');
    await expectText('details.auth-help', 'owner@example.com');
    await shot('03-code');
    await page.click('details.auth-help summary');
  });

  let verifies = [];
  await step('code screen: submits by itself at the sixth digit; a wrong code is explained under the field', async () => {
    await page.route('**/api/auth/verify', async route => {
      verifies.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ status: 400, json: { error: 'That code is not right, or it has expired.' } });
    });
    await page.locator('#code').pressSequentially('12345');
    if (verifies.length) throw new Error('submitted early');
    await page.locator('#code').press('6');
    await expectText('.field .error', 'That code is not right, or it has expired.');
    if (verifies.length !== 1 || verifies[0].code !== '123456' || verifies[0].number !== signInNumber) throw new Error('verify: ' + JSON.stringify(verifies));
    await shot('04-code-error');
  });

  await step('code screen: a pasted code with a space works', async () => {
    await page.fill('#code', '987 654');
    await page.waitForFunction(() => document.querySelectorAll('.field .error').length > 0);
    await page.waitForTimeout(300);
    if (verifies.length !== 2 || verifies[1].code !== '987654') throw new Error('verify: ' + JSON.stringify(verifies));
  });

  await step('code screen: after the countdown, a new code can be asked for', async () => {
    await page.waitForSelector('#resend-button', { timeout: 8000 });
    codeRequests = [];
    await page.click('#resend-button');
    await expectText('#resend-status', 'A new code was asked for');
    if (codeRequests.length !== 1) throw new Error('no new request');
    await expectText('.resend', 'You can ask for a new code in');
    await shot('05-code-resent');
  });

  await step('code screen: "Use a different number" goes back with the number kept', async () => {
    await page.click('text=Use a different number');
    await heading('Sign in or sign up');
    if ((await page.inputValue('#number')) === '') throw new Error('the number was lost');
  });

  await step('code sign-in, complete: a new account lands in the guided setup', async () => {
    await page.unroute('**/api/auth/verify');
    await page.route('**/api/auth/verify', async route => {
      await openAccount(signInNumber);
      await route.fulfill({ json: { ok: true, created: true } });
    });
    await page.fill('#number', local(signInNumber));
    await page.click('button[type=submit]');
    await heading('Enter the code');
    await page.locator('#code').pressSequentially('246810');
    await heading('Welcome to Betaharah');
    if (page.url().includes('?')) throw new Error('address: ' + page.url());
    await shot('20-setup-welcome');
    await signOut();
  });

  // ----- sign-in by link -----
  await step('link sign-in: an unknown link is explained, with the normal sign-in below', async () => {
    await page.goto(base + '/app/?k=' + 'z'.repeat(40));
    await expectText('.alert.bad', 'This link has expired or was already used');
    if (page.url().includes('k=')) throw new Error('the token is still in the address');
    if ((await page.locator('#number').count()) !== 1) throw new Error('no sign-in form');
    await shot('06-link-failed');
  });

  await step('link sign-in: a good link signs in', async () => {
    const n = number(2);
    await page.route('**/api/auth/link', async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.token !== 'good-token') return route.fulfill({ status: 400, json: { error: 'no' } });
      await openAccount(n);
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto(base + '/app/?k=good-token');
    await heading('Welcome to Betaharah');
    if (page.url().includes('k=')) throw new Error('the token is still in the address');
    await page.unroute('**/api/auth/link');
    await signOut();
  });

  // ----- password -----
  await step('password sign-in: a wrong password is explained under the field', async () => {
    await page.goto(base + '/app/');
    await page.click('text=Sign in with a password instead');
    await heading('Sign in with a password');
    await page.fill('#number', local(signInNumber));
    await page.fill('#pw', 'not the password');
    await page.click('button[type=submit]');
    await expectText('.field .error', 'Wrong number or password.');
    if ((await page.getAttribute('#pw', 'aria-invalid')) !== 'true') throw new Error('not marked invalid');
    await page.check('#show-pw');
    if ((await page.getAttribute('#pw', 'type')) !== 'text') throw new Error('show password');
    await shot('07-password-error');
  });

  await step('password sign-in: works', async () => {
    await page.fill('#pw', ACCOUNT_PASSWORD);
    await page.click('button[type=submit]');
    await heading('Welcome to Betaharah');
    await signOut();
  });

  // ----- invitations -----
  await step('invitation: a used or unknown one is explained', async () => {
    await page.goto(base + '/app/?invite=' + 'x'.repeat(32));
    await expectText('.alert.bad', 'This invitation link is not valid any more');
    await shot('08-invite-invalid');
  });

  const setupNumber = number(3);
  await step('setup invitation: mistakes shown at the field, then the account opens into the setup', async () => {
    const { link } = await api('POST', '/api/admin/invites', { kind: 'setup', number: setupNumber });
    await page.goto(link.replace(/^https?:\/\/[^/]+/, base));
    await heading('Set up your account');
    await shot('09-invite-setup');
    await page.fill('#number', local(setupNumber));
    await page.fill('#pw1', ACCOUNT_PASSWORD);
    await page.fill('#pw2', 'something else entirely');
    await page.click('button[type=submit]');
    await expectText('.field .error', 'The two passwords are not the same.');
    await page.fill('#pw2', ACCOUNT_PASSWORD);
    await page.click('button[type=submit]');
    await heading('Welcome to Betaharah');
    if (page.url().includes('invite=')) throw new Error('the invitation is still in the address');
  });

  // ----- the guided setup, all the way, on the setup-invitation account -----
  await step('setup: welcome', async () => {
    const t = await page.textContent('.setup');
    if (!t.includes('Step 1 of 7')) throw new Error('stepper');
    await page.click('#setup-start');
    await heading('Where do you live?');
    await shot('21-setup-place');
  });

  await step('setup: location by ZIP code, then today’s sunset is shown', async () => {
    await page.route('**/api/postal/08701', route =>
      route.fulfill({ json: { place: { name: 'Lakewood, NJ 08701', latitude: 40.0821, longitude: -74.2097, timeZone: 'America/New_York', elevation: 16, postal: '08701' } } }),
    );
    await page.fill('#setup-zip', '123');
    await page.click('#setup-zip-go');
    await expectText('.field .error', 'Enter a 5-digit US ZIP code');
    await page.fill('#setup-zip', '08701');
    await page.click('#setup-zip-go');
    await expectText('#setup-chosen', 'Lakewood, NJ 08701');
    await shot('22-setup-place-chosen');
    await page.click('#setup-save-place');
    await heading('Your location is saved');
    await expectText('.setup .alert.ok', 'Today’s sunset there: ');
    const st = (await api('GET', '/api/state')).state;
    if (!st.app.place || st.app.place.name !== 'Lakewood, NJ 08701') throw new Error('not saved');
    await shot('23-setup-place-saved');
    await page.unroute('**/api/postal/08701');
  });

  await step('setup: customs, "keep the stricter defaults" does not confirm them', async () => {
    await page.click('#setup-main');
    await heading('Your customs');
    const t = await page.textContent('.setup-card');
    for (const phrase of ['The calendar follows the customs chosen here.', 'Until they are confirmed, it uses the stricter option of each.', 'They can be changed at any time', 'Go over them with your rav.']) {
      if (!t.includes(phrase)) throw new Error('missing: ' + phrase);
    }
    await shot('24-setup-customs');
    // the English/Hebrew switch works here too, and keeps the focus on itself
    await page.click('#setup-terms-he');
    await expectText('.setup-card', 'הפסק טהרה');
    if ((await page.evaluate(() => document.activeElement.id)) !== 'setup-terms-he') throw new Error('focus lost after switching');
    await shot('24-setup-customs-hebrew');
    await page.click('#setup-terms-en');
    await expectText('.setup-card', 'before the hefsek taharah');
    await page.click('#setup-skip');
    await heading('When did the most recent flow begin?');
    const st = (await api('GET', '/api/state')).state;
    if (st.halachic.confirmedAt !== null) throw new Error('confirmed by "keep defaults"');
  });

  await step('setup: customs, going through them shows the server’s exact texts and confirms on save', async () => {
    await page.click('#setup-back');
    await heading('Your customs');
    await page.click('#setup-main');
    const st = (await api('GET', '/api/state')).state;
    const titles = [];
    for (let part = 1; part <= 4; part += 1) {
      await expectText('.setup-count', 'Customs, part ' + part + ' of 4');
      const legends = await page.$$eval('.setup-card legend', els => els.map(e => e.textContent));
      titles.push(...legends);
      const labels = await page.$$eval('.setup-card .choice > span', els => els.map(e => e.childNodes[0].textContent));
      for (const c of st.halachic.choices) {
        if (legends.includes(c.title)) for (const o of c.options) if (!labels.includes(o.label)) throw new Error('option reworded or missing: ' + o.label);
      }
      await shot('25-setup-customs-part' + part);
      if (part === 1) await page.check('#r-sc-minWaitDays-4');
      if (part < 4) await page.click('#setup-customs-next');
    }
    for (const c of st.halachic.choices) if (!titles.includes(c.title)) throw new Error('choice not shown: ' + c.title);
    if (!titles.includes(st.halachic.tzeitTitle)) throw new Error('nightfall not shown');
    await page.click('#setup-confirm-customs');
    await heading('When did the most recent flow begin?');
    const after = (await api('GET', '/api/state')).state;
    if (!after.halachic.confirmedAt || after.halachic.settings.minWaitDays !== '4') throw new Error('not confirmed or not saved');
  });

  await step('setup: dates, each answer recorded with the server’s confirmation, with Undo', async () => {
    await shot('26-setup-flow');
    await page.click('#sd-record');
    await expectText('.field .error', 'Choose the date.');
    await page.fill('#sd-date', isoDaysAgo(20));
    await page.click('#sd-record');
    await expectText('.setup-error', 'Choose whether it began by day or at night.');
    await page.check('#r-sd-part-day');
    await page.click('#sd-record');
    await heading('Has the hefsek taharah been done since then?');
    await expectText('#sd-recorded', 'Recorded');
    await shot('27-setup-hefsek');
    await page.fill('#sd-date', isoDaysAgo(15));
    await page.click('#sd-record');
    await heading('Has the immersion taken place since then?');
    await page.click('#sd-undo');
    await heading('Has the hefsek taharah been done since then?');
    await expectText('#sd-note', 'That date was removed.');
    await page.fill('#sd-date', isoDaysAgo(15));
    await page.click('#sd-record');
    await heading('Has the immersion taken place since then?');
    await shot('28-setup-immersion');
    await page.fill('#sd-date', isoDaysAgo(8));
    await page.click('#sd-record');
    await heading('Your recent dates');
    await shot('29-setup-dates-summary');
    const st = (await api('GET', '/api/state')).state;
    if (st.entryCount !== 3) throw new Error('entries: ' + st.entryCount);
  });

  await step('setup: dates, the server’s refusal is shown at the field', async () => {
    await page.click('#setup-back');
    await heading('Has the immersion taken place since then?');
    await page.fill('#sd-date', isoDaysAgo(30));
    await page.click('#sd-record');
    await page.waitForSelector('.field .error');
    await shot('30-setup-refusal');
    await page.click('#setup-skip');
    await heading('Your recent dates');
  });

  await step('setup: calendar, a subscription link', async () => {
    await page.click('#setup-main');
    await heading('See the dates in your calendar app');
    await shot('31-setup-calendar');
    await page.click('#sc-link');
    await expectText('code.copy', '/cal/');
    await shot('32-setup-calendar-link');
    await page.click('#setup-main');
  });

  await step('setup: phones, this phone must be confirmed first; the spouse’s phone', async () => {
    await heading('Text reminders to this phone');
    await expectText('.setup-card', 'confirm that it is yours');
    await shot('33-setup-phone-confirm');
    await page.click('#setup-skip');
    await heading('Your spouse’s phone');
    await expectText('.setup-card', 'Add only a phone whose owner has agreed.');
    let calls = 0;
    await page.route('**/api/phones/code', async route => {
      calls += 1;
      if (calls === 1) return route.fulfill({ status: 502, json: { error: 'The code could not be sent. Check the number and try again.' } });
      return route.fulfill({ json: { ok: true, number: number(9) } });
    });
    await page.route('**/api/phones/verify', route => route.fulfill({ status: 400, json: { error: 'That code is not right, or it has expired.' } }));
    await page.fill('#sp-number', local(number(9)));
    await page.click('#sp-send');
    await expectText('.field .error', 'The code could not be sent.');
    await shot('34-setup-spouse-error');
    await page.click('#sp-send');
    await page.waitForSelector('#sp-code');
    await page.locator('#sp-code').pressSequentially('111111');
    await expectText('.field .error', 'That code is not right');
    await shot('35-setup-spouse-code');
    await page.unroute('**/api/phones/code');
    await page.unroute('**/api/phones/verify');
    await page.click('text=Use a different number');
    await page.click('#setup-skip');
  });

  await step('setup: the last screen, the text commands, and into the dashboard', async () => {
    await heading('The setup is finished');
    const rows = await page.$$eval('table.commands tbody tr', trs => trs.map(tr => tr.textContent));
    if (rows.length < 5 || !rows[0].startsWith('1')) throw new Error('commands: ' + rows.join(' | '));
    await expectText('.setup-texting', '(732) 999-0000');
    await shot('36-setup-done');
    await page.click('#setup-finish');
    await page.waitForSelector('[role=tablist]');
    const st = (await api('GET', '/api/state')).state;
    if (!st.account.welcomed) throw new Error('not marked welcomed');
    await shot('37-dashboard');
  });

  await step('setup: reopened from Settings, then left', async () => {
    await page.evaluate(() => import('/app/onboarding.js').then(m => m.openGuidedSetup()));
    await heading('Welcome to Betaharah');
    const done = await page.$$eval('ol.stepper li.done', els => els.length);
    if (done < 4) throw new Error('steps marked done: ' + done);
    await page.click('#setup-leave');
    await page.click('dialog button[type=submit]');
    await page.waitForSelector('[role=tablist]');
    await signOut();
  });

  // ----- reminders on a phone that proved its number -----
  // The local accounts are opened by invitation and have not proved their number (no code can be texted here),
  // so the state is changed on its way to the page to show this phone as proved; the server still checks on saving.
  await step('setup: text reminders with the exact consent wording', async () => {
    await page.route('**/api/state', async route => {
      const r = await route.fetch();
      const json = await r.json();
      json.state.phones = json.state.phones.map(p => (p.me ? { ...p, verified: true } : p));
      await route.fulfill({ response: r, json });
    });
    await page.goto(base + '/app/');
    await page.click('text=Sign in with a password instead');
    await page.fill('#number', local(signInNumber));
    await page.fill('#pw', ACCOUNT_PASSWORD);
    await page.click('button[type=submit]');
    await heading('Welcome to Betaharah');
    await page.click('#setup-start');
    await page.click('#setup-skip'); // location
    await heading('Your customs');
    await page.click('#setup-skip'); // keep defaults
    await heading('Your most recent dates');
    await page.click('#setup-skip'); // dates need a location
    await heading('See the dates in your calendar app');
    await page.click('#setup-skip');
    await heading('Text reminders to this phone');
    const t = await page.textContent('.setup-card');
    if (!t.includes(CONSENT_REMINDERS)) throw new Error('consent wording missing');
    if ((await page.locator('.setup-card input[type=checkbox]').count()) < 3) throw new Error('no reminder choices');
    await shot('38-setup-reminders');
    await page.click('#sp-turn-on');
    await page.waitForSelector('.setup-error');
    await page.unroute('**/api/state');
    await signOut();
  });

  // ----- coming back resumes at the first unfinished step; the ZIP lookup falls back to the list -----
  await step('setup: ZIP codes against the real lookup (unknown, a place without times, Canada), then resume after a reload', async () => {
    const n = number(4);
    await openAccount(n);
    await page.goto(base + '/app/');
    await heading('Welcome to Betaharah');
    await page.click('#setup-start');
    await heading('Where do you live?');
    await page.fill('#setup-zip', '00001');
    await page.click('#setup-zip-go');
    await expectText('.field .error', 'No place was found for that code.');
    await page.fill('#setup-zip', '99501');
    await page.click('#setup-zip-go');
    await expectText('#setup-chosen', 'Anchorage, AK 99501');
    await page.click('#setup-save-place');
    await expectText('.setup-error', 'the times cannot be calculated');
    await expectText('.setup-error', 'The location was not saved.');
    if ((await api('GET', '/api/state')).state.app.place !== null) throw new Error('Anchorage was saved');
    await shot('39-setup-zip-refused');
    await page.fill('#setup-zip', 'h2x 1y4');
    await page.click('#setup-zip-go');
    await expectText('#setup-chosen', 'QC H2X');
    await page.fill('#setup-zip', '08701');
    await page.click('#setup-zip-go');
    await expectText('#setup-chosen', 'Lakewood, NJ 08701');
    await page.click('#setup-save-place');
    await heading('Your location is saved');
    await page.reload();
    await heading('Your customs');
    await signOut();
  });

  // ----- notes: invitation only, closed, texting not available -----
  await step('notes: invitation only; closed; texting not available', async () => {
    await config({ signup: 'invite' });
    await page.goto(base + '/app/');
    await heading('Sign in');
    await expectText('.alert.info', 'New accounts are by invitation only.');
    await shot('10-note-invite-only');
    await config({ signup: 'closed' });
    await page.goto(base + '/app/');
    await expectText('.alert.info', 'New accounts cannot be opened at the moment.');
    if ((await page.locator('.auth-aside').count()) !== 0) throw new Error('texting sign-up offered while closed');
    await shot('11-note-closed');
    await config({ signup: 'open', smsEnabled: false });
    await page.goto(base + '/app/');
    await heading('Sign in with a password');
    await expectText('.alert.info', 'Sign-in by text message is not available yet');
    await shot('12-note-no-texting');
    await config({ signup: 'open', smsEnabled: true });
  });

  log(errors.length === 0, 'no script errors on the page', errors.join(' | '));
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  const runs = quick
    ? [['390-light', 390, 'light', 0, true]]
    : [
        ['390-light', 390, 'light', 0, true],
        ['390-dark', 390, 'dark', 1, true],
        ['1280-light', 1280, 'light', 2, true],
        ['1280-dark', 1280, 'dark', 3, true],
        ['360', 360, 'light', 4, false],
      ];
  for (const r of runs) await variant(browser, ...r);
  await browser.close();
  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
