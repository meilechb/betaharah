/*
 * Setup step: where the household is. The times depend on it.
 * Ways to choose, in order: a ZIP code, the list of places, this device's
 * location, and coordinates as the last resort.
 */
import { alert, api, button, h, icon, selectField, setFieldError, textField, withBusy } from '../lib.js';
import { S, adopt, render, t } from '../store.js';
import { back, flow, next, onEnter, problem, screen } from './flow.js';

const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (e) {
    return '';
  }
};

const blank = () => ({
  zip: '',
  zipError: '',
  zipUnavailable: false,
  cand: null, // the place chosen but not yet saved
  candFrom: '',
  listValue: '',
  coordsOpen: false,
  lat: '',
  lon: '',
  elev: '',
  tz: deviceZone(),
  coordsError: '',
  geoError: '',
  saveError: '',
  justSaved: false,
  changing: false,
});

let st = blank();
onEnter('place', () => {
  const keep = st.zipUnavailable;
  st = blank();
  st.zipUnavailable = keep;
});

/** Today's sunset at the saved place, from the month grid the server sends. */
function sunsetToday() {
  const g = S.grid;
  if (!g) return '';
  const day = g.days.find(d => d.date === g.today);
  return day ? day.sunset : '';
}

function choose(place, from) {
  st.cand = place;
  st.candFrom = from;
  st.saveError = '';
  flow.focus = 'setup-chosen';
  render();
}

function lookUpZip(e) {
  e.preventDefault();
  const btn = e.submitter || document.getElementById('setup-zip-go');
  const zip = st.zip.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!/^\d{5}(-?\d{4})?$/.test(zip) && !/^[A-Z]\d[A-Z]( ?\d[A-Z]\d)?$/.test(zip)) {
    st.zipError = 'Enter a 5-digit US ZIP code, such as 08701, or a Canadian postal code, such as H2X 1Y4.';
    flow.focus = 'setup-zip';
    render();
    return;
  }
  withBusy(btn, () => api('GET', '/api/postal/' + encodeURIComponent(zip))).then(
    r => {
      if (r && r.place) {
        st.zipError = '';
        choose({ ...r.place }, 'zip');
      } else {
        st.zipUnavailable = true;
        flow.focus = 'setup-place-list';
        render();
      }
    },
    err => {
      if (err.status === 404 && (!err.message || err.message === 'Not found.')) {
        // The lookup is not on this site yet: offer the other ways.
        st.zipUnavailable = true;
        flow.focus = 'setup-place-list';
      } else {
        st.zipError = err.status === 404 ? err.message : problem(err);
        flow.focus = 'setup-zip';
      }
      render();
    },
  );
}

function useDevice(e) {
  const btn = e.currentTarget;
  st.geoError = '';
  if (!navigator.geolocation) {
    st.geoError = 'This browser cannot give its location.';
    render();
    return;
  }
  const zone = deviceZone();
  withBusy(
    btn,
    () =>
      new Promise(resolve => {
        navigator.geolocation.getCurrentPosition(
          pos => {
            resolve();
            if (!zone) {
              st.geoError = 'This device did not say which time zone it is in. Enter the coordinates and time zone below instead.';
              st.coordsOpen = true;
              st.lat = String(Math.round(pos.coords.latitude * 10000) / 10000);
              st.lon = String(Math.round(pos.coords.longitude * 10000) / 10000);
              render();
              return;
            }
            choose(
              {
                name: 'My location',
                latitude: Math.round(pos.coords.latitude * 10000) / 10000,
                longitude: Math.round(pos.coords.longitude * 10000) / 10000,
                timeZone: zone,
                elevation: typeof pos.coords.altitude === 'number' ? Math.max(0, Math.round(pos.coords.altitude)) : 0,
              },
              'device',
            );
          },
          err => {
            resolve();
            st.geoError =
              err && err.code === 1
                ? 'The location was not shared.'
                : 'The location could not be read.';
            flow.focus = 'setup-geo';
            render();
          },
          { enableHighAccuracy: false, timeout: 20000, maximumAge: 600000 },
        );
      }),
  );
}

