/*
 * Phone numbers and texted codes: the fields and the small rules shared by
 * the sign-in views (auth.js) and the guided setup's phone step.
 * Owner: the sign-up agent.
 */
import { textField } from '../lib.js';

const digitsOf = text => String(text || '').replace(/\D/g, '');

/** "7324440101", "732-444-0101", "+1 732 444 0101" as "(732) 444-0101" while it is typed; anything else unchanged. */
export function formatUs(text) {
  const raw = String(text || '');
  const trimmed = raw.trim();
  if (trimmed.startsWith('+') && !trimmed.startsWith('+1')) return raw;
  let d = digitsOf(trimmed);
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length > 10) return raw;
  if (d.length === 0) return '';
  if (d.length <= 3) return d;
  if (d.length <= 6) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
}

/**
 * Reads a typed number. Returns { number: '+17324440101' } or { error: 'a sentence' }.
 * prefixes: the prefixes the site allows (P.prefixes), such as ['+1'].
 */
export function readNumber(text, prefixes) {
  const allowed = prefixes && prefixes.length ? prefixes : ['+1'];
  const trimmed = String(text || '').trim();
  if (!trimmed) return { error: 'Enter your mobile number.' };
  let number = null;
  if (trimmed.startsWith('+')) {
    const d = digitsOf(trimmed);
    if (d.length < 8 || d.length > 15) return { error: 'That number does not look complete. Check it and try again.' };
    number = '+' + d;
  } else if (allowed.includes('+1')) {
    const d = digitsOf(trimmed);
    if (d.length === 10) number = '+1' + d;
    else if (d.length === 11 && d[0] === '1') number = '+' + d;
    else if (d.length < 10) return { error: 'Enter the whole number with its area code: 10 digits, such as (732) 555-0123.' };
    else return { error: 'That is too many digits for a US mobile number.' };
  } else {
    return { error: 'Enter the number with its country code, starting with +.' };
  }
  if (!allowed.some(p => number.startsWith(p))) return { error: 'Only numbers beginning with ' + allowed.join(' or ') + ' can be used here.' };
  return { number };
}

/**
 * A mobile-number field: large digits, the telephone keypad, and the number
 * shown formatted while it is typed (only when typing at the end, so that a
 * correction in the middle is left alone).
 *   phoneField({ id: 'number', label: 'Your mobile number', value, onvalue: v => ..., error, help })
 */
export function phoneField(opts) {
  const o = opts || {};
  return textField({
    id: o.id,
    label: o.label,
    help: o.help,
    error: o.error,
    type: 'tel',
    inputmode: 'tel',
    autocomplete: o.autocomplete || 'tel',
    class: 'phone-input',
    placeholder: '(732) 555-0123',
    value: formatUs(o.value),
    required: true,
    oninput: e => {
      const el = e.target;
      const atEnd = el.selectionStart === el.value.length;
      const deleting = typeof e.inputType === 'string' && e.inputType.startsWith('delete');
      if (atEnd && !deleting) {
        const next = formatUs(el.value);
        if (next !== el.value) el.value = next;
      }
      if (o.onvalue) o.onvalue(el.value);
    },
    onblur: e => {
      const next = formatUs(e.target.value);
      if (next !== e.target.value) {
        e.target.value = next;
        if (o.onvalue) o.onvalue(next);
      }
    },
  });
}

/**
 * A field for a texted 6-digit code: the number keypad, the phone's offer to
 * fill in a code that just arrived, pasting with spaces or dashes, and
 * oncomplete(code) as soon as the sixth digit is in.
 *   codeField({ id: 'code', label: 'The 6-digit code', value, onvalue, oncomplete, error, help })
 */
export function codeField(opts) {
  const o = opts || {};
  return textField({
    id: o.id,
    label: o.label || 'The 6-digit code',
    help: o.help,
    error: o.error,
    type: 'text',
    wide: false,
    class: 'otp',
    autocomplete: 'one-time-code',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    spellcheck: 'false',
    autocapitalize: 'off',
    placeholder: '······',
    required: true,
    value: o.value || '',
    oninput: e => {
      const el = e.target;
      const code = digitsOf(el.value).slice(0, 6);
      if (code !== el.value) el.value = code;
      if (o.onvalue) o.onvalue(code);
      if (code.length === 6 && o.oncomplete) o.oncomplete(code);
    },
  });
}

/** An error's message, with a plain sentence when the site could not be reached at all. */
export function messageOf(err) {
  if (!err) return 'Something went wrong. Try again.';
  if (err.status === undefined && (err.name === 'TypeError' || /fetch|network/i.test(err.message || ''))) {
    return 'The site could not be reached. Check the internet connection and try again.';
  }
  return err.message || 'Something went wrong. Try again.';
}
