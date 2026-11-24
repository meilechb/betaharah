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

Open **https://betaharah.com/admin/** and sign in with `DASHBOARD_PASSWORD`
(a session lasts 12 hours). It shows totals and the site's own settings, and
it carries you through the setup. Under Accounts, opening one account lists
its phone numbers, the Google email used to sign in, and its recent texts;
it does not list the stored dates. Each section is its own page (a side list
on a computer, a menu at the top on a phone):

- **Overview**: the main numbers with their trend, the setup steps in
  order, each with its status (done, needs you, waiting on someone else)
  and the exact next step (this replaces most of this document), the status
  of each part (whether texting works, the last failure and its kind,
  whether the every-minute job ran, the last text received, Google, RCS),
  and texts sent in the last 30 days. Telnyx's toll-free verification
  cannot be seen by the site; tick it under Keys and connections as a note
  to yourself.
- **Usage and cost**: texts and sign-in codes today and this month against
  the limits, received texts, new and deleted accounts, an estimate in
  dollars at a price per text you set, and the last 30 days.
- **Accounts**: internal ids, dates, number of phones and whether a
  reminder is waiting; search by id; delete with DELETE typed. Open an
  account (its id, or Open) to see its phone numbers (each: verified or
  not, agreed to reminder texts or not, replied STOP or not), the Google
  email and name it signs in with, and its last 15 texts. The account can
  be deleted from there too. The dates recorded, the customs and the
  settings are not shown.
- **Site settings**: the contact for the public pages, who may sign up,
  sign-up by text (off at first; see "Sign-up by text" below), "Send text
  messages", the allowed prefixes and the limits, each with what it
  protects against, and the ways to give (see "Donations" below).
- **Keys and connections**: Telnyx, RCS and Google. Keys are write-only;
  each shows whether it is saved, can be cleared, and has a Check button
  that makes a read-only call (it sends nothing). The Google part shows
  both redirect addresses to add to the OAuth client (Sign in with Google,
  and Google Calendar).
- **Invitations**: a link for sign-up on the website, a word for sign-up by
  text (JOIN and the word), or an account for one number with a password.
- **Test account**: open, reset or delete it.
- **Text simulator**: "Try signing up by text" (below), and what people
  can text.
- **Tools**: a test text to your own number, and links to the public pages
  and the two consent screenshots.

## Test account

The console can open a test account, to try every feature on the live site,
text messages included, before Telnyx is set up and without sending any
text.

- "Open the test account" deletes the test account if there is one, makes a
  new one, and signs your browser in to it. Its phone is (732) 555-0100,
  named "Test phone"; a second phone, (732) 555-0199, is named "Spouse
  (example)". Numbers from 555-0100 to 555-0199 are reserved for fiction and
  are never real phones.
- It starts fully set up in Lakewood, NJ, with four past cycles and a
  period that began about nine days ago, so it opens in the seven clean
  days, with reminders and a coming mikvah night.
- No text is ever sent for it. Replies, reminders, the "reminders are on"
  text, test texts and the codes for adding a phone are recorded in its
  Log as "simulated" instead. Nothing is counted against the site's limits.
- The dashboard has a box for sending a text from the test phone. It goes
  through the same conversation as a real text (every word in
  [TEXTING.md](TEXTING.md), STOP, START, HELP), and every text that would
  have been sent is shown on the page, with its RCS buttons.
- A phone added to it must have a number from 555-0100 to 555-0199. The code
  is shown on the page instead of being texted.
- Its reminders are "sent" by the periodic job at their times, and appear in
  its Log.
- To come back to it later, set a password inside it (Settings) and sign in
  with (732) 555-0100 and that password, or open it again from the console,
  which starts it fresh.
- "Delete the test account" removes it. It is listed among the accounts like
  any other while it exists.

The site never texts a number from 555-0100 to 555-0199: sign-in codes,
one-number invitations and the console's test text refuse them, and a text
received from one is never answered.

### Trying sign-up by text before the number is approved

Console → **Text simulator**. You text "from" a made-up
number (555-0100 to 555-0199) and see every reply, with the RCS buttons as
buttons you can tap. The text goes through the whole real path (the
sign-up rules, JOIN, setup, every word, ADD and JOIN with a code, WEB,
DELETE ACCOUNT), but nothing is sent, nothing is charged, and none of the
site's counters move. The accounts it makes are test accounts, never
texted. One stays until you text DELETE ACCOUNT and YES from the same
made-up number, or delete it under Accounts.

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
   auto-responses: on toll-free numbers the carrier confirms STOP and START
   itself; the site answers HELP and START with the wording in the table
   below).
   Note the profile's **Messaging Profile ID**: RCS needs it later.
