# Betaharah by text message

Everything in Betaharah can be done by text message alone: signing up,
setting up, recording, and managing the account. This page lists every
text a person can send and exactly what comes back. It is also the
reference for the carrier review and for whoever connects the engine
(`src/app/chat/`) to the server.

The examples were produced by the engine itself (the tests check the same
texts). They assume Lakewood, NJ, on Tuesday 24 November 2026. In the
examples `>` is what the person sends and `<` is what Betaharah sends back;
`[buttons: ...]` are the tap-to-reply buttons an RCS phone shows under the
text. A phone that has only SMS sees the same text without buttons, and the
text always says in words what to send.

## The rules every reply follows

1. **Digits always record an event, and nothing else.** `1 2 3 4 5 9 0 ?`
   with their additions work at any moment, even while a question is
   waiting. No question is ever answered with a digit. Answers are letters
   (A, B, C ...), YES or NO, a ZIP code where one is asked for, or words.
   So a person answering a question can never record a flow by accident,
   and a person recording a flow can never answer a question by accident.
2. **Nothing is guessed.** A text that is not fully understood changes
   nothing, and the reply says so ("Not understood; nothing was changed.")
   and what to send instead.
3. **Every change is confirmed** by a reply that says what was changed.
4. **Length and characters.** Every text uses only the basic GSM-7
   characters (no curly quotes, dashes, emoji or accents outside GSM-7), so
   it is sent at 160 characters a segment. Most replies fit one segment
   (160 characters); none is longer than two (306). At most two texts go
   back for any one text received. Each segment costs about a cent.
5. **Wording.** Plain, literal sentences. No exclamation marks, emoji,
   figures of speech or jokes. Halachic terms in English letters, as the
   existing texts write them (hefsek, bedikah, mikvah, onah, veset). The
   app does not rule on halacha: on customs, the replies say the calendar
   follows what the person selected, and "ask a rav" appears where the app
   already says it.
6. **A question closes after 30 minutes.** An answer sent later is treated
   as a new text: nothing changes, and the reply says the question closed
   and which word asks it again.
7. **STOP, START, HELP** and the other carrier words (STOPALL, UNSUBSCRIBE,
   CANCEL, END, QUIT, REVOKE, OPT OUT, UNSTOP, INFO) are handled by the
   carrier and the existing code before the conversation engine, and none
   of them is used as a command word here. YES is used only to confirm an
   action that was just described, never as an opt-in.
8. **Anything that cannot be undone asks first.** Erasing an entry,
   removing a phone, leaving the account, deleting the account, replacing
   or removing the calendar link, pausing vesatot, and texting an
   invitation to another number each need YES.

## Signing up

A text from a number that has no account.

**While sign-up is open**, any text gets one reply:

```
> Hi
< Betaharah is a mikvah calendar by text message. Reply JOIN to sign up. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help. Terms: betaharah.com/terms
  [buttons: Join]
> JOIN
  (the account is created with this phone; setup begins, below)
```

**While sign-up is by invitation**, `JOIN` and an invitation word creates
the account. Anything else gets:

```
< Betaharah is a mikvah calendar by text message. Sign-up is by invitation: reply JOIN and your invitation word. Msg&data rates may apply. Reply STOP to stop, HELP for help. Terms: betaharah.com/terms
```

and a word that is not valid (or has expired) gets:

```
> JOIN WRONG
< Betaharah: that invitation word is not valid, or it has expired. Nothing was set up. Reply STOP to stop, HELP for help.
```

A word after JOIN that is not valid never creates an account, even while
sign-up is open, so that a husband who mistypes his wife's invitation code
does not end up with a separate account.

**While sign-up is closed, nothing is sent**, whatever the text. Why:
strangers and wrong numbers will text this number. Each reply costs money,
and a reply invites more texts. When sign-up is closed the operator has
decided not to take new accounts, so a reply could only say "no", which
helps nobody enough to be worth paying for every wrong number and every
automated text. Today's site already sends nothing to strangers. The
public page says when sign-up is closed.

By invitation, one reply is sent, because someone who heard about the
service needs to know that an invitation word is what is missing; a wrong
word gets one reply, because people mistype. The server should limit
replies to numbers without an account (for example, at most one reply per
number per day, and a daily total for the site), because each one costs
money.

**A phone invited by an account** (see PHONES) replies `JOIN` and the code
from that invitation. This works whether sign-up is open, by invitation or
closed, because it adds the phone to an existing account:

```
> JOIN NRMAAABZ
< This phone is now on the account with the phone ending 0101. Text 9 for status, MENU for everything. Reminders are off for this phone until you text REMINDERS ON.
  [buttons: Status / History / Customs / Reminders]
```

