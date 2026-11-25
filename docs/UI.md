# The interface: files, rules, tokens and components

This is the guide for anyone changing the pages in `public/`. Read it with the
code; it is the only other document you need.

## Files and who owns them

| File | What it is | Owner |
|---|---|---|
| `public/site.css` | Tokens and every shared component. Linked first on every page. | Frozen |
| `public/app/lib.js` | DOM helper `h()`, `api()`, icons and the component builders below. | Frozen |
| `public/app/store.js` | Shared state of the signed-in page (`P`, `S`, `draft`), `adopt()`, `t()`, `run()`, `saved()`, dates. | Frozen (ask before changing) |
| `public/app/main.js` | Boot (`start()`), sign-in or dashboard, the header and the menu, the pages and hash routing, focus kept across redraws. | Dashboard agent |
| `public/app/auth.js` | Every sign-in, sign-up and invitation view. | Sign-up agent |
| `public/app/onboarding.js` | The "Getting started" card (`onboardingCard()`), to become the guided setup. | Sign-up agent |
| `public/app/auth.css` | Styles for the sign-in views and the guided setup. | Sign-up agent |
| `public/app/views/today.js`, `log.js`, `customs.js`, `shared.js` | The pages: the home (`viewHome`), Coming up, Texting and Try a text (`today.js`), the Log, Customs; and pieces two pages use (`alertsBlock`, `termsToggle`, `saveApp`). | Dashboard agent |
| `public/app/views/calendar.js` | The home's month: pages by Hebrew or civil month, the tinted niddah days, the marks, the keyboard, "Key" (the legend in a sheet), and where a day's popup opens. | Dashboard agent |
| `public/app/views/daypop.js` | The small popup of a day: what is expected, what is recorded (Edit, Delete), what can be added, the likeliest first. | Dashboard agent |
| `public/app/views/dates.js` | How the page writes a date: the Dates setting (`datesMode()`), "Today" / "Monday night" (`dayWord()`), the date as the setting has it (`dateText()`). | Dashboard agent |
| `public/app/views/sheet.js` | `openSheet()`: a native modal dialog outside the root, a bottom sheet on a phone (the menu, the Key). | Dashboard agent |
| `public/app/views/record.js` | Recording, in one place: `recordNow(body, button, where, before)` for one-tap entries (a day's popup), `notice(where)` for the server's confirmation with Undo or its refusal, `openRecord(preset, openerId)` and `recordPage()` for the full form (`#record`), `recordCard()` for "Add a past entry" on the Log. | Dashboard agent |
| `public/app/views/marks.js` | The marks of the kinds of days, used by the dashboard and the console's calculation test: `mark()` (H✓ a recorded hefsek, M✓ a recorded immersion, H? the hefsek day not recorded, outlined M a mikvah night whether ahead or past, dashed expected), `entryMark(kind)`, `legend()`, and the words beside a title: `plainTitle()` (no " (projected)"), `stateTag()` ("recorded", "not recorded", "expected"), `spoken()`, `describe()`, `assumption()`. | Dashboard agent |
| `public/app/views/settings/*.js`, `public/app/settings.css` | The Settings page: `index.js` draws the list of sections (each row with a one-line summary) and the open section; one module per section; `route.js` keeps the open section in the address (`#settings/phones`); `ui.js` has the rows and switches. | Settings |
| `test/ui/settings.cjs` | The browser run of every Settings section, on the test account and on a new account. | Settings |
| `public/app/dashboard.css` | Styles for the signed-in pages. | Dashboard agent |
| `public/index.html`, `public/landing.css` | The public landing page. | Console and landing agent |
| `public/landing-try.js` | "Try it" on the home page (`#try`): a visitor's dates worked out by `POST /api/try`, with the same marks as the dashboard; without JavaScript the section is a sentence and a link. | Console and landing agent |
| `public/admin/sections/calc.js` | The console's "Calculation test" (`#calc`), from `POST /api/admin/sandbox`. It imports `mark()` (with the H✓, M✓, H? and outlined M marks) from `public/app/views/marks.js`; its calendar styles repeat the dashboard's under `.calc` in `admin.css`. | Console and landing agent |
| `test/ui/sandbox.cjs` | The browser run of the calculation test and of "Try it". | Console and landing agent |
| `public/admin/*` (`admin.js`, `admin.css`) | The operator console. `admin.js` is still a classic script; it may become a module that imports `/app/lib.js`. | Console and landing agent |
| `test/ui-check.cjs` | The browser run of every page. Whoever changes markup it relies on updates it. | Shared |

`src/app/pages.ts` (Help, Privacy, Terms) is server code; those pages use only
`site.css` (`header.site`, `main.doc`, `footer.site`).

A page-specific style goes in that page's stylesheet, never in `site.css`.
If a component is missing, build it in your own module from the tokens and say
so in your report; do not edit the frozen files.

## Hard rules

- **Privacy.** No third-party scripts, images, analytics or CDNs.
  Everything is served from the site itself, including the fonts.
- **Fonts.** Headings about 20px and up use Bellefair (one weight, 400),
  for Hebrew and Latin. Body text, buttons, labels, inputs, small text and
  calendar cards use Heebo, a variable font, at weights 400, 500 and 600
  (`--weight-normal`, `--weight-medium`, `--weight-bold`). Both are
  self-hosted as woff2 under `public/fonts/`, split into Hebrew and Latin
  files with `unicode-range`, and loaded with `font-display: swap`. The
  Latin files are preloaded. The system font stack stays after them, so a
  missing file still draws. Bellefair has the Hebrew letters and vowel
  points, and not gershayim (U+05F4); Heebo is the next family in
  `--font-display`, so that character is drawn by Heebo. The page stays
  left-to-right.
- **Content Security Policy** (`public/_headers`):
  `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'`.
  `font-src 'self'` allows the files in `/fonts/` and still blocks a font CDN.
  So: no inline `<script>`, no `style=""` attributes, no `<style>` elements
  created at run time. Setting `el.style.x` from script works, but use classes.
  Do not loosen the policy.
- **Never insert server text as HTML.** Build nodes with `h()` and set text.
  No `innerHTML`, `insertAdjacentHTML` or `outerHTML`.
- **Language.** The interface is English and left-to-right. Halachic terms come
  from the server in the form the household chose, in `S.words`. A UI sentence
  that mentions a term uses `t('... {hefsek} ...')` so the English/Hebrew toggle
  keeps working. Never hard-code a term that exists in `S.words`
  (`src/engine/terms.ts` lists them). Hebrew words sit inside English
  sentences; the page never turns right-to-left (`dir="rtl"`).
- **Dates.** Every date the server writes (status, Coming up, the Log, alerts,
  confirmations, calendar events, texts) comes from one set of helpers,
  `src/engine/dates.ts`, and follows `S.app.dates`: `'hebrew'` (the default,
  also for accounts saved before the choice), `'civil'` or `'both'`. A time is
  named first in plain words: a weekday for a daytime ("Tuesday", "Shabbat"),
  the evening's weekday for a night ("Monday night"); with "now" known,
  "today", "tonight", "tomorrow", "tomorrow night", "yesterday", "last night",
  and the weekday alone within the coming six days. Otherwise the date follows:
  `Tue, 16 Kislev` / `Tue, Nov 26` / `Tue, Nov 26 (16 Kislev)`; a night
  `Mon night, eve of 16 Kislev` / `Mon night, Nov 25` /
  `Mon night, Nov 25 (eve of 16 Kislev)` (the civil date of its evening, the
  Hebrew date that begins then). The Log and calendar descriptions always
  write the date, with its year in the Log. The Hebrew date is in the terms'
  form (English letters or Hebrew script); texts always use English letters.
  The page does not format these itself. For a Hebrew-month view each grid day
  has `hebrewYear` (5787), `hebrewYearText` ('5787' or 'תשפ״ז') and
  `hebrewMonthId` ('5787-09': the year and the month as the calendar numbers
  it, Nisan 01 … Tishrei 07 … Adar I 12, Adar II 13; for grouping, not
  sorting), and `S.today.text` is the onah it is now in words with its date.
  Settings, Language and dates has the choice.
- **Wording.** Plain, literal English. Short sentences. No figurative phrases,
  jokes, exclamation marks or marketing tone. A button says exactly what it does
  ("Save location", "Remove link"), not "OK" or "Submit".
- **Accessibility.** Every control has a label (visible, or `aria-label` when
  the meaning is visible from context). Focus is always visible. Everything works
  by keyboard. Colour is never the only signal (alerts carry an icon, tags carry
  a word). Tap targets are at least 44 px. The page reads at 200% zoom and at
  360 px wide with no sideways scrolling.
- **No build step, no npm dependencies, no frameworks.** Plain ES modules and CSS.
  Import paths are relative and end in `.js`.
- **No `confirm()`, `prompt()` or `alert()`.** Use `confirmDialog()` and `promptDialog()`.

## How the signed-in page works

- `main.js` draws the whole page from `S` and the drafts with `render()`. Views
  are functions that return nodes; they hold their own small form state in
  module variables (for example `rec` in `record.js`).
- After any change, call the API, then `saved(message)` adopts the new state,
  redraws and shows a toast: `run(() => api('PUT', '/api/app', draft.app), saved('Saved.'), button)`.
  The third argument is the button to show as busy.
- `render()` keeps the focus on the control that had it, **by id**. Give every
  control that triggers a redraw a fixed id (`radioRow` does this for you from
  `name` and `value`).
- Views get `render`, `go(page)`, `restart()` and `currentTab()` (the page shown) from `store.js`;
  they never import `main.js`.
- `S` and `P` are live bindings: `import { S } from '../store.js'` and read
  `S.x`. Change them only through `adopt()`, `setPublic()`, `signOutLocally()`.
- The shape of `S` is `dashboardState()` in `src/app/dashboard.ts`.

## The shell, the home, the menu and the day popup

The signed-in home is the calendar and nothing else.

1. **Header, one row** (`header()` in `main.js`): the mark and name at the left
   (a link home, `#home-link`), "Test account" beside the name on the
   operator's test account (`#demo-tag`), and one button at the right, "Menu"
   (`#menu-button`). With alerts (`S.alerts`) the button carries their count
   (`.menu-count`, and "Menu, 1 alert" as its name). No date line, no tabs, no
   banner.
2. **The status line** (`viewHome` in `today.js`): `S.status.headline`, then,
   smaller, `S.status.detail`. Plain text, no card, no buttons.
3. **The month** (`homeCalendar` in `calendar.js`) fills the rest of the
   screen: the title in the middle with previous and next beside it, "Today"
   only when another month is shown; large cells; under the month one quiet
   line, "Tap a day" (touch screens) or "Choose a day", and "Key", which opens
   the legend (`legend()` in `marks.js`) in a sheet (`sheet.js`).
   - The Dates setting (`S.app.dates`, read by `datesMode()` in `dates.js`):
     `hebrew` (the default, also when the field is absent) pages by Hebrew
     month (title "Kislev 5787", the civil span small under it), the large
     number is the Hebrew day and the small one the civil day (with the
     month's short name on the 1st); `civil` pages by civil month with the
     civil day only; `both` pages by civil month with the civil day large and
     the Hebrew day small. Hebrew months are grouped by the grid's
     `hebrewMonthId` (and `hebrewYear`) when it sends them, otherwise by
     `monthStart`; the year is `hebrewYear` or worked out from the civil year.
   - The days of a niddah period (from the day it began through the date of
     its mikvah night) are tinted (`.day.niddah`: the flow colour mixed into
     the surface, and a bar along the bottom); their label says "Niddah day".
   - Inside the cells the marks of `marks.js`; from 700 px a word beside each
     ("Period", "Hefsek", "Clean 3", "Mikvah", "Onah", through the terms).
   - Arrow keys move between days and across months; Page Up and Page Down
     move by month (by Hebrew month when the month is a Hebrew one).
   - Without a location the home is the one sentence "Nothing can be
     calculated until a location is chosen." and a button to Settings,
     Location.
4. **The popup of a day** (`daypop.js`): tapping or choosing a day (Enter or
   Space) opens a small popup beside it, under the day or above it when there
   is no room below, always inside the screen. It closes on Escape, a tap
   outside, or tapping the day again; the focus goes back to the day. Up and
   Down move between its buttons. Top to bottom:
   - the day in plain words and its date as the setting has it ("Tuesday
     14 Kislev", "Yesterday Nov 23 · 13 Kislev"; `dateText()` and `dayWord()`
     in `dates.js`; a night is "Monday night", its Hebrew date "eve of ...");
   - one short line of what is expected that day (the titles of the events
     that are worked out, not recorded);
   - what is recorded on that day, one row each ("Stain, by day") with Edit
     and Delete. Delete asks once in the popup. Edit changes the date and day
     or night in place: the entry is recorded again with
     `POST /api/entries` (its note kept) and the old one removed with
     `DELETE /api/entries/:id`;
   - for today or an earlier day, what can be added, the likeliest first:
     "Hefsek taharah done" on a day it can be done (a niddah period with no
     hefsek taharah recorded, from the last day of the customs' wait), then
     "A period began" (today: now; an earlier day: "By day" / "At night"),
     then "More" (the full form, `#record`, preset to that date). A future day
     has nothing to add. One tap records; the popup closes and the server's
     sentence with Undo is shown under the month (`notice('day')`).
5. **Everything else is behind Menu**: a sheet on a phone, a list under the
   button on a wide screen (`openMenu()` in `main.js`, a native `<dialog>`, so
   it keeps the focus and closes on Escape). One or two words each: Calendar,
   Coming up (with the alert count), Log, Customs, Settings, Texting, "Try a
   text" (test account only), Help (`/help`), Sign out. Each page has
   "Calendar" at its top (`#back-home`); the header's name goes home too.
   - Addresses: `#today` (also an empty hash and `#calendar`), `#coming`,
     `#log`, `#customs`, `#settings/...`, `#texting`, `#try`, `#record`. Each
     page is a step in the browser's history.
   - **Coming up** (`viewComing`): the alerts first, then "Getting started"
     while it is not done, then "Until mikvah night" and "Onot of separation"
     (the calendar button on a row opens that day's popup on the calendar).
   - **Texting** (`viewTexting`): "Text this number" when texting works and
     the account has a phone, otherwise a short note and a link to Settings,
     Texting. **Try a text** (`viewTry`): the test account's chat.
   - **The full form** (`recordPage` in `record.js`): any kind, any date, a
     clock time, a note and the vesatot switch; Cancel goes back to the
     calendar.

Titles never show the server's " (projected)": the page says "not recorded"
(the hefsek day), "expected" (projected) or "recorded" in a label beside them
(Coming up, the day's label).

## Settings → Reminders

`settings/reminders.js`: a row per kind (switch, timing in a few words,
"Change" opens it). The Bedikot row opens to seven day buttons `1` to `7`
(`aria-pressed`, with `All` and `1 and 7`), then two parts, Morning and
Before sunset, each a switch with its time beside it
(`app.reminders.bedikot.days`, `.morning`, `.beforeSunset`). One row,
"Before Shabbat and Yom Tov", holds the time of the one text sent the
morning before (`app.reminders.restEve`, default 9:00 AM); there is no switch
for Shabbat: nothing is ever sent on it. No explanations of halacha.

## Settings → Calendar

`settings/calendar.js`, top to bottom: Google Calendar, the subscription link,
"Shown in your calendar app", event titles and the calendar's name, then
"More". "Shown in your calendar app" has six switches, saved in
`app.calendar.show` (`PUT /api/app`): Onot (`onot`), Period start (`period`),
Hefsek taharah (`hefsek`), Niddah days (`niddah`: one all-day event per
period, from its first day through the evening of its mikvah night), Seven
clean days (`cleanDays`) and Mikvah night (`mikvah`). By default a calendar
app shows only the onot, the start of each period and the hefsek taharah;
the other three are off. The niddah days and the onot are separate switches:
the niddah days are known without a calendar. In a calendar app the
start of a period is an all-day event on its date ("Period began (by day)"),
and with Hebrew terms every title and description is wholly Hebrew, each
line ending with a right-to-left mark (`src/engine/hebrewText.ts`): a
calendar app scrambles a line that mixes Hebrew and English. They apply to Google Calendar and the
subscription feed only (`calendarAppEvents` in `src/engine/calendar.ts`); the
month calendar on the Today tab, the reminders and the texts keep every event.
The guided setup's calendar step has no such switches.

## Tokens (`:root` in `site.css`)

Light values below; dark values are set under `prefers-color-scheme: dark`.
Every text colour meets WCAG AA (4.5:1) on `--bg` and `--surface`; control
borders (`--line-strong`) meet 3:1.

| Group | Tokens |
|---|---|
| Surfaces and text | `--bg` page, `--surface` cards and controls, `--surface-2` sunken areas, `--ink` text, `--muted` secondary text, `--line` dividers, `--line-strong` control borders, `--overlay` behind dialogs |
| Accent | `--accent`, `--accent-hover`, `--accent-ink` (text on accent), `--accent-soft` (pressed backgrounds), `--focus` (focus ring) |
| Status | `--info-bg`/`--info-line`, `--warn-bg`/`--warn-line`, `--ok`/`--ok-bg`, `--bad`/`--bad-bg`/`--bad-hover`/`--bad-ink` |
| Kinds of days | `--flow`, `--onah`, `--light` (a lighter onah), `--hefsek`, `--clean`, `--mikvah` |
| Spacing (4 px scale) | `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-10` 40, `-12` 48 |
| Type | `--font` Heebo, then the system stack; `--font-display` Bellefair for headings about 20px and up, then Heebo; `--font-mono`; `--text-xs` 13 px, `-sm` 14, `-base` 16, `-lg` 18, `-xl` 22, `-2xl` 28, `-3xl` landing headline; `--leading` 1.55, `--leading-tight` 1.25; `--weight-normal` 400, `-medium` 500, `-bold` 600 |
| Shape | `--radius-sm` 6, `-md` 10 (controls), `-lg` 14 (cards), `-pill`; `--shadow-sm` (cards), `-md`, `-lg` (toasts, dialogs) |
| Sizes | `--tap` 44 px, `--control-h` 44 px, `--page-max` 760, `--page-wide` 1120, `--doc-max` 720, `--gutter` 16 |
| Motion | `--ease`, `--dur-fast` 120 ms, `--dur` 200 ms; both become 0 under `prefers-reduced-motion` |

Use the tokens for every colour, gap and radius. Do not write raw colours in
page stylesheets.

## Layout

- `#root` is the page shell: 760 px wide, 16 px side gutter. `mount(nodes, { wide: true })`
  makes it 1120 px (the dashboard does).
- `.cols`: two columns (3 : 2) from 960 px, one column below. Children keep
  their order on a phone, so put what matters first in the first column.
- `.narrow`: keeps a long form at 760 px inside a wide page.
- `header.top`: page title on the left, a short line on the right.
- `.login`: a centred 420 px card (sign-in views).
- Utilities: `.muted`, `.small`, `.stack` (12 px between children),
  `.indent` (sub-options under a checkbox), `.visually-hidden`.

## Components (`lib.js`)

Every helper returns DOM nodes. Options are one object; children follow as
extra arguments where a component has content.

### `h(tag, attrs, ...children)`
The element builder. `class` sets the class; `onclick` (any `on…` function)
adds a listener; `checked`, `disabled`, `selected`, `open`, `value` are set as
properties; `false`, `null`, `undefined` are skipped, so pass aria values as
strings: `'aria-pressed': String(on)`. Children are nodes, strings or arrays.
```js
h('p', { class: 'help' }, 'See the ', h('a', { href: '/privacy' }, 'Privacy page'), '.')
```

### `mount(children, { wide })`
Replaces what `#root` shows.

### `api(method, path, body)` and `configureApi({ onUnauthorized })`
Calls the JSON API with the site's header. Throws an `Error` with the server's
message and `.status`. `main.js` sets `onUnauthorized` to go back to sign-in.

### `icon(name, { size, label })`
Inline SVG built with `createElementNS`; decorative unless `label` is given.
`size`: `'sm'` 1em, default 1.25em, `'lg'` 2em. Names (`ICON_NAMES`):
check, close, chevron-down, chevron-up, chevron-left, chevron-right, plus,
calendar, clock, phone, message, bell, moon, sun, droplet, settings, user,
lock, link, copy, download, trash, info, alert, list, log-out, refresh, map.
To add one, add it to `ICONS` in a separate commit and say so.

### Buttons
```js
button({ label, variant, size, icon, iconOnly, type, onclick, busy, disabled, block, className, attrs })
linkButton({ href, label, variant, size, icon, download, block, className, attrs })
setBusy(buttonEl, true | false)
withBusy(buttonEl, async () => ...)   // busy while it runs
actions([buttons], { end, stack })    // a wrapping row of buttons
```
`variant`: `'primary'` (one per card, the main action), `'secondary'`
(default), `'danger'` (outlined red), `'danger-solid'` (only for the confirm
button of a destructive dialog), `'link'`. `size`: `'sm'`, `'md'`, `'lg'`.
Busy: disabled, `aria-busy="true"`, a spinner before the label.
A row of choices uses `aria-pressed` buttons in `.actions.pick`.
```js
actions([button({ label: 'Save location', variant: 'primary', onclick: e => saveApp('Location saved.', e.currentTarget) })])
```

### Fields
```js
field({ label, control, help, error, id, className })   // wires label[for], aria-describedby, aria-invalid
setFieldError(fieldEl, message)                          // '' clears it
textField({ id, label, help, error, wide, ...inputAttributes })
selectField({ id, label, help, error, options: [{ value, label }], value, onchange, wide })
inlineField({ label, control })                          // short control on the label's line
numberRow({ label, value, onchange: n => ..., min, max, step, id })
```
Text, tel, password and email inputs fill the width unless `wide: false`.
```js
textField({ id: 'number', label: 'Your mobile number', type: 'tel', autocomplete: 'tel', value: a.number, oninput: e => (a.number = e.target.value), error: msg })
```
Show a field's own error with `error` (or `setFieldError`); use an alert at the
top of a form only for errors about the whole form.

### Checkboxes, radios, toggles
```js
checkRow({ id, label, help, checked, disabled, onchange })
radioRow({ name, value, label, help, checked, onchange, id })     // id defaults to r-<name>-<value>
radioGroup({ legend, help, name, value, options: [{ value, label, help }], onchange: value => ... }, ...extraNodes)
segmented({ id, label, value, options: [{ value, label, lang }], onchange: value => ... })
```
The whole row is the tap target (44 px). `segmented` is a `role="group"` of
`aria-pressed` buttons with a check mark on the chosen one.

### Cards
```js
card({ title, icon, intro, headerAction, tag, className, attrs }, ...children)
cardSection({ title }, ...children)   // a titled part of a card, with a divider
```
`tag: 'form'` with `attrs: { onsubmit }` makes the card a form.

### Alerts and tags
```js
alert({ kind: 'info' | 'warn' | 'ok' | 'bad', title, role }, ...children)
tag(text, kind)      // kind: 'info' | 'warn' | 'ok' | 'bad' | none
```
Use `role: 'alert'` only for an error that just appeared.

### Tabs
```js
tabs({ label, items: [{ id, label, icon }], current, onselect: id => ..., idPrefix })
tabPanel({ current, idPrefix }, ...children)
```
`role="tablist"`, `aria-selected`, roving `tabindex`, Left/Right/Home/End.

### Toasts
```js
toast('Saved.')
toast('The calendar could not be updated.', true)   // bad: 9 s and role="alert"
toast('Copied.', { timeout: 3000 })
```
One at a time, in a polite live region, with a Dismiss button; hovering or
focusing it keeps it open.

### Dialogs (native `<dialog>`)
```js
if (!(await confirmDialog({ title: 'Remove this entry?', body: e.text, confirmLabel: 'Remove', danger: true }))) return;

const typed = await promptDialog({
  title: 'Delete the account?', body: '...', label: 'Type DELETE to confirm',
  expect: 'DELETE', mismatchMessage: 'Type DELETE in capital letters. Nothing has been deleted.',
  confirmLabel: 'Delete my account', danger: true,
});
if (typed === null) return;
```
Modal, focus moves into it (to Cancel when `danger`), Escape or a click outside
cancels, focus returns where it was. Titles are questions; the confirm button
repeats the action ("Remove link"), never "OK". With `expect`, the dialog stays
open and shows the field error until the answer matches.

### Copy field
```js
copyField({ value: link, label: 'Copy', copiedMessage: 'Copied.', failMessage })
```
The value in a selectable `code.copy` box and a Copy button.

### Loading, empty, progress
```js
pageLoading('Loading…')                       // whole page, at boot
skeleton({ lines: 3, label: 'Loading the calendar' })
emptyState({ icon: 'calendar', title: 'Nothing recorded yet.', body, action: buttonEl })
stepper({ label: 'Setup', current: 1, steps: [{ label: 'Location', done: true }, { label: 'Customs' }, { label: 'Dates' }] })
```
`stepper` shows "Step 2 of 3" and a bar per step, `aria-current="step"` on the
current one; below 520 px only the current step's name is shown.

### Lists
```js
list(rows)
listRow({ lead, title, meta, body, trail, className })
```
`lead`: a `span.dot.<kind>` or an icon. `trail`: buttons at the right.
`className: 'projected'` sets the title in italics.

### Small values
`clone(value)`, `cap(text)`, `pretty('+17325550123')` → `(732) 555-0123`, `uid(prefix)`.

## From `store.js`
`P`, `S`, `draft`, `setPublic`, `adopt`, `signOutLocally`, `connect`, `render`,
`go`, `restart`, `currentTab`, `t(template)`, `run(action, done, busyButton)`,
`saved(message)`, `todayIso()`, `when(ms)`.

## Checking your work

```sh
npx wrangler dev --port 8801 --persist-to <a new empty directory>
node test/ui-check.cjs <screenshot directory> http://127.0.0.1:8801
```
Look at the pages at 390 px and 1280 px, in light and dark
(`browser.newContext({ colorScheme: 'dark' })`), before you finish.
