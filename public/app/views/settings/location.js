/* Settings: the Location card. Next owner: the dashboard agent. */
import { button, card, checkRow, clone, h, numberRow, selectField, textField, toast } from '../../lib.js';
import { S, draft, render } from '../../store.js';
import { saveApp } from '../shared.js';

export function locationCard() {
  const a = draft.app;
  const place = a.place;
  const listed = place ? S.places.findIndex(p => p.name === place.name && p.latitude === place.latitude && p.longitude === place.longitude) : -1;
  const custom = place !== null && listed < 0;
  const setPlace = p => {
    a.place = p ? clone(p) : null;
    render();
  };
  return card(
    { title: 'Location', intro: 'Sunrise, sunset and nightfall are calculated for this place. Change it when you travel.' },
    selectField({
      id: 'place',
      label: 'Place',
      wide: true,
      options: [
        { value: '', label: 'Choose…', selected: place === null },
        ...S.places.map((p, i) => ({ value: String(i), label: p.name, selected: listed === i })),
        { value: 'custom', label: 'Other (enter coordinates)', selected: custom },
      ],
      onchange: e => {
        const v = e.target.value;
        if (v === '') setPlace(null);
        else if (v === 'custom') setPlace({ name: 'My location', latitude: 0, longitude: 0, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, elevation: 0 });
        else setPlace(S.places[Number(v)]);
      },
    }),
    custom
      ? h(
          'div',
          {},
          textField({ id: 'place-name', label: 'Name', value: place.name, maxlength: 80, oninput: e => (place.name = e.target.value) }),
          numberRow({ label: 'Latitude', value: place.latitude, onchange: v => (place.latitude = v), step: 'any', id: 'place-lat' }),
          numberRow({ label: 'Longitude', value: place.longitude, onchange: v => (place.longitude = v), step: 'any', id: 'place-lon' }),
          numberRow({ label: 'Elevation (m)', value: place.elevation, onchange: v => (place.elevation = v), step: '1', id: 'place-elev' }),
          textField({ id: 'place-tz', label: 'Time zone', value: place.timeZone, placeholder: 'America/New_York', oninput: e => (place.timeZone = e.target.value) }),
          button({
            label: 'Use this device’s location',
            icon: 'map',
            onclick: () => {
              if (!navigator.geolocation) return toast('This browser cannot give its location.', true);
              navigator.geolocation.getCurrentPosition(
                pos => {
                  place.latitude = Math.round(pos.coords.latitude * 10000) / 10000;
                  place.longitude = Math.round(pos.coords.longitude * 10000) / 10000;
                  if (typeof pos.coords.altitude === 'number') place.elevation = Math.max(0, Math.round(pos.coords.altitude));
                  place.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                  render();
                },
                () => toast('The location could not be read.', true),
              );
            },
          }),
        )
      : null,
    checkRow({ id: 'use-elevation', label: 'Adjust sunrise and sunset for elevation (off: sea-level times)', checked: a.useElevation, onchange: e => (a.useElevation = e.target.checked) }),
    h('div', { class: 'actions' }, button({ label: 'Save location', variant: 'primary', onclick: e => saveApp('Location saved.', e.currentTarget) })),
  );
}
