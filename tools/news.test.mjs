import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { dateOnlyMatchesPeriod } from '../src/lib/date-only-period.mjs';
import { parseFeed } from './collect-news-leads.mjs';

function feed(items) {
  return `<rss><channel>${items.map(({ title, link, description = '' }) => `<item><title><![CDATA[${title}]]></title><link>${link}</link><description><![CDATA[${description}]]></description><pubDate>Tue, 29 Sep 2026 20:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
}

test('RSS collector keeps crime leads but excludes traffic deaths and unrelated stories', () => {
  const xml = feed([
    { title: 'Three killed in Detroit shooting', link: 'https://www.wxyz.com/news/detroit-shooting' },
    { title: 'Horse struck and killed in Detroit', link: 'https://www.wxyz.com/news/horse-killed' },
    { title: 'Driver killed in Detroit crash', link: 'https://www.wxyz.com/news/crash' },
    { title: 'Detroit homicide detective retires', link: 'https://www.wxyz.com/news/detective' },
    { title: 'Murder investigation in Warren', link: 'https://www.wxyz.com/news/warren-murder' },
    { title: 'Driver charged with murder after vehicle strikes Warren vendor', link: 'https://www.wxyz.com/news/warren-vehicle-murder' },
  ]);
  assert.deepEqual(parseFeed(xml, 'WXYZ').map((item) => item.url), [
    'https://www.wxyz.com/news/detroit-shooting',
    'https://www.wxyz.com/news/warren-murder',
    'https://www.wxyz.com/news/warren-vehicle-murder',
  ]);
});

test('RSS collector assigns major crime categories beyond homicide', () => {
  const xml = feed([
    { title: 'Armed robbery reported in Detroit', link: 'https://www.wxyz.com/news/detroit-robbery' },
    { title: 'Thieves steal safe during Warren break-in', link: 'https://www.wxyz.com/news/warren-break-in' },
    { title: 'Loaded gun found at Canton daycare', link: 'https://www.wxyz.com/news/canton-gun' },
    { title: 'Pedestrian struck and killed in Macomb County', link: 'https://www.wxyz.com/news/pedestrian-crash' },
  ]);
  assert.deepEqual(parseFeed(xml, 'WXYZ').map((item) => item.category), [
    'Robbery / carjacking',
    'Burglary / home invasion',
    'Weapons offense',
  ]);
});

test('WDIV feed requires a metro area and rejects links outside the publisher', () => {
  const xml = feed([
    { title: 'Man killed in Pontiac shooting', link: 'https://www.clickondetroit.com/news/local/pontiac-shooting/' },
    { title: 'Man killed in Florida shooting', link: 'https://www.clickondetroit.com/news/national/florida-shooting/' },
    { title: 'Murder in Detroit', link: 'https://example.com/news/detroit-murder' },
  ]);
  assert.equal(parseFeed(xml, 'WDIV').length, 1);
});

test('reviewed cases have distinct IDs, geographic notes, and direct publisher citations', async () => {
  const file = JSON.parse(await readFile(new URL('../public/data/local-news/incidents.json', import.meta.url), 'utf8'));
  const ids = new Set();
  for (const item of file.cases) {
    assert.ok(!ids.has(item.id));
    ids.add(item.id);
    assert.match(item.incidentDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(item.category, 'Homicide / Murder');
    assert.ok(item.victims > 0 && Number.isInteger(item.victims));
    assert.ok(item.locationNote.length > 20);
    if (item.longitude === null || item.latitude === null) {
      assert.equal(item.longitude, null);
      assert.equal(item.latitude, null);
      assert.match(item.locationNote, /list-only/i);
    } else {
      assert.ok(item.longitude > -85 && item.longitude < -81 && item.latitude > 41 && item.latitude < 44);
    }
    assert.ok(item.articles.length > 0);
    for (const article of item.articles) assert.match(article.url, /^https:\/\/www\.(wxyz\.com|clickondetroit\.com)\//);
  }
  assert.deepEqual([...new Set(file.cases.map((item) => Number(item.incidentDate.slice(0, 4))))].sort((a, b) => a - b), [
    1981, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026,
  ]);
});

test('publisher feed archive keeps labeled article metadata separate from incidents', async () => {
  const file = JSON.parse(await readFile(new URL('../public/data/local-news/articles.json', import.meta.url), 'utf8'));
  assert.ok(file.articles.length > 0);
  assert.ok(new Set(file.articles.map((item) => item.category)).size > 1);
  for (const item of file.articles) {
    assert.match(item.id, /^[a-f0-9]{16}$/);
    assert.match(item.publishedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(item.url, /^https:\/\/www\.(wxyz\.com|clickondetroit\.com)\//);
    assert.doesNotMatch(item.title, /\b(crash|pedestrian struck)\b/i);
  }
});

test('date-only cases match rolling windows when their calendar day overlaps', () => {
  const now = Date.parse('2026-10-03T16:00:00Z');

  assert.equal(dateOnlyMatchesPeriod('2026-10-03', '24h', now), true);
  assert.equal(dateOnlyMatchesPeriod('2026-10-02', '24h', now), true);
  assert.equal(dateOnlyMatchesPeriod('2026-10-01', '24h', now), false);
  assert.equal(dateOnlyMatchesPeriod('2026-10-04', '24h', now), false);

  assert.equal(dateOnlyMatchesPeriod('2026-09-26', '7d', now), true);
  assert.equal(dateOnlyMatchesPeriod('2026-09-25', '7d', now), false);
  assert.equal(dateOnlyMatchesPeriod('2026-09-03', '30d', now), true);
  assert.equal(dateOnlyMatchesPeriod('2026-09-02', '30d', now), false);
});

test('date-only cases remain selectable by archived year', () => {
  const now = Date.parse('2026-10-03T16:00:00Z');

  assert.equal(dateOnlyMatchesPeriod('2014-05-20', '2014', now), true);
  assert.equal(dateOnlyMatchesPeriod('2014-05-20', '2015', now), false);
  assert.equal(dateOnlyMatchesPeriod('2014-05-20', 'all', now), true);
});