3. Set the profile's **inbound webhook URL** to the address the console
   shows (`https://betaharah.com/webhooks/telnyx`). An RCS agent's inbound
   webhook may be set to that same address or to
   `https://betaharah.com/webhooks/telnyx/rcs`: both read SMS and RCS
   messages alike. Until the agent's id is saved in the console, an RCS
   message is answered by SMS.
4. Submit the **toll-free verification** for the number. US carriers do not
   deliver texts from an unverified toll-free number. Telnyx says it takes
   one to two weeks. Suggested answers are below.
5. In the console, paste the **API key**, the **public key** (Telnyx portal
   → Keys & Credentials → Public Key) and the **number**. Use "Send a test
   text".

Once this works, people sign up on the website with a texted code.

### Sign-up by text

Signing up by texting JOIN to the number is **off** at first (console →
Site settings → "People can create an account by texting JOIN to the
number"). Switch it on only after the toll-free verification has been
amended to cover it (the table after "Suggested answers for the toll-free
verification form" below). What people receive is in
[TEXTING.md](TEXTING.md). While sign-up is by invitation, they text JOIN
and an invitation word that you make under Invitations (a word of 6 to 24
letters and digits, any case). The console's Text simulator follows the
same switch: while it is off, JOIN from a new number gets no reply there
either.

## RCS (when the agent is approved)

RCS shows the same texts with tap-to-reply buttons, from a verified
sender. Every RCS text carries an SMS fallback with the same words, so a
phone without RCS still gets an ordinary text, and every text says in
words what to send, so nothing depends on the buttons. Sign-in codes and
sign-in links always go as plain SMS.

1. In the Telnyx portal, when the RCS agent is approved (or in its testing
   stage, for test devices), link the agent to the **same Messaging
   Profile** the number is on.
2. Set the **RCS agent's inbound webhook** to the same address as the
   number's: `https://betaharah.com/webhooks/telnyx` (the console shows
   it). Telnyx sends received RCS messages to the address on the agent,
   not the one on the profile; the site reads both kinds there and checks
   the signature the same way.
3. In the console, enter the **RCS agent id** (`rcsAgentId`) and the
   **Messaging Profile ID** (`telnyxMessagingProfileId`), then switch
   **RCS** on (`rcsEnabled`). It takes effect only while text messages are
   set up and switched on.
4. Text the number from an RCS phone and check that the buttons appear,
   and from a phone without RCS (or an iPhone with RCS off) that an
   ordinary text arrives.

To stop using RCS, switch it off: everything goes by SMS again at once.
RCS messages to the agent are still answered (by SMS) while its id is
saved. Each RCS message is billed by Telnyx per message, like an SMS;
check Telnyx's RCS pricing, and whether a message delivered by its SMS
fallback is billed once or twice, before switching it on.

Things to confirm with Telnyx before switching RCS on (their RCS
documentation does not say): whether STOP sent by RCS blocks further RCS
and SMS sends to that phone, as on toll-free SMS (the site itself stops
texting a phone that sends STOP either way); the most suggested replies
per message and the longest label (the site uses at most 4, of at most 20
characters); the error code when an RCS send is refused because the phone
opted out (the site treats 40300 as that, as for SMS); and whether the
fallback is used only when the phone has no RCS, or also when an RCS
delivery fails.

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
| Sample message 2 | `Betaharah: you're subscribed to reminder texts. Message frequency varies. Msg&data rates may apply. Reply ? for help, STOP to opt out.` |
| Sample message 3 | `Mikvah night: Thu Dec 3, after 5:16 PM. Reply 4 after immersing.` |
| Opt-in confirmation message | Sample message 2 |
| HELP reply | `Betaharah: text ? for commands. Help: admin@betaharah.com. Reply STOP to opt out.` |

The answers above describe opting in on the website, and they are what was
filed. Sign-up by text (texting `JOIN`) is a second way to opt in and is
**off** until you turn it on under Settings in the console. Before turning it
on, amend the verification with Telnyx to add the keyword opt-in and these
messages (the console's switch points here):

| Field | Addition for sign-up by text |
| --- | --- |
| Use case summary | Betaharah is a free personal calendar for Jewish family-purity observance, used by the operator's family and friends. Users sign up either by texting the keyword JOIN to the number, or on the website with their mobile number and a one-time code sent by SMS. Users text short commands to record calendar dates, set up and manage their account, and receive a reply to each text. Users who turn on reminders (by texting REMINDERS ON, or in their account settings) receive reminders about dates in their own calendar. Nothing is ever sent to a number that has not texted the service or entered itself on the website. No marketing or promotional messages are sent. |
| How users opt in | (1) By text: the user texts the keyword JOIN to the number (the number and the keyword are published on https://betaharah.com/help). Any first text from a new number gets one reply describing the program, with message frequency, rates, STOP and HELP, and the terms link (sample message 4); JOIN then creates the account and the reply starts setup (sample message 5). A second phone joins an account only by texting JOIN and a code from its own phone. (2) Sign-in codes on the website: the user enters their own mobile number on https://betaharah.com/app/ and presses "Text me a code"; the page states that a code will be sent by text and that message and data rates may apply. (3) Reminders: off by default, also after JOIN. The user texts REMINDERS ON, and the reply confirms the consent with the full wording (sample message 6); or a signed-in user turns on "Send text reminders to this phone" under Settings for a phone whose number was verified, where the page shows the consent wording before saving, and a confirmation text is then sent. Consent is not a condition of any purchase; the service is free. |
| Sample message 4 (first reply to a new number) | `Betaharah is a mikvah calendar by text message. Reply JOIN to sign up. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help. Terms: betaharah.com/terms` |
| Sample message 5 (reply to JOIN) | `Welcome to Betaharah. This phone is signed up. Step 1 of 3: reply with your ZIP code (in Canada, your postal code, e.g. H3W 1A1). It sets the times of sunset.` |
| Sample message 6 (reply to REMINDERS ON) | `Reminders are on for this phone (ending 0101). This phone agrees to receive reminder texts from Betaharah. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help.` |
| Opt-in keyword | JOIN |
| Opt-in confirmation message | Sample message 5 for joining by text (sample message 6 when reminders are turned on by text) |
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

## Donations (optional)

The site can show a Donate page (`/donate`) that lists ways to give toward
its costs. The site takes no payment itself: it shows links to payment pages
you set up yourself, and a note.

1. Choose a payment service and create your own account with it (for
   example a PayPal donation button or a Stripe payment link). Its fees,
   receipts and refunds are that service's, under its terms.
2. Console → Site settings → **Donations**: add up to four links, each with
   the words for its button (1 to 40 characters) and the address of your
   payment page (it must begin with `https://`, at most 300 characters).
   For ways without a link, such as Zelle or an address for cheques, write
   a note (at most 400 characters; it is shown as written).
3. Press **Save settings**, then "Open the Donate page" to check it.

Once a link or a note is saved, the page exists and is linked from the home
page, the footer and header of Help, Privacy and Terms, and Settings → Your
data in the signed-in page. Privacy then also says that the links lead to
other sites with their own terms. Remove every link and the note, and save,
to take the page and all its links down. Nothing about donating appears in
texts, reminders or the Today tab. The page does not say that a gift is tax
deductible or promise anything in return; do not add that to the note
unless it is true for you.

## Keeping the bill and the site safe

- The limits in the console: sign-in codes per day, texts per month for the
  site, texts per month per account. Past a limit nothing is sent. Only
  codes that are really sent count toward the daily total; a number that may
  not sign up (in invitation-only or closed mode) gets the same answer
  without using it up.
- "Send text messages" switched off: reminders that come due meanwhile wait,
  and are sent if texting is back on within their time (a few hours at
  most); after that they are dropped.
- The console's sign-in locks a network address for 15 minutes after eight
  wrong passwords from it, and locks for everyone after 300 wrong passwords
  in 15 minutes from all addresses together.
- "Phone numbers must begin with" keeps texts to the countries you choose.
  Texts to other countries cost more.
- "Send text messages" is a single switch that stops all sending at once.
- If sign-ups you did not expect appear, switch "Who may create an account"
  to invitation only, or switch "sign-up by text" off.
- Numbers without an account: each gets at most one reply in 24 hours; the
  site sends at most 50 such replies a day and creates at most 25 accounts
  a day by text; past those, nothing is sent. More than 30 texts an hour
  from one number are ignored. While sign-up is closed, or sign-up by text
  is off, a number without an account gets no reply (except a phone
  joining an existing account with its code). HELP and START are always
  answered, also from a number without an account, with the fixed replies
  filed for the verification (the HELP reply above; START gets sample
  message 2), within their own daily limits.
- Telnyx's portal has its own spending limit and usage alerts; set them.

## What you can and cannot see

The console lists each account's phone numbers, Google email, and recent
texts. The dates themselves stay in the encrypted record and are not listed.
The key is the Worker's `ENCRYPTION_KEY` secret. The Privacy page tells
users what the console shows.

Worker logs record errors only (the kind of error and where in the code),
not the addresses requested and not any account's data.

## If something goes wrong

- **Nobody receives texts:** console → Overview, Status. Check the Telnyx portal for
  the number's verification status and the message logs.
- **Someone is locked out:** make them a one-number invitation only if their
  account does not exist. If it exists and they have no password and texts
  are down, they have to wait for texts; there is no back door into an
  account.
- **Restore the database:** Cloudflare keeps 7 days of point-in-time
  recovery (`wrangler d1 time-travel`). There is no other backup.
