import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchJSONResponse } from '../src/lib/http.ts';
import { comparisonCSV } from '../src/lib/cjic-comparison.ts';

test('CSV exports preserve text, line breaks, commas and numeric changes safely', () => {
  const csv = comparisonCSV([['label', 'count'], ['=HYPERLINK("bad")', -4], ['quoted, "text"\nsecond line', null]]);
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")",-4'));
  assert.ok(csv.includes('"quoted, ""text""\nsecond line",'));
});
test('unresponsive sources time out while caller cancellation remains cancellable', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_, { signal }) => new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(fetchJSONResponse('https://example.test', { timeoutMs: 10 }), /too long/);
    const controller = new AbortController();
    const request = fetchJSONResponse('https://example.test', { signal: controller.signal, timeoutMs: 100 });
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
  } finally { clearTimeout(keepAlive); globalThis.fetch = original; }
});
