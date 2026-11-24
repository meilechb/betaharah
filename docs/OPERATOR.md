# Running the site

For the person who operates betaharah.com.

## What is already in place

- The Worker deploys itself from the `main` branch of this repository
  (Cloudflare → Workers & Pages → betaharah → Settings → Builds).
- Two secrets are set on the Worker: `DASHBOARD_PASSWORD` (now the password
  of the operator's console) and `ENCRYPTION_KEY`.
  **Do not change `ENCRYPTION_KEY`.** Every account's data is encrypted with
  it. If it is changed or lost, no account can be read again.
- The database creates its own tables the first time the Worker runs.

## The operator's console

Open **https://betaharah.com/admin/** and sign in with `DASHBOARD_PASSWORD`.
It lists accounts, their phone numbers, the Google email used to sign in, and recent texts. It does not list the stored dates. There you:

1. **Set the contact** shown on the Help, Privacy and Terms pages (a name,
   and an email address if you want one public).
2. **Choose who may sign up**: anyone, by invitation, or nobody.
3. **Enter the keys** for Telnyx and, optionally, Google.
4. **Make invitations.**
5. **Delete an account** if someone asks and cannot do it themselves.

## Before text messaging works

Sign-in is by texted code, so until Telnyx has verified the number nobody
can sign up on their own. In the meantime you can create accounts yourself:

1. In the console, under Invitations, choose "For one phone number", enter
   the person's mobile number, and create the invitation.
2. Send them the link. They enter the same number and choose a password.
3. They sign in with number and password. Everything works except texts.
4. Once texting works, the first time they sign in with a texted code their
   number is marked as verified, and they can record by text and turn on
   reminders.

Do this for yourself first.

## Text messages (Telnyx)

Cost: about $1 a month for a toll-free number and about 1 cent per text, in
each direction. You pay for every text the site sends, sign-in codes
included. The limits in the console cap it; with the defaults the most the
site can send is 3,000 texts a month.

1. Create a Telnyx account, add a payment method, and buy a **toll-free**
   number with SMS.
2. Create a **Messaging Profile** and assign the number to it. Leave the
   profile's opt-out settings at their defaults (do not add custom
   auto-responses: on toll-free numbers the carrier answers STOP and START
   itself, and the site answers HELP).
3. Set the profile's **inbound webhook URL** to the address the console
   shows (`https://betaharah.com/webhooks/telnyx`).
4. Submit the **toll-free verification** for the number. US carriers do not
   deliver texts from an unverified toll-free number. Telnyx says it takes
   one to two weeks. Suggested answers are below.
5. In the console, paste the **API key**, the **public key** (Telnyx portal
   → Keys & Credentials → Public Key) and the **number**. Use "Send a test
   text".

### Suggested answers for the toll-free verification form

Use your own name and address as the business (an individual is a "sole
proprietor"). Choose the closest option where the form has a list.

| Question | Answer |
|---|---|
| Website | `https://betaharah.com` |
| Use case | Account notifications (with two-factor sign-in codes) |
| Use case summary | Betaharah is a free personal calendar for Jewish family-purity observance, used by the operator's family and friends. Users sign in with their mobile number and a one-time code sent by SMS. Users may text single-digit commands to record a calendar date and receive a confirmation reply. Users who turn on reminders in their account settings receive reminders about dates in their own calendar. No marketing or promotional messages are sent. |
| Monthly volume | The lowest option offered |
| How users opt in | (1) Sign-in codes: the user enters their own mobile number on https://betaharah.com/app/ and presses "Text me a code"; the page states that a code will be sent by text and that message and data rates may apply. (2) Reminders: off by default. A signed-in user turns on "Send text reminders to this phone" under Settings for a phone whose number was verified by code; the page shows the consent wording (program name, message frequency varies, message and data rates may apply, reply STOP to stop, HELP for help) before saving. A confirmation text is then sent. Consent is not a condition of any purchase; the service is free. |
| Opt-in screenshots | `https://betaharah.com/sms-opt-in-1.png` (sign-in) and `https://betaharah.com/sms-opt-in-2.png` (reminders) |
| Privacy policy | `https://betaharah.com/privacy` |
| Terms | `https://betaharah.com/terms` |
| Sample message 1 | `Betaharah code: 123456. It expires in 10 minutes. Do not share it.` |
| Sample message 2 | `Betaharah: reminders are on for this number. Text ? for the list of commands. Msg&data rates may apply. Reply STOP to stop, HELP for help.` |
| Sample message 3 | `Mikvah night: Thu Dec 3, after 5:16 PM. Reply 4 after immersing.` |
| Opt-in confirmation message | Sample message 2 |
| HELP reply | `Betaharah: calendar reminders and replies. Commands and help: betaharah.com/help. Msg&data rates may apply. Reply STOP to stop.` |
| STOP | Handled by the carrier on toll-free numbers; the site also records it and sends nothing further to that phone until it texts START. |

If the reviewer asks for changes, the wording that users see is in
`public/app/app.js` (sign-in page and Settings) and `src/app/pages.ts`
(Privacy and Terms).

## Google Calendar (optional)

Without this, accounts can still use the calendar subscription link, which
works with Google Calendar too (Google refreshes subscribed calendars on its
own schedule, up to about 12 hours). With it, an account's Google calendar
is updated within about a minute.

The exact scopes and the two redirect URIs are in
[GOOGLE_SETUP.md](GOOGLE_SETUP.md). In short: one Web client, redirect
`https://betaharah.com/api/auth/google/callback` for sign-in (`openid email
profile`) and `https://betaharah.com/api/google/callback` for the calendar
(`https://www.googleapis.com/auth/calendar.app.created`). Paste the client
ID and secret into the console. Publishing status **In production**.

Until Google has verified the app, people see a "Google hasn't verified this
app" page when they connect, and can continue past it; Google also limits an
unverified app to 100 people. Whether Google asks for verification of this
scope is shown in the Cloud Console's consent-screen pages. If you want the
warning gone, submit the app for verification there; it needs the home page
and privacy policy above and proof that you own the domain.

## Keeping the bill and the site safe

- The limits in the console: sign-in codes per day, texts per month for the
  site, texts per month per account. Past a limit nothing is sent.
- "Phone numbers must begin with" keeps texts to the countries you choose.
  Texts to other countries cost more.
- "Send text messages" is a single switch that stops all sending at once.
- If sign-ups you did not expect appear, switch "Who may create an account"
  to invitation only.
- Telnyx's portal has its own spending limit and usage alerts; set them.

## What you can and cannot see

The console lists each account's phone numbers, Google email, and recent
texts. The dates themselves stay in the encrypted record and are not listed.
The key is the Worker's `ENCRYPTION_KEY` secret. The Privacy page tells
users what the console shows.

Worker logs record errors only (the kind of error and where in the code),
not the addresses requested and not any account's data.

## If something goes wrong

- **Nobody receives texts:** console → Status. Check the Telnyx portal for
  the number's verification status and the message logs.
- **Someone is locked out:** make them a one-number invitation only if their
  account does not exist. If it exists and they have no password and texts
  are down, they have to wait for texts; there is no back door into an
  account.
- **Restore the database:** Cloudflare keeps 7 days of point-in-time
  recovery (`wrangler d1 time-travel`). There is no other backup.
