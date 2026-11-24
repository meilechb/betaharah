/**
 * Copy and navigation that a visitor can see, checked in the page sources:
 * what was agreed for the sign-in form (the toll-free filing describes it),
 * for Google sign-in, and for finding the way out.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');
const landing = read('public/index.html') + read('public/landing.js');
const auth = read('public/app/auth.js');
const shell = read('public/app/main.js');
const today = read('public/app/views/today.js');
const css = read('public/site.css') + read('public/pages.css');

describe('public copy and the dashboard shell', () => {
  it('the landing page does not claim that no email is kept, and every public page is linked', () => {
    expect(landing).toContain('mikvah calendar');
    expect(landing).not.toMatch(/No name(,| or) (no )?email/i);
    expect(landing).toContain('Signing in with Google');
    for (const href of ['/app/', '/help', '/privacy', '/terms']) expect(landing).toContain(`href="${href}"`);
  });

  it('a signed-in person can leave from the header, and texting is explained on Today', () => {
    expect(shell).toContain("'Sign out'");
    expect(shell).toContain('Back to the home page');
    expect(today).toContain('Text this number');
    expect(today).toContain('Nothing can be calculated until a location is chosen.');
  });

  it('the sign-in form shows the SMS consent next to the phone field, and offers Google only when it is turned on', () => {
    expect(auth).toContain('Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.');
    expect(auth).toContain("href: '/privacy'");
    expect(auth).toContain("href: '/terms'");
    expect(auth).toContain('/api/auth/google/start');
    expect(auth).toMatch(/P\.google/);
  });

  it('the console opens one account at a time, and names both Google redirect addresses', () => {
    expect(read('public/admin/sections/accounts.js')).toContain('/api/admin/accounts/');
    expect(read('public/admin/sections/keys.js')).toContain('signInRedirect');
  });

  it('the tekhelet disc is the icon on every page', () => {
    const svg = read('public/favicon.svg');
    expect(svg).toContain('<circle');
    expect(svg).toContain('#2a3c6e');
    expect(svg).not.toContain('#6e3d45');
    expect(svg).not.toContain('<rect');
    const ico = readFileSync('public/favicon.ico');
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    expect([0, 1, 2].map(i => ico[6 + i * 16])).toEqual([16, 32, 48]);
    const png = (file: string, w: number, h: number): Buffer => {
      const buf = readFileSync(file);
      expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(buf.readUInt32BE(16)).toBe(w);
      expect(buf.readUInt32BE(20)).toBe(h);
      return buf;
    };
    png('public/apple-touch-icon.png', 180, 180);
    png('public/icons/icon-192.png', 192, 192);
    png('public/icons/icon-512.png', 512, 512);
    png('public/icons/icon-maskable-192.png', 192, 192);
    png('public/icons/icon-maskable-512.png', 512, 512);
    png('public/brand/og-1200x630.png', 1200, 630);
    const manifest = JSON.parse(read('public/site.webmanifest'));
    expect(manifest.theme_color).toBe('#2a3c6e');
    expect(manifest.background_color).toBe('#f1ebe0');
    expect(manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`)).toEqual(['192x192 any', '512x512 any', '192x192 maskable', '512x512 maskable']);
    const share = 'https://betaharah.com/brand/og-1200x630.png';
    for (const file of ['public/index.html', 'public/app/index.html', 'public/admin/index.html']) {
      const html = read(file);
      expect(html, file).toContain('href="/favicon.ico"');
      expect(html, file).toContain('href="/favicon.svg"');
      expect(html, file).toContain('href="/apple-touch-icon.png"');
      expect(html, file).toContain('href="/site.webmanifest"');
      expect(html, file).toContain('content="#2a3c6e"');
      expect(html, file).toContain('name="twitter:card" content="summary_large_image"');
      expect(html, file).toContain(share);
    }
    // beside the name: on the home page, the document pages, the app and the console
    expect(read('public/index.html')).toContain('<img class="mark" src="/favicon.svg"');
    expect(read('src/app/pages.ts')).toContain('<img class="mark" src="/favicon.svg"');
    for (const file of ['public/app/main.js', 'public/app/auth.js', 'public/admin/main.js', 'public/admin/signin.js']) expect(read(file), file).toContain("src: '/favicon.svg'");
    // the page's security policy lets the browser load the manifest
    expect(read('public/_headers')).toContain("manifest-src 'self'");
  });

  it('the RCS brand images are the sizes Telnyx asks for', () => {
    const logo = readFileSync('public/brand/logo-224.png');
    const banner = readFileSync('public/brand/banner-1440x448.png');
    for (const buf of [logo, banner]) expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([logo.readUInt32BE(16), logo.readUInt32BE(20)]).toEqual([224, 224]);
    expect(logo.length).toBeLessThan(50 * 1024);
    expect([banner.readUInt32BE(16), banner.readUInt32BE(20)]).toEqual([1440, 448]);
    expect(banner.length).toBeLessThan(200 * 1024);
  });

  it('headings use self-hosted Bellefair and the rest of the text uses Heebo', () => {
    expect(css).toContain("font-family: Bellefair");
    expect(css).toContain("font-family: Heebo");
    expect(css).toContain('font-display: swap');
    expect(css).toContain('U+0590-05FF');
    expect(css).toContain('--font-display: Bellefair, Heebo, system-ui');
    expect(css).toContain('--weight-bold: 600');
    for (const file of ['public/fonts/bellefair-latin.woff2', 'public/fonts/bellefair-hebrew.woff2', 'public/fonts/heebo-latin.woff2', 'public/fonts/heebo-hebrew.woff2']) {
      expect(readFileSync(file).subarray(0, 4).toString('ascii')).toBe('wOF2');
    }
    expect(read('public/index.html')).toContain('rel="preload" href="/fonts/heebo-latin.woff2"');
    expect(read('public/index.html')).not.toContain('fonts.googleapis.com');
    expect(read('public/_headers')).toContain("font-src 'self'");
    expect(read('src/app/index.ts')).toContain("font-src 'self'");
  });

  it('document pages stay a readable measure, and buttons are large enough to tap', () => {
    expect(css).toMatch(/max-width:\s*72[08]px/);
    expect(css).toMatch(/--tap:\s*44px/);
  });
});

/** Every file under a folder, with its path. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('immersion is assumed, never asked about', () => {
  it('no text, page or event asks whether she immersed or says that no immersion is recorded', () => {
    const sources = [...files('src'), ...files('public'), 'docs/TEXTING.md', 'docs/OPERATOR.md'].filter(f => /\.(ts|js|html|md)$/.test(f));
    const asked = [
      /no immersion (is )?recorded/i,
      /immersion not recorded/i,
      /no M recorded/,
      /Reply 4 (after|if)/,
      /If she immersed/i,
      /She immersed (tonight|on the evening)/,
      /Record that \{?immersion/i,
      /mikvah_confirm/,
      /mikvah_not_recorded/,
    ];
    for (const file of sources) {
      // settings.ts maps the old kind of reminder, as stored in accounts saved before, to the new one
      const text = file === join('src', 'app', 'settings.ts') ? read(file).replace(/mikvah_confirm/g, '') : read(file);
      for (const re of asked) expect(re.test(text), `${file}: ${re}`).toBe(false);
    }
  });
});
