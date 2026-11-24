// Drives the public pages (the landing page, Help, Privacy, Terms) in a real
// browser against a locally running app.
//
//   npx wrangler dev --port 8814 --persist-to <a new empty directory>
//   node test/ui/landing.cjs http://127.0.0.1:8814 [directory for screenshots]
//
// For each page, at 360 px and 1280 px, light and dark: the key content is
// there, no console error or refused request (the Content Security Policy
// reports to the console), no sideways scrolling at 360 px, every link to
// the site itself answers and every link to a place on a page finds it.
// The "By text message only" card is checked against GET /api/public: with
// a texting number it says to text JOIN to it; without one it names no
// number. Needs Playwright with Chromium. Exits 0 when every check passed.
const { chromium } = require('playwright');
const base = (process.argv[2] || 'http://127.0.0.1:8814').replace(/\/$/, '');
const out = process.argv[3] || null;

const PAGES = [
  { path: '/', h1: 'mikvah calendar', phrases: ['How it works', 'Two ways to use it', 'By text message only', 'What encryption does not do', 'It does not rule on halachic questions', 'Message and data rates may apply', 'Reply STOP to stop, HELP for help', 'Recorded: flow Sun Nov 22 by day. Hefsek from Thu Nov 26. 0 to undo.'] },
  { path: '/help', h1: 'Help', phrases: ['On this page', 'Recording by text message', 'Using it by text only', 'MENU', 'JOIN', 'ask your rav'] },
  { path: '/privacy', h1: 'Privacy', phrases: ['On this page', 'What encryption does not do', 'Signing up by text', 'No mobile information is shared with third parties or affiliates for marketing or promotional purposes.', 'Texting JOIN'] },
  { path: '/terms', h1: 'Terms', phrases: ['On this page', 'It is not a rav', 'Message frequency varies', 'Message and data rates may apply', 'STOP', 'START', 'HELP', 'texting JOIN'] },
];

const failures = [];
const fail = (where, message) => failures.push(`${where}: ${message}`);

(async () => {
  const pub = await (await fetch(base + '/api/public')).json();
  const browser = await chromium.launch();
  const checkedLinks = new Map();

  for (const scheme of ['light', 'dark']) {
    for (const width of [360, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
      const page = await context.newPage();
      let errors = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));
      page.on('requestfailed', r => errors.push('request failed: ' + r.url()));

      for (const spec of PAGES) {
        const where = `${spec.path} ${width}px ${scheme}`;
        errors = [];
        const res = await page.goto(base + spec.path);
        if (!res || res.status() !== 200) fail(where, 'status ' + (res && res.status()));
        await page.waitForLoadState('networkidle');

        const h1 = (await page.locator('h1').first().innerText()).trim();
        if (!h1.includes(spec.h1)) fail(where, 'heading: ' + h1);
        const text = (await page.locator('main').textContent()).replace(/\s+/g, ' ');
        for (const phrase of spec.phrases) if (!text.includes(phrase)) fail(where, 'missing: ' + phrase);
        for (const href of ['/', '/help', '/privacy', '/terms', '/app/']) {
          if (spec.path === '/' && href === '/') continue;
          if ((await page.locator(`a[href="${href}"]`).count()) === 0) fail(where, 'no link to ' + href);
        }

        // the stylesheets loaded
        const styled = await page.evaluate(() => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)');
        if (!styled) fail(where, 'the stylesheet did not load');
        if (spec.path !== '/') {
          const max = await page.evaluate(() => getComputedStyle(document.querySelector('main')).maxWidth);
          if (max !== '720px') fail(where, 'main is not the document width: ' + max);
        }

        if (width === 360) {
          const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (sideways > 0) fail(where, `scrolls sideways by ${sideways}px`);
        }

        // links: to the site itself, and to places on the page
        const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
        for (const href of hrefs) {
          if (href.startsWith('#')) {
            const id = decodeURIComponent(href.slice(1));
            if (!(await page.evaluate(i => !!document.getElementById(i), id))) fail(where, 'no place for ' + href);
          } else if (href.startsWith('/')) {
            const [path, hash] = href.split('#');
            if (!checkedLinks.has(path)) checkedLinks.set(path, (await fetch(base + path)).status);
            if (checkedLinks.get(path) !== 200) fail(where, `${href} answers ${checkedLinks.get(path)}`);
            if (hash) {
              const html = await (await fetch(base + path)).text();
              if (!html.includes(`id="${hash}"`)) fail(where, 'no place for ' + href);
            }
          } else if (!/^(mailto:|sms:)/.test(href)) {
            fail(where, 'link to another site: ' + href);
          }
        }

        // nothing from another site
        const foreign = await page.evaluate(() =>
          [...document.querySelectorAll('script[src], link[href], img[src]')].map(e => e.src || e.href).filter(u => !u.startsWith(location.origin)),
        );
        if (foreign.length) fail(where, 'loads from another site: ' + foreign.join(', '));

        if (spec.path === '/') {
          const card = await page.locator('#text-only').innerText();
          if (pub.textingNumber) {
            const digits = pub.textingNumber.replace(/\D/g, '').slice(-10);
            const shown = card.replace(/\D/g, '');
            if (!card.includes('JOIN') || !shown.includes(digits)) fail(where, 'the text-only card does not say to text JOIN to the number: ' + card);
            const sms = await page.locator('#text-only a[href^="sms:"]').getAttribute('href');
            if (!sms || !sms.includes(pub.textingNumber)) fail(where, 'no sms: link to the number');
          } else {
            if (/\d{3}\D{0,2}\d{3}\D?\d{4}/.test(card)) fail(where, 'the text-only card names a number while there is none');
            if (card.includes('Text JOIN')) fail(where, 'the text-only card says to text JOIN while sign-up by text is not offered');
          }
        }

        if (errors.length) fail(where, errors.join('; '));
        if (out) await page.screenshot({ path: `${out}/${spec.path === '/' ? 'home' : spec.path.slice(1)}-${width}-${scheme}.png`, fullPage: true });
      }
      await context.close();
    }
  }
  await browser.close();

  if (failures.length) {
    console.log('FAILED');
    for (const f of failures) console.log('  ' + f);
    process.exit(1);
  }
  console.log(`ok: 4 pages x 2 widths x 2 colour schemes${pub.textingNumber ? ', with a texting number' : ', without a texting number'}`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
