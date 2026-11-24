/**
 * The GSM-7 basic character set and the length of a text in SMS segments.
 * A text made only of these characters is sent 160 to a segment (153 each
 * when it takes more than one); a single other character makes the whole
 * text UCS-2, 70 to a segment, which would double the cost.
 */

const BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ' +
  ' !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§' +
  '¿abcdefghijklmnopqrstuvwxyzäöñüà';

const GSM_BASIC = new Set(BASIC);

/** One SMS segment. */
export const SEGMENT_CHARS = 160;
/** Two SMS segments (153 each once a text is split): the most any reply may take. */
export const MAX_TEXT_CHARS = 306;

export function isGsmBasic(text: string): boolean {
  for (const ch of text) if (!GSM_BASIC.has(ch)) return false;
  return true;
}

/** Number of SMS segments for a GSM-7 basic text. */
export function segments(text: string): number {
  return text.length <= SEGMENT_CHARS ? 1 : Math.ceil(text.length / 153);
}

/**
 * Makes text from elsewhere (a place name) GSM-7: accents that GSM-7 lacks
 * are dropped from their letters ("Jérôme" -> "Jérome"), and any other
 * character becomes a space.
 */
export function foldToGsm(text: string): string {
  let out = '';
  for (const ch of text) {
    if (GSM_BASIC.has(ch)) {
      out += ch;
      continue;
    }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base !== '' && [...base].every(c => GSM_BASIC.has(c)) ? base : ' ';
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

/** Counts of last-resort repairs in outgoing texts. The tests require both to stay at zero. */
export const repairs = { folded: 0, shortened: 0 };

/**
 * Last-resort guard on every outgoing text: GSM-7 only and at most two
 * segments. Every text the engine writes already meets this (the tests
 * check it); the guard keeps a surprise from costing more.
 */
export function guard(text: string): string {
  let t = text;
  if (!isGsmBasic(t)) {
    repairs.folded++;
    t = foldToGsm(t);
  }
  if (t.length > MAX_TEXT_CHARS) {
    repairs.shortened++;
    const cut = t.slice(0, MAX_TEXT_CHARS - 3);
    const end = cut.lastIndexOf('. ');
    t = end > 100 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}...`;
  }
  return t;
}