function useCoords() {
  const lat = Number(st.lat);
  const lon = Number(st.lon);
  const elev = st.elev.trim() === '' ? 0 : Number(st.elev);
  let error = '';
  if (st.lat.trim() === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) error = 'The latitude must be a number from -90 to 90, such as 40.0821.';
  else if (st.lon.trim() === '' || !Number.isFinite(lon) || lon < -180 || lon > 180) error = 'The longitude must be a number from -180 to 180, such as -74.2097. West of Greenwich it is negative.';
  else if (!Number.isFinite(elev) || elev < -430 || elev > 6000) error = 'The elevation must be a number of metres from -430 to 6000.';
  else {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: st.tz.trim() }).format(0);
      if (!st.tz.trim()) throw new Error('empty');
    } catch (e) {
      error = 'The time zone is not one this browser knows. Write it like America/New_York.';
    }
  }
  st.coordsError = error;
  if (error) {
    render();
    return;
  }
  choose({ name: 'My location', latitude: lat, longitude: lon, timeZone: st.tz.trim(), elevation: elev }, 'coords');
}

function save(e) {
  const btn = e.currentTarget;
  if (!st.cand) {
    st.saveError = 'Choose a place first.';
    flow.focus = st.zipUnavailable ? 'setup-place-list' : 'setup-zip';
    render();
    return;
  }
  const c = st.cand;
  const place = { name: c.name, latitude: c.latitude, longitude: c.longitude, timeZone: c.timeZone, elevation: c.elevation || 0 };
  withBusy(btn, () => api('PUT', '/api/app', { ...S.app, place })).then(
    r => {
      adopt(r.state);
      st = { ...blank(), justSaved: true, zipUnavailable: st.zipUnavailable };
      flow.focus = 'setup-saved';
      render();
    },
    err => {
      st.saveError = problem(err) + (err.status === 400 ? ' The location was not saved. Choose another place, or a different time of nightfall in the customs.' : '');
      render();
    },
  );
}

function savedView() {
  const p = S.app.place;
  const sunset = sunsetToday();
  return screen({
    title: st.justSaved ? 'Your location is saved' : 'Your location',
    body: [
      h(
        'div',
        { class: 'setup-place', id: 'setup-saved', tabindex: '-1' },
        icon('map', { size: 'lg' }),
        h('div', {}, h('p', { class: 'setup-place-name' }, p.name), h('p', { class: 'small muted' }, 'Time zone: ' + p.timeZone)),
      ),
      sunset
        ? alert({ kind: st.justSaved ? 'ok' : 'info', role: st.justSaved ? 'status' : null }, t('Today’s {sunset} there: ') + sunset + '. ' + (st.justSaved ? 'The times are now calculated for this place.' : ''))
        : null,
      h('p', { class: 'link-row' }, button({ label: 'Choose a different place', variant: 'link', attrs: { id: 'setup-change-place' }, onclick: () => ((st.changing = true), (st.justSaved = false), (flow.focus = st.zipUnavailable ? 'setup-place-list' : 'setup-zip'), render()) })),
    ],
    back,
    main: { label: 'Continue', icon: null, onclick: next },
  });
}

