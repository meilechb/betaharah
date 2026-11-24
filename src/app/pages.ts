/**
 * The Help, Privacy and Terms pages. They are written by the server so that
 * they can name the person who runs the site, as set in the operator's
 * console. Every value the operator sets goes through escapeHtml.
 */
import { HELP_TEXT } from './commands';
import { ADMIN_EMAIL, googleReady, MAX_MESSAGES_KEPT, MAX_PHONES, MAX_REMOVED_KEPT, PRIVACY_EMAIL, smsReady, type Site } from './model';

export const LAST_UPDATED = 'November 24, 2026';

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** One titled part of a page. `id` is the anchor the table of contents links to. */
interface Section {
  id: string;
  title: string;
  body: string;
}

interface Doc {
  title: string;
  /** Shown under the heading: the page's purpose, in a sentence or two (HTML). */
  intro: string;
  updated?: boolean;
  /** Whether search engines may list the page. Privacy and Terms may: Google's review of the sign-in looks for them. */
  indexable?: boolean;
  sections: Section[];
}

function layout(doc: Doc): string {
  const toc = doc.sections.map(s => `<li><a href="#${s.id}">${s.title}</a></li>`).join('');
  const sections = doc.sections.map(s => `<section id="${s.id}" aria-labelledby="${s.id}-h">\n<h2 id="${s.id}-h">${s.title}</h2>\n${s.body}\n</section>`).join('\n\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${doc.indexable ? 'index,follow' : 'noindex'}">
<title>${escapeHtml(doc.title)} · Betaharah</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/site.css">
<link rel="stylesheet" href="/pages.css">
</head>
<body class="doc-page">
<a class="skip" href="#main">Skip to the content</a>
<header class="site">
  <a class="brand" href="/"><img src="/favicon.svg" alt="" width="28" height="28">Betaharah</a>
  <nav aria-label="Site"><a href="/help">Help</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a class="button" href="/app/">Sign in</a></nav>
</header>
<main class="doc" id="main">
<header class="doc-head">
<h1>${escapeHtml(doc.title)}</h1>
${doc.updated ? `<p class="updated">Last updated ${LAST_UPDATED}</p>` : ''}
<p class="intro">${doc.intro}</p>
</header>
<nav class="toc" aria-labelledby="toc-title">
<p class="toc-title" id="toc-title">On this page</p>
<ol>${toc}</ol>
</nav>
${sections}
<p class="to-top"><a href="#main">Back to the top</a></p>
</main>
<footer class="site"><a href="/">Home</a><a href="/help">Help</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
</body>
</html>
`;
}

/** Who runs the site, as a sentence fragment, and how to reach them. */
function contact(site: Site): { who: string; how: string } {
  const name = site.config.contactName.trim();
  const who = name ? escapeHtml(name) : 'Betaharah';
  const extra = site.config.contactEmail.trim();
  const listed = new Set([PRIVACY_EMAIL, ADMIN_EMAIL]);
  const more = extra && !listed.has(extra) ? ` You can also write to <a href="mailto:${escapeHtml(extra)}">${escapeHtml(extra)}</a>.` : '';
  const how = `Privacy questions: <a href="mailto:${PRIVACY_EMAIL}">${PRIVACY_EMAIL}</a>. The person who runs the site: <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a>.${more}`;
  return { who, how };
}

function textingNumber(site: Site): string | null {
  return smsReady(site) ? (site.secrets.telnyxNumber ?? null) : null;
}

/** The number to text JOIN to, when a person may sign up that way (the same rule as GET /api/public). */
function joinNumber(site: Site): string | null {
  return site.config.textSignup && site.config.signup !== 'closed' ? textingNumber(site) : null;
}

/** A texting number as a link that opens the phone's messages: '+18885550100' is shown as (888) 555-0100. */
function numberLink(number: string, body?: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(number);
  const shown = m ? `(${m[1]}) ${m[2]}-${m[3]}` : number;
  const href = `sms:${number}${body ? `?body=${encodeURIComponent(body)}` : ''}`;
  return `<a class="nowrap" href="${escapeHtml(href)}">${escapeHtml(shown)}</a>`;
}

const COMMANDS: Array<[string, string]> = [
  ['1', 'A flow began now'],
  ['2', 'Hefsek taharah done today'],
  ['3', 'The count of clean days was broken now'],
  ['4', 'Immersed tonight'],
  ['5', 'A stain that makes her niddah was found now'],
  ['9', 'Where things stand'],
  ['0', 'Undo the last entry (within 48 hours)'],
  ['?', 'The list of commands'],
  ['MENU', 'Every other word: location, customs, reminders, phones, calendar link, sign-in link, deleting the account'],
];

export function helpPage(site: Site): string {
  const c = contact(site);
  const number = textingNumber(site);
  const join = joinNumber(site);
  const rows = COMMANDS.map(([code, meaning]) => `  <tr><td><code>${escapeHtml(code)}</code></td><td>${meaning}</td></tr>`).join('\n');
  return layout({
    title: 'Help',
    intro: 'How to start, how to record by text message, and how to see the dates in your calendar.',
    sections: [
      {
        id: 'getting-started',
        title: 'Getting started',
        body: `<ol class="steps">
  ${googleReady(site) ? '<li><strong>Sign in with Google, or with your phone number.</strong> With Google, nothing else is asked. With a phone, you get a six-digit code by text and type it in. If you like, you can also set a password for a phone under Settings.</li>' : '<li><strong>Sign in with your phone number.</strong> You get a six-digit code by text message and type it in. There is nothing else to fill in. If you like, you can also set a password under Settings, and sign in with that.</li>'}
  <li><strong>Choose your location.</strong> Sunrise, sunset and nightfall are calculated for it.</li>
  <li><strong>Review your customs.</strong> Every point on which customs differ is a setting. Until you save them, the calendar uses the stricter option for each. Go over them with your rav.</li>
  <li><strong>Record the most recent dates</strong>: when the last period began, and the hefsek taharah and immersion that followed.</li>
  <li><strong>Optional: put it in your calendar and turn on text reminders</strong>, both under Settings.</li>
</ol>`,
      },
      {
        id: 'by-text',
        title: 'Recording by text message',
        body: `${number ? `<p class="number-line">Text <strong>${numberLink(number)}</strong> from a phone that is on your account.</p>` : '<p class="number-line">Text messaging is not available on this site yet. Everything can be recorded on the website.</p>'}
<table class="commands">
  <caption>Send one of these as a text message</caption>
  <thead><tr><th scope="col">Text</th><th scope="col">Meaning</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
<h3>Saying when it happened</h3>
<ul>
  <li>For <code>1</code>, <code>3</code> and <code>5</code>: <code>1 day</code>, <code>1 night</code>, <code>1 yesterday night</code>, or a clock time such as <code>1 6:40am</code>.</li>
  <li>For <code>2</code> and <code>4</code>: <code>2 yesterday</code>.</li>
  <li>For an earlier date, add it as month/day: <code>1 11/22 night</code>, <code>2 11/26</code>, <code>4 12/3</code>.</li>
</ul>
<p>The short reminder the service sends is: <em>${escapeHtml(HELP_TEXT)}</em></p>
<p>Every text gets a reply saying what was recorded. If a text arrives shortly after sunrise or sunset, the reply says which side it was counted on and how to correct it.</p>`,
      },
      {
        id: 'text-only',
        title: 'Using it by text only',
        body: `<p>An account can be created and used entirely by text message, without the website.</p>
${
  join
    ? `<p class="number-line">To start, text <strong>JOIN</strong> to <strong>${numberLink(join, 'JOIN')}</strong>.</p>`
    : '<p class="number-line">Signing up by text message is not open on this site at the moment. You can sign up on the website.</p>'
}
<ul>
  <li>Texting JOIN counts as your request to create an account and to receive the replies. The replies then ask for your ZIP code and your customs, one question at a time, and for the most recent dates.</li>
  <li>Text <code>MENU</code> at any time for the list of every word you can send. Each word sent alone shows its own options. For example: <code>LOCATION 08701</code> sets the location by ZIP code, <code>CUSTOMS</code> shows and changes the customs, <code>REMINDERS ON</code> turns on reminders for that phone, <code>CALENDAR LINK</code> makes a link for a calendar app, <code>WEB</code> texts a link that signs that phone in on the website once, within 10 minutes, and <code>DELETE ACCOUNT</code> deletes the account after you confirm with YES.</li>
  <li>The digits in the table above work the same way.</li>
  <li><strong>A second phone</strong>: a phone on the account texts <code>ADD</code> and gets a code of eight letters. The other phone then texts <code>JOIN</code> and that code (for example <code>JOIN NRMAAABZ</code>) to the same number, within 7 days.</li>
  <li>Reply <strong>STOP</strong> to stop all texts to your phone, <strong>START</strong> to turn them back on, and <strong>HELP</strong> for a short description.</li>
  <li>The site does not text a number that has not texted it, with two exceptions that a person asks for on the website by entering the number: a sign-in code, and a code to add that phone to an account. Reminders go only to a phone for which they were turned on.</li>
</ul>`,
      },
      {
        id: 'reminders',
        title: 'Reminders',
        body: `<p>Reminders are off until you turn them on for a phone, under Settings or by texting <code>REMINDERS ON</code> from it. You choose which ones each phone receives and when. Nothing is sent on Shabbat or Yom Tov: what falls on those days is sent beforehand, or held until afterwards, or dropped, depending on what it is.</p>
<p>To stop all texts to a phone, reply <strong>STOP</strong>. To turn them back on, reply <strong>START</strong>. Reply <strong>HELP</strong> for a short description. Message frequency varies with your settings. Message and data rates may apply.</p>`,
      },
      {
        id: 'calendar',
        title: 'Seeing it in your calendar',
        body: `<p>There are two ways, both optional.</p>
<ul>
  <li><strong>Google Calendar.</strong> Under Settings, connect Google Calendar. That is separate from signing in. The site creates one new calendar and keeps it up to date within about a minute of each change. It can see and change only that one calendar. To share it with your spouse, share that calendar from Google Calendar.</li>
  <li><strong>A subscription link</strong>, for Apple Calendar, Outlook, or Google Calendar without connecting an account. Under Settings, create the link and add it in your calendar app as a subscribed calendar (in Google Calendar: Other calendars, +, From URL). The calendar app decides how often it looks for changes; Google says it can take up to 12 hours. Anyone who has the link can read the calendar, so treat it like a password. You can replace or remove it at any time.</li>
</ul>
<p>Event titles can be written in words or as symbols only, for a calendar other people may see.</p>`,
      },
      {
        id: 'sharing',
        title: 'Sharing an account',
        body: `<p>Husband and wife can use one account. Under Settings, add the second phone: a code is texted to it, and once it is entered that phone can sign in, record by text and receive its own choice of reminders. By text, a phone on the account texts <code>ADD</code>, and the other phone texts <code>JOIN</code> and the code it got. An account can have up to ${MAX_PHONES} phones.</p>`,
      },
      {
        id: 'terms',
        title: 'English or Hebrew terms',
        body: `<p>The site is in English. Under Settings you can choose whether halachic terms are written in English letters (hefsek taharah) or in Hebrew (<span lang="he">הפסק טהרה</span>). The choice also applies to the calendar events.</p>`,
      },
      {
        id: 'not-a-rav',
        title: 'What this is not',
        body: `<p class="callout">The calendar does arithmetic on the dates you record, by the customs you select. It does not rule on halachic questions. For stains, for anything unclear, when a veset kavua may have been established (the calendar points this out but does not apply it), and for every doubt, ask your rav.</p>`,
      },
      {
        id: 'contact',
        title: 'Contact',
        body: `<p>This site is run by ${c.who}. ${c.how}</p>
<p class="credit">Places for ZIP and postal codes: postal code data from <a href="https://www.geonames.org/">GeoNames</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, shortened and rounded.</p>`,
      },
    ],
  });
}

export function privacyPage(site: Site): string {
  const c = contact(site);
  return layout({
    title: 'Privacy',
    updated: true,
    indexable: true,
    intro: `Betaharah is a free service run by ${c.who}. It has no advertising, no analytics and no tracking. This page says exactly what is kept and who can see it.`,
    sections: [
      {
        id: 'kept',
        title: 'What is kept',
        body: `<ul>
  <li><strong>Your phone number</strong>, if you add one, and the number of any other phone on the account.</li>
  <li><strong>If you sign in with Google:</strong> the email address and name on that Google account, used only to recognize you. The site asks Google for <code>openid</code>, <code>email</code> and <code>profile</code> for sign-in, and nothing else at that step.</li>
  <li><strong>Your settings</strong>: location, customs, reminder choices.</li>
  <li><strong>The dates you record</strong>, and the last ${MAX_REMOVED_KEPT} entries you removed (so that a mistake can be traced).</li>
  <li><strong>The last ${MAX_MESSAGES_KEPT} text messages</strong> between your phones and the service.</li>
  <li><strong>If you set a password</strong>: a salted, keyed hash of it, from which the password cannot be read.</li>
  <li><strong>If you connect Google Calendar</strong>: a token from Google that lets the site manage the one calendar it creates. The only calendar permission asked for is <code>https://www.googleapis.com/auth/calendar.app.created</code>. The site cannot see your other calendars or your contacts.</li>
</ul>
<p>A name or email is kept only when you sign in with Google. A date of birth is never asked for.</p>`,
      },
      {
        id: 'by-text',
        title: 'Signing up by text',
        body: `<p>An account can also be created by texting JOIN to the site's number. Texting JOIN counts as the request to create an account and to receive the replies. A phone joins an existing account by texting JOIN and the code that a phone on that account got by texting ADD. The site does not text a number that has not texted it, except a sign-in code or a code to add a phone that a person asked for on the website by entering that number. What is kept, how it is protected and how it can be deleted are the same as for an account made on the website.</p>`,
      },
      {
        id: 'protected',
        title: 'How it is protected',
        body: `<ul>
  <li>Everything about your account, including the dates, settings, phone numbers, messages and the Google token, is encrypted (AES-256-GCM) before it is written to the database.</li>
  <li>The table used to look up an account by phone number holds only a keyed fingerprint of each number, not the number.</li>
  <li>Reminder texts waiting to be sent are encrypted too.</li>
  <li>Each account can be read only through its own sign-in, a text from one of its own phones, or its own calendar link. One account cannot read another.</li>
  <li>All connections use HTTPS. The only cookie is the one that keeps you signed in.</li>
</ul>
<div class="callout">
<p><strong>What encryption does not do.</strong> The encryption key is held by the server, apart from the database. That protects your data if the database alone is copied or looked through. It does not hide your data from the server itself: the server has to read your dates to work out the calendar and send reminders. The person who operates the site can open an account. The operator's console lists each account's phone numbers, the Google email used to sign in, and the recent text messages (a reply can include a date you recorded). It does not list the stored calendar entries themselves.</p>
</div>`,
      },
      {
        id: 'others',
        title: 'Who else handles it',
        body: `<ul>
  <li><strong>Cloudflare</strong> hosts the site and the database. The database contents are encrypted as described above. Cloudflare handles each request, including your network address, in order to deliver it.</li>
  <li><strong>Telnyx</strong> and the mobile carriers deliver the text messages, so they handle your phone number and the words of each text. If that matters to you, choose the "discreet" wording for reminders, which uses letters and times only.</li>
  <li><strong>Google</strong>, if you sign in with Google or connect a calendar. Sign-in receives the email and name on that account. Connecting a calendar writes the events into a calendar the site creates in your Google account.</li>
</ul>
<p><strong>Limited Use.</strong> Betaharah's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Information received from Google is used only to sign you in and, if you connect it, to keep the one calendar this site creates. It is not sold, not used for advertising, and not used to train a model.</p>
<p>Your information is not sold, rented or given to anyone else. No mobile information is shared with third parties or affiliates for marketing or promotional purposes. Text-message opt-in data and consent are not shared with any third party.</p>`,
      },
      {
        id: 'logs',
        title: 'Logs and limits',
        body: `<p>The server keeps no log of the pages or addresses requested. Errors are logged without any account's data. To stop abuse of sign-in codes, a keyed fingerprint of the network address that asked for a code is kept for up to one hour.</p>`,
      },
      {
        id: 'calendar-link',
        title: 'The calendar link',
        body: `<p>If you create a calendar subscription link, anyone who has that link can read your calendar without signing in. Share it only with your spouse. You can replace or remove the link under Settings; the old one stops working at once.</p>`,
      },
      {
        id: 'your-data',
        title: 'Seeing, taking and deleting your data',
        body: `<p>Under Settings you can download everything kept about your account, and you can delete the account. Deleting removes all of it from the database immediately and withdraws the site's access to your Google calendar (the calendar itself stays in your Google account for you to delete). Cloudflare keeps a restore history of the database for 7 days; after that, deleted data cannot be recovered by anyone.</p>
<p>Replying STOP to a text stops all texts to that phone.</p>`,
      },
      {
        id: 'adults',
        title: 'Adults only',
        body: '<p>This service is for adults.</p>',
      },
      {
        id: 'changes',
        title: 'Changes and contact',
        body: `<p>If this page changes in a way that matters, the change is noted here with a new date. ${c.how}</p>`,
      },
    ],
  });
}

