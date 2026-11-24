/**
 * The Help, Privacy and Terms pages. They are written by the server so that
 * they can name the person who runs the site, as set in the operator's
 * console.
 */
import { HELP_TEXT } from './commands';
import { ADMIN_EMAIL, MAX_MESSAGES_KEPT, MAX_PHONES, MAX_REMOVED_KEPT, PRIVACY_EMAIL, smsReady, type Site } from './model';

export const LAST_UPDATED = 'November 24, 2026';

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SHARE = 'A free mikvah calendar that works by text message and shows up in your own calendar. Calculated by your customs.';
const SHARE_IMAGE = 'https://betaharah.com/brand/og-1200x630.png';

function layout(title: string, body: string, indexable = false, path = '/'): string {
  const full = `${title} · Betaharah`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${indexable ? 'index,follow' : 'noindex'}">
<title>${escapeHtml(full)}</title>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#6e3d45">
<meta property="og:site_name" content="Betaharah">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(full)}">
<meta property="og:description" content="${escapeHtml(SHARE)}">
<meta property="og:url" content="https://betaharah.com${path}">
<meta property="og:image" content="${SHARE_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(full)}">
<meta name="twitter:description" content="${escapeHtml(SHARE)}">
<meta name="twitter:image" content="${SHARE_IMAGE}">
<link rel="stylesheet" href="/site.css">
</head>
<body>
<header class="site">
  <a class="brand" href="/"><img class="mark" src="/favicon.svg" width="36" height="36" alt="">Betaharah</a>
  <nav><a href="/help">Help</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a class="button" href="/app/">Sign in</a></nav>
</header>
<main class="doc">
${body}
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

export function helpPage(site: Site): string {
  const c = contact(site);
  const number = textingNumber(site);
  return layout(
    'Help',
    `<h1>Help</h1>

<h2>Getting started</h2>
<ol>
  <li><strong>Sign in with Google, or with your phone number.</strong> With Google, nothing else is asked. With a phone, you get a six-digit code by text and type it in. If you like, you can also set a password for a phone under Settings.</li>
  <li><strong>Choose your location.</strong> Sunrise, sunset and nightfall are calculated for it.</li>
  <li><strong>Review your customs.</strong> Every point on which customs differ is a setting. Until you save them, the calendar uses the stricter option for each. Go over them with your rav.</li>
  <li><strong>Record the most recent dates</strong>: when the last period began, and the hefsek taharah and immersion that followed.</li>
  <li><strong>Optional: put it in your calendar and turn on text reminders</strong>, both under Settings.</li>
</ol>

<h2>Recording by text message</h2>
${number ? `<p>Text <strong>${escapeHtml(number)}</strong> from a phone that is on your account.</p>` : '<p>Text messaging is not available on this site yet. Everything can be recorded on the website.</p>'}
<table>
  <tr><th>Text</th><th>Meaning</th></tr>
  <tr><td><code>1</code></td><td>A flow began now</td></tr>
  <tr><td><code>2</code></td><td>Hefsek taharah done today</td></tr>
  <tr><td><code>3</code></td><td>The count of clean days was broken now</td></tr>
  <tr><td><code>4</code></td><td>Immersed tonight</td></tr>
  <tr><td><code>5</code></td><td>A stain that makes her niddah was found now</td></tr>
  <tr><td><code>9</code></td><td>Where things stand</td></tr>
  <tr><td><code>0</code></td><td>Undo the last entry (within 48 hours)</td></tr>
  <tr><td><code>?</code></td><td>The list of commands</td></tr>
</table>
<p>For <code>1</code>, <code>3</code> and <code>5</code> you can add when it happened: <code>1 day</code>, <code>1 night</code>, <code>1 yesterday night</code>, or a clock time such as <code>1 6:40am</code>. For <code>2</code> and <code>4</code> you can add <code>yesterday</code>.</p>
<p>The short reminder the service sends is: <em>${escapeHtml(HELP_TEXT)}</em></p>
<p>Every text gets a reply saying what was recorded. If a text arrives shortly after sunrise or sunset, the reply says which side it was counted on and how to correct it.</p>

<h2>Reminders</h2>
<p>Reminders are off until you turn them on for a phone under Settings. You choose which ones each phone receives and when. Nothing is sent on Shabbat or Yom Tov: what falls on those days is sent beforehand, or held until afterwards, or dropped, depending on what it is.</p>
<p>To stop all texts to a phone, reply <strong>STOP</strong>. To turn them back on, reply <strong>START</strong>. Reply <strong>HELP</strong> for a short description. Message frequency varies with your settings. Message and data rates may apply.</p>

<h2>Seeing it in your calendar</h2>
<p>There are two ways, both optional.</p>
<ul>
  <li><strong>Google Calendar.</strong> Under Settings, connect Google Calendar. That is separate from signing in. The site creates one new calendar and keeps it up to date within about a minute of each change. It can see and change only that one calendar. To share it with your spouse, share that calendar from Google Calendar.</li>
  <li><strong>A subscription link</strong>, for Apple Calendar, Outlook, or Google Calendar without connecting an account. Under Settings, create the link and add it in your calendar app as a subscribed calendar (in Google Calendar: Other calendars, +, From URL). The calendar app decides how often it looks for changes; Google says it can take up to 12 hours. Anyone who has the link can read the calendar, so treat it like a password. You can replace or remove it at any time.</li>
</ul>
<p>Event titles can be written in words or as symbols only, for a calendar other people may see.</p>

<h2>Sharing an account</h2>
<p>Husband and wife can use one account. Under Settings, add the second phone: a code is texted to it, and once it is entered that phone can sign in, record by text and receive its own choice of reminders. An account can have up to ${MAX_PHONES} phones.</p>

<h2>English or Hebrew terms</h2>
<p>The site is in English. Under Settings you can choose whether halachic terms are written in English letters (hefsek taharah) or in Hebrew (הפסק טהרה). The choice also applies to the calendar events.</p>

<h2>What this is not</h2>
<p>The calendar does arithmetic on the dates you record, by the customs you select. It does not rule on halachic questions. For stains, for anything unclear, when a veset kavua may have been established (the calendar points this out but does not apply it), and for every doubt, ask your rav.</p>

<h2>Contact</h2>
<p>This site is run by ${c.who}. ${c.how}</p>`,
    false,
    '/help',
  );
}

