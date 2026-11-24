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

  it('document pages stay a readable measure, and buttons are large enough to tap', () => {
    expect(css).toMatch(/main\.doc\s*\{[^}]*max-width:\s*720px/);
    expect(css).toContain('min-height: 44px');
  });
});
