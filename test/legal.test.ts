/**
 * The public privacy policy and terms. They are static files, served by
 * the asset layer at /privacy and /terms with no session, so this checks
 * the files rather than the Worker.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');
const privacy = read('public/privacy.html');
const terms = read('public/terms.html');
const home = read('public/index.html');
const dashboard = read('public/app.js');

/** HTML before the first script, which is what a crawler sees without JavaScript. */
const homeBeforeScript = home.slice(0, home.indexOf('<script'));

describe('public legal pages', () => {
  it('the sign-in page links to them in the HTML, before any script', () => {
    expect(homeBeforeScript).toContain('href="/privacy"');
    expect(homeBeforeScript).toContain('href="/terms"');
    expect(home).toContain('noindex');
  });

  it('the privacy policy states what is stored, where, and the Google and Telnyx use', () => {
    expect(privacy).not.toMatch(/noindex/i);
    expect(privacy).not.toContain('/api/login');
    expect(privacy).toContain('https://betaharah.com/privacy');
    expect(privacy).toContain('Cloudflare');
    expect(privacy).toContain('D1');
    expect(privacy).toContain('hefsek taharah');
    expect(privacy).toContain('latitude');
    expect(privacy).toContain('Halachic settings');
    expect(privacy).toContain('https://www.googleapis.com/auth/calendar.app.created');
    expect(privacy).toContain('Google API Services User Data Policy');
    expect(privacy).toContain('Limited Use');
    expect(privacy).toContain('https://developers.google.com/terms/api-services-user-data-policy');
    expect(privacy).toContain('refresh token');
    expect(privacy).toContain('Telnyx');
    expect(privacy).toContain('https://betaharah.com/webhooks/telnyx');
    expect(privacy).toContain('signature');
    expect(privacy).toContain('not sold');
    expect(privacy).toContain('privacy@betaharah.com');
    expect(privacy).toContain('marked removed');
    expect(privacy).toContain('href="/terms"');
  });

  it('the terms page is public, points at the policy, and does not rule', () => {
    expect(terms).not.toMatch(/noindex/i);
    expect(terms).toContain('https://betaharah.com/terms');
    expect(terms).toContain('href="/privacy"');
    expect(terms).toContain('does not pasken');
    expect(terms).toContain('privacy@betaharah.com');
  });

  it('the dashboard tells the operator which URL to give Google', () => {
    expect(dashboard).toContain("location.origin + '/privacy'");
    expect(dashboard).toContain("location.origin + '/terms'");
  });
});
