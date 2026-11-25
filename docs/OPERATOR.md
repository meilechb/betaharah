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
- **Calculation test**: a blank calendar on which you add dates and see
  what an account would show, as of any day you choose (below).
- **Texts**: every text the service sends, grouped, with when it is
  sent, how it looks by SMS and by RCS, and its length. Change any text,
  the labels of its options, the general words and the options prefix
  (below).
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

## Calculation test

Console → **Calculation test**. It is for checking the calculation: you
start from a blank calendar, add dates, and see the following months worked
out exactly as a person's account would show them. Each change is sent to
`POST /api/admin/sandbox`, which builds a made-up household in memory, puts
the place and customs on it as the Settings and Customs tabs save them,
records each date in the order you added it with the same checks as the
Record form (the same refusals, in the same words), works the picture out
with the same code as the dashboard, and forgets it. Nothing is saved on
the server and no account is touched.

How to use it:

1. **Click a day** on the calendar. Beside the calendar (under it on a
   phone) the day opens with "What happened on this day?".
2. **Press one button**: flow by day, flow at night, or hefsek taharah.
   "Other things to add" has stain, count broken, immersion that evening
   (optional: once the seven clean days are over the calendar takes it that
   she immersed on the mikvah night), a flow at a clock time, and the switch
   for a flow that does not count for the vestos. The date is added at once. A date an account would refuse is
   not kept, and the reason is shown where you added it.
3. **Read the result**: the calendar marks the two months shown; "Where
   things stand" gives the status, warnings and pattern alerts; "What the
   calendar works out" lists the steps until the mikvah night and each onah of
   separation with the reasons it is kept.

What you entered and what the calendar works out are kept apart. A tick
(`H✓`, `M✓`) marks a hefsek taharah or immersion you entered. `H?` with a
dashed outline is the day the hefsek taharah can be done: the calendar shows
it after a period is added, and it was not entered. Dashed clean days and
mikvah night are what follows if the hefsek taharah is done on that day; the
lists label them "not entered" and "expected".

- **Today in the test** is the latest date you entered, so dates can be
  added one after another as they would happen, and a date is never refused
  for being in the future. The line "Shown as of …" says which day that is.
  **Forward one onah**, **Forward one day** and **Choose another day as
  today** move it ahead, to see what an account shows on a later day (a
  count going on, mikvah night). It cannot be before the latest date
  entered. By day, "now" is halfway between sunrise and sunset; at night,
  half an hour after nightfall.
- **Place**: one of the app's list, or any US ZIP or Canadian postal code.
- **Calendar**: two months at a time, with the marks people see; the arrows
  move between months (two before today to four after).
- **Dates you entered**: as an account's Log shows them. Removing one works
  everything out again from the remaining dates in the order they were
  added; a date that would now be refused is listed under "Not recorded
  now" with the reason.
- **Customs** (closed until opened, below the calendar): the twelve
  settings, starting as a new account's. Each change is worked out at once.
- **Keep this scenario, or load one**: copies the place, customs, today and
  dates as text, and runs such a text again, so a case can be kept and
  checked later. The scenario also stays in this browser tab
  (sessionStorage) across a reload. **Start over** clears it.

The home page has a smaller version for visitors ("Try it",
`POST /api/try`): a place from the list or a ZIP code, three customs
(days before the hefsek, which day of onah beinonis, Or Zarua), up to 12
dates (a flow, then its hefsek taharah; the walk then shows the clean days
and the mikvah night and ends with the sign-up button), and a chosen
"today". It saves nothing about the dates; the only thing stored is a
counter per network address (a keyed fingerprint, as for sign-in), which
allows 60 tries in 10 minutes.

### Trying sign-up by text before the number is approved

Console → **Text simulator**. You text "from" a made-up
number (555-0100 to 555-0199) and see every reply with its options as
buttons; tapping one sends it, so a whole conversation can be walked
without typing. The text goes through the whole real path (the sign-up
rules, JOIN, setup, every option and word, ADD and JOIN with a code, the
sign-in link, DELETE ACCOUNT), but nothing is sent, nothing is charged,
and none of the site's counters move. The accounts it makes are test accounts, never
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