## Setup

Right after JOIN. It can be started again at any time with `SETUP`.

```
< Welcome to Betaharah. This phone is signed up. Step 1 of 3: reply with your ZIP code (in Canada, your postal code, e.g. H3W 1A1). It sets the times of sunset.
> 99999
< No place was found for 99999. Reply with a 5-digit US ZIP code or a Canadian postal code. For other countries, send WEB for a link to set it on the website.
> 08701
< Location set: Lakewood, NJ 08701. Sunset and nightfall are now worked out for it.
< Step 2 of 3: customs. Until you choose, the calendar uses the stricter option of each custom, ideally chosen with your rav. Any can be changed at any time. A: keep them for now. B: answer the 12 questions by text. C: do it later on the website. Reply A, B or C.
  [buttons: A: Keep for now / B: Answer by text / C: Later, website]
```

On an RCS phone, sharing a location answers step 1 as well (the nearest
ZIP code is used).

Step 2, answer A:

```
> A
< The stricter option of each custom stays until you change it. CUSTOMS changes one at any time. Step 3 of 3: recent dates. Send the start of the most recent period: 1, the date, and day or night, e.g. 1 11/22 night (the night that begins that evening). Or reply SKIP.
  [buttons: Skip]
```

Answer C:

```
> C
< Customs can be reviewed on the website, under Customs. Until then the stricter option of each is used. Step 3 of 3: recent dates. ...
```

Answer B goes through the twelve questions below, one text each. Every
answer is confirmed ("Saved:" when it changed something, "Kept:" when it did
not) together with the next question:

```
> B
< Custom 1 of 12: Days to wait before the hefsek, counting the day she became niddah (by a flow or a stain) as day 1. A: five days (Ashkenazi custom, and some Sephardi communities). B: four days (some Sephardi communities). For four days from the last relations, ask a rav. Now: A. Reply A or B, or KEEP.
  [buttons: A: Five days / B: Four days / Keep]
> A
< Kept: wait before hefsek: Five days. Custom 2 of 12: Onah beinonit: which day. The day of the flow is day 1. A: day 30 only. B: day 31 only. C: day 30 and day 31. Now: C. Reply A, B or C, or KEEP.
  [buttons: A: Day 30 only / B: Day 31 only / C: Days 30 and 31 / Keep]
> KEEP
< Kept: onah beinonit day: Days 30 and 31. Custom 3 of 12: Onah beinonit: how long. ...
> A
< Saved: onah beinonit length: One onah. Custom 4 of 12: Veset hachodesh: how long. ...
  ... (questions 4 to 12)
> A
< Kept: nightfall: 8.5 degrees. All 12 customs are saved. The calendar follows what you selected. CUSTOMS changes one at any time. Step 3 of 3: recent dates. Send the start of the most recent period: 1, the date, and day or night, e.g. 1 11/22 night (the night that begins that evening). Or reply SKIP.
  [buttons: Skip]
```

Answering all twelve marks the customs as reviewed, as saving them on the
website does (the website's "review your customs" notice goes away).

Step 3 uses the dated record commands (below). They work at any time, not
only here:

```
> 1 11/1 night
< Recorded: flow Sun Nov 1 night, 2026. Hefsek from Fri Nov 6. 0 to undo. If they followed: send 2 and the hefsek date (2 11/26), and 4 and the evening of immersion (4 12/3). Reply DONE when finished.
  [buttons: Done]
> 2 11/6
< Recorded: hefsek Fri Nov 6, 2026. Clean days Sat Nov 7 - Fri Nov 13. Mikvah Fri Nov 13 after 5:25 PM. 0 to undo. The question before is still open: send 2 or 4 with a date, or DONE.
  [buttons: Done]
> 4 11/13
< Recorded: mikvah Fri Nov 13 night, 2026. 0 to undo. The question before is still open: send 2 or 4 with a date, or DONE.
  [buttons: Done]
> DONE
< Setup is finished. From now on text 1 when a flow begins, 2 after the hefsek, 4 after immersion, 9 for status. Reminders are off until you text REMINDERS ON. MENU lists everything.
  [buttons: Status / History / Customs / Reminders]
```

`SKIP` instead of a date finishes setup the same way.

`SETUP` when a location is already set:

```
> SETUP
< Setup. Step 1 of 3: your location is Lakewood, NJ 08701. Reply with a new ZIP code, or KEEP to keep it.
  [buttons: Keep]
```

## The customs questions, exactly as texted

These are shortened from the website's wording (`HALACHIC_CHOICES` and the
nightfall presets in `src/engine/settings.ts`) without changing their
meaning: the same options, in the same order, mapped to the same stored
values (a test checks every key and every value). "Now:" shows the
household's current choice; until customs are saved that is the stricter
option.

