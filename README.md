# בטהרה (betaharah): a mikvah calendar in Google Calendar

A private app for one household. It keeps the record of flows, hefsek
taharah and immersions, works out the dates by the Hebrew calendar and the
times by the sun at your location, writes them into a calendar in your
Google account, and takes updates and sends reminders by text message.

It is a calculation aid. It does not rule on anything; see
[docs/HALACHA.md](docs/HALACHA.md) for exactly what it calculates and what it
leaves to a rav.

## What is here

| Part | Where |
|---|---|
| The rules: dates, sun times, vesatot, the count | `src/engine/` |
| Hebrew wording of events, English wording of text messages | `src/engine/present.ts` |
| The server: storage, sign-in, text commands, Google Calendar, reminders | `src/app/` |
| The dashboard page | `public/` |
| Tests (run with `npm test`) | `test/` |

It runs on Cloudflare's free plan: a Worker, a D1 database, and a job every
five minutes. Vercel's free plan runs scheduled jobs once a day only, which
is not enough for reminders.

## Text commands

Text the app's number from a phone listed in the dashboard.

| Text | Meaning |
|---|---|
| `1` | A flow began (now) |
| `2` | Hefsek taharah done today |
| `3` | The count was broken; a new hefsek is needed |
| `4` | Immersed (tonight, or last night if sent by day) |
| `5` | A stain: niddah without a flow |
| `9` | Status |
| `0` | Undo the last entry (within 48 hours) |
| `?` | Help |

After `1`, `3` or `5` you can say when: `1 night`, `1 day`,
`1 yesterday day`, `1 yesterday night`, `1 9pm`, `1 yesterday 21:30`.
After `2` or `4` you can add `yesterday`. A message that is not fully
understood changes nothing, and the reply says so. Every change is confirmed
by a reply that states the date it was recorded for.

## Setting it up

The app runs at **https://betaharah.com**. Nothing here costs money except
the phone number in step 4.

### 1. Put it on Cloudflare

The database already exists in the Cloudflare account (its id is in
`wrangler.jsonc`). Cloudflare builds and deploys the app from this
repository; every push to `main` deploys again.

1. In the Cloudflare dashboard go to **Workers & Pages → Create
   application → GitHub**, and choose the `betaharah` repository. Keep the
   project name `betaharah` and the default deploy command
   (`npx wrangler deploy`); no build command is needed. Press **Save and
   Deploy**.
2. Open the new `betaharah` Worker → **Settings → Variables and Secrets**
   and add two **secrets**:
   - `DASHBOARD_PASSWORD`: the password for the dashboard, 10 or more
     characters.
   - `ENCRYPTION_KEY`: 32 or more random characters (a password manager's
     generator is fine). Keep a copy somewhere safe. The keys you enter
     later in the dashboard (Google, Telnyx) are stored encrypted with it;
     if it is lost or changed, those have to be entered again. The record
     of entries is not affected.
3. Open https://betaharah.com and sign in.

If the first deploy fails with a message about an existing DNS record:
in the Cloudflare dashboard open **betaharah.com → DNS → Records**, delete
the A, AAAA or CNAME record for the bare name `betaharah.com`, and retry
the deploy. (Mail and verification records are not in the way.)

To deploy from a computer instead: `npm install`, `npx wrangler login`,
`npx wrangler deploy`, then `npx wrangler secret put` for each secret.

### 2. In the dashboard

1. **Settings → Location**: choose the place.
2. **הגדרות הלכה**: go through every setting, with your rav where needed, and
   press שמירה ואישור. Until you do, the stricter option is used everywhere
   and the dashboard shows a notice.
3. **היום → רישום**: enter the last four or more flows, each with its date
   and day or night, and the hefsek and immersion that followed if you have
   them. The intervals are counted from these.

### 3. Google Calendar

In [Google Cloud Console](https://console.cloud.google.com/):

1. Create a project and enable the **Google Calendar API**.
2. Configure the OAuth consent screen (user type: External). Set its
   publishing status to **In production**. In "Testing" status Google ends
   the app's access every seven days. Google will show a "this app isn't
   verified" page when you sign in, because the app is yours and not
   reviewed; continue past it.
3. Create an OAuth client of type **Web application**. Add the redirect
   address shown in the dashboard under Settings → Google Calendar.
4. Paste the client ID and client secret into the dashboard, save, and press
   **Connect**. Sign in with the Google account that should own the
   calendar.

The app asks for one permission only: to create its own calendar and manage
the events on it. It cannot see your other calendars. The calendar appears
in Google Calendar as **בטהרה**; share it with your wife from Google
Calendar's own sharing settings, and each of you can set your own
notifications for it there.

Events you add to that calendar by hand are never touched.

### 4. Text messages

The app uses [Telnyx](https://telnyx.com/). A toll-free number costs about
$1 a month plus about 1 cent per message, with no registration fee. (A local
number also needs carrier registration: about $20 once and $2 a month more.)

1. Create a Telnyx account and buy a toll-free number.
2. Create a Messaging Profile, assign the number to it, and set the
   profile's inbound webhook to the address shown in the dashboard under
   Settings → Text messages.
3. Submit the number's toll-free verification (Telnyx's form; as an
   individual choose "sole proprietor"). US carriers do not deliver messages
   from an unverified number. Telnyx says this takes one to two weeks.
4. Paste the API key, the public key (Telnyx portal → Keys & Credentials →
   Public Key) and the number into the dashboard. Add your phones and choose which
   reminders each receives. Use **Send test**.

Until the number is verified, everything else works: the dashboard, the
calendar, and Google Calendar's own notifications.

## Privacy

- The dashboard needs the password; eight wrong attempts lock sign-in for 15
  minutes.
- Text messages are accepted only from the phones you list, and only when
  Telnyx's signature on the delivery is valid. Anyone else gets no reply.
- API keys and the Google token are stored encrypted.
- The calendar's event titles can be switched to symbols only (Settings →
  Google Calendar), and the reminder texts to letters and times only, for a
  calendar or a phone that others may see.
- Text messages are not private: the phone company and Telnyx can read them.

## Working on it

```sh
npm test            # all tests
npm run typecheck
npm run dev         # run locally at http://localhost:8787 (needs a .dev.vars file, see test/ui-check.cjs)
```

The Hebrew calendar arithmetic is `@hebcal/hdate` (GPL-2.0-or-later), so
this project carries the same licence.

## Limits to know about

- Cloudflare's free plan allows 10 ms of processor time per request. A full
  recalculation with three years of history measures about 3 ms on a test
  machine (`test/cost.test.ts`). After deploying, the real figure is under
  Workers → the app → Metrics in the Cloudflare dashboard. If it ever gets
  close, lower the days of history kept (Settings → Google Calendar; 400 by
  default).
- The free plan's database has no automatic off-site backup beyond 7 days of
  point-in-time recovery. The Google calendar itself is a second copy of
  everything recorded.
- The calendar is refreshed after every change and at least every six
  hours.
