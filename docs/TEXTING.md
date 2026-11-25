# Betaharah by text message

Everything in Betaharah can be done by text message alone: signing up,
setting up, recording, and managing the account. This page describes how
texting works. Every text the service sends, with its options and its
current wording, is listed in the operator's console under **Texts** (the
registry is `src/app/chat/messages.ts`); the server is
`src/app/conversation.ts`, the engine `src/app/chat/`.

The examples were produced by the engine itself (`test/chat-script.test.ts`
checks the same texts). They assume Lakewood, NJ, on Tuesday 24 November
2026. `>` is what the person sends and `<` what Betaharah sends back.

## Every text ends with its options

```
> menu
< Betaharah.
  Reply: PERIOD, HEFSEK, STATUS, MORE
```

- **By SMS** the options are the words on the last line, after `Reply:`.
- **By RCS** the same options are buttons under the text (the text above
  them is the body alone). A tap sends exactly the button's label, so a tap
  and a typed reply are read the same way. Every RCS text carries an SMS
  fallback: the body with the options line.
- There are no digit commands. A digit sent alone is answered like any
  reply that was not understood.
- The main options are `PERIOD, HEFSEK, STATUS, MORE`. `MORE` shows the
  rest in small groups (never more than six options in one text):
  `OTHER ENTRIES` (stain, count broken, immersion), `HISTORY`, `UNDO`,
  `SETTINGS` (reminders, location, customs, calendar, terms, dates) and `ACCOUNT`
  (phones, the sign-in link, setup, deleting the account).
- Each text fits one SMS segment (160 GSM-7 characters) where it can, and
  never more than two (306). At most two texts go back for one received.
- Dates are written as the household chooses (DATES, or Settings on the
  website): Hebrew (the default), civil, or both, always in English
  letters, from the same helpers as the website (`src/engine/dates.ts`).
  A time is named in plain words first: `today`, `tonight`, `tomorrow`,
  `tomorrow night`, `yesterday`, `last night`, a weekday alone within the
  coming six days (`Thu`, `Shabbat`, `Mon night`); otherwise the weekday and
  the date: `Tue, 16 Kislev` / `Tue, Nov 26` / `Tue, Nov 26 (16 Kislev)`,
  and for a night the date of its evening and the Hebrew date it begins:
  `Mon night, eve of 16 Kislev` / `Mon night, Nov 25` /
  `Mon night, Nov 25 (eve of 16 Kislev)`. A reminder says "today" or
  "tomorrow" only when all the time it may be sent falls on one date. A
  date that was typed is repeated in full with its year. Every default text
  fits its segments in all three settings (test/texts.test.ts); for that,
  three defaults were shortened: the confirmation of a hefsek names the
  first clean day only (`Clean days from ...`), `status.before_first_day`
  is `Clean days begin ... Mikvah ...`, and `status.before_hefsek_later` is
  `Niddah since ... Hefsek can be done ... before ...`.

## How a reply is read

In this order:

1. **The carrier words** (STOP, START, HELP and the others Telnyx acts on)
   are handled first, exactly as before. HELP and START get the wording
   filed with the carrier.
2. **A digit alone, an empty text (a picture), or a text over 400
   characters**: not understood.
3. **The free text the last text asked for**: a ZIP code, or a date ("Nov
   22 night", "11/26", "yesterday", "last night", "9pm").
4. **The options of the last text sent to that phone.** They are kept in
   the household's encrypted record until the next text replaces them, or
   for 24 hours. A reply chooses an option when, ignoring case and
   punctuation, it equals the option's label, or contains one of the
   option's own words as a whole word (a word of its label that no other
   option has, and for the main options their general words), and exactly
   one option matches. Two matching is not understood. A reply that names a
   general word of something else (for example `status` while the options
   of the history are waiting) goes to that word instead.
