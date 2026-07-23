/**
 * Date parsing for BIP header fields.
 *
 * `Created:` in a BIP header is hand-typed by the author, so it is *mostly*
 * ISO `YYYY-MM-DD` and occasionally not: a bare year, a year-month, a spelled
 * out month, a trailing parenthetical, or nothing at all. Every function here
 * returns `null` instead of throwing or handing back an `Invalid Date`, because
 * analytics over a partially broken corpus is still useful — analytics that die
 * on record 300 are not.
 *
 * Everything is computed in UTC. BIP dates have no timezone, and running the
 * report in Sydney should not shift a proposal into the previous year.
 */

const MS_PER_DAY = 86_400_000;

/** Julian year: the conversion astronomers and everyone else agrees on. */
const DAYS_PER_YEAR = 365.25;

/** Anything outside this is a typo or a parser artefact, not a BIP date. */
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

/** A date is usable if it is real and lands in a plausible century. */
function isUsableDate(date: Date): boolean {
  const time = date.getTime();
  if (!Number.isFinite(time)) return false;
  const year = date.getUTCFullYear();
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * Build a UTC date, rejecting impossible calendar values.
 *
 * `Date.UTC` happily rolls 2015-02-31 forward into March, which would silently
 * invent data, so we round-trip the components and reject on mismatch.
 */
function buildUtcDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!isUsableDate(date)) return null;
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return roundTrips ? date : null;
}

function monthFromName(name: string): number | null {
  const month = MONTHS[name.toLowerCase()];
  return month ? month : null;
}

/**
 * Parse whatever a BIP record put in a date field.
 *
 * Recognised: `Date` instances, `YYYY-MM-DD`, `YYYY/MM/DD`, `YYYY.MM.DD`,
 * `YYYY-MM`, `YYYY`, `19 August 2011`, `August 19, 2011`, `Aug 2011`, and ISO
 * timestamps. A partial date is anchored to the earliest instant it could mean
 * (so `2015` becomes 2015-01-01) — that biases intervals slightly long, which
 * is the conservative direction for a "how slow is Bitcoin governance" number.
 *
 * @returns a UTC `Date`, or `null` if the value is missing or unreadable.
 */
export function parseBipDate(value: unknown): Date | null {
  if (value instanceof Date) return isUsableDate(value) ? value : null;
  if (typeof value !== "string") return null;

  // Drop trailing editorial notes, e.g. "2015-11-01 (revised)".
  const text = value.trim().replace(/\s*\(.*\)\s*$/, "").trim();
  if (!text) return null;

  const numeric = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/);
  if (numeric) {
    return buildUtcDate(
      Number(numeric[1]),
      Number(numeric[2]),
      numeric[3] ? Number(numeric[3]) : 1,
    );
  }

  const yearOnly = text.match(/^(\d{4})$/);
  if (yearOnly) return buildUtcDate(Number(yearOnly[1]), 1, 1);

  const dayMonthYear = text.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (dayMonthYear) {
    const month = monthFromName(dayMonthYear[2]);
    if (month === null) return null;
    return buildUtcDate(Number(dayMonthYear[3]), month, Number(dayMonthYear[1]));
  }

  const monthDayYear = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monthDayYear) {
    const month = monthFromName(monthDayYear[1]);
    if (month === null) return null;
    return buildUtcDate(Number(monthDayYear[3]), month, Number(monthDayYear[2]));
  }

  const monthYear = text.match(/^([A-Za-z]+),?\s+(\d{4})$/);
  if (monthYear) {
    const month = monthFromName(monthYear[1]);
    if (month === null) return null;
    return buildUtcDate(Number(monthYear[2]), month, 1);
  }

  // ISO timestamps ("2021-11-14T00:00:00Z", or SQLite's "2021-11-14 00:00:00").
  // The time-of-day is dropped deliberately: everything downstream works at day
  // granularity, and honouring an offset here could shift a BIP across a year
  // boundary depending on where the report is run.
  const timestamp = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ]/);
  if (timestamp) {
    return buildUtcDate(Number(timestamp[1]), Number(timestamp[2]), Number(timestamp[3]));
  }

  // Everything else is unreadable, and we stop here rather than handing the
  // string to `new Date`: V8 reads "sometime in 2019" as 2019-01-01, which
  // invents data and would not reproduce on another engine. A null the caller
  // can count is worth more than a plausible-looking guess.
  return null;
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Convert a day count to years, rounded to 2dp. */
export function daysToYears(days: number): number {
  return Math.round((days / DAYS_PER_YEAR) * 100) / 100;
}

/** Render a UTC date as `YYYY-MM-DD` — JSON-safe and stable across timezones. */
export function toIsoDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** UTC calendar year. */
export function yearOf(date: Date): number {
  return date.getUTCFullYear();
}
