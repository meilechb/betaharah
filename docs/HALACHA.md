# What the calendar calculates, and from where

This page states every rule the program applies, so that a rav can check it.
The program does arithmetic on dates. It does not rule on anything: stains,
colours, bedikah results, a hefsek close to sunset, and every case of doubt
are questions for a rav, and the program says so where it can tell.

Sources: the published guides of Nishmat's Yoatzot Halacha (yoatzot.org),
quoted by page below, and the open-source calculator Luach
(github.com/ComputeHalacha/Luach), whose list of options was compared with
this one. Each rule is covered by tests in `test/`; the worked examples in
the tests are the ones printed on those pages.

## Days and onos

- The Hebrew date begins at sunset.
- An onah is half of a Hebrew date: the night, from sunset to sunrise, or the
  day, from sunrise to sunset. (Yoatzot, "Times of sunrise and sunset".)
- Sunrise and sunset are calculated for the location in the settings, at sea
  level unless "adjust for elevation" is on. They are the moments the upper
  edge of the sun is on the horizon. The calculation is the NOAA solar
  algorithm; the tests compare it with Hebcal's zmanim library every day for
  two years in eight cities (largest difference under 2 seconds).
- A time shown as a deadline (before sunset) is rounded down to the minute; a
  time shown as a start (after nightfall) is rounded up.

## Becoming niddah, and the count

Source: Yoatzot, "Minimum Wait", "Hefsek Taharah", "Seven Clean Days".

- The day she becomes niddah is day 1, whether from a flow or a stain. That
  day is the Hebrew date: a flow after sunset belongs to the next date.
- **Minimum wait** (setting): the hefsek taharah is on day 5 at the earliest,
  or day 4.
- The hefsek is done before sunset. The calendar shows minchah ketanah
  (9.5 proportional hours after sunrise, sunrise-to-sunset day) as the
  preferred earliest time, and sunset as the deadline.
- **A hefsek recorded before the earliest day** is kept, the clean days start
  only after the wait, and the entry is marked "ask a rav".
- **Seven clean days** begin the night after the hefsek. Reminders are for a
  bedikah each morning and each afternoon before sunset; days 1 and 7 are
  marked as required. The account chooses which of the seven days get
  them (default all seven) and whether the morning one, the one before
  sunset, or both are sent (default both); a day not chosen gets none. The
  morning after the hefsek is recorded, a reminder to book the mikvah names
  the mikvah night (none if that morning is already the day of the mikvah
  night).
- **Reminder times** (when, not what): unless the account set another
  time, the hefsek is sent 2 hours before sunset, the bedikah before sunset
  90 minutes before it, the mikvah night 3 hours before sunset, and the onah
  2 hours before it begins (at sunset or sunrise).
- **Shabbos and Yom Tov**: nothing is sent from candle lighting (18 minutes
  before sunset) until nightfall, a run of such days (Yom Tov into Shabbos)
  counting as one. Every reminder whose time falls in it, and a mikvah night
  that is a Friday or Yom Tov night, is one line of one text sent the
  morning the run begins (9:00 AM, or the time set; never later than 90
  minutes before candle lighting), with its day and time, so a mikvah night
  on Friday night or right after Shabbos is known beforehand. What becomes
  known after that text and before candle lighting goes at once in a second
  text; what becomes known during the days goes after nightfall, if still
  ahead.
- **A flow or stain after the hefsek**, while the seven clean days are still
  being counted, or a "count broken" entry, cancels the count. A new hefsek
  is needed. The minimum wait is not started again.
