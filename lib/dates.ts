// Phase 10A: the club's timezone.
//
// EVERY DISPLAYED DATE GOES THROUGH HERE. The club is in Goa, so the dates on
// the site are Indian dates - a session at 9pm IST belongs to that evening, not
// to the next day because the server happens to count in UTC.
//
// WHY PIN THE ZONE RATHER THAN USE THE VISITOR'S
//
// These formatters used to pin UTC, for a good reason: a date must not shift
// with wherever the reader is sitting. That reason still holds - it is the ZONE
// that changed, not the principle. Pinning Asia/Kolkata keeps the anti-shift
// property AND makes the date mean what the club means by it. Letting the
// browser decide would put a member in London and a member in Goa on different
// days for the same session.
//
// STORAGE IS UNTOUCHED. Every timestamp in the database is still a TIMESTAMPTZ
// written in UTC. This module only decides how an instant is READ.
//
// Intl, not hand-rolled arithmetic, for the calendar work: the runtime's
// timezone database knows IST is +05:30 and has no DST, and a hand-rolled offset
// would silently be wrong the day somebody changes that assumption.

/** The club's timezone. Indian Standard Time, UTC+05:30, no DST. */
export const CLUB_TIME_ZONE = 'Asia/Kolkata';

/**
 * The display locale.
 *
 * `en-IN` renders dates in the Indian order ("18 Sep 2026") rather than the
 * American one ("Sep 18, 2026"), which is what the club and its members read.
 */
const CLUB_LOCALE = 'en-IN';

/** IST is a fixed +05:30 - there is no daylight saving to account for. */
const IST_OFFSET_MS = 330 * 60 * 1000;

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/** A month and a year, e.g. "September 2026". */
export function formatIstMonth(value: string | Date): string {
  const date = toDate(value);

  if (!date) return typeof value === 'string' ? value : '';

  return new Intl.DateTimeFormat(CLUB_LOCALE, {
    timeZone: CLUB_TIME_ZONE,
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** A short month and a year, e.g. "Sep 2026". */
export function formatIstShortMonth(value: string | Date): string {
  const date = toDate(value);

  if (!date) return typeof value === 'string' ? value : '';

  return new Intl.DateTimeFormat(CLUB_LOCALE, {
    timeZone: CLUB_TIME_ZONE,
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** A calendar date, e.g. "18 Sep 2026". */
export function formatIstDate(value: string | Date): string {
  const date = toDate(value);

  if (!date) return typeof value === 'string' ? value : '';

  return new Intl.DateTimeFormat(CLUB_LOCALE, {
    timeZone: CLUB_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * A date with its weekday, e.g. "Fri, 18 Sep 2026".
 *
 * Used for events, where the day of the week is part of what a reader is
 * checking.
 */
export function formatIstWeekdayDate(value: string | Date): string {
  const date = toDate(value);

  if (!date) return typeof value === 'string' ? value : '';

  return new Intl.DateTimeFormat(CLUB_LOCALE, {
    timeZone: CLUB_TIME_ZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** A date and a time, e.g. "17 Sep 2026, 22:13". */
export function formatIstDateTime(value: string | Date): string {
  const date = toDate(value);

  if (!date) return typeof value === 'string' ? value : '';

  return new Intl.DateTimeFormat(CLUB_LOCALE, {
    timeZone: CLUB_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Today in IST, as 'YYYY-MM-DD'.
 *
 * For a CALENDAR DATE that is stored, not for a timestamp. Shifting the instant
 * into IST and reading the UTC parts of the result is exact, because IST is a
 * fixed offset with no DST.
 */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export type MonthPeriod = {
  /** Inclusive. */
  start: Date;
  /** Exclusive. */
  end: Date;
};

/**
 * The current leaderboard month, as the half-open range [start, end).
 *
 * THE INDIAN MONTH, because that is what "this month" means to this club. The
 * boundaries are IST midnights expressed as UTC instants - the instants are what
 * the database is queried with, and it compares them against UTC timestamps, so
 * the window is exact.
 *
 * This replaces `utcMonthPeriod`. That function's own comment justified the UTC
 * calendar month on the grounds that "there is no application-level timezone
 * anywhere" - which this phase ends. Once the site labels the month in IST, the
 * window has to agree with the label: a UTC window under an IST heading would
 * disagree for five and a half hours at every month boundary, showing August's
 * entries under "September 2026".
 *
 * `Date.UTC` performs exact calendar arithmetic, so the window is correct across
 * month lengths and leap years alike.
 */
export function istMonthPeriod(now: Date = new Date()): MonthPeriod {
  // Read the IST calendar month by shifting the instant, then build the
  // boundaries back in UTC.
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);

  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();

  return {
    start: new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - IST_OFFSET_MS),
  };
}
