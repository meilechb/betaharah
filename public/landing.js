// The public home page. The page is complete without this script; it only:
//  - asks the server what the site allows (GET /api/public) and shows the
//    number to text JOIN to when there is one, or why sign-up is limited;
//  - says "Open my calendar" instead of "Sign in" to someone signed in;
//  - shows the links to the Donate page only when the server says it exists;
//  - draws a line under the navigation once the page is scrolled;
//  - eases sections in as they come into view, without ever hiding them;
//  - turns "Try it" into a calendar the visitor can try (landing-try.js).
import { startTry } from './landing-try.js';

/** '+18885550100' -> '(888) 555-0100'; other numbers are shown as they are. */
function pretty(number) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : number;
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

const byId = id => document.getElementById(id);

function show(id, ...children) {
  const node = byId(id);
  if (!node) return;
  node.replaceChildren(...children);
  node.hidden = children.length === 0;
}

function smsLink(number, label) {
  return el('a', { href: `sms:${number}?body=JOIN` }, label || pretty(number));
}

function texting(info) {
  const number = typeof info.textingNumber === 'string' && info.textingNumber ? info.textingNumber : null;
  if (number) {
    show('hero-sms', 'No app needed. Text ', el('code', {}, 'JOIN'), ' to ', smsLink(number), ' and just tell it what happened, in your own words.');
    show('offline-note');
  } else if (info.sms) {
    show('offline-note', 'Sign up on the website. Then you can text it too.');
  } else {
    show('offline-note', 'Texting is not available yet. Use the website.');
  }
}

function signupNote(info) {
  let text = '';
  if (info.signup === 'invite') text = 'Sign-up is by invitation only.';
  else if (info.signup === 'closed') text = 'Sign-up is closed.';
  if (text) show('signup-note', text);
}

function prefixes(info) {
  const list = Array.isArray(info.prefixes) ? info.prefixes.filter(p => typeof p === 'string' && p) : [];
  if (list.length === 0 || (list.length === 1 && list[0] === '+1')) return;
  const node = byId('prefix-note');
  if (!node) return;
  node.textContent = `Signing up needs a number that begins with ${list.join(' or ')}.`;
  node.hidden = false;
}

function signedIn() {
  for (const id of ['hero-start']) {
    const a = byId(id);
    if (a && a.firstChild) a.firstChild.textContent = 'Open my calendar';
  }
  const nav = byId('nav-sign-in');
  if (nav) nav.textContent = 'Open my calendar';
  const start = byId('nav-start');
  if (start) start.hidden = true;
}

async function fromServer() {
  let info;
  try {
    const res = await fetch('/api/public', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    info = await res.json();
  } catch {
    return; // the page keeps its general wording
  }
  if (!info || !info.configured) return;
  texting(info);
  signupNote(info);
  prefixes(info);
  if (info.signedIn) signedIn();
  if (info.donate === true) donate();
}

/** The footer link stays hidden until the server says the page exists. */
function donate() {
  const node = byId('foot-donate');
  if (node) node.hidden = false;
}

function navLine() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  const update = () => nav.classList.toggle('scrolled', window.scrollY > 8);
  update();
  window.addEventListener('scroll', update, { passive: true });
}

function reveal() {
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const targets = document.querySelectorAll('.section-head, .split > *, .flow-steps > li, .cal-compare > *, .priv-grid > li');
  const io = new IntersectionObserver(
    entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('revealed');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const t of targets) io.observe(t);
}

navLine();
reveal();
fromServer();
startTry();