RCS shows the same texts with their options as buttons, from a verified
sender; a tap sends the option's label. Every RCS text carries an SMS
fallback with the same words and the options on its last line, so a phone
without RCS still gets an ordinary text and nothing depends on the
buttons. Sign-in codes and sign-in links always go as plain SMS.

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
per message and the longest label (the site uses at most 6, of at most 20
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
| Use case summary | Betaharah is a free personal calendar for Jewish family-purity observance, used by the operator's family and friends. Users sign in with their mobile number and a one-time code sent by SMS. Users may reply to a text with one of the options it lists (for example PERIOD or STATUS) to record a calendar date and receive a confirmation reply. Users who turn on reminders in their account settings receive reminders about dates in their own calendar. No marketing or promotional messages are sent. |
| Monthly volume | The lowest option offered |
| How users opt in | (1) Sign-in codes: the user enters their own mobile number on https://betaharah.com/app/ and presses "Text me a code"; the page states that a code will be sent by text and that message and data rates may apply. (2) Reminders: off by default. A signed-in user turns on "Send text reminders to this phone" under Settings for a phone whose number was verified by code; the page shows the consent wording (program name, message frequency varies, message and data rates may apply, reply STOP to stop, HELP for help) before saving. A confirmation text is then sent. Consent is not a condition of any purchase; the service is free. |
| Opt-in screenshots | `https://betaharah.com/sms-opt-in-1.png` (sign-in) and `https://betaharah.com/sms-opt-in-2.png` (reminders) |
| Privacy policy | `https://betaharah.com/privacy` |
| Terms | `https://betaharah.com/terms` |
| Sample message 1 | `Betaharah code: 123456. It expires in 10 minutes. Do not share it.` |
| Sample message 2 | `Betaharah: you're subscribed to reminder texts. Message frequency varies. Msg&data rates may apply. Reply ? for help, STOP to opt out.` |
| Sample message 3 | `Mikvah night: Thu Dec 3, after 5:16 PM.`<br>`Reply: STATUS` |
| Opt-in confirmation message | Sample message 2 |
| HELP reply | `Betaharah: text ? for commands. Help: admin@betaharah.com. Reply STOP to opt out.` |

The answers above describe opting in on the website. What was filed
differs from the live texts in two places: the use case summary said
"single-digit commands" (there are none now; texts list their options),
and sample message 3 now ends with the line `Reply: STATUS`. Amend the
verification with these two answers if Telnyx asks. Sign-up by text (texting `JOIN`) is a second way to opt in and is
**off** until you turn it on under Settings in the console. Before turning it
on, amend the verification with Telnyx to add the keyword opt-in and these
messages (the console's switch points here):

| Field | Addition for sign-up by text |
| --- | --- |
| Use case summary | Betaharah is a free personal calendar for Jewish family-purity observance, used by the operator's family and friends. Users sign up either by texting the keyword JOIN to the number, or on the website with their mobile number and a one-time code sent by SMS. Each text lists the options it accepts; users reply with an option, or in words, to record calendar dates, set up and manage their account, and receive a reply to each text. Users who turn on reminders (by texting REMINDERS ON, or in their account settings) receive reminders about dates in their own calendar. Nothing is ever sent to a number that has not texted the service or entered itself on the website. No marketing or promotional messages are sent. |
| How users opt in | (1) By text: the user texts the keyword JOIN to the number (the number and the keyword are published on https://betaharah.com/help). Any first text from a new number gets one reply describing the program, with message frequency, rates, STOP and HELP, and the terms link (sample message 4); JOIN then creates the account and the reply starts setup (sample message 5). A second phone joins an account only by texting JOIN and a code from its own phone. (2) Sign-in codes on the website: the user enters their own mobile number on https://betaharah.com/app/ and presses "Text me a code"; the page states that a code will be sent by text and that message and data rates may apply. (3) Reminders: off by default, also after JOIN. The user texts REMINDERS ON, and the reply confirms the consent with the full wording (sample message 6); or a signed-in user turns on "Send text reminders to this phone" under Settings for a phone whose number was verified, where the page shows the consent wording before saving, and a confirmation text is then sent. Consent is not a condition of any purchase; the service is free. |
| Sample message 4 (first reply to a new number) | `Betaharah: a mikvah calendar by text. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help. Terms: betaharah.com/terms`<br>`Reply: JOIN` |
| Sample message 5 (reply to JOIN) | `Welcome to Betaharah. Setup step 1 of 3: your ZIP code (or Canadian postal code), for the times of sunset.`<br>`Reply: SKIP` |
| Sample message 6 (reply to REMINDERS ON) | `Reminders are on for this phone (ending 0101). This phone agrees to receive reminder texts from Betaharah. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help.`<br>`Reply: KINDS, STATUS` |
| Opt-in keyword | JOIN |
| Opt-in confirmation message | Sample message 5 for joining by text (sample message 6 when reminders are turned on by text) |
| STOP | Handled by the carrier on toll-free numbers; the site also records it and sends nothing further to that phone until it texts START. |

If the reviewer asks for changes, the wording that users see is in
`public/app/app.js` (sign-in page and Settings) and `src/app/pages.ts`
(Privacy and Terms); every text message is on the console's Texts page.

### Changing the texts

Console → **Texts**. The page opens on **Important**: the 20 or so texts
most people ever get. The categories (Reminders, Recording, Status,
Sign-up and setup, Menu and not understood, Settings by text, Phones and
account, Carrier words and sign-in) show how many texts each has; **All**
shows every one, **Changed** only the ones you edited, and the search box
looks in the names, "sent when" and the wording. Each row is one text: its
name, when it is sent, and the wording as sent with example values and
its options as small chips (the length shows only when it takes more than
one SMS). A reminder's plain and discreet wording share one row, and the
twelve customs questions are one row that opens to them.

Click a row (or Enter) to edit it in place: the wording with its
placeholders as buttons that insert them (each shows its example), one box
per option label, and a live SMS and RCS preview with the count. Escape or
**Cancel** closes it; **Reset to the original** puts back the shipped
wording. The address keeps the category, filters, search and open text,
so a reload or Back returns to the same place. **Words people can write**
(last in the categories): the words for each action as chips to add or
remove, and what comes before the options (`Reply:`).

A change is refused, with the reason beside the field, when a required
placeholder is missing or an unknown one is used, a character is not in
the basic SMS alphabet (it is named), the text with the example values and
the options would be longer than two segments (306 characters), or a
label is empty, longer than 20 characters, not letters, digits and spaces,
used twice in one text, a word the carrier acts on (STOP, START, HELP,
INFO, CANCEL, END, QUIT, ...), or a general word of something else. The
next text sent uses the change. What each option does stays fixed.

The three texts filed with the carrier (the sign-in code and the replies
to HELP and START) are marked: change them only together with the filing.

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
