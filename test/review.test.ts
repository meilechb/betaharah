/** Copy and navigation that a visitor can see without signing in. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const landing = readFileSync('public/index.html', 'utf8');
const app = readFileSync('public/app/app.js', 'utf8');
const css = readFileSync('public/site.css', 'utf8');

describe('public copy and the dashboard shell', () => {
  it('the landing page does not claim that no email is kept, and every public page is linked', () => {
    expect(landing).toContain('mikvah calendar');
    expect(landing).not.toContain('No name, no email');
    expect(landing).toContain('Signing in with Google');
    for (const href of ['/app/', '/help', '/privacy', '/terms']) expect(landing).toContain(`href="${href}"`);
  });

  it('a signed-in person can leave from the header, and texting is explained on Today', () => {
    expect(app).toContain("class: 'quiet', type: 'button', onclick: signOut }, 'Sign out'");
    expect(app.match(/'Sign out'/g)).toHaveLength(1);
    expect(app).toContain('Text this number');
    expect(app).toContain('Nothing can be calculated until a location is chosen.');
    expect(app).toContain('Back to the home page');
  });

  it('the sign-up form shows the SMS consent next to the phone field, and the console reads the waiting count', () => {
    const admin = readFileSync('public/admin/admin.js', 'utf8');
    expect(app).toContain('Message frequency varies');
    expect(app).toContain('Msg & data rates may apply');
    expect(app).toContain('STOP');
    expect(app).toContain('HELP');
    expect(app).toContain("href: '/privacy'");
    expect(app).toContain("href: '/terms'");
    expect(admin).toContain('t.waiting');
    expect(admin).not.toContain('pendingReminders');
    expect(admin).toContain('S.urls.rcsWebhook');
  });

  it('the wine-disc mark is the icon on every page, and the old rounded mark is gone', () => {
    const svg = readFileSync('public/favicon.svg', 'utf8');
    expect(svg).toContain('<circle');
    expect(svg).toContain('#6e3d45');
    expect(svg).not.toContain('<rect');
    const ico = readFileSync('public/favicon.ico');
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    const sizes = [0, 1, 2].map(i => ico[6 + i * 16]);
    expect(sizes).toEqual([16, 32, 48]);
    const png = (file: string, w: number, h: number) => {
      const buf = readFileSync(file);
      expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(buf.readUInt32BE(16)).toBe(w);
      expect(buf.readUInt32BE(20)).toBe(h);
    };
    png('public/apple-touch-icon.png', 180, 180);
    png('public/icons/icon-192.png', 192, 192);
    png('public/icons/icon-512.png', 512, 512);
    png('public/icons/icon-maskable-192.png', 192, 192);
    png('public/icons/icon-maskable-512.png', 512, 512);
    png('public/brand/og-1200x630.png', 1200, 630);
    const manifest = JSON.parse(readFileSync('public/site.webmanifest', 'utf8'));
    expect(manifest.theme_color).toBe('#6e3d45');
    expect(manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '192x192 maskable',
      '512x512 maskable',
    ]);
    const mark = '<img class="mark" src="/favicon.svg"';
    const share = 'https://betaharah.com/brand/og-1200x630.png';
    for (const file of ['public/index.html', 'public/app/index.html', 'public/admin/index.html']) {
      const html = readFileSync(file, 'utf8');
      expect(html, file).toContain('href="/favicon.ico"');
      expect(html, file).toContain('href="/favicon.svg"');
      expect(html, file).toContain('href="/apple-touch-icon.png"');
      expect(html, file).toContain('href="/site.webmanifest"');
      expect(html, file).toContain('content="#6e3d45"');
      expect(html, file).toContain('name="twitter:card" content="summary_large_image"');
      expect(html, file).toContain(share);
    }
    expect(landing).toContain(mark);
    expect(readFileSync('src/app/pages.ts', 'utf8')).toContain('class="mark"');
    expect(app).toContain("class: 'mark'");
    expect(readFileSync('public/admin/admin.js', 'utf8')).toContain("class: 'mark'");
  });

  it('the RCS brand images are the sizes Telnyx asks for', () => {
    const logo = readFileSync('public/brand/logo-224.png');
    const banner = readFileSync('public/brand/banner-1440x448.png');
    expect(logo.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(logo.readUInt32BE(16)).toBe(224);
    expect(logo.readUInt32BE(20)).toBe(224);
    expect(logo.length).toBeLessThan(50 * 1024);
    expect(banner.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(banner.readUInt32BE(16)).toBe(1440);
    expect(banner.readUInt32BE(20)).toBe(448);
    expect(banner.length).toBeLessThan(200 * 1024);
  });

  it('document pages stay a readable measure, and buttons are large enough to tap', () => {
    expect(css).toMatch(/main\.doc\s*\{[^}]*max-width:\s*720px/);
    expect(css).toContain('min-height: 44px');
  });
});