1. Custom 1 of 12: Days to wait before the hefsek, counting the day she became niddah (by a flow or a stain) as day 1. A: five days (Ashkenazi custom, and some Sephardi communities). B: four days (some Sephardi communities). For four days from the last relations, ask a rav. Now: A. Reply A or B, or KEEP.
2. Custom 2 of 12: Onah beinonit: which day. The day of the flow is day 1. A: day 30 only. B: day 31 only. C: day 30 and day 31. Now: C. Reply A, B or C, or KEEP.
3. Custom 3 of 12: Onah beinonit: how long. A: one onah, the same as that of the flow (day or night). B: the full day: the night and the day of that date. Now: B. Reply A or B, or KEEP.
4. Custom 4 of 12: Veset hachodesh: how long. A: one onah, the same as that of the flow (day or night). B: the full day: the night and the day of that date. Now: A. Reply A or B, or KEEP.
5. Custom 5 of 12: The onah of the Or Zarua: separation also on the onah before each veset onah. A: observed. B: not observed. Now: A. Reply A or B, or KEEP.
6. Custom 6 of 12: How the veset haflagah is counted. A: in days, from the start of one flow to the start of the next. B: in onot, from the hefsek to the next flow (Shulchan Aruch HaRav; Chabad custom). Counting in onot, record the hefsek every month: the count starts from it. Now: A. Reply A or B, or KEEP.
7. Custom 7 of 12: A longer haflagah never passed: a flow came after a shorter interval, before the day of the earlier, longer one. A: only the latest haflagah is observed. B: every longer haflagah not yet passed without a flow is observed too. Now: B. Reply A or B, or KEEP.
8. Custom 8 of 12: A flow on the 30th, when the next month has 29 days. A: the 1st of the month after is observed. B: the 29th is observed. C: both the 29th and the 1st of the month after are observed. D: no veset hachodesh that month. Now: C. Reply A, B, C or D, or KEEP.
9. Custom 9 of 12: Cycles that regularly run past day 31: three times in a row the flow began after day 31 from the one before. A: onah beinonit and veset hachodesh are observed as usual. B: they are not observed, as long as a flow does not come earlier again. Now: A. Reply A or B, or KEEP.
10. Custom 10 of 12: Calculating vesatot (pregnancy, nursing, or on the instruction of a rav). A: vesatot are calculated. B: no vesatot are calculated for now. Now: A. Reply A or B, or KEEP.
11. Custom 11 of 12: Yom Tov. A: outside Israel (two days). B: Israel. Now: A. Reply A or B, or KEEP.
12. Custom 12 of 12: Nightfall, for the time of immersion. A: the sun 8.5 degrees below the horizon. B: the sun 7.083 degrees below the horizon. C: 50 minutes after sunset. D: 72 minutes after sunset (Rabbeinu Tam). Now: A. Reply A, B, C or D, or KEEP.

RCS buttons: the letters with a few words (for example "A: Five days",
"B: Onot from hefsek", "A: 1st of next month"), and "Keep" when there is
room for a fourth button.

A nightfall typed in on the website that is not one of the four is shown
as, for example, "Now: 60 minutes after sunset (set on the website)."; KEEP
keeps it.

## Every command

Words may be sent in capitals or not; a full stop or comma at the end is
ignored. `MENU` lists the words.

```
> MENU
< Words: STATUS, HISTORY, UNDO, LOCATION, CUSTOMS, NIGHTFALL, REMINDERS, PHONES, CALENDAR, TERMS, WEB, SETUP, DELETE ACCOUNT. Send one to see its options. Digits record: 1 flow, 2 hefsek, 3 count broken, 4 mikvah, 5 stain, 9 status, 0 undo; ? for more.
  [buttons: Status / History / Customs / Reminders]
```

Each word sent alone shows its own options (a second level of the menu).

### Recording: digits

The existing commands are unchanged, with their existing replies:
`1` flow began, `2` hefsek done, `3` count broken, `4` immersed, `5` stain,
`9` status, `0` undo. After 1, 3 or 5: `day`, `night`, `yesterday day`,
`yesterday night`, or a time (`9pm`, `9:30pm`, `21:30`). After 2 or 4:
`yesterday`.