5. **The general words**, at any time. Each is a list the operator can
   change:

   | Does | Words |
   |---|---|
   | Period began | period, flow, started, bleeding |
   | Hefsek done | hefsek |
   | Status | status, where |
   | Undo | undo |
   | Main options | menu, options, more (`?` too; `more` shows MORE's page) |
   | Stain, count broken | stain; broken |
   | History, location, customs, nightfall, vesatot | history; location, zip; customs, custom; nightfall; vesatot |
   | Reminders, kinds, wording | reminders, reminder; kinds; wording |
   | Phones, add, leave | phones, phone; add; leave |
   | Calendar, terms, dates, sign-in link, setup, delete | calendar; terms; dates; web, website; setup; delete |
   | Join (already signed up) | join |
   | On the website only | password, download, export, google, times |

   A word that records takes a time or a date after it: `period now`,
   `period last night`, `period yesterday 9pm`, `period Nov 22 night`,
   `hefsek yesterday`, `hefsek 11/26`. A few settings take one too:
   `location 08701`, `reminders on`, `reminders off`, `wording discreet`,
   `terms hebrew`, `dates both`, `calendar link`, `pause vesatot`, `resume vesatot`,
   `delete account`.
6. **Otherwise**: `Not understood; nothing was changed.` with the main
   options.

Nothing is guessed: no AI, no fuzzy matching. A text that is not
understood changes nothing.

## Signing up

A text from a number that has no account is answered only if the operator
allows sign-up by text (`textSignup`, off as shipped), sign-up is not
closed, the number has an allowed prefix and is not reserved for fiction,
and the limits below are not reached. The exception is a phone joining an
account with a code, which works in every mode.

```
> Hi
< Betaharah: a mikvah calendar by text. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help. Terms: betaharah.com/terms
  Reply: JOIN
> JOIN
< Welcome to Betaharah. Setup step 1 of 3: your ZIP code (or Canadian postal code), for the times of sunset.
  Reply: SKIP
```

By invitation, JOIN and an invitation word creates the account; anything
else gets one text saying sign-up is by invitation, and a word that is not
valid gets one text. While sign-up is closed, nothing is sent: each reply
costs money and invites more texts. A word after JOIN that is not valid
never creates an account.

**Limits for numbers without an account** (constants in
`src/app/conversation.ts`, counted by keyed fingerprints only): one reply
per number in 24 hours, 50 replies a day for the site, 25 accounts a day by
text, and 30 texts an hour from any one number. HELP and START have their
own limits (4 per number a day, 100 a day for the site).

## Setup

```
< Welcome to Betaharah. Setup step 1 of 3: ...
> 08701
< Location set: Lakewood, NJ 08701. Step 2 of 3: customs. Until they are chosen, the stricter option of each is used.
  Reply: KEEP FOR NOW, ANSWER BY TEXT, LATER
> answer by text
< Custom 1 of 12: Days before the hefsek, the day she became niddah being day 1: five (Ashkenazi, some Sephardi) or four (some Sephardi). Now: five days.
  Reply: FIVE DAYS, FOUR DAYS, KEEP
  ... (each answer is confirmed with "Saved:" or "Kept:", then the next custom)
< Kept: nightfall: 8.5 degrees. All 12 customs are saved. Step 3 of 3: when did the last period begin? For example: Nov 22 night.
  Reply: SKIP
> Nov 1 night
< Recorded: flow Sun night, eve of 22 Cheshvan 5787. Hefsek from Fri, 26 Cheshvan. Hefsek done? Its date, for example: Nov 27.
  Reply: NOT YET
> 11/6
< Recorded: hefsek Fri, 26 Cheshvan 5787. Clean days from Shabbat, 27 Cheshvan. Mikvah Fri night, eve of 4 Kislev after 5:25 PM. Setup is done. Reminders are off for now.
  Reply: PERIOD, HEFSEK, REMINDERS, MORE
```

SKIP at step 1 leaves the location for later (by RCS, a shared location
answers it). Answering all twelve customs marks them as reviewed, as saving
them on the website does. `setup` starts it again; with a location set,
step 1 offers KEEP. Nothing asks about the immersion: once the seven clean
days are over the calendar takes it that she immersed on the mikvah night.

## Recording

```
> period
< When did it begin?
  Reply: NOW, LAST NIGHT, ANOTHER DAY          (at night: NOW, TODAY BY DAY, ANOTHER DAY)
> last night
< Recorded: flow last night. Hefsek from Shabbat.
  Reply: UNDO, STATUS
> hefsek
< Hefsek tahara: which day?
  Reply: TODAY, YESTERDAY, ANOTHER DAY
> another day
< Which date? For example: Nov 26.
  Reply: MENU
```

- Stain and count broken (under MORE, OTHER ENTRIES) ask "when?" with the
  same options as PERIOD. The immersion is there too, optional: it asks
  which night (TONIGHT at night, LAST NIGHT, ANOTHER DAY). Nothing prompts
  for it.
- A date is month/day (`11/22`, `11/22/26`) or a month name and day (`nov
  22`, `november 22 2025`). Without a year it is the most recent such date
  not after today. A period, stain or broken count needs day, night or a
  time after the date ("night" is the night that begins that evening); a
  hefsek or immersion takes the date alone.
- A Hebrew date in English letters, day then month, is read too: `15
  kislev day`, `period 3 teves night`, `hefsek 12 kislev`, with the usual
  spellings (`cheshvan`/`heshvan`, `tevet`/`teves`, `shevat`/`shvat`,
  `adar i`/`adar 1`, `adar ii`/`adar2`...). It is the most recent such date
  that has begun. Its night is the night before its day (`15 kislev
  night` began on the evening of 14 Kislev), and a clock time is the time
  within that Hebrew date (after sunset: the evening before). In a leap
  year, plain `adar` asks which one (`date.adar`).
- Every website check applies (no period open, before the period began, a
  time to come, already recorded); a refusal for a written date adds the
  date as it was read: `Not recorded: no period is open. (Read as Thu, 7
  Kislev 5786.)`
- A time shortly after sunrise or sunset adds `Counted as night: sunset
  was 4:31 PM.` (information only).
- `undo` removes the latest entry of the last 48 hours and gives the
  status; `history` lists the latest five as FIRST to FIFTH, and erasing
  one asks YES or NO.
- A phone that may not record (set on the website) is told so, and can use
  everything else.

## Status

`status` (or `where`) answers in the words of the phase: `Tehorah.` (with
the next onah when there is one), `Niddah since ... Hefsek from ...`,
`Clean days begin ...`, `Clean day 3 of 7. Mikvah ... after ...`, `Mikvah
tonight after ...`. Its options are PERIOD, HEFSEK, HISTORY, MORE.

## Reminders

Off for each phone until turned on (`reminders`, then `TURN ON`, or
`reminders on`), which is the consent:

```
< Reminders are on for this phone (ending 0101). This phone agrees to receive reminder texts from Betaharah. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help.
  Reply: KINDS, STATUS
```

The hefsek reminder offers `DONE`, which records the hefsek on the day the
reminder was about; every other reminder offers `STATUS`:

```
< Hefsek tahara: today, before sunset at 4:33 PM.
  Reply: DONE, STATUS
> done
< Recorded: hefsek today. Clean days from tomorrow. Mikvah Thu night, eve of 24 Kislev after 5:16 PM.
  Reply: UNDO, STATUS
```

`kinds` shows which kinds this phone gets, and each option (TAHARA, AM
BEDIKAH, PM BEDIKAH, MIKVAH NIGHT, BOOKING, ONAH) turns one on or off.
`wording` chooses plain or discreet wording for the whole account (the
discreet hefsek reminder is `H today before 4:33 PM.`, with the same
options). Reminder times are set on the website.

## Settings, phones and the account

- **Location**: `location` shows it; a ZIP code then changes it, or
  `location 11219` at once. By RCS, a location shared without a question
  asks YES or NO. Places outside the US and Canada are set on the website.
- **Customs**: `customs` lists them in three pages of options (and ALL 12
  goes through all twelve); each custom offers its options and KEEP.
  Pausing vesatot asks YES or NO; `resume vesatot` turns them back on.
- **Calendar**: CREATE LINK, SHOW LINK, NEW LINK (YES or NO), REMOVE LINK
  (YES or NO). Google Calendar is connected on the website.
- **Terms**: HEBREW or ENGLISH, for the calendar and the website; texts
  are always in English letters.
- **Dates**: HEBREW, CIVIL or BOTH, for the texts, the calendar and the
  website (`dates civil` at once). The change is confirmed with today's
  date written the new way: `Changed: dates are Hebrew and civil, e.g. Tue,
  Nov 24 (14 Kislev).`
- **Phones**: `phones` lists them (first, second...); ADD gives an
  eight-letter code that the other phone texts back as `JOIN <code>` within
  7 days (nothing is sent to the other phone); REMOVE asks which, then YES
  or NO; LEAVE asks YES or NO (the only phone cannot leave). At most four
  phones.
- **WEB LINK**: one plain SMS with a sign-in link that works once, within
  10 minutes, for this phone only.
- **Delete account**: asks YES or NO; the account is deleted before the
  reply is sent.

Anything that cannot be undone asks YES or NO first: erasing an entry,
removing a phone, leaving, deleting the account, replacing or removing the
calendar link, pausing vesatot, and a shared location.

## The texts filed with the carrier

Three texts keep the wording filed for the toll-free verification and
carry no options line: the sign-in code (`Betaharah code: {code}. It
expires in {minutes} minutes. Do not share it.`), the reply to HELP
(`Betaharah: text ? for commands. Help: admin@betaharah.com. Reply STOP to
opt out.`) and the reply to START (`Betaharah: you're subscribed to
reminder texts. Message frequency varies. Msg&data rates may apply. Reply ?
for help, STOP to opt out.`). The operator can change them like the others;
the Texts page marks them.

## The operator's wording

The console's **Texts** page shows every message, grouped, with when it
is sent, how it looks by SMS and by RCS with example values, and its
length and number of segments. The operator can change each body (with its
placeholders), each option label, the general words and the prefix of the
options line. The changes are one readable row of the `site` table
(`texts`), loaded with the site's settings in its one query, so a text
costs no extra query. A change is checked before it is saved:

- required placeholders present, no unknown placeholder;
- only GSM-7 characters (the one that is not is named);
- the whole text with the example values and the options line at most 306
  characters (two segments);
- labels: 1 to 20 letters, digits and spaces, unique within the message,
  no word the carrier acts on (STOP, START, HELP, INFO, CANCEL, END, QUIT,
  ...), and no general word of another action;
- general words: one word each, not digits only, not a carrier word, in
  one list only, and not a word of an option that does something else.

The ids of the options (what each does) are fixed in the code.

## How the server runs it

`converse()` (pure: no database, network, clock or randomness of its own)
gets the household, the phone's pending options (`ChatState`: the
message's key, the options as shown, what free text it asked for, and what
its options need, such as the history's entry ids), the text, and the
operator's wording; it returns the texts, the new options, the effects
only the server can carry out (a code for a phone, removing a phone,
leaving, deleting the account, the sign-in link) and whether the household
changed. Every received text takes this one path: the webhook, the test
account's "Try a text" box, and the console's simulator.

Reminders are queued with their message key and values and rendered in the
operator's wording when they are sent; a reminder sent becomes the last
text to that phone, so its options (DONE, STATUS) answer the next reply.
