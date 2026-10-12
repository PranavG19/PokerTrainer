/**
 * The learner's day, as one integer.
 *
 * Practice days (the Career cadence, the Lamp, the Chalk daily cap) follow the learner's own night, not
 * UTC: bucketing by `Math.floor(ms / 86_400_000)` put a UTC−8 evening session on "tomorrow". The day also
 * turns at 4 am local rather than midnight, so a session that runs past midnight still belongs to the
 * evening it started in.
 *
 * Core stays clock-free and timezone-free: `dayKeyAt` is pure arithmetic on an explicit offset, and every
 * core consumer takes a `DayKeyOf` function. `systemDayKeyOf` is the one place that reads the machine's
 * timezone, and only the renderer (or main) calls it. The offset is looked up per timestamp, so a
 * session either side of a DST change lands on the right local day.
 */

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/** The local hour at which one practice day ends and the next begins. */
export const DAY_BOUNDARY_HOUR = 4;

declare const dayKeyBrand: unique symbol;
/** Days since the epoch on the learner's local calendar, shifted by the boundary hour. */
export type DayKey = number & { readonly [dayKeyBrand]: 'DayKey' };

export type DayKeyOf = (ms: number) => DayKey;

/**
 * `offsetMinutes` is local minus UTC (UTC−8 is −480): the negation of `Date#getTimezoneOffset`.
 */
export function dayKeyAt(ms: number, offsetMinutes: number, boundaryHour: number = DAY_BOUNDARY_HOUR): DayKey {
  return Math.floor((ms + offsetMinutes * 60_000 - boundaryHour * MS_PER_HOUR) / MS_PER_DAY) as DayKey;
}

/** A fixed-offset day function. Tests use it; so does anything that must not depend on the machine. */
export function fixedOffsetDayKeyOf(offsetMinutes: number, boundaryHour: number = DAY_BOUNDARY_HOUR): DayKeyOf {
  return (ms) => dayKeyAt(ms, offsetMinutes, boundaryHour);
}

/** The machine's timezone, looked up for each timestamp. Never called from core logic. */
export function systemDayKeyOf(boundaryHour: number = DAY_BOUNDARY_HOUR): DayKeyOf {
  return (ms) => dayKeyAt(ms, -new Date(ms).getTimezoneOffset(), boundaryHour);
}

/** Validates a persisted day key: a safe integer. Anything else is corruption. */
export function asDayKey(value: unknown): DayKey | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? (value as DayKey) : null;
}