```
> 1
< Recorded: flow Tue Nov 24 night. Hefsek from Sun Nov 29. 0 to undo.
> 0
< Removed: flow Tue Nov 24 night. Tehorah.
> 1 tomorrow
< Not understood; nothing was changed. 1 flow began, 2 hefsek done, 3 count broken, 4 mikvah, 5 stain, 9 status, 0 undo. After 1/3/5 you may add: day, night, yesterday day, or a time (9pm).
> ?
< 1 flow began, 2 hefsek done, 3 count broken, 4 mikvah, 5 stain, 9 status, 0 undo. After 1/3/5 you may add: day, night, yesterday day, or a time (9pm). A date also works: 1 11/22 night, 2 11/26, 4 12/3. MENU lists the words.
```

Three replies differ from the existing code, for a phone that may not have
the website: with no location set, the reply says `Not recorded: no
location is set yet. Send LOCATION and your ZIP code, e.g. LOCATION 08701.`
(and for 9, `No location is set yet. ...`) instead of "choose your location
on the website first"; `0` with nothing recent to undo says `Nothing recent
to undo. Older entries can be erased by text: send HISTORY.`; and `?` adds
the dated forms and MENU, as above.

### Recording: with a date

For past dates (setup step 3, or anything forgotten):

| Text | Records |
|---|---|
| `1 11/22 day` | flow by day on Nov 22 |
| `1 11/22 night` | flow in the night that begins on the evening of Nov 22 |
| `1 nov 22 9pm` | flow at 9 pm on Nov 22 (day or night is worked out from the time and sunset) |
| `3 11/28 day`, `5 11/20 night` | count broken, stain: the same forms as 1 |
| `2 11/26` | hefsek on Nov 26 |
| `4 12/3` | immersion on the evening of Dec 3 |

The date is month/day (`11/22`, `11/22/26`, `11/22/2026`) or a month name
and day (`nov 22`, `november 22`, `nov 22 2025`). Without a year, it is the
most recent such date that is not after today: on 24 November 2026, `11/22`
is 22 November 2026 and `11/27` is 27 November 2025. 1, 3 and 5 need day,
night or a time after the date; 2 and 4 take nothing more. "Night" means the
night that begins on the evening of that date, as on the website's form.
The confirmation states the full date with its year. Every check the
website makes applies, with the same wording, and the date as it was read
is added to a refusal:

```
> 1 11/22 night
< Recorded: flow Sun Nov 22 night, 2026. Hefsek from Fri Nov 27. 0 to undo.
> 2 11/27
< Not recorded: no period is open. Send 1 or 5 first. (Read as Thu Nov 27, 2025.)
> 1 11/22
< Not understood: after the date add day, night (the night that begins that evening) or a time, e.g. 1 11/22 night. Nothing was changed.
> 1 2/30 day
< Not understood: there is no such date as 2/30. Write the month and day, e.g. 1 11/22 night. Nothing was changed.
> 1 2/29 day
< Not understood: there was no Feb 29 in the past year. Add the year, e.g. 2/29/2024. Nothing was changed.
> 2 11/26 night
< Not understood: after a date, 2 takes nothing more, e.g. 2 11/26. Nothing was changed.
> 2 12/1/2026
< Not recorded: that time has not come yet.
```

A dated entry is undone with `0` like any other, while it is the latest.

### STATUS and UNDO

`STATUS` is the same as `9`; `UNDO` is the same as `0`.

```
> STATUS
< Tehorah.
> UNDO
< Nothing recent to undo. Older entries can be erased by text: send HISTORY.
```

### HISTORY and ERASE

```
> HISTORY
< Latest entries: A hefsek Fri Nov 6. B flow Sun Nov 1 by day. To erase one, reply ERASE and its letter, e.g. ERASE A.
> ERASE B
< Erase flow Sun Nov 1 by day? Reply YES to erase it, NO to keep it.
  [buttons: Yes / No]
> YES
< Erased: flow Sun Nov 1 by day. Tehorah.
```

The list shows the latest five entries by date, with the year when it is
not this year. `ERASE` works only right after `HISTORY` (within 30
minutes), and always asks first. With no entries: `No entries yet. Record
with 1, 2, 3, 4 or 5; send ? for the details.`

### LOCATION (or ZIP)

```
> LOCATION
< Your location is Lakewood, NJ 08701. To change it, reply with the new ZIP code.
> 11219
< Location set: Brooklyn, NY 11219. Sunset and nightfall are now worked out for it.
> LOCATION 08701
< Location set: Lakewood, NJ 08701. Sunset and nightfall are now worked out for it.
```

A ZIP code sent on its own, with no question asking for one, is not taken as
a change: `To change your location, send LOCATION and the ZIP code, e.g.
LOCATION 08701. Nothing was changed.` An RCS location shared at any other
time asks first:

```
> (shares a location)
< Set your location to Chicago, IL 60645? Reply YES to set it, NO to keep Lakewood, NJ 08701.
  [buttons: Yes / No]
