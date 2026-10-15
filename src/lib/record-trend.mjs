const zone = 'America/Detroit';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (time) => {
  const parts = Object.fromEntries(dayFormat.formatToParts(time).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/** Readable integer count ticks, targeting five intervals.
 * @param {number} maximum
 */
export function trendCountAxis(maximum) {
  const target = Math.max(0, maximum) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(target || 1));
  const candidates = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).filter((step) => step >= 1 && Number.isInteger(step));
  const step = candidates.sort((a, b) => Math.abs(Math.ceil(maximum / a) - 5) - Math.abs(Math.ceil(maximum / b) - 5))[0] || 1;
  const ceiling = Math.max(step, Math.ceil(maximum / step) * step);
  return { ceiling, ticks: Array.from({ length: Math.round(ceiling / step) + 1 }, (_, index) => index * step) };
}

/** @param {{key: string, label: string}} point @param {string} unit */
export function trendAxisLabel(point, unit) {
  if (unit === 'hour') return new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric' }).format(Number(point.key));
  if (unit === 'year') return point.key;
  const date = new Date(`${point.key}${unit === 'month' ? '-01' : ''}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', ...(unit === 'month' ? { year: '2-digit' } : { day: 'numeric' }) }).format(date);
}

/** Build a complete, zero-filled series without assigning invented dates to annual rows.
 * @param {{ occurredAt: number | null, year?: number, datePrecision?: string, count?: number }[]} records
 * @param {string} period
 * @param {{key: string, crime: number, victims: number}[]} annual
 * @param {number} now
 */
export function buildRecordTrend(records, period, annual = [], now = Date.now()) {
  const yearly = annual.length > 0 || records.some((record) => record.year !== undefined);
  const hourly = !yearly && period === '24h' && !records.some((record) => record.datePrecision === 'date');
  const unit = yearly ? 'year' : hourly ? 'hour' : /^\d{4}$/.test(period) || period === 'all' ? 'month' : 'day';
  const keyFor = (time) => unit === 'year' ? dayKey(time).slice(0, 4) : unit === 'hour' ? String(Math.floor(time / 3_600_000) * 3_600_000) : unit === 'month' ? dayKey(time).slice(0, 7) : dayKey(time);
  const counts = new Map();
  let undated = 0;
  for (const record of records) {
    const key = record.year !== undefined ? String(record.year) : record.occurredAt !== null && Number.isFinite(record.occurredAt) ? keyFor(record.occurredAt) : null;
    const count = record.count ?? 1;
    if (key === null) { undated += count; continue; }
    counts.set(key, (counts.get(key) || 0) + count);
  }
  for (const row of annual) counts.set(row.key, (counts.get(row.key) || 0) + row.crime + row.victims);
  const days = { '24h': 1, '7d': 7, '30d': 30 }[period];
  if (days && !yearly) {
    if (hourly) {
      for (let time = now - days * 86_400_000; time <= now; time += 3_600_000) {
        const key = keyFor(time);
        if (!counts.has(key)) counts.set(key, 0);
      }
    } else {
      // Iterate calendar dates independently of 23/25-hour daylight-saving days.
      const startDate = Date.parse(`${dayKey(now - days * 86_400_000)}T00:00:00Z`);
      const endDate = dayKey(now);
      for (let date = startDate; new Date(date).toISOString().slice(0, 10) <= endDate; date += 86_400_000) {
        const key = new Date(date).toISOString().slice(0, 10);
        if (!counts.has(key)) counts.set(key, 0);
      }
    }
    if (!counts.has(keyFor(now))) counts.set(keyFor(now), 0);
  } else if (/^\d{4}$/.test(period)) {
    if (yearly) { if (!counts.has(period)) counts.set(period, 0); }
    else for (let month = 1; month <= 12; month++) {
      const key = `${period}-${String(month).padStart(2, '0')}`;
      if (!counts.has(key)) counts.set(key, 0);
    }
  } else if (counts.size) {
    const keys = [...counts.keys()].sort();
    if (yearly) for (let year = Number(keys[0]); year <= Number(keys.at(-1)); year++) {
      if (!counts.has(String(year))) counts.set(String(year), 0);
    }
    else if (unit === 'month') {
      let [year, month] = keys[0].split('-').map(Number);
      while (`${year}-${String(month).padStart(2, '0')}` <= keys.at(-1)) {
        const key = `${year}-${String(month).padStart(2, '0')}`;
        if (!counts.has(key)) counts.set(key, 0);
        if (++month === 13) { month = 1; year++; }
      }
    }
  }
  const points = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => ({
    key, count,
    label: hourly ? new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', timeZoneName: 'short' }).format(Number(key)) : key,
  }));
  return { points, unit, undated, total: points.reduce((sum, point) => sum + point.count, 0) + undated };
}