export function privacyPage(site: Site): string {
  const c = contact(site);
  return layout(
    'Privacy',
    `<h1>Privacy</h1>
<p class="muted">Last updated ${LAST_UPDATED}</p>
<p>Betaharah is a free tool run by ${c.who} for family and friends. It has no advertising, no analytics and no tracking. This page says exactly what is kept and who can see it.</p>

<h2>What is kept</h2>
<ul>
  <li><strong>Your phone number</strong>, if you add one, and the number of any other phone on the account.</li>
  <li><strong>If you sign in with Google:</strong> the email address and name on that Google account, used only to recognize you. The site asks Google for <code>openid</code>, <code>email</code> and <code>profile</code> for sign-in, and nothing else at that step.</li>
  <li><strong>Your settings</strong>: location, customs, reminder choices.</li>
  <li><strong>The dates you record</strong>, and the last ${MAX_REMOVED_KEPT} entries you removed (so that a mistake can be traced).</li>
  <li><strong>The last ${MAX_MESSAGES_KEPT} text messages</strong> between your phones and the service.</li>
  <li><strong>If you set a password</strong>: a salted, keyed hash of it, from which the password cannot be read.</li>
  <li><strong>If you connect Google Calendar</strong>: a token from Google that lets the site manage the one calendar it creates. The only calendar permission asked for is <code>https://www.googleapis.com/auth/calendar.app.created</code>. The site cannot see your other calendars or your contacts.</li>
</ul>
<p>A name or email is kept only when you sign in with Google. A date of birth is never asked for.</p>

<h2>How it is protected</h2>
<ul>
  <li>Everything about your account, including the dates, settings, phone numbers, messages and the Google token, is encrypted (AES-256-GCM) before it is written to the database.</li>
  <li>The table used to look up an account by phone number holds only a keyed fingerprint of each number, not the number.</li>
  <li>Reminder texts waiting to be sent are encrypted too.</li>
  <li>Each account can be read only through its own sign-in, a text from one of its own phones, or its own calendar link. One account cannot read another.</li>
  <li>All connections use HTTPS. The only cookie is the one that keeps you signed in.</li>
</ul>
<p><strong>What encryption does not do.</strong> The encryption key is held by the server, apart from the database. That protects your data if the database alone is copied or looked through. It does not hide your data from the server itself: the server has to read your dates to work out the calendar and send reminders. The person who operates the site can open an account. The operator's console lists each account's phone numbers, the Google email used to sign in, and the recent text messages (a reply can include a date you recorded). It does not list the stored calendar entries themselves.</p>

<h2>Who else handles it</h2>
<ul>
  <li><strong>Cloudflare</strong> hosts the site and the database. The database contents are encrypted as described above. Cloudflare handles each request, including your network address, in order to deliver it.</li>
  <li><strong>Telnyx</strong> and the mobile carriers deliver the text messages, so they handle your phone number and the words of each text. If that matters to you, choose the "discreet" wording for reminders, which uses letters and times only.</li>
  <li><strong>Google</strong>, if you sign in with Google or connect a calendar. Sign-in receives the email and name on that account. Connecting a calendar writes the events into a calendar the site creates in your Google account.</li>
</ul>
<p><strong>Limited Use.</strong> Betaharah's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Information received from Google is used only to sign you in and, if you connect it, to keep the one calendar this site creates. It is not sold, not used for advertising, and not used to train a model.</p>
<p>Your information is not sold, rented or given to anyone else. No mobile information is shared with third parties or affiliates for marketing or promotional purposes. Text-message opt-in data and consent are not shared with any third party.</p>

<h2>Logs and limits</h2>
<p>The server keeps no log of the pages or addresses requested. Errors are logged without any account's data. To stop abuse of sign-in codes, a keyed fingerprint of the network address that asked for a code is kept for up to one hour.</p>

<h2>The calendar link</h2>
<p>If you create a calendar subscription link, anyone who has that link can read your calendar without signing in. Share it only with your spouse. You can replace or remove the link under Settings; the old one stops working at once.</p>

<h2>Seeing, taking and deleting your data</h2>
<p>Under Settings you can download everything kept about your account, and you can delete the account. Deleting removes all of it from the database immediately and withdraws the site's access to your Google calendar (the calendar itself stays in your Google account for you to delete). Cloudflare keeps a restore history of the database for 7 days; after that, deleted data cannot be recovered by anyone.</p>
<p>Replying STOP to a text stops all texts to that phone.</p>

<h2>Adults only</h2>
<p>This service is for adults.</p>

<h2>Changes and contact</h2>
<p>If this page changes in a way that matters, the change is noted here with a new date. ${c.how}</p>`,
    true,
    '/privacy',
  );
}