```

Places outside the US and Canada are set on the website (send WEB).

### CUSTOMS, NIGHTFALL, PAUSE VESATOT, RESUME VESATOT

```
> CUSTOMS
< Customs: reply a letter to see or change one. A wait before hefsek, B onah beinonit day, C onah beinonit length, D veset hachodesh length, E Or Zarua, F haflagah count, G longer haflagah, H flow on the 30th, I long cycles, J vesatot, K Yom Tov, L nightfall. CUSTOMS ALL goes through all 12.
> J
< Custom 10 of 12: Calculating vesatot (pregnancy, nursing, or on the instruction of a rav). A: vesatot are calculated. B: no vesatot are calculated for now. Now: A. Reply A or B, or KEEP.
  [buttons: A: Calculated / B: Paused / Keep]
> B
< Changed: vesatot: no vesatot are calculated for now. The calendar follows what you selected.
> NIGHTFALL
< Custom 12 of 12: Nightfall, for the time of immersion. ... Now: A. Reply A, B, C or D, or KEEP.
> D
< Changed: nightfall: 72 minutes after sunset (Rabbeinu Tam). The calendar follows what you selected.
```

`KEEP` answers `Kept as it was; nothing was changed.` `CUSTOMS ALL` goes
through all twelve, as in setup, and ends with `All 12 customs are saved.
The calendar follows what you selected. CUSTOMS changes one at any time.`
Changing one custom does not by itself mark the customs as reviewed.

Pausing vesatot asks first, because it removes the onot perishah from the
calendar:

```
> PAUSE VESATOT
< Pause vesatot? The calendar will then show no onot perishah (for pregnancy, nursing, or on the instruction of a rav) until you send RESUME VESATOT. Reply YES to pause them, NO to keep them.
  [buttons: Yes / No]
> YES
< Changed: no vesatot are calculated for now, as you selected. RESUME VESATOT turns them back on.
> RESUME VESATOT
< Changed: vesatot are calculated again, as you selected.
```

### REMINDERS, KINDS, WORDING

Reminders are for each phone, and off until turned on.

```
> REMINDERS
< Reminders for this phone are off. REMINDERS ON turns them on. KINDS chooses which kinds (now 6 of 6). WORDING PLAIN or WORDING DISCREET (now plain). Times are set on the website.
  [buttons: Reminders on / Kinds / Wording discreet]
> REMINDERS ON
< Reminders are on for this phone (ending 0101). This phone agrees to receive reminder texts from Betaharah. Msg frequency varies. Msg&data rates may apply. Reply STOP to stop, HELP for help.
> REMINDERS OFF
< Changed: reminders are off for this phone. Replies to your texts still come. REMINDERS ON turns them back on.
> KINDS
< Reminder kinds for this phone: A hefsek (on), B morning bedikah (on), C afternoon bedikah (on), D mikvah night (on), E immersion not recorded (on), F onah (on). Reply the letters of the kinds you want, e.g. A D F, or ALL or NONE. The others turn off.
  [buttons: All / None]
> A D F
< Changed: this phone gets reminders for: hefsek, mikvah night, onah. They are sent once you text REMINDERS ON.
> WORDING DISCREET
< Changed: reminder wording is now discreet for every phone on the account: short letters, such as H for hefsek and M for mikvah, instead of the words.
> TIMES
< Reminder times, in minutes before sunset and so on, are set on the website, under Settings. Send WEB for a sign-in link.
```

`REMINDERS ON` is the consent: it is recorded for this phone (with the
time), and the reply carries the consent wording. A phone that replied STOP
is told to reply START first. `WORDING` is one setting for the whole
account, as on the website.

### PHONES, ADD, REMOVE, LEAVE

```
> PHONES
< Phones: A ending 0101 (this phone, reminders off), B ending 0102 (reminders off). ADD and a number adds one, e.g. ADD 7325551234. REMOVE and a letter removes one. LEAVE takes this phone off.
> REMOVE B
< Remove the phone ending 0102 from the account? It will no longer see the calendar or get reminders. Reply YES to remove it, NO to keep it.
  [buttons: Yes / No]
> NO
< Nothing was changed.
> ADD 7325551234
< Text an invitation to (732) 555-1234 to join this account? That phone must accept it from its own phone. Reply YES to send it, NO to stop.
  [buttons: Yes / No]
