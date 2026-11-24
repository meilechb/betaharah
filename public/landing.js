// The public landing page. Asks the server what the site allows (/api/public)
// and fills in the "By text message only" card and the sign-up note.
// The page reads correctly without this script; nothing here is required.

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

function textOnly(info) {
  const body = document.getElementById('text-only-body');
  const more = document.getElementById('text-only-more');
  if (!body || !more) return;
  more.replaceChildren();
  const number = typeof info.textingNumber === 'string' && info.textingNumber ? info.textingNumber : null;
  if (number) {
    body.textContent = 'No website needed: sign up and keep everything by text message.';
    more.append(
      el('p', { class: 'join-number' }, 'Text ', el('code', {}, 'JOIN'), ' to ', el('span', { class: 'nowrap' }, pretty(number))),
      el(
        'p',
        { class: 'muted small' },
        'Texting JOIN is your request to create an account and to receive the replies. Text ',
        el('code', {}, 'MENU'),
        ' at any time for the list of everything you can do. Reply STOP to stop all texts.',
      ),
      el('div', { class: 'actions' }, el('a', { class: 'button', href: `sms:${number}?body=JOIN` }, 'Text JOIN from this phone')),
    );
  } else if (info.sms) {
    body.textContent = 'Signing up by text message is not open on this site at the moment. Sign up on the website. After that, you can record dates by text from your phone.';
  } else {
    body.textContent = 'Text messaging is not available on this site yet. Everything can be done on the website.';
  }
}

function signupNote(info) {
  const note = document.getElementById('signup-note');
  if (!note) return;
  let text = '';
  if (info.signup === 'invite') text = 'Sign-up is by invitation at the moment. If someone sent you an invitation link, open it to begin.';
  else if (info.signup === 'closed') text = 'Sign-up is closed at the moment. If you have an account, you can sign in.';
  note.textContent = text;
  note.hidden = text === '';
}

function signedIn() {
  for (const id of ['hero-start', 'way-start']) {
    const a = document.getElementById(id);
    if (a) a.textContent = 'Open your calendar';
  }
  const nav = document.getElementById('nav-sign-in');
  if (nav) nav.textContent = 'Your calendar';
}

async function start() {
  let info;
  try {
    const res = await fetch('/api/public', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    info = await res.json();
  } catch {
    return; // the page keeps its general wording
  }
  if (!info || !info.configured) return;
  textOnly(info);
  signupNote(info);
  if (info.signedIn) signedIn();
}

start();