- **Immersion is assumed (owner's instruction).** Once a hefsek taharah is
  recorded and the seven clean days are complete, the calendar takes it that
  she immersed on the mikvah night. Nothing asks whether she went. On the
  mikvah night the status is "Mikvah night"; from the next sunrise it is
  tehorah. Recording an immersion stays possible and optional: a recorded one
  closes the period on its own night (a later night, if she went later). A
  hefsek or a "count broken" dated after the mikvah night has no period to
  belong to and is refused.
- **A flow or stain after the count was over** begins a new period, with
  its own days of waiting: (a) the earlier period has a hefsek and its seven
  clean days are over (the flow is on the first night she could have
  immersed, or later): she is taken to have immersed, so this is simply the
  next period, with no note; or (b) the earlier period has no hefsek
  recorded at all and the flow comes on or after what would have been its
  earliest night of immersion (the days of waiting plus seven). In (b) the
  record is incomplete; the calendar takes the stricter reading (a new
  period, the wait counted again) and says in one line that no hefsek
  taharah was recorded for the period before. The earlier period keeps what
  was recorded for it (in (a), its hefsek, clean days and mikvah night stay
  on the calendar as they were). Before (a) and (b), bleeding continues the
  same period as above.
- **A second hefsek** replaces the first (this can only make immersion
  later).
- **Immersion** is on the night after the seventh day, after nightfall
  (setting: degrees below the horizon, or minutes after sunset).
- **Not on the night of Yom Kippur or of Tisha B'Av**: the night moves to the
  next one. When 9 Av is Shabbos the fast is on Sunday: Friday night is a
  permitted night, Saturday night is not. (Yoatzot answers on immersion
  after Yom Kippur and around Tisha B'Av.)
- Friday night, Yom Tov night, and the night after Shabbos or Yom Tov are
  noted on the event (preparation beforehand). The time shown is nightfall in
  every case.
- An immersion recorded before the count is complete is refused.

## Onos perishah without a vest kavua

Source: Yoatzot, "Guide to Vesatot", "Onah Beinonit", "Veset Haflagah",
"Veset Kavua", and the answer on a flow that began on the 30th.

All three are counted from the onah in which the latest flow began, and are
in the same onah (day or night) as that flow. They stop applying when the
next flow begins. A stain does not create vestos. A flow can be marked "not
for vestos" when a rav says so.

### Onah beinonis
- Day 30, the day of the flow being day 1 (always four weeks and one day
  later).
- Setting: day 30 only, day 31 only, or both.
- Setting: one onah, or the whole Hebrew date (night and day).

### Vest hachodesh
- The same day of the next Hebrew month.
- Setting: one onah, or the whole Hebrew date. (Luach applies its 24-hour
  option here too; Yoatzot mentions it for the onah beinonis.)
- A flow on the 30th when the next month has 29 days. Setting: the 1st of
  the month after (the ruling Yoatzot follows), the 29th, both (as Luach
  does), or none.

### Vest haflagah
- **Counted in days** (setting): the number of days from the first day of the
  previous flow to the first day of the latest, counting both. The vest is
  that many days from the latest flow, counting its first day as day 1.
  Example: 2 Nisan and 30 Nisan are 29 days; the vest is 28 Iyar.
- **Counted in onos from the hefsek** (setting; Shulchan Aruch HaRav, the
  Chabad custom as Yoatzot describes it): the number of onos from the first
  night of the clean days through the onah in which the next flow began,
  counting both; the vest is that many onos from the first night of the
  clean days of the current period. This needs the hefsek of both periods
  to be recorded; until then the dashboard says the haflagah is waiting.
- Always a single onah.
- **A longer interval that was not passed** (setting): either only the latest
  interval is observed, or also every earlier, longer interval that she has
  not since passed without a flow, each counted from the latest flow. An
  interval is passed when a later interval is longer than it.

### Or Zarua
- Setting: also separate on the onah before each onas havest.

### Long cycles
- Setting. When on: after three consecutive cycles in which the flow began
  after day 31, onah beinonis and vest hachodesh are not observed (the
  haflagah still is). A cycle that begins on day 31 or earlier brings them
  back for the next cycle; a long cycle after that removes them again at
  once; three consecutive shorter cycles end the exemption until three
  consecutive long ones return.

### Pausing
- Setting: no vestos are calculated (pregnancy, nursing, or on a rav's
  instruction). The program does not decide when this applies.

## What the program only points out

- **A possible vest kavua.** Three flows in a row on the same day of the
  month in the same onah; three equal intervals in a row (four flows, the
  last three in the same onah); intervals or dates that move by a fixed
  step. The dashboard says "ask a rav". The program never applies a vest
  kavua by itself: it goes on showing the three ordinary vestos.
- **An onah that falls on the night of immersion.** Marked "ask a rav".
- **A flow recorded shortly after sunset or sunrise.** The reply says which
  onah it was counted in and how to change it.

## What the program does not do

These are not calculated. Where they apply, follow the rav's instructions;
the calendar's ordinary vestos may not be the right ones.

- Applying a vest kavua, uprooting one, or a vest haguf.
- Vestos under hormonal contraception.
- The rules of pregnancy and nursing (beyond the "pause" setting).
- The Chabad "uncertain days" of the haflagah.
- Counting four days from the last relations (the custom of some Sephardi
  communities); the four-day setting counts from the day niddah began.
- Keeping day 30 or 31 from an earlier flow after a new flow has begun (one
  of the things Luach's "Taz" option does).
- Counting the haflagah in onos from flow to flow (a separate option in
  Luach).
- Anything about a kallah, childbirth, or a medical procedure.

## Defaults

Until the settings are saved in the dashboard, the stricter option is used
wherever one option adds separation: five days, days 30 and 31, the onah
beinonis for the whole date, Or Zarua, longer intervals kept, both the 29th
and the 1st, no long-cycle exemption. The dashboard shows a notice until the
settings have been reviewed and saved.
