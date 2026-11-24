// Drives the public pages (the home page, Help, Privacy, Terms) in a real
// browser against a locally running app.
//
//   a .dev.vars with DASHBOARD_PASSWORD=local-test-password (see test/ui-check.cjs)
//   npx wrangler dev --port 8814 --persist-to <a new empty directory>
//   node test/ui/landing.cjs http://127.0.0.1:8814 [directory for screenshots]
//
// The home page, at 360, 768, 1280 and 1600 px, light and dark:
//   - it answers 200, with no console error, page error or refused request
//     (the Content Security Policy reports to the console), and nothing is
//     requested from another origin;
//   - there is exactly one h1, a skip link to #main, and no sideways scrolling;
//   - every link resolves: links to the site answer 200 (and their #place
//     exists), links to places on the page find them, and no link leaves the
//     site except sms: and mailto:;
//   - what the page says about texting matches GET /api/public.
// Then, at 1280 px: the texting lines in both states of /api/public (with a
// texting number and without one, served to the page by the test), the
// signed-in wording, the questions open and close from the keyboard, the page
// with JavaScript turned off, the meta tags and the X-Robots-Tag headers.
// Help, Privacy and Terms still load with their content.
// Donations: nothing about donating shows by default. With ways to give saved
// in the console (through its API, which needs the operator password), the
// line under the questions and the footer link appear and lead to /donate,
// the document pages link it too, the page itself loads at 360, 390 and
// 1280 px in light and dark, and with JavaScript off the home page still says
// nothing about donating. Then they are removed again and /donate is gone.
// Needs Playwright with Chromium. Exits 0 when every check passed.
const { chromium } = require('playwright');
const base = (process.argv[2] || 'http://127.0.0.1:8814').replace(/\/$/, '');
const out = process.argv[3] || null;
const origin = new URL(base).origin;

const failures = [];
const fail = (where, message) => failures.push(`${where}: ${message}`);

const HOME_PHRASES = [
  'Your mikvah calendar, worked out for you',
  'Tap any day to try it.',
  'Prefer texting?',
  'period started today',
  'Text reminders, your way',
  'Signing in with Google',
];
// The home page says what it does for a person; how it is built is on /privacy.
const TECHNICAL = [/AES/, /decrypt/i, /encrypt/i, /Telnyx/, /cookie/i, /\bserver\b/i, /night of Shabbat/];
const FOOTER_PHRASES = ['Message frequency varies', 'Message and data rates may apply', 'Reply STOP to stop, HELP for help', 'It does not give halachic rulings or medical advice'];
const DOCS = [
  { path: '/help', h1: 'Help', phrases: ['On this page', 'Recording by text message', 'Using it by text only', 'Reply: PERIOD, HEFSEK, STATUS, MORE', 'The main options', 'period last night', 'It does not give halachic rulings'] },
  { path: '/privacy', h1: 'Privacy', phrases: ['On this page', 'What encryption does not do', 'Signing up by text', 'No mobile information is shared with third parties or affiliates for marketing or promotional purposes.'] },
  { path: '/terms', h1: 'Terms', phrases: ['On this page', 'It does not give halachic rulings', 'Message frequency varies', 'Message and data rates may apply', 'STOP', 'START', 'HELP'] },
];

const statusCache = new Map();
async function statusOf(path) {
  if (!statusCache.has(path)) statusCache.set(path, (await fetch(base + path, { redirect: 'manual' })).status);
  return statusCache.get(path);
}
const htmlCache = new Map();
async function htmlOf(path) {
  if (!htmlCache.has(path)) htmlCache.set(path, await (await fetch(base + path)).text());
  return htmlCache.get(path);
}

/** Watches a page for errors and for requests to other origins. */
function watch(page) {
  const w = { errors: [], foreign: [] };
  page.on('pageerror', e => w.errors.push('pageerror: ' + e.message));
  page.on('console', m => m.type() === 'error' && w.errors.push('console: ' + m.text()));
  page.on('requestfailed', r => w.errors.push('request failed: ' + r.url()));
  page.on('request', r => {
    const u = r.url();
    if (/^(data|blob):/.test(u)) return;
    if (new URL(u).origin !== origin) w.foreign.push(u);
  });
  return w;
}

