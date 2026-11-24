/* Settings: the Location card (ZIP code, a list, this device, or coordinates). */
import { api, button, card, checkRow, h, icon, selectField, setBusy, textField } from '../../lib.js';
import { S, t } from '../../store.js';
import { attempt, refresh, region, saveAppChange, saveStatus } from '../shared.js';

/** What is typed in the ZIP box and the coordinates form, and their errors. */
let zip = '';
let zipError = '';
let coords = null;
let coordErrors = {};
let geoError = '';

const savePlace = place => saveAppChange('location', a => (a.place = place), { message: 'Saved: ' + place.name });

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
        zipError = 'No place was found for this ZIP code. Choose the nearest place from the list below, or use this device’s location.';
        refresh('loc-zip');
        return;
      }
      zip = '';
      savePlace(r.place);
    },
    fail: (message, e) => {
      zipError =
        e && e.status === 404
          ? 'No place was found for this ZIP code. Choose the nearest place from the list below, or use this device’s location.'
          : message;
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
      const place = {
        name: 'This device’s location',
        latitude: Math.round(pos.coords.latitude * 10000) / 10000,
        longitude: Math.round(pos.coords.longitude * 10000) / 10000,
        elevation: typeof pos.coords.altitude === 'number' ? Math.max(0, Math.round(pos.coords.altitude)) : 0,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      savePlace(place);
    },
    () => {
      geoError = 'The location could not be read. Allow this site to use your location, or choose from the list.';
      refresh('loc-device');
    },
    { timeout: 15000 },
  );
}

function coordinatesForm() {
  return region('loc-coords', () => {
    const p = S.app.place;
    if (!coords) coords = { name: p ? p.name : '', latitude: p ? String(p.latitude) : '', longitude: p ? String(p.longitude) : '', elevation: p ? String(p.elevation) : '0', timeZone: p ? p.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone };
    const field = (key, label, attrs) =>
      textField({ id: 'place-' + key, label, value: coords[key], error: coordErrors[key] || '', oninput: e => (coords[key] = e.target.value), ...(attrs || {}) });
    return h(
      'form',
      {
        class: 'coords',
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
      h('div', { class: 'two' }, field('latitude', 'Latitude', { inputmode: 'decimal', wide: true }), field('longitude', 'Longitude', { inputmode: 'decimal', wide: true })),
      h('div', { class: 'two' }, field('elevation', 'Elevation (metres)', { inputmode: 'numeric', wide: true }), field('timeZone', 'Time zone', { placeholder: 'America/New_York', autocomplete: 'off', spellcheck: 'false' })),
      button({ label: 'Use these coordinates', type: 'submit', attrs: { id: 'place-save' } }),
    );
  });
}

export function locationCard() {
  const place = S.app.place;
  const listed = place ? S.places.findIndex(p => p.name === place.name && p.latitude === place.latitude && p.longitude === place.longitude) : -1;
  return card(
    { title: 'Location', icon: 'map', headerAction: saveStatus('location'), className: 'location-card' },
    h('p', { class: 'card-intro' }, t('Sunrise, {sunset} and {nightfall} are calculated for this place. Change it when you travel.')),
    place
      ? h('div', { class: 'current-place' }, icon('map'), h('div', {}, h('strong', {}, place.name), h('span', { class: 'small muted' }, place.latitude + ', ' + place.longitude + ' · ' + place.timeZone)))
      : h('div', { class: 'current-place none' }, icon('alert'), h('div', {}, h('strong', {}, 'No location chosen yet.'), h('span', { class: 'small muted' }, 'Nothing can be calculated until one is chosen.'))),
    region('loc-zip', () =>
      h(
        'form',
        {
          class: 'zip-form',
          novalidate: true,
          onsubmit: e => {
            e.preventDefault();
            findZip(e.submitter || document.getElementById('zip-find'));
          },
        },
        h(
          'div',
          { class: 'field' },
          h('label', { for: 'zip' }, 'ZIP code'),
          h(
            'div',
            { class: 'zip-row' },
            h('input', {
              id: 'zip',
              type: 'text',
              autocomplete: 'postal-code',
              maxlength: 10,
              value: zip,
              'aria-invalid': zipError ? 'true' : null,
              'aria-describedby': zipError ? 'zip-error' : null,
              oninput: e => (zip = e.target.value),
            }),
            button({ label: 'Find', type: 'submit', attrs: { id: 'zip-find' } }),
          ),
          zipError ? h('div', { class: 'error', id: 'zip-error' }, icon('alert', { size: 'sm' }), h('span', {}, zipError)) : null,
        ),
      ),
    ),
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
    region('loc-device', () =>
      h(
        'div',
        { class: 'device' },
        button({ label: 'Use this device’s location', icon: 'map', attrs: { id: 'place-device' }, onclick: e => useDevice(e.currentTarget) }),
        geoError ? h('div', { class: 'error', role: 'alert' }, icon('alert', { size: 'sm' }), h('span', {}, geoError)) : null,
      ),
    ),
    h(
      'details',
      { class: 'advanced', id: 'loc-adv' },
      h('summary', {}, 'Advanced: coordinates and elevation'),
      coordinatesForm(),
      checkRow({
        id: 'use-elevation',
        label: t('Adjust sunrise and {sunset} for elevation'),
        help: 'Off: the times at sea level, as most calendars print them.',
        checked: S.app.useElevation,
        onchange: e => {
          const on = e.target.checked;
          saveAppChange('location', a => (a.useElevation = on));
        },
      }),
    ),
  );
}
