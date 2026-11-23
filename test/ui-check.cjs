// Drives the dashboard in a real browser against a locally running app.
//
//   1. printf 'DASHBOARD_PASSWORD=local-test-password\nENCRYPTION_KEY=local-test-key-0123456789abcdef0123456789\n' > .dev.vars
//   2. rm -rf .wrangler/state && npx wrangler dev --port 8799      (in another terminal; a fresh database each time)
//   3. node test/ui-check.cjs /tmp/shots http://127.0.0.1:8799
//
// Needs Playwright with Chromium. Exits 0 when every step passed.
const { chromium } = require('playwright');
const out = process.argv[2];
const base = process.argv[3];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // The browser logs refused requests (wrong password, a repeated entry, a bad phone number,
  // the request after signing out); those refusals are what the steps below check for.
  page.on('console', m => { if (m.type() === 'error' && !/status of 40[01]/.test(m.text())) errors.push('console: ' + m.text()); });
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '-', e.message.split('\n')[0]); errors.push(name); } };

  await page.goto(base + '/');
  await step('login form shown', async () => { await page.waitForSelector('form.login input[type=password]'); });
  await step('wrong password message', async () => {
    await page.fill('#pw', 'nope'); await page.click('button[type=submit]');
    await page.waitForSelector('.alert.bad'); 
    if (!(await page.textContent('.alert.bad')).includes('Wrong password')) throw new Error('no message');
  });
  await step('sign in', async () => {
    await page.fill('#pw', 'local-test-password'); await page.click('button[type=submit]');
    await page.waitForSelector('nav.tabs');
  });
  await step('alerts: no location, settings not confirmed', async () => {
    const t = await page.textContent('#root');
    if (!t.includes('No location is set yet')) throw new Error('missing location alert');
    if (!t.includes('ההגדרות ההלכתיות טרם אושרו')) throw new Error('missing halachic alert');
  });
  await step('choose a location', async () => {
    await page.click('nav.tabs button:has-text("Settings")');
    await page.selectOption('#place', { label: 'Lakewood, NJ' });
    await page.click('button:has-text("Save location")');
    await page.waitForSelector('.toast:has-text("Location saved")');
  });
  await step('today tab shows status and Hebrew date', async () => {
    await page.click('nav.tabs button:has-text("היום")');
    await page.waitForSelector('.status .headline');
    const head = await page.textContent('.status .headline');
    if (head.trim() !== 'טהורה') throw new Error('headline ' + head);
    const today = await page.textContent('header.top .today');
    if (!/תשפ״ז/.test(today)) throw new Error('today ' + today);
  });
  await step('halachic settings: all 11 choices plus nightfall, in Hebrew', async () => {
    await page.click('nav.tabs button:has-text("הגדרות הלכה")');
    const n = await page.locator('form.card fieldset').count();
    if (n !== 12) throw new Error('fieldsets ' + n);
    const text = await page.textContent('form.card');
    for (const s of ['עונה בינונית', 'עונת האור זרוע', 'חשבון וסת ההפלגה', 'ימי המתנה קודם הפסק טהרה', 'צאת הכוכבים', 'יום ל׳ ויום ל״א', 'מנהג חב״ד']) if (!text.includes(s)) throw new Error('missing ' + s);
  });
  await page.screenshot({ path: out + '/halacha.png', fullPage: true });
  await step('change and save halachic settings', async () => {
    await page.locator('label.choice:has-text("אין חוששים")').first().click();
    await page.locator('label.choice:has-text("יום ל׳ בלבד")').click();
    await page.click('button:has-text("שמירה ואישור")');
    await page.waitForSelector('.toast:has-text("ההגדרות נשמרו")');
    const text = await page.textContent('form.card');
    if (!text.includes('נשמר לאחרונה')) throw new Error('not confirmed');
  });
  await step('settings persisted after reload', async () => {
    await page.reload();
    await page.waitForSelector('form.card fieldset');
    const checked = await page.locator('label.choice:has-text("יום ל׳ בלבד") input').isChecked();
    if (!checked) throw new Error('day 30 not checked');
    const t = await page.textContent('#root');
    if (t.includes('טרם אושרו. החישוב')) throw new Error('still unconfirmed');
  });
  await step('record a flow now', async () => {
    await page.click('nav.tabs button:has-text("היום")');
    await page.click('.actions button:has-text("ראייה")');
    await page.waitForSelector('form button:has-text("רישום")');
    await page.click('form button:has-text("רישום")');
    await page.waitForSelector('.toast:has-text("נרשם")');
    const head = await page.textContent('.status .headline');
    if (!head.includes('נדה')) throw new Error('headline ' + head);
    const list = await page.textContent('ul.list');
    if (!list.includes('שבעה נקיים: יום א׳ (משוער)')) throw new Error('no projected days');
    if (!list.includes('הפסק טהרה (עד')) throw new Error('no hefsek');
  });
  await page.screenshot({ path: out + '/today.png', fullPage: true });
  await step('duplicate is refused with a message', async () => {
    await page.click('.actions button:has-text("ראייה")');
    await page.click('form button:has-text("רישום")');
    await page.waitForSelector('.toast.bad:has-text("Already recorded")');
  });
  await step('record a past flow by date and night', async () => {
    await page.click('.actions button:has-text("ראייה")');
    await page.locator('label.choice:has-text("במועד אחר")').click();
    await page.fill('#rec-date', '2026-10-25');
    await page.locator('label.choice:has-text("בלילה")').click();
    await page.click('form button:has-text("רישום")');
    await page.waitForSelector('.toast:has-text("נרשם")');
  });
  await step('log tab lists entries and can delete one', async () => {
    await page.click('nav.tabs button:has-text("רשומות")');
    const before = await page.locator('section.card ul.list li').count();
    if (before < 2) throw new Error('entries ' + before);
    page.once('dialog', d => d.accept());
    await page.locator('button:has-text("מחיקה")').first().click();
    await page.waitForSelector('.toast:has-text("נמחק")');
  });
  await step('settings: add a phone, validation error shown, then saved', async () => {
    await page.click('nav.tabs button:has-text("Settings")');
    await page.click('button:has-text("Add a phone")');
    if (!(await page.locator('button:has-text("Remove this phone")').isVisible())) throw new Error('remove button not visible');
    const box = await page.locator('.phone').first().boundingBox();
    if (box.x < 0 || box.x + box.width > 420) throw new Error('phone block is wider than the screen');
    await page.fill('input[type=tel]', '7325550123');
    await page.click('button:has-text("Save phones")');
    await page.waitForSelector('.toast.bad:has-text("country code")');
    await page.fill('input[type=tel]', '+17325550123');
    await page.click('button:has-text("Save phones")');
    await page.waitForSelector('.toast:has-text("Phones saved")');
  });
  await step('settings: webhook and redirect addresses shown', async () => {
    const t = await page.textContent('#root');
    if (!t.includes('/webhooks/telnyx') || !t.includes('/api/google/callback')) throw new Error('addresses missing');
  });
  await page.screenshot({ path: out + '/settings.png', fullPage: true });
  await step('no horizontal overflow at phone width', async () => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) throw new Error('overflow ' + over);
  });
  await step('sign out returns to the login form', async () => {
    await page.click('button:has-text("Sign out")');
    await page.waitForSelector('form.login');
  });
  await step('API is closed after sign-out', async () => {
    const status = await page.evaluate(async () => (await fetch('/api/state')).status);
    if (status !== 401) throw new Error('status ' + status);
  });
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
