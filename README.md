# Betaharah (בטהרה): a mikvah calendar by text message

A free tool for family and friends, at **https://betaharah.com**.

A couple signs up with a phone number. They record dates by text, answering
the options each text lists, or on the website. The site works out the onos perishah, the hefsek
taharah, the seven clean days and mikvah night by the Hebrew calendar, the
sun at their location and their own customs, shows them in their own
calendar (Google Calendar, or any calendar app through a subscription link),
and sends reminders by text.

It is a calculation aid. It does not rule on anything; see
[docs/HALACHA.md](docs/HALACHA.md) for exactly what it calculates and what it
leaves to a rav.

If you run the site, read [docs/OPERATOR.md](docs/OPERATOR.md). The Google Cloud settings are in [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md).

## How people use it

| Step | What happens |
|---|---|
| Sign up, and sign in each time | Sign in with Google (when the operator has turned it on); or text `JOIN` to the site's number and answer the setup questions by text, with no website at all; or enter a mobile number on the website, get a six-digit code by text, type it in. A password can be set as well, under Settings. Everything (location by ZIP code, customs, phones, reminders, calendar link, deleting the account) can be done by text: [docs/TEXTING.md](docs/TEXTING.md). |
| Location and customs | Sunrise, sunset and nightfall are calculated for the place chosen. Every point on which customs differ is a setting; until they are saved the stricter option of each is used. |
| Recording | On the website, or by text: every text ends with its options (`Reply: PERIOD, HEFSEK, STATUS, MORE`), answered by word: `period last night`, `hefsek yesterday`, `period Nov 22 night`. No digit commands. By SMS, or by RCS with the options as buttons once the RCS agent is approved. Every text and its options are on the console's Texts page, where the operator can change them. |
| Husband and wife | A second phone is added on the website with a code texted to it, or by text: a phone on the account texts `ADD` and gets a code, and the other phone texts `JOIN` and that code. Up to four phones share one account; each chooses its own reminders. |
| Calendar (optional) | Connect Google Calendar (the site creates one calendar and can see only that one), or create a subscription link for any calendar app. By default it shows the onos, the start of each period and the hefsek taharah; the niddah days, the seven clean days and the mikvah night can be switched on under Settings. Titles in words, or as symbols only. |
| Reminders (optional) | Off until turned on for a phone. Nothing is sent on Shabbos or Yom Tov. STOP stops them. |
| English or Hebrew terms | The site is in English. A setting chooses whether halachic terms are written in English letters (hefsek taharah) or in Hebrew (הפסק טהרה), on the site and in the calendar. Text messages are always in English letters. |
| Leaving | Settings has "Download my data" and "Delete my account". |

## Test account

