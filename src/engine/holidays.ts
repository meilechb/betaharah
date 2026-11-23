/**
 * The few calendar facts the engine needs: Shabbat, Yom Tov, and the two
 * fasts on whose night immersion is not done.
 */
import { dayOfWeek } from './civil';
import { absOfHebrew, hebrewOfAbs, HEBREW_MONTHS } from './hebrew';

/** True if the Hebrew date `abs` is Shabbat. */
export function isShabbat(abs: number): boolean {
  return dayOfWeek(abs) === 6;
}

/** Hebrew date (R.D.) on which the fast of Tisha B'Av is observed in Hebrew year `yy`. */
export function tishaBavObserved(yy: number): number {
  const ninth = absOfHebrew({ yy, mm: HEBREW_MONTHS.AV, dd: 9 });
  // 9 Av on Shabbat: the fast is pushed off to Sunday, 10 Av.
  return isShabbat(ninth) ? ninth + 1 : ninth;
}

export function isYomKippur(abs: number): boolean {
  const h = hebrewOfAbs(abs);
  return h.mm === HEBREW_MONTHS.TISHREI && h.dd === 10;
}

export function isTishaBavObserved(abs: number): boolean {
  return tishaBavObserved(hebrewOfAbs(abs).yy) === abs;
}

/**
 * True if immersion is not done on the night that begins Hebrew date `abs`:
 * the night of Yom Kippur and the night of the (observed) fast of Tisha B'Av.
 */
export function isNoImmersionNight(abs: number): boolean {
  return isYomKippur(abs) || isTishaBavObserved(abs);
}

/** True if the Hebrew date is a Yom Tov on which melachah is forbidden. */
export function isYomTov(abs: number, where: 'diaspora' | 'israel'): boolean {
  const { mm, dd } = hebrewOfAbs(abs);
  const two = where === 'diaspora';
  switch (mm) {
    case HEBREW_MONTHS.TISHREI:
      // Rosh Hashanah (two days everywhere), Yom Kippur, Sukkot, Shemini Atzeret / Simchat Torah
      return dd === 1 || dd === 2 || dd === 10 || dd === 15 || (two && dd === 16) || dd === 22 || (two && dd === 23);
    case HEBREW_MONTHS.NISAN:
      return dd === 15 || (two && dd === 16) || dd === 21 || (two && dd === 22);
    case HEBREW_MONTHS.SIVAN:
      return dd === 6 || (two && dd === 7);
    default:
      return false;
  }
}

/** Shabbat or Yom Tov. */
export function isRestDay(abs: number, where: 'diaspora' | 'israel'): boolean {
  return isShabbat(abs) || isYomTov(abs, where);
}
