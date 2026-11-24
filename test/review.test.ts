/**
 * Copy and navigation that a visitor can see, checked in the page sources:
 * what was agreed for the sign-in form (the toll-free filing describes it),
 * for Google sign-in, and for finding the way out.
 */
import { readFileSync } from 'node:fs';
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

  it('document pages stay a readable measure, and buttons are large enough to tap', () => {
    expect(css).toMatch(/max-width:\s*72[08]px/);
    expect(css).toMatch(/--tap:\s*44px/);
  });
});