> YES
< Invitation sent to (732) 555-1234. That phone must reply JOIN and the code within 7 days. Its reminders stay off until it texts REMINDERS ON.
```

The invited phone receives:

```
< Betaharah: the phone ending 0101 invited this number to share its Betaharah calendar account. To accept, reply JOIN NRMAAABZ within 7 days. If not, ignore this text. Msg&data rates may apply. Reply STOP to stop, HELP for help.
```

Its own reply proves the number and is its agreement to receive texts; its
reminders stay off until it sends REMINDERS ON itself. Codes are eight
capital letters (no I or O, no digits). Numbers are written as 10 digits,
with or without +1, spaces, dashes or brackets. Only the last four digits of
any phone are ever shown.

```
> LEAVE
< Take this phone off the account? It will get no more reminders and cannot see the calendar. The other phones keep everything. Reply YES to leave, NO to stay.
  [buttons: Yes / No]
> YES
< This phone is off the account. It will get no more texts from Betaharah unless it signs up or is invited again.
```

The only phone on an account cannot leave: `This is the only phone on the
account, so it cannot leave it. To close the account, send DELETE ACCOUNT.
Nothing was changed.` `REMOVE` works only right after `PHONES`; `REMOVE`
with this phone's letter points to LEAVE. An account has at most four
phones.

### CALENDAR

```
> CALENDAR
< No calendar link yet. CALENDAR LINK creates a private link to show the calendar in a calendar app. Google Calendar is connected on the website, under Settings.
  [buttons: Calendar link]
> CALENDAR LINK
< Calendar link created: https://betaharah.com/cal/<secret>.ics Anyone who has this link can read the calendar, so keep it private. CALENDAR NEW replaces it, CALENDAR OFF removes it.
> CALENDAR NEW
< Replace the calendar link? The old link stops working, and calendar apps that use it stop updating. Reply YES to replace it, NO to keep it.
  [buttons: Yes / No]
> YES
< Changed: new calendar link: https://betaharah.com/cal/<secret>.ics The old link no longer works; add the new one in your calendar app. Anyone who has it can read the calendar.
> CALENDAR OFF
< Remove the calendar link? Calendar apps that use it stop updating. Reply YES to remove it, NO to keep it.
  [buttons: Yes / No]
> YES
< Changed: the calendar link is removed and no longer works. CALENDAR LINK creates a new one.
```

When a link exists, `CALENDAR` says `The calendar link is on. CALENDAR LINK
shows it, CALENDAR NEW replaces it, CALENDAR OFF removes it. Google Calendar
is connected on the website, under Settings.` and `CALENDAR LINK` shows it
again with the warning.

### TERMS

```
> TERMS
< Halachic terms in the calendar and on the website are in English letters. TERMS HEBREW or TERMS ENGLISH changes it. Texts are always in English letters.
  [buttons: Terms Hebrew / Terms English]
> TERMS HEBREW
< Changed: halachic terms in the calendar and on the website are now in Hebrew. Texts stay in English letters. TERMS ENGLISH changes it back.
> TERMS ENGLISH
< Changed: halachic terms in the calendar and on the website are now in English letters. TERMS HEBREW changes it back.
```

### WEB

```
> WEB
< Betaharah sign-in link for this phone. It works once, for a short time: https://betaharah.com/...
```

(The server makes the link and sends this one text.)

### DELETE ACCOUNT

```
> DELETE ACCOUNT
< Delete the account? All dates, settings and phones are erased, and this cannot be undone. Download your data first on the website if you want it. Reply YES to delete, NO to keep it.
  [buttons: Yes / No]