export function termsPage(site: Site): string {
  const c = contact(site);
  return layout(
    'Terms',
    `<h1>Terms</h1>
<p class="muted">Last updated ${LAST_UPDATED}</p>
<p>Betaharah is a free tool run by ${c.who} for family and friends. By using it you agree to the following.</p>

<h2>What it does, and what it does not</h2>
<ul>
  <li>It calculates dates from what you record, by the customs you select, for the location you choose. If something is recorded wrongly or a setting does not match your custom, the result will be wrong.</li>
  <li><strong>It is not a rav and does not give halachic rulings.</strong> It is an aid for keeping track. Questions about stains, examinations, a veset kavua, or any doubt belong to your rav. Review your settings with your rav.</li>
  <li>Times are astronomical calculations for your location. They can differ by a minute or two from a printed calendar. Do not rely on the last minutes before a time.</li>
  <li>It is not medical advice.</li>
  <li>You are responsible for checking what it shows. Text messages and calendar updates can be late or fail to arrive.</li>
</ul>

<h2>Text messages</h2>
<ul>
  <li><strong>Program:</strong> Betaharah. Sign-in codes when you ask for one; replies to the commands you text; and, only if you turn them on, reminders about the dates in your calendar.</li>
  <li><strong>Consent:</strong> you ask for a sign-in code by entering your number on the sign-in page. Reminders are off until you turn them on for a phone under Settings. Add only phones whose owners have agreed. Consent to receive texts is not a condition of anything.</li>
  <li><strong>Frequency:</strong> message frequency varies with your settings and your calendar.</li>
  <li><strong>Cost:</strong> the service is free. Message and data rates may apply from your mobile carrier.</li>
  <li><strong>Stopping:</strong> reply <strong>STOP</strong> to any text to stop all texts to that phone. Reply <strong>START</strong> to turn them back on. Reply <strong>HELP</strong> for help, or see the <a href="/help">Help page</a>.</li>
  <li>Carriers are not liable for delayed or undelivered messages.</li>
  <li>See the <a href="/privacy">Privacy page</a> for how phone numbers are handled.</li>
</ul>

<h2>Your account</h2>
<ul>
  <li>Use only phone numbers that are yours or whose owner has agreed.</li>
  <li>Keep your sign-in codes, your password and your calendar link to yourself.</li>
  <li>You can delete your account at any time under Settings.</li>
  <li>The operator may limit or remove accounts that abuse the service, and may limit the number of text messages to keep the service free.</li>
</ul>

<h2>No warranty</h2>
<p>The service is provided as it is, without any warranty, and may change or stop. To the extent the law allows, the operator is not liable for loss or harm that comes from using it or from relying on what it shows.</p>

<h2>Contact</h2>
<p>${c.how}</p>`,
    true,
    '/terms',
  );
}
