/* Settings: Location (the current place with today's times; change it by ZIP code, from the list, by this device, or by coordinates). */
import { api, button, h, icon, selectField, setBusy, textField } from '../../lib.js';
import { S } from '../../store.js';
import { attempt, refresh, region } from '../shared.js';
import { blockRow, errorText, group, more, save, saveApp, sunToday, switchRow, tn } from './ui.js';

/** What is typed in the ZIP box and the coordinates form, and their errors. */
let zip = '';
let zipError = '';
let coords = null;
let coordErrors = {};
let geoError = '';
/** The last place that could not be saved, and why (the server's explanation). */
let refused = null;

/** "Lakewood, NJ 08701" when the place came from a postal code. */
export function placeName(p) {
  if (!p) return '';
  return p.postal && !p.name.includes(p.postal) ? p.name + ' ' + p.postal : p.name;
}

function savePlace(place) {
  refused = null;
  const next = JSON.parse(JSON.stringify(S.app));
  next.place = place;
  // A refusal (for example a place where the times cannot be computed) is shown under the place, which stays as it was.
  return save('location', () => api('PUT', '/api/app', next).catch(e => {
    refused = { name: placeName(place), message: (e && e.message) || 'Could not save.' };
    throw e;
  }), { message: 'Saved: ' + placeName(place) });
}

function findZip(btn) {
  const code = zip.replace(/\s+/g, '').toUpperCase();
  if (!/^[0-9A-Z-]{3,10}$/.test(code)) {
    zipError = 'Enter a ZIP code, for example 08701.';
    refresh('loc-zip');
    document.getElementById('zip')?.focus();
    return;
  }
  zipError = '';
  attempt(() => api('GET', '/api/postal/' + encodeURIComponent(code)), {
    button: btn,
    done: r => {
      if (!r || !r.place) {
        zipError = 'No place was found for this ZIP code. Choose the nearest place from the list, or use this device’s location.';
        refresh('loc-zip');
        return;
      }
      zip = '';
      savePlace(r.place);
    },
    fail: (message, e) => {
      zipError = e && e.status === 404 ? message + ' Or choose the nearest place from the list.' : message;
      refresh('loc-zip');
      document.getElementById('zip')?.focus();
    },
  });
}