> YES
< The account is deleted: all dates, settings and phones. No more texts will be sent unless you sign up again.
```

### Other replies

```
> YES          (with no question waiting; also NO, KEEP, SKIP, DONE, ALL, NONE)
< There is no question waiting for an answer, so nothing was changed. MENU lists the words.
> JOIN         (from a phone that already has an account)
< This phone is already signed up. MENU lists the words.
> xyz
< Not understood; nothing was changed. Digits record: 1 flow, 2 hefsek, 3 count broken, 4 mikvah, 5 stain, 9 status, 0 undo. MENU lists the other words.
> CALENDAR PLEASE
< Not understood; nothing was changed. Send CALENDAR LINK, CALENDAR NEW or CALENDAR OFF.
```

A word with something after it that it does not take is not understood and
changes nothing; the reply says what to send.

## What is on the website only

Each answers with one line saying where it is, and `WEB` texts a sign-in
link:

| Text | Reply |
|---|---|
| `PASSWORD` | A password is set on the website, under Settings. Send WEB for a sign-in link. |
| `DOWNLOAD` (or `EXPORT`) | Download my data is on the website, under Settings. Send WEB for a sign-in link. |
| `GOOGLE` (or `CALENDAR GOOGLE`) | Google Calendar is connected on the website, under Settings. Send WEB for a sign-in link. CALENDAR LINK works with any calendar app by text. |
| `TIMES` (or `REMINDER TIMES`) | Reminder times, in minutes before sunset and so on, are set on the website, under Settings. Send WEB for a sign-in link. |

Also website-only: a place outside the US and Canada, a nightfall other
than the four listed, using elevation, the calendar's name, style and
history, the margin around sunrise and sunset, which phones may record,
and phone names.

## Questions that wait for an answer

**30 minutes.** A question (a lettered list, YES or NO, a ZIP code) waits 30
minutes from when it was sent. After that the answer changes nothing:

```
> CUSTOMS
< Customs: reply a letter to see or change one. ...
  (31 minutes later)
> A
< That question was sent more than 30 minutes ago, so it was closed and nothing was changed. Send CUSTOMS to start again.
```

**A digit in the middle of a question** records as always, and the question
stays open (the next answer continues it):

```
> CUSTOMS ALL
< Custom 1 of 12: ...
> 1 night
< Recorded: flow Mon Nov 23 night. Hefsek from Sat Nov 28. 0 to undo. The question before is still open: reply A or B, or KEEP.
  [buttons: A: Five days / B: Four days / Keep]
> maybe
< Not understood; nothing was changed. Reply A or B, or KEEP.
  [buttons: A: Five days / B: Four days / Keep]
```

The exception is a YES-or-NO question: any other text closes it, so that a
YES sent later can never carry out something the person has moved on from.

**A word in the middle of a question** (MENU, REMINDERS, ...) closes the
question, and setup with it; `SETUP` starts setup again. `STATUS` and `UNDO`
count as digits.

## RCS buttons

A text that expects one of a few answers carries buttons: lettered options,
YES and NO, the menu, and the next step of setup. Each button sends exactly
what an SMS user would type (its postback data), so there is one parser. At
most 4 buttons per text, each label at most 20 characters. (Telnyx's RCS
documentation shows suggestions without stating a limit on their number or
label length; these limits are chosen to be safe, and are an open question
to check with Telnyx or Google's RCS Business Messaging limits.)

## What it costs

Most replies are one segment. The longer ones, two segments, are: the
sign-up welcome, the customs texts in setup and the questions, MENU, the
list of customs, the reminder kinds, REMINDERS ON (because of the consent
wording), PHONES, the calendar link texts, DELETE ACCOUNT, and recordings
whose reply adds a note. A full setup with all twelve customs answered by
text is roughly 35 to 40 segments (35 to 40 cents); keeping the customs
(answer A) makes it about 10. No reply is longer than two segments, and no text received
gets more than two texts back.

## For the integrator

The engine is `src/app/chat/` (`index.ts` exports everything). It is pure:
no database, network, clock or randomness of its own. Types are in
`types.ts`.

### Which function when

1. A text arrives (after STOP / START / HELP are handled as today).
2. **The number has no account:** `const word = joinWord(text)`; if `word`
   is not null, look it up (a sign-up invitation, or an invitation from an
   account to this number). Call
   `greet({ text, signup, inviteValid, inviteKind })`:
   - `reply`: send `out`. (Limit these per number and per day.)
   - `ignore`: send nothing.
   - `create`: create the account with this phone, verified (texting in
     proves the number), mark the sign-up invitation used if there was
     one, then call `begin({ data, from, now }, 'setup')`, save its `chat`
     and send its `out`.
   - `join`: check the invitation (`invite`) was issued for this number,
     add the phone to the household that issued it (verified, `consentAt`
     null), use up the invitation, then `begin(..., 'joined')` and send
     its `out`.
3. **The number is on an account:** call `converse({...})` with the
   household data, the phone's stored `chat`, `from`, `text` (for an RCS
   button tap, `suggestion_response.postback_data`; for a shared location,
   `text: ''` and `location` from `body.location`), `now`,
   `limits: { maxPhones: MAX_PHONES }`, the ZIP lookups, and
   `random: randomToken`.
   - Store the returned `chat` for this phone (inside the encrypted
     household document, keyed by phone number: two phones may each have a
     question open). Save the document if `changed` is true or `chat`
     differs from what was stored.
   - If `changed` is true, refresh the household's reminders and calendar
     (use `computed` when present instead of computing again).
   - Carry out each effect (below); then send `out` to `from`, in order,
     each through the household's monthly limit. If an effect could not
     be carried out, send its `ifFailed` text instead of `out`.

The engine records entries through `recordEntry` with source `'sms'`, sets
`data.sync.dirty`, and changes only the household data; phone records are
changed only for the phone that wrote (`consentAt`, `verifiedAt` on
REMINDERS ON, and its reminder kinds). Adding or removing phones is always
an effect, so that the `phones` table and the household stay in step
(`accounts.ts`).

### Effects

| Effect | What the server does |
|---|---|
| `{ type: 'invite_phone', number, code, days, text, ifFailed }` | Refuse (send `ifFailed`) if `number` is on another account, not an allowed prefix, a fictional test number, or the household is full. Otherwise store an invitation for `code`, bound to `number` and this household, valid `days` days, and text `text` to `number`. When that number replies `JOIN <code>`, greet with `inviteValid: true, inviteKind: 'phone'`. |
| `{ type: 'remove_phone', number, ifFailed }` | `removePhone(env, householdId, number, now)`. |
| `{ type: 'leave', number, ifFailed }` | `removePhone` for the phone that wrote. Send `out` first or after; the phone is still allowed to receive this one reply. |
| `{ type: 'delete_account', ifFailed }` | Send `out` first, then delete the household and its phones. |
| `{ type: 'web_link', number, text, ifFailed }` | Make a one-time sign-in link for `number` and send one text: `text` followed by the link. `out` is empty for WEB. |

### The pending question (`ChatState`)

Plain JSON: `{ v: 1, at, setup, q }`. `at` is when the question was asked;
the engine closes it after 30 minutes (`CHAT_TTL_MS`). `setup` is true
while in the setup conversation. A malformed or older value is treated as
no question (`validChat`), so it is safe to store and to drop.

### RCS

Send each `OutMessage` as an RCS text with `suggestions` mapped to reply
suggestions: `{ reply: { text: label, postback_data: send } }`. Set
`sms_fallback.text` to the same `text`: it is complete on its own.

### Things the engine relies on

- `lookupPostal("08701")` returns `{ name, latitude, longitude, timeZone,
  elevation, postal }` or null; Canadian codes are passed as `H3W` or
  `H3W 1A1`. `nearestPostal(lat, lon)` returns the nearest or null.
  Place names are made GSM-7 in replies (accents GSM-7 lacks are dropped)
  and stored as given.
- `random()` returns an unguessable token (24 random bytes, base64url, as
  `randomToken()`); it becomes the calendar link's secret, and the
  invitation code is made from it.
- `origin` (optional, default `https://betaharah.com`) is used in calendar
  links.