/** `external`: links to other sites are allowed (the document pages credit their data sources); the home page has none. */
async function checkLinks(page, where, external = false) {
  // links inside a hidden element are not offered (the Donate links stay hidden until the page exists)
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].filter(a => !a.closest('[hidden]')).map(a => a.getAttribute('href')));
  for (const href of hrefs) {
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      if (!(await page.evaluate(i => !!document.getElementById(i), id))) fail(where, 'no place for ' + href);
    } else if (href.startsWith('/')) {
      const [path, hash] = href.split('#');
      const status = await statusOf(path);
      if (status !== 200) fail(where, `${href} answers ${status}`);
      if (hash && !(await htmlOf(path)).includes(`id="${hash}"`)) fail(where, 'no place for ' + href);
    } else if (!/^(mailto:|sms:)/.test(href) && !(external && /^https:\/\//.test(href))) {
      fail(where, 'link to another site: ' + href);
    }
  }
}

/** What the page shows about texting, checked against an /api/public answer. */
async function checkTexting(page, pub, where) {
  const hero = page.locator('#hero-sms');
  const number = pub.configured && typeof pub.textingNumber === 'string' && pub.textingNumber ? pub.textingNumber : null;
  if (number) {
    const digits = number.replace(/\D/g, '').slice(-10);
    if (!(await hero.isVisible())) fail(where, 'the hero has no "text JOIN" line although there is a texting number');
    else {
      const text = await hero.innerText();
      if (!text.includes('JOIN') || !text.replace(/\D/g, '').includes(digits)) fail(where, 'the hero texting line is wrong: ' + text);
    }
    const href = await page.locator('#hero-sms a[href^="sms:"]').getAttribute('href').catch(() => null);
    if (!href || !href.includes(number)) fail(where, 'no sms: link to the number');
    if (await page.locator('#offline-note').isVisible()) fail(where, 'the "not available" note shows although there is a texting number');
  } else {
    if (await hero.isVisible()) fail(where, 'the hero says to text JOIN while there is no texting number');
    const body = await page.locator('main').innerText();
    if (/\(\d{3}\) \d{3}-\d{4}/.test(body)) fail(where, 'the page names a phone number while there is none');
    if (pub.configured && !(await page.locator('#offline-note').isVisible())) fail(where, 'no note that sign-up by text is not available');
  }
}

/** The donation line and footer link: shown, and leading to /donate, only when `on`; otherwise nothing visible mentions donating. */
async function checkDonate(page, on, where) {
  const visible = await page.locator('#foot-donate').isVisible();
  if (visible !== on) fail(where, `#foot-donate is ${visible ? 'shown' : 'hidden'} while the Donate page ${on ? 'exists' : 'does not exist'}`);
  if (on) {
    if ((await page.locator('#foot-donate').getAttribute('href')) !== '/donate') fail(where, 'the footer link does not lead to /donate');
  } else {
    const shown = await page.evaluate(() => document.body.innerText);
    if (/donat/i.test(shown)) fail(where, 'the page mentions donating while there is no Donate page');
  }
}

