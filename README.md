# Betaharah (בטהרה): a mikvah calendar by text message

A free tool for family and friends, at **https://betaharah.com**.

A couple signs up with a phone number. They record dates by texting one
digit, or on the website. The site works out the onot perishah, the hefsek
taharah, the seven clean days and mikvah night by the Hebrew calendar, the
sun at their location and their own customs, shows them in their own
calendar (Google Calendar, or any calendar app through a subscription link),
and sends reminders by text.

It is a calculation aid. It does not rule on anything; see
[docs/HALACHA.md](docs/HALACHA.md) for exactly what it calculates and what it
leaves to a rav.

If you run the site, read [docs/OPERATOR.md](docs/OPERATOR.md).

## How people use it

| Step | What happens |
|---|---|
| Sign up, and sign in each time | Enter a mobile number, get a six-digit code by text, type it in. Nothing else is asked. A password can be set as well, under Settings. |
| Location and customs | Sunrise, sunset and nightfall are calculated for the place chosen. Every point on which customs differ is a setting; until they are saved the stricter option of each is used. |
| Recording | On the website, or by text: `1` flow, `2` hefsek, `3` count broken, `4` immersed, `5` stain, `9` status, `0` undo, `?` commands. After `1`, `3`, `5`: `day`, `night`, `yesterday night`, or a time such as `6:40am`. After `2`, `4`: `yesterday`. |
| Husband and wife | A second phone is added to the account with a code texted to it. Up to four phones share one account; each chooses its own reminders. |
| Calendar (optional) | Connect Google Calendar (the site creates one calendar and can see only that one), or create a subscription link for any calendar app. Titles in words, or as symbols only. |
| Reminders (optional) | Off until turned on for a phone. Nothing is sent on Shabbat or Yom Tov. STOP stops them. |
| English or Hebrew terms | The site is in English. A setting chooses whether halachic terms are written in English letters (hefsek taharah) or in Hebrew (הפסק טהרה), on the site and in the calendar. Text messages are always in English letters. |
| Leaving | Settings has "Download my data" and "Delete my account". |

## What is here

| Part | Where |
|---|---|
| The rules: dates, sun times, vesatot, the count | `src/engine/` |
| The two forms of each halachic term | `src/engine/terms.ts` |
| Wording of calendar events; wording of text messages | `src/engine/calendar.ts`, `src/engine/present.ts` |
| Accounts, sign-in, storage, text commands, reminders, Google Calendar | `src/app/` |
| Help, Privacy and Terms pages | `src/app/pages.ts` |
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
- **The operator's console shows no account's data**, only totals.
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
the console, and can switch sign-up to invitation only, or close it.

## Working on it

```sh
npm install
npm test            # all tests (a local database is created for them)
npm run typecheck
npm run dev         # run locally at http://localhost:8787 (needs a .dev.vars file, see test/ui-check.cjs)
```

`test/ui-check.cjs` drives the three pages in a real browser.

The Hebrew calendar arithmetic is `@hebcal/hdate` (GPL-2.0-or-later), so
this project carries the same licence.

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
