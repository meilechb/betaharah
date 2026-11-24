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
