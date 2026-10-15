export const DAY_MS = 86_400_000;
const detroitParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
function detroitTime(date, hour) {
  const target = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
  let time = target;
  for (let iteration = 0; iteration < 3; iteration++) {
    const parts = Object.fromEntries(detroitParts.formatToParts(time).map((part) => [part.type, Number(part.value)]));
    const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    time += target - local;
  }
  return time;
}

/**
 * Convert a date-only value to noon in Detroit. Noon prevents records from
 * displaying on an adjacent date when they are converted to an incident.
 *
 * @param {string} date
 */
export function dateOnlyValue(date) {
  return detroitTime(date, 12);
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
  const nextDate = new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  const dateStart = detroitTime(date, 0);
  const dateEnd = detroitTime(nextDate, 0) - 1;
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