export function placeView() {
  if (S.app.place && !st.changing) return savedView();
  const listIndex = st.candFrom === 'list' ? S.places.findIndex(p => p.name === st.cand.name) : -1;

  const zipPart = st.zipUnavailable
    ? alert({ kind: 'info' }, 'ZIP codes are not available yet. Choose from the list.')
    : h(
        'form',
        { class: 'setup-zip', novalidate: true, onsubmit: lookUpZip },
        h(
          'div',
          { class: 'zip-row' },
          textField({
            id: 'setup-zip',
            label: 'ZIP code (or Canadian postal code)',
            autocomplete: 'postal-code',
            maxlength: 10,
            wide: false,
            class: 'zip-input',
            value: st.zip,
            error: st.zipError,
            oninput: e => {
              st.zip = e.target.value.slice(0, 10);
              if (st.zipError) {
                st.zipError = '';
                setFieldError(e.target.closest('.field'), '');
              }
            },
          }),
          button({ label: 'Look up', type: 'submit', attrs: { id: 'setup-zip-go' } }),
        ),
      );

  return screen({
    title: 'Where do you live?',
    intro: t('The times of {sunset} and {nightfall} are worked out for it.'),
    body: [
      zipPart,
      h('h3', { class: 'setup-or' }, st.zipUnavailable ? 'Choose from the list' : 'Or choose from the list'),
      selectField({
        id: 'setup-place-list',
        label: 'Place',
        wide: true,
        options: [{ value: '', label: 'Choose a place…', selected: listIndex < 0 }, ...S.places.map((p, i) => ({ value: String(i), label: p.name, selected: listIndex === i }))],
        onchange: e => {
          if (e.target.value === '') return;
          flow.focus = 'setup-place-list';
          st.cand = { ...S.places[Number(e.target.value)] };
          st.candFrom = 'list';
          st.saveError = '';
          render();
        },
      }),
      h('h3', { class: 'setup-or' }, 'Or use where you are now'),
      h(
        'div',
        { class: 'field', id: 'setup-geo', tabindex: '-1' },
        button({ label: 'Use this device’s location', icon: 'map', onclick: useDevice, attrs: { id: 'setup-geo-button' } }),
        h('div', { class: 'help' }, 'Used only to work out the times.'),
        st.geoError ? h('div', { class: 'error', role: 'alert' }, icon('alert', { size: 'sm' }), h('span', {}, st.geoError)) : null,
      ),
      h(
        'details',
        {
          class: 'setup-coords',
          open: st.coordsOpen,
          ontoggle: e => (st.coordsOpen = e.target.open),
        },
        h('summary', {}, icon('chevron-right', { size: 'sm' }), 'Enter coordinates instead'),
        h('p', { class: 'help' }, 'Decimal degrees, as a map app shows them.'),
        h(
          'div',
          { class: 'coords-grid' },
          textField({ id: 'setup-lat', label: 'Latitude', inputmode: 'decimal', value: st.lat, placeholder: '40.0821', wide: true, oninput: e => (st.lat = e.target.value) }),
          textField({ id: 'setup-lon', label: 'Longitude', inputmode: 'decimal', value: st.lon, placeholder: '-74.2097', wide: true, oninput: e => (st.lon = e.target.value) }),
          textField({ id: 'setup-elev', label: 'Elevation in metres (optional)', inputmode: 'decimal', value: st.elev, placeholder: '0', wide: true, oninput: e => (st.elev = e.target.value) }),
          textField({ id: 'setup-tz', label: 'Time zone', value: st.tz, placeholder: 'America/New_York', wide: true, autocapitalize: 'off', spellcheck: 'false', oninput: e => (st.tz = e.target.value) }),
        ),
        st.coordsError ? h('p', { class: 'setup-error', role: 'alert' }, icon('alert', { size: 'sm' }), h('span', {}, st.coordsError)) : null,
        button({ label: 'Use these coordinates', onclick: useCoords, attrs: { id: 'setup-coords-go' } }),
      ),
      st.cand
        ? h(
            'div',
            { class: 'setup-chosen', id: 'setup-chosen', tabindex: '-1', role: 'status' },
            icon('check'),
            h('div', {}, h('p', {}, h('strong', {}, 'Chosen: '), st.cand.name), h('p', { class: 'small muted' }, 'Time zone: ' + st.cand.timeZone + (st.candFrom === 'device' || st.candFrom === 'coords' ? ' · ' + st.cand.latitude + ', ' + st.cand.longitude : ''))),
          )
        : null,
      st.saveError ? h('p', { class: 'setup-error', role: 'alert' }, icon('alert', { size: 'sm' }), h('span', {}, st.saveError)) : null,
    ],
    back: S.app.place ? () => ((st.changing = false), render()) : back,
    skip: S.app.place ? null : { label: 'Skip this step', onclick: next },
    main: { label: 'Save location', onclick: save, id: 'setup-save-place' },
  });
}