export function termsPage(site: Site): string {
  const c = contact(site);
  return layout({
    title: 'Terms',
    updated: true,
    indexable: true,
    intro: `Betaharah is a free service run by ${c.who}. By using it you agree to the following.`,
    sections: [
      {
        id: 'what-it-does',
        title: 'What it does, and what it does not',
        body: `<ul>
  <li>It calculates dates from what you record, by the customs you select, for the location you choose. If something is recorded wrongly or a setting does not match your custom, the result will be wrong.</li>
  <li><strong>It is not a rav and does not give halachic rulings.</strong> It is an aid for keeping track. Questions about stains, examinations, a veset kavua, or any doubt belong to your rav. Review your settings with your rav.</li>
  <li>Times are astronomical calculations for your location. They can differ by a minute or two from a printed calendar. Do not rely on the last minutes before a time.</li>
  <li>It is not medical advice.</li>
  <li>You are responsible for checking what it shows. Text messages and calendar updates can be late or fail to arrive.</li>
</ul>`,
      },
      {
        id: 'text-messages',
        title: 'Text messages',
        body: `<dl class="terms-list">
  <dt>Program</dt>
  <dd>Betaharah. Sign-in codes when you ask for one; a code to add a phone to an account when someone on that account asks for it on the website; replies to the texts you send; and, only if you turn them on, reminders about the dates in your calendar.</dd>
  <dt>Consent</dt>
  <dd>You ask for a sign-in code by entering your number on the sign-in page. Or you create an account by texting JOIN to the site's number: texting JOIN counts as your request to create an account and to receive the replies. A phone texting JOIN and a code joins the account that made the code. Reminders are off until you turn them on for a phone, on the website or by texting REMINDERS ON. Add only phones whose owners have agreed. Consent to receive texts is not a condition of anything.</dd>
  <dt>Frequency</dt>
  <dd>Message frequency varies with your settings and your calendar.</dd>
  <dt>Cost</dt>
  <dd>The service is free. Message and data rates may apply from your mobile carrier.</dd>
  <dt>Stopping</dt>
  <dd>Reply <strong>STOP</strong> to any text to stop all texts to that phone. Reply <strong>START</strong> to turn them back on. Reply <strong>HELP</strong> for help, or see the <a href="/help">Help page</a>.</dd>
  <dt>Carriers</dt>
  <dd>Carriers are not liable for delayed or undelivered messages.</dd>
  <dt>Privacy</dt>
  <dd>See the <a href="/privacy">Privacy page</a> for how phone numbers are handled.</dd>
</dl>`,
      },
      {
        id: 'account',
        title: 'Your account',
        body: `<ul>
  <li>Use only phone numbers that are yours or whose owner has agreed.</li>
  <li>Keep your sign-in codes, your password and your calendar link to yourself.</li>
  <li>You can delete your account at any time under Settings.</li>
  <li>The operator may limit or remove accounts that abuse the service, and may limit the number of text messages to keep the service free.</li>
</ul>`,
      },
      {
        id: 'warranty',
        title: 'No warranty',
        body: '<p>The service is provided as it is, without any warranty, and may change or stop. To the extent the law allows, the operator is not liable for loss or harm that comes from using it or from relying on what it shows.</p>',
      },
      {
        id: 'contact',
        title: 'Contact',
        body: `<p>${c.how}</p>`,
      },
    ],
  });
}