async function homeAt(browser, width, scheme, pub) {
  const where = `/ ${width}px ${scheme}`;
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await context.newPage();
  const w = watch(page);
  const res = await page.goto(base + '/');
  if (!res || res.status() !== 200) fail(where, 'status ' + (res && res.status()));
  await page.waitForLoadState('networkidle');

  if ((await page.locator('h1').count()) !== 1) fail(where, 'not exactly one h1');
  const h1 = (await page.locator('h1').innerText()).replace(/\s+/g, ' ');
  if (!h1.includes('mikvah calendar')) fail(where, 'heading: ' + h1);
  if ((await page.locator('a.skip[href="#main"]').count()) !== 1) fail(where, 'no skip link');
  const main = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
  for (const p of HOME_PHRASES) if (!main.includes(p)) fail(where, 'missing: ' + p);
  for (const word of TECHNICAL) if (word.test(main)) fail(where, 'technical wording on the home page: ' + word);
  const foot = (await page.locator('footer').textContent()).replace(/\s+/g, ' ');
  for (const p of FOOTER_PHRASES) if (!foot.includes(p)) fail(where, 'footer missing: ' + p);
  for (const href of ['/help', '/privacy', '/terms', '/app/']) if ((await page.locator(`footer a[href="${href}"]`).count()) === 0) fail(where, 'the footer has no link to ' + href);

  const styled = await page.evaluate(() => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)');
  if (!styled) fail(where, 'the stylesheet did not load');
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (sideways > 0) fail(where, `scrolls sideways by ${sideways}px`);

  await checkLinks(page, where);
  await checkTexting(page, pub, where);
  await checkDonate(page, pub.donate === true, where);

  if (w.errors.length) fail(where, w.errors.join('; '));
  if (w.foreign.length) fail(where, 'requested from another origin: ' + w.foreign.join(', '));
  if (out) {
    await page.evaluate(() => document.querySelectorAll('.reveal-pending').forEach(e => e.classList.add('revealed')));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/home-${width}-${scheme}.png`, fullPage: true });
  }
  await context.close();
}

/** The page with /api/public answered by the test. */
async function homeWith(browser, pub, label) {
  const where = `/ with ${label}`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const w = watch(page);
  await page.route('**/api/public', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pub) }));
  await page.goto(base + '/');
  await page.waitForLoadState('networkidle');
  await checkTexting(page, pub, where);
  await checkLinks(page, where);
  if (pub.signedIn) {
    const nav = await page.locator('#nav-sign-in').innerText();
    if (!/Open my calendar/.test(nav)) fail(where, 'signed in, but the navigation says ' + nav);
    if (await page.locator('#nav-start').isVisible()) fail(where, 'signed in, but "Get started" still shows in the navigation');
  }
  if (pub.signup === 'closed' && !(await page.locator('#signup-note').isVisible())) fail(where, 'no note that sign-up is closed');
  if (w.errors.length) fail(where, w.errors.join('; '));
  await context.close();
}

async function keyboard(browser) {
  const where = '/ keyboard';
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(base + '/');
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement && document.activeElement.className);
  if (!/skip/.test(first || '')) fail(where, 'the first Tab does not reach the skip link');
  await page.waitForSelector('#try-cal button.day');
  const field = page.locator('#try-cal button.day').first();
  await field.focus();
  const focusRing = await field.evaluate(el => {
    el.focus();
    const s = getComputedStyle(el);
    return s.outlineStyle !== 'none' && s.outlineWidth !== '0px';
  });
  if (!focusRing) fail(where, 'the date has no visible focus outline');
  await context.close();
}

async function withoutScript(browser, label = '') {
  const where = '/ without JavaScript' + label;
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, javaScriptEnabled: false });
  const page = await context.newPage();
  const w = watch(page);
  await page.goto(base + '/');
  if ((await page.locator('h1').count()) !== 1) fail(where, 'not exactly one h1');
  const main = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
  for (const p of HOME_PHRASES) if (!main.includes(p)) fail(where, 'missing: ' + p);
  for (const sel of ['#hero-sms', '#offline-note', '#signup-note']) if (await page.locator(sel).isVisible()) fail(where, sel + ' shows an empty line');
  if (!(await page.locator('#hero-start').isVisible())) fail(where, 'no "Start for free"');
  if (!(await page.locator('.month').isVisible())) fail(where, 'the calendar is not shown');
  const opacity = await page.locator('#privacy p').evaluate(el => getComputedStyle(el).opacity);
  if (opacity !== '1') fail(where, 'a section is left invisible');
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (sideways > 0) fail(where, `scrolls sideways by ${sideways}px`);
  // whether or not the Donate page exists, nothing about it shows without the script
  await checkDonate(page, false, where);
  if (w.errors.length) fail(where, w.errors.join('; '));
  await context.close();
}

const PASSWORD = process.env.DASHBOARD_PASSWORD || 'local-test-password';
const DONATE = {
  links: [
    { label: 'PayPal', url: 'https://www.paypal.com/donate/?hosted_button_id=LANDINGTEST' },
    { label: 'Card, through Stripe', url: 'https://buy.stripe.com/test_landing_0123456789abcdefghijklmnopqrstuvwxyz' },
  ],
  note: 'Zelle: give@example.org\nCheques payable to the operator: 1 Main Street, Lakewood, NJ 08701',
};

/** Saves the ways to give through the console's API, as the operator would. */
async function saveDonate(donate) {
  const headers = { 'x-betaharah': '1', 'content-type': 'application/json' };
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers, body: JSON.stringify({ password: PASSWORD }) });
  if (login.status !== 200) throw new Error('could not sign in to the console: ' + login.status);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const state = await (await fetch(base + '/api/admin/state', { headers: { cookie } })).json();
  const saved = await fetch(base + '/api/admin/config', { method: 'PUT', headers: { ...headers, cookie }, body: JSON.stringify({ ...state.config, donate }) });
  if (saved.status !== 200) throw new Error('could not save the ways to give: ' + JSON.stringify(await saved.json()));
  statusCache.clear();
  htmlCache.clear();
}

async function donation(browser) {
  await saveDonate(DONATE);
  const pub = await (await fetch(base + '/api/public')).json();
  if (pub.donate !== true) fail('/api/public', 'does not say donate: true once a way to give is saved');

  // the home page: the line and the footer link, at a phone's width and a computer's
  for (const width of [360, 1280]) {
    const where = `/ with the Donate page, ${width}px`;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const w = watch(page);
    await page.goto(base + '/');
    await page.waitForLoadState('networkidle');
    await checkDonate(page, true, where);
    await checkLinks(page, where);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (sideways > 0) fail(where, `scrolls sideways by ${sideways}px`);
    if (out) {
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.locator('#foot-donate').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await page.locator('footer').screenshot({ path: `${out}/home-donate-footer-${width}-${scheme}.png` });
      }
    }
    // the footer link opens the page
    await page.click('#foot-donate');
    await page.waitForURL(base + '/donate');
    if (!(await page.locator('h1').innerText()).includes('Donate')) fail(where, 'the footer link did not open the Donate page');
    if (w.errors.length) fail(where, w.errors.join('; '));
    await context.close();
  }
  await withoutScript(browser, ', with the Donate page');

  // the document pages link it, in the header and the footer
  for (const path of ['/help', '/privacy', '/terms']) {
    const html = await htmlOf(path);
    if ((html.match(/<a href="\/donate">Donate<\/a>/g) || []).length !== 2) fail(path, 'not linked to /donate in the header and the footer');
  }

  // the page itself
  const res = await fetch(base + '/donate');
  if (res.status !== 200) fail('/donate', 'status ' + res.status);
  if (!/noindex/.test(res.headers.get('x-robots-tag') || '')) fail('/donate', 'not sent with X-Robots-Tag: noindex');
  if (!/form-action 'none'/.test(res.headers.get('content-security-policy') || '')) fail('/donate', 'no Content Security Policy');
  for (const scheme of ['light', 'dark']) {
    for (const width of [360, 390, 1280]) {
      const where = `/donate ${width}px ${scheme}`;
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
      const page = await context.newPage();
      const w = watch(page);
      const r = await page.goto(base + '/donate');
      if (!r || r.status() !== 200) fail(where, 'status ' + (r && r.status()));
      await page.waitForLoadState('networkidle');
      if ((await page.locator('h1').innerText()).trim() !== 'Donate') fail(where, 'heading');
      const text = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
      for (const phrase of ['Betaharah is free.', 'What it costs to run', 'Giving is optional', 'Ways to give', 'Betaharah never sees card or bank details.', 'Cheques payable']) if (!text.includes(phrase)) fail(where, 'missing: ' + phrase);
      const links = await page.$$eval('a.give-link', as => as.map(a => ({ href: a.getAttribute('href'), rel: a.getAttribute('rel'), text: a.textContent })));
      if (links.length !== 2 || links.some((l, i) => l.href !== DONATE.links[i].url || l.rel !== 'noopener noreferrer' || l.text !== DONATE.links[i].label)) fail(where, 'the buttons: ' + JSON.stringify(links));
      if ((await page.locator('form').count()) !== 0) fail(where, 'a form on the page');
      const small = await page.$$eval('a.give-link', as => as.filter(a => a.getBoundingClientRect().height < 44).length);
      if (small) fail(where, 'a button is lower than 44 px');
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (sideways > 0) fail(where, `scrolls sideways by ${sideways}px`);
      if ((await page.evaluate(() => getComputedStyle(document.querySelector('main')).maxWidth)) !== '720px') fail(where, 'main is not the document width');
      await checkLinks(page, where, true);
      if (w.errors.length) fail(where, w.errors.join('; '));
      if (w.foreign.length) fail(where, 'requested from another origin: ' + w.foreign.join(', '));
      if (out) await page.screenshot({ path: `${out}/donate-${width}-${scheme}.png`, fullPage: true });
      await context.close();
    }
  }

  // removed again
  await saveDonate({ links: [], note: '' });
  if ((await statusOf('/donate')) !== 404) fail('/donate', 'still answers after every way to give was removed');
  if ((await (await fetch(base + '/api/public')).json()).donate !== false) fail('/api/public', 'still says donate: true');
  if ((await htmlOf('/help')).includes('/donate')) fail('/help', 'still links to /donate');
}

async function metaAndHeaders() {
  const where = '/ meta and headers';
  const res = await fetch(base + '/');
  const html = await res.text();
  if (/<meta[^>]+name="robots"/i.test(html)) fail(where, 'the home page still has a robots meta tag');
  const robots = res.headers.get('x-robots-tag');
  if (robots && /noindex/i.test(robots)) fail(where, 'the home page is sent with X-Robots-Tag: ' + robots);
  for (const needle of ['<title>', 'name="description"', 'rel="canonical"', 'property="og:title"', 'property="og:description"', 'property="og:image"', 'name="twitter:card"']) {
    if (!html.includes(needle)) fail(where, 'missing ' + needle);
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) fail(where, 'an inline script');
  if (/\sstyle="/i.test(html) || /<style/i.test(html)) fail(where, 'an inline style');
  const image = /property="og:image" content="([^"]+)"/.exec(html);
  if (image) {
    const path = new URL(image[1]).pathname;
    const img = await fetch(base + path);
    if (img.status !== 200) fail(where, 'the share image does not load: ' + path);
    else if (!/^image\/(png|jpeg)$/.test(img.headers.get('content-type') || '')) fail(where, 'the share image is not a PNG or JPEG: ' + img.headers.get('content-type'));
    const typeTag = /property="og:image:type" content="([^"]+)"/.exec(html);
    if (!typeTag || typeTag[1] !== img.headers.get('content-type')) fail(where, 'og:image:type does not match the image');
    if (/noindex/i.test(img.headers.get('x-robots-tag') || '')) fail(where, 'the share image is sent with noindex');
    const tw = /name="twitter:image" content="([^"]+)"/.exec(html);
    if (!tw || tw[1] !== image[1]) fail(where, 'twitter:image differs from og:image');
  }
  for (const path of ['/app/', '/admin/', '/help', '/site.css']) {
    const tag = (await fetch(base + path)).headers.get('x-robots-tag') || '';
    if (!/noindex/i.test(tag)) fail(where, `${path} is no longer sent with X-Robots-Tag: noindex`);
  }
  // Privacy and Terms may be indexed (Google's sign-in review reads them), so they carry no noindex.
  for (const path of ['/privacy', '/terms']) {
    const tag = (await fetch(base + path)).headers.get('x-robots-tag') || '';
    if (/noindex/i.test(tag)) fail(where, `${path} is sent with X-Robots-Tag: ${tag}`);
  }
}

async function docs(browser) {
  for (const scheme of ['light', 'dark']) {
    for (const width of [360, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
      const page = await context.newPage();
      for (const spec of DOCS) {
        const where = `${spec.path} ${width}px ${scheme}`;
        const w = watch(page);
        const res = await page.goto(base + spec.path);
        if (!res || res.status() !== 200) fail(where, 'status ' + (res && res.status()));
        await page.waitForLoadState('networkidle');
        const h1 = (await page.locator('h1').first().innerText()).trim();
        if (!h1.includes(spec.h1)) fail(where, 'heading: ' + h1);
        const text = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
        for (const phrase of spec.phrases) if (!text.includes(phrase)) fail(where, 'missing: ' + phrase);
        const max = await page.evaluate(() => getComputedStyle(document.querySelector('main')).maxWidth);
        if (max !== '720px') fail(where, 'main is not the document width: ' + max);
        if (width === 360) {
          const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (sideways > 0) fail(where, `scrolls sideways by ${sideways}px`);
        }
        await checkLinks(page, where, true);
        if (w.errors.length) fail(where, w.errors.join('; '));
        if (w.foreign.length) fail(where, 'requested from another origin: ' + w.foreign.join(', '));
        page.removeAllListeners();
      }
      await context.close();
    }
  }
}

(async () => {
  const pub = await (await fetch(base + '/api/public')).json();
  const browser = await chromium.launch();

  for (const scheme of ['light', 'dark']) for (const width of [360, 768, 1280, 1600]) await homeAt(browser, width, scheme, pub);

  const sample = { configured: true, signedIn: false, signup: 'open', sms: true, prefixes: ['+1'], contactName: '', contactEmail: '', codeMinutes: 10, resendSeconds: 60 };
  await homeWith(browser, { ...sample, textingNumber: '+18885550100' }, 'a texting number');
  await homeWith(browser, { ...sample, textingNumber: null }, 'no texting number');
  await homeWith(browser, { ...sample, sms: false, textingNumber: null }, 'no text messaging');
  await homeWith(browser, { ...sample, signup: 'closed', textingNumber: null, signedIn: true }, 'sign-up closed, signed in');

  await keyboard(browser);
  await withoutScript(browser);
  await metaAndHeaders();
  await docs(browser);
  await donation(browser);
  await browser.close();

  if (failures.length) {
    console.log('FAILED');
    for (const f of failures) console.log('  ' + f);
    process.exit(1);
  }
  console.log(`ok: home page at 4 widths x 2 colour schemes${pub.textingNumber ? ', with a texting number' : ', without a texting number'}; both texting states; keyboard; no JavaScript; meta and headers; Help, Privacy, Terms; the Donate page and its links, on and off`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