## Decisions made in building this

- Sign-up closed: no reply at all. By invitation: one reply. Wrong
  invitation word: one reply. Explained under "Signing up".
- A word after JOIN that is not valid never creates an account, even while
  sign-up is open.
- Setup is started by `begin(..., 'setup')`, a separate function, rather
  than by a reserved text that a person could also type.
- A digit command during a lettered question records and keeps the
  question open; a YES-or-NO question is closed by it.
- A command word closes any open question and setup.
- Dated commands without a year take the most recent such date that is not
  after today; only this year and last year are tried, so Feb 29 without a
  year is refused unless there was one in the past year.
- 1, 3 and 5 with a date need day, night or a time; a date alone does not
  say which onah, and nothing is guessed (as "yesterday" alone is refused).
- A refused dated entry shows the date as it was read, so a date taken as
  last year is visible.
- Erasing any entry by text asks first, whatever its age.
- Inviting a phone asks first, because it texts a third party.
- Pausing vesatot asks first; resuming does not.
- An RCS location shared outside a ZIP question asks first.
- A ZIP code sent with no question is not taken as a change of location.
- Only answering all twelve customs marks them as reviewed.
- `REMINDERS ON` records consent and also marks the phone verified (the
  text came from it).
- Reminder wording (plain or discreet) is one setting for the account, as
  on the website.
- `LOCATION` and `ZIP` are the same word; so are `REMINDERS` and
  `REMINDER`, `PHONES` and `PHONE`, `CUSTOMS` and `CUSTOM`, `DOWNLOAD` and
  `EXPORT`.
- A phone that may not record (set on the website) gets "This phone may not
  record entries" for 1-5, 0, UNDO, dated forms and ERASE; it can still use
  everything else.
- Invitation codes are eight capital letters without I, O or digits, so
  they cannot be confused with the digit commands or misread.
- Texts longer than 400 characters are not read.