function useDevice(btn) {
  geoError = '';
  if (!navigator.geolocation) {
    geoError = 'This browser cannot give its location. Choose from the list instead.';
    refresh('loc-device');
    return;
  }
  setBusy(btn, true);
  navigator.geolocation.getCurrentPosition(
    pos => {
      setBusy(btn, false);
      savePlace({
        name: 'This device’s location',
        latitude: Math.round(pos.coords.latitude * 10000) / 10000,
        longitude: Math.round(pos.coords.longitude * 10000) / 10000,
        elevation: typeof pos.coords.altitude === 'number' ? Math.max(0, Math.round(pos.coords.altitude)) : 0,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    },
    () => {
      geoError = 'The location could not be read. Allow this site to use your location, or choose from the list.';
      if (btn.isConnected) setBusy(btn, false);
      refresh('loc-device');
    },
    { timeout: 15000 },
  );
}

function coordinatesForm() {
  return region('loc-coords', () => {
    const p = S.app.place;
    if (!coords) coords = { name: p ? p.name : '', latitude: p ? String(p.latitude) : '', longitude: p ? String(p.longitude) : '', elevation: p ? String(p.elevation) : '0', timeZone: p ? p.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone };
    const field = (key, label, attrs) => textField({ id: 'place-' + key, label, value: coords[key], error: coordErrors[key] || '', oninput: e => (coords[key] = e.target.value), ...(attrs || {}) });
    return h(
      'form',
      {
        class: 'st-form st-coords',
        novalidate: true,
        onsubmit: e => {
          e.preventDefault();
          const errs = {};
          const lat = Number(coords.latitude);
          const lon = Number(coords.longitude);
          const elev = Number(coords.elevation || 0);
          if (!coords.name.trim()) errs.name = 'Give the place a name.';
          if (coords.latitude.trim() === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) errs.latitude = 'A latitude between -90 and 90, for example 40.0821.';
          if (coords.longitude.trim() === '' || !Number.isFinite(lon) || lon < -180 || lon > 180) errs.longitude = 'A longitude between -180 and 180, for example -74.2097. West is negative.';
          if (!Number.isFinite(elev) || elev < -430 || elev > 6000) errs.elevation = 'Metres above sea level, between -430 and 6000.';
          if (!coords.timeZone.trim()) errs.timeZone = 'A time zone, for example America/New_York.';
          coordErrors = errs;
          if (Object.keys(errs).length) {
            refresh('loc-coords');
            document.getElementById('place-' + Object.keys(errs)[0])?.focus();
            return;
          }
          savePlace({ name: coords.name.trim(), latitude: lat, longitude: lon, elevation: elev, timeZone: coords.timeZone.trim() }).then(ok => {
            if (ok) coords = null;
          });
        },
      },
      field('name', 'Name of the place', { maxlength: 80 }),
      h('div', { class: 'st-two' }, field('latitude', 'Latitude', { inputmode: 'decimal', wide: true }), field('longitude', 'Longitude', { inputmode: 'decimal', wide: true })),
      h('div', { class: 'st-two' }, field('elevation', 'Elevation (metres)', { inputmode: 'numeric', wide: true }), field('timeZone', 'Time zone', { placeholder: 'America/New_York', autocomplete: 'off', spellcheck: 'false' })),
      h('div', { class: 'actions' }, button({ label: 'Use these coordinates', type: 'submit', attrs: { id: 'place-save' } })),
    );
  });
}

const round4 = n => String(Math.round(n * 10000) / 10000);

function currentPlace() {
  const p = S.app.place;
  if (!p) {
    return h(
      'div',
      { class: 'st-hero none' },
      h('span', { class: 'st-hero-icon' }, icon('alert')),
      h('div', {}, h('p', { class: 'st-hero-title' }, 'No location is chosen yet.'), h('p', { class: 'st-hero-meta' }, tn('Nothing can be calculated until one is chosen: not {sunset}, not the dates, not the reminders.'))),
    );
  }
  const sun = sunToday();
  return h(
    'div',
    { class: 'st-hero' },
    h('span', { class: 'st-hero-icon' }, icon('map')),
    h(
      'div',
      { class: 'st-hero-main' },
      h('p', { class: 'st-hero-title', id: 'loc-current' }, placeName(p)),
      h('p', { class: 'st-hero-meta' }, p.timeZone.replace(/_/g, ' ') + ' · ' + round4(p.latitude) + ', ' + round4(p.longitude)),
      sun
        ? h(
            'dl',
            { class: 'st-times', 'aria-label': 'Today in this place' },
            h('div', {}, h('dt', {}, icon('sun', { size: 'sm' }), 'Sunrise'), h('dd', {}, sun.sunrise || '—')),
            h('div', {}, h('dt', {}, icon('moon', { size: 'sm' }), tn('{sunset}', true)), h('dd', {}, sun.sunset || '—')),
          )
        : null,
      sun ? h('p', { class: 'st-hero-note' }, 'Today’s times, as the calendar and the reminders use them.') : null,
    ),
  );
}

function zipForm() {
  return region('loc-zip', () =>
    h(
      'form',
      {
        class: 'st-form st-zip',
        novalidate: true,
        onsubmit: e => {
          e.preventDefault();
          findZip(e.submitter || document.getElementById('zip-find'));
        },
      },
      h('label', { for: 'zip', class: 'st-label' }, 'ZIP code'),
      h(
        'div',
        { class: 'st-inline' },
        h('input', {
          id: 'zip',
          type: 'text',
          autocomplete: 'postal-code',
          inputmode: 'text',
          maxlength: 10,
          value: zip,
          placeholder: '08701',
          'aria-invalid': zipError ? 'true' : null,
          'aria-describedby': 'zip-help' + (zipError ? ' zip-error' : ''),
          oninput: e => (zip = e.target.value),
        }),
        button({ label: 'Find', type: 'submit', variant: 'primary', attrs: { id: 'zip-find' } }),
      ),
      h('p', { class: 'help', id: 'zip-help' }, 'A 5-digit US ZIP code or a Canadian postal code.'),
      errorText('zip-error', zipError),
    ),
  );
}

function view() {
  const place = S.app.place;
  const listed = place ? S.places.findIndex(p => p.name === place.name && p.latitude === place.latitude && p.longitude === place.longitude) : -1;
  return {
    title: 'Location',
    parent: '',
    statusKey: 'location',
    lead: tn('Sunrise, {sunset} and {nightfall} are calculated for this place. Change it when you travel.'),
    body: [
      currentPlace(),
      refused
        ? h(
            'div',
            { class: 'st-refused', role: 'alert' },
            icon('alert'),
            h('div', {}, h('strong', {}, refused.name + ' was not saved.'), h('p', {}, refused.message), h('p', { class: 'small' }, place ? 'The location is still ' + placeName(place) + '.' : 'No location is set.')),
          )
        : null,
      group(
        { title: 'Change the place', id: 'loc-change' },
        blockRow(zipForm()),
        blockRow(
          selectField({
            id: 'place',
            label: 'Or choose from the list',
            wide: true,
            options: [{ value: '', label: listed < 0 ? (place ? 'Another place (' + place.name + ')' : 'Choose…') : 'Choose…', selected: listed < 0 }, ...S.places.map((p, i) => ({ value: String(i), label: p.name, selected: listed === i }))],
            onchange: e => {
              const v = e.target.value;
              if (v !== '') savePlace(S.places[Number(v)]);
            },
          }),
        ),
        blockRow(
          region('loc-device', () =>
            h(
              'div',
              { class: 'st-device' },
              button({ label: 'Use this device’s location', icon: 'map', attrs: { id: 'place-device' }, onclick: e => useDevice(e.currentTarget) }),
              h('p', { class: 'help' }, 'Your browser asks first. The place is saved with its coordinates only.'),
              geoError ? h('div', { class: 'error', role: 'alert' }, icon('alert', { size: 'sm' }), h('span', {}, geoError)) : null,
            ),
          ),
        ),
      ),
      more(
        { id: 'loc-adv', summary: 'Advanced: coordinates and elevation' },
        group({ title: 'Coordinates', intro: 'For a place that is not in the list and has no ZIP code.' }, blockRow(coordinatesForm())),
        group(
          {},
          switchRow({
            id: 'use-elevation',
            label: tn('Adjust sunrise and {sunset} for elevation'),
            help: S.app.useElevation ? 'On: the times are for ' + (place ? place.elevation : 0) + ' metres above sea level.' : 'Off: the times at sea level, as most calendars print them.',
            checked: S.app.useElevation,
            onchange: e => {
              const on = e.target.checked;
              saveApp('location', a => (a.useElevation = on));
            },
          }),
        ),
      ),
    ],
  };
}

export const locationSection = {
  id: 'location',
  title: 'Location',
  icon: 'map',
  summary: () => {
    const p = S.app.place;
    if (!p) return 'Not chosen yet';
    const sun = sunToday();
    return [placeName(p), sun && sun.sunset ? [tn(' · {sunset} today '), sun.sunset] : ''];
  },
  flag: () => (S.app.place ? null : { kind: 'warn', text: 'Needed to calculate anything' }),
  view,
};
