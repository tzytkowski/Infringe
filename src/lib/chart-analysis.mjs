/** @param {Record<string, number>} counts @param {number} limit */
export function rankCrimeMix(counts, limit = 6) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const ranked = entries.filter(([name]) => name !== 'Other').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
  if (!ranked.some(([name]) => name === 'Homicide')) {
    if (ranked.length >= limit) ranked.pop();
    ranked.push(['Homicide', counts.Homicide || 0]);
    ranked.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  const remainder = total - ranked.reduce((sum, [, count]) => sum + count, 0);
  if (remainder) ranked.push(['Other offenses', remainder]);
  return { total, rows: ranked.map(([name, count]) => ({ name, count, share: total ? count / total : 0 })) };
}

const timeParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** @param {{occurredAt: number | null, datePrecision?: string, count?: number}[]} records */
export function buildTimingGrid(records) {
  const cells = Array(168).fill(0);
  let total = 0;
  let excluded = 0;
  for (const record of records) {
    const count = record.count ?? 1;
    if (record.occurredAt === null || !Number.isFinite(record.occurredAt) || record.datePrecision === 'date') { excluded += count; continue; }
    const parts = Object.fromEntries(timeParts.formatToParts(record.occurredAt).map((part) => [part.type, part.value]));
    cells[WEEKDAYS.indexOf(parts.weekday) * 24 + Number(parts.hour)] += count;
    total += count;
  }
  return { cells, total, excluded, maximum: Math.max(0, ...cells) };
}

/** @param {{count: number}[]} points @param {number} window */
export function trailingAverage(points, window = 3) {
  return points.map((_, index) => index + 1 < window ? null : points.slice(index + 1 - window, index + 1).reduce((sum, point) => sum + point.count, 0) / window);
}
