export const DAY_MS = 86_400_000;

/**
 * Convert a date-only value to noon in Detroit. Noon prevents records from
 * displaying on an adjacent date when they are converted to an incident.
 *
 * @param {string} date
 */
export function dateOnlyValue(date) {
  return Date.parse(`${date}T12:00:00-04:00`);
}

/**
 * A date-only record represents the entire reported calendar day. It matches
 * a rolling window whenever any part of that day overlaps the window.
 *
 * @param {string} date
 * @param {number} windowStart
 * @param {number} windowEnd
 */
export function dateOnlyOverlapsWindow(date, windowStart, windowEnd) {
  const noon = dateOnlyValue(date);
  const dateStart = noon - DAY_MS / 2;
  const dateEnd = noon + DAY_MS / 2 - 1;
  return dateEnd >= windowStart && dateStart <= windowEnd;
}

/**
 * @param {string} date
 * @param {string} period
 * @param {number} now
 */
export function dateOnlyMatchesPeriod(date, period, now) {
  if (period === '24h') return dateOnlyOverlapsWindow(date, now - DAY_MS, now);
  if (period === '7d') return dateOnlyOverlapsWindow(date, now - 7 * DAY_MS, now);
  if (period === '30d') return dateOnlyOverlapsWindow(date, now - 30 * DAY_MS, now);
  if (/^\d{4}$/.test(period)) return date.slice(0, 4) === period;
  return true;
}
