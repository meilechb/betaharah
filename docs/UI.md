# The interface: files, rules, tokens and components

This is the guide for anyone changing the pages in `public/`. Read it with the
code; it is the only other document you need.

## Files and who owns them

| File | What it is | Owner |
|---|---|---|
| `public/site.css` | Tokens and every shared component. Linked first on every page. | Frozen |
| `public/app/lib.js` | DOM helper `h()`, `api()`, icons and the component builders below. | Frozen |
| `public/app/store.js` | Shared state of the signed-in page (`P`, `S`, `draft`), `adopt()`, `t()`, `run()`, `saved()`, dates. | Frozen (ask before changing) |
| `public/app/main.js` | Boot (`start()`), sign-in or dashboard, tab bar, hash routing, focus kept across redraws. | Dashboard agent |
| `public/app/auth.js` | Every sign-in, sign-up and invitation view. | Sign-up agent |
| `public/app/onboarding.js` | The "Getting started" card (`onboardingCard()`), to become the guided setup. | Sign-up agent |
| `public/app/auth.css` | Styles for the sign-in views and the guided setup. | Sign-up agent |
| `public/app/views/today.js`, `log.js`, `customs.js`, `shared.js` | The tabs, and pieces two tabs use (`alertsBlock`, `termsToggle`, `saveApp`). | Dashboard agent |
| `public/app/views/calendar.js` | Today's month calendar: the month, the legend (always shown, in two groups), and the chosen day with its one-click buttons and what is marked on it. | Dashboard agent |
| `public/app/views/record.js` | Recording, in one place: `recordNow(body, button, where)` for one-click entries (the next step, a day's buttons), `notice(where)` for the server's confirmation with Undo or its refusal, `openRecord(preset, openerId)` and `recordPanel()` for the full form on Today, `recordCard()` for "Add a past entry" on the Log. | Dashboard agent |
| `public/app/views/marks.js` | The marks of the kinds of days, used by the dashboard and the console's calculation test: `mark()` (H✓/M✓ recorded, H? the hefsek day not recorded, outlined M a mikvah night, dashed expected), `entryMark(kind)`, `legend()`, and the words beside a title: `plainTitle()` (no " (projected)"), `stateTag()` ("recorded", "not recorded", "expected"), `spoken()`, `describe()`, `assumption()`. | Dashboard agent |
| `public/app/views/settings/*.js`, `public/app/settings.css` | The Settings tab: `index.js` draws the list of sections (each row with a one-line summary) and the open section; one module per section; `route.js` keeps the open section in the address (`#settings/phones`); `ui.js` has the rows and switches. | Settings |
| `test/ui/settings.cjs` | The browser run of every Settings section, on the test account and on a new account. | Settings |
| `public/app/dashboard.css` | Styles for the signed-in tabs. | Dashboard agent |
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

- **Privacy.** No third-party scripts, fonts, images, analytics or CDNs.
  Everything is served from the site itself. System fonts only.
- **Content Security Policy** (`public/_headers`):
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'`.
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
- Views get `render`, `go(tab)`, `restart()` and `currentTab()` from `store.js`;
  they never import `main.js`.
- `S` and `P` are live bindings: `import { S } from '../store.js'` and read
  `S.x`. Change them only through `adopt()`, `setPublic()`, `signOutLocally()`.
- The shape of `S` is `dashboardState()` in `src/app/dashboard.ts`.

## The Today tab

Top to bottom on a phone; from 960 px the calendar is the left column and the
rest stays in this order on the right (`.today-layout` in `dashboard.css`).

1. **Where things stand** (`statusCard` in `today.js`): the server's headline
   and sentence, then the one thing to record next as one primary button
   (`#next-step`), chosen from `S.status.phase`: "A period began" (tehorah);
   "The hefsek taharah was done today" (before the hefsek, by day, once the
   grid's projected hefsek day has come); "She immersed tonight" (mikvah night);
   "She immersed on the evening of …" (the mikvah night passed with nothing
   recorded). The clean days and a postponed immersion have no button. Links
   open the full form preset: "It began earlier", "On another night",
   "Record something else". Then today's items, the next onat perishah while
   tehorah, today's sunset, and the alerts; under the note about a period with
   no immersion recorded before it, "Record that immersion".
2. **The full form** (`recordPanel` in `record.js`), only after a link opened
   it, with Close. It keeps every choice: any kind, another date, by day, at
   night or a clock time, a note, the vesatot switch.
3. **Calendar** (`calendar.js`): the month, the legend, and the chosen day.
   For today or an earlier day, "What happened on this day?" records with one
   click (`POST /api/entries` with `{ kind, date, part }`), with more under
   "Other things to add"; then "On this day".
4. **Coming up**: "Until the immersion" (the hefsek day, the clean days as one
   row, the mikvah night, with the server's assumption when they are
   projected), then "Onot of separation", one row each, with the reasons shown.
   The calendar button on a row shows that day on the calendar.
5. "Text this number", or on the test account "Try a text", last.

Titles never show the server's " (projected)": the page says "not recorded"
(the hefsek day), "expected" (projected) or "recorded" in a label beside them.
A confirmation (with Undo) or a refusal is shown where the entry was recorded
from: the status card, the chosen day, or the form.

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
| Type | `--font`, `--font-mono`; `--text-xs` 13 px, `-sm` 14, `-base` 16, `-lg` 18, `-xl` 22, `-2xl` 28, `-3xl` landing headline; `--leading` 1.55, `--leading-tight` 1.25; `--weight-normal` 400, `-medium` 500, `-bold` 650 |
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