The operator's console opens a test account with one click: a made-up
household, fully set up and in the middle of the seven clean days, with
phones (732) 555-0100 and (732) 555-0199 (numbers reserved for fiction).
Every feature works in it, but no text is ever sent: replies, reminders and
codes are recorded in its Log as "simulated", and the dashboard has a box for
sending a text from its phone. Details are in
[docs/OPERATOR.md](docs/OPERATOR.md#test-account). The site never texts a
number from 555-0100 to 555-0199.

## What is here

| Part | Where |
|---|---|
| The rules: dates, sun times, vestos, the count | `src/engine/` |
| The two forms of each halachic term | `src/engine/terms.ts` |
| Wording of calendar events; wording of text messages | `src/engine/calendar.ts`, `src/engine/present.ts` |
| Accounts, sign-in, storage, texts and replies, reminders, Google Calendar | `src/app/` |
| Help, Privacy and Terms pages, and the Donate page (`/donate`, only once the operator has entered a way to give) | `src/app/pages.ts` |
| The calculation test (console) and "Try it" (home page): a made-up household worked out in memory by the same code, nothing stored (`POST /api/admin/sandbox`, `POST /api/try`) | `src/app/sandbox.ts`, `public/admin/sections/calc.js`, `public/landing-try.js` |
| The public page, the dashboard (`/app/`), the operator's console (`/admin/`) | `public/` |
| Tests (`npm test`) | `test/` |

It runs on Cloudflare's free plan: a Worker, a D1 database, and a job every
minute. Text messages go through Telnyx, which is the only part that costs
money.

## Privacy, as built

- **Identity is a phone number only.** No name or email is asked for.
- **Each account's data is one encrypted document** (AES-256-GCM, bound to
  the account's id): settings, phone numbers, entries, messages, the waiting
  reminders, the Google token. The key is the `ENCRYPTION_KEY` secret of the
  Worker; it is not in the database.
- **What can be read in the database:** ids, timestamps, counters, the
  site's own settings, and for each account the time its next reminder is
  due (the minute-by-minute job needs that to know which account to open).
  Phone numbers, invitation links and calendar links appear only as keyed
  fingerprints. A test (`what can be read in the database`) fills the
  database and checks that no phone number, entry, message, token, code or
  key is readable in it.
- **One account cannot reach another.** The database is reachable only by
  the Worker; no browser talks to it. Every route takes the account from the
  signed session cookie, the verified sender of a text, or the secret
  calendar link, never from anything typed. The tests under `one account
  never sees another` check this, including copying one account's stored
  data over another's (it fails to decrypt).
- **The operator's console** lists each account's phone numbers, the Google email used to sign in, and recent texts, so the service can be supported. It does not list the stored dates. The Privacy page says so.
- **What this does not do:** the server can decrypt, because it has to read
  the dates to calculate and to send reminders. Whoever controls the
  Cloudflare account can therefore read an account. Text messages are read
  by Telnyx and the phone companies. The Privacy page says both.
- **Password hashing** is PBKDF2-SHA256 with 20,000 iterations, then keyed
  with a secret that is not in the database. The iteration count is what
  fits in the free plan's 10 ms of processor time per request; it is lower
  than OWASP recommends for PBKDF2 on its own. Someone with only the
  database cannot test guesses at all, because of the key.

## Limits that protect the text-message bill

Every text costs the operator about a cent. Sign-in codes: one a minute and
five a day per number, eight an hour per network address, 150 a day for the
whole site. Texts: 3,000 a month for the whole site, 200 a month per
account. Numbers must begin with +1. The operator changes all of these in
the console, and can switch sign-up to invitation only, or close it. A
number without an account gets at most one reply a day, the whole site at
most 50 such replies a day, and at most 25 accounts a day are created by
text (`src/app/conversation.ts`).

## Working on it

```sh
npm install
npm test            # all tests (a local database is created for them)
npm run typecheck
npm run dev         # run locally at http://localhost:8787 (needs a .dev.vars file, see test/ui-check.cjs)
```

`test/ui-check.cjs` drives the whole site in a real browser; `test/ui/*.cjs` cover the sign-in views, the dashboard, Settings, the home page and the operator's console in detail. Each needs its own local server on a new empty database (the first lines of each file say how).

The Hebrew calendar arithmetic is `@hebcal/hdate` (GPL-2.0-or-later), so
this project carries the same licence.

## Data

The location of a US ZIP code or a Canadian postal area (`src/app/zip.ts`)
comes from a table, `src/app/postal-data.ts`, which
`node scripts/build-postal.mjs` makes (it downloads its sources; the header
of the script says what it keeps and leaves out, and why).

- Place names and coordinates: postal code data from
  [GeoNames](https://www.geonames.org/), licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The table was
  made from the files published on 2026-11-24; names are shortened and
  coordinates rounded to about 1 km.
- Time zones: computed from those coordinates with
  [geo-tz](https://github.com/evansiroky/node-geo-tz), from the
  [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder)
  boundaries, which are © OpenStreetMap contributors and available under the
  [Open Database Licence](https://opendatacommons.org/licenses/odbl/).
- Checked against the US Census Bureau 2025 Gazetteer (public domain) and the
  GeoNames gazetteer (CC BY 4.0).

## Limits to know about

- Cloudflare's free plan allows 10 ms of processor time per request. The
  whole calculation for three years of history measures about 4 ms on a test
  machine, and checking a password about 4 ms (`test/cost.test.ts`). The
  real figures are under Workers → betaharah → Metrics in the Cloudflare
  dashboard.
- The free plan's database keeps 7 days of point-in-time recovery and no
  other backup.
- Each account's calendar and reminders are brought up to date after every
  change, and at least every six hours.
- The periodic job sends at most 8 reminders a minute. With very many
  accounts whose reminders fall in the same minute, some go out a few
  minutes late.
