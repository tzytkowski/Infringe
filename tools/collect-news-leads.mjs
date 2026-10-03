import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { standardizeOffense } from '../src/lib/offense-taxonomy.mjs';

// Only the publishers' advertised WXYZ and WDIV RSS feeds are read.
const feeds = [
  { outlet: 'WXYZ', url: 'https://www.wxyz.com/news/region/detroit.rss' },
  { outlet: 'WXYZ', url: 'https://www.wxyz.com/news/region/wayne-county.rss' },
  { outlet: 'WXYZ', url: 'https://www.wxyz.com/news/region/oakland-county.rss' },
  { outlet: 'WXYZ', url: 'https://www.wxyz.com/news/region/macomb-county.rss' },
  { outlet: 'WDIV', url: 'https://www.clickondetroit.com/arc/outboundfeeds/rss/category/news/?outputType=xml&size=100' },
];
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
const leadPath = new URL('../data/local-news/leads.json', import.meta.url);
const reviewedPath = new URL('../public/data/local-news/incidents.json', import.meta.url);
const articlePath = new URL('../public/data/local-news/articles.json', import.meta.url);
const homicideWords = /\b(homicide|murder(?:ed)?|slain|killed|kills?|dead|fatally shot|shot to death|stabbed to death|fatal shooting|deadly shooting|deadly stabbing)\b/i;
const crimeWords = /\b(homicide|murder(?:ed)?|slain|killed|shooting|shot|gunfire|guns?|stabbing|stabbed|robbery|robbed|carjack(?:ing|ed)?|kidnap(?:ping|ped)?|abduct(?:ion|ed)?|assault(?:ed)?|rape|sexual assault|burglary|break-in|breaking and entering|theft|stolen|larceny|arson|fraud|forgery|embezzl(?:ement|ed)|identity theft|vandal(?:ism|ized)?|firearm|weapon|drug|narcotic)\b/i;
const nonTrafficCrimeWords = /\b(homicide|murder(?:ed)?|shooting|shot|gunfire|guns?|stabbing|stabbed|robbery|robbed|carjack(?:ing|ed)?|kidnap(?:ping|ped)?|abduct(?:ion|ed)?|assault(?:ed)?|rape|sexual assault|burglary|break-in|breaking and entering|theft|stolen|larceny|arson|fraud|forgery|embezzl(?:ement|ed)|identity theft|vandal(?:ism|ized)?|firearm|weapon|drug|narcotic)\b/i;
const unrelatedHeadline = /\b(horse|homicide detective)\b/i;
const trafficDeath = /\b(crash(?:es)?|accident|drunk driver|pedestrian|struck by|struck and killed|hit-and-run)\b/i;
const explicitHomicide = /\b(homicide|murder(?:ed)?)\b/i;
const metroWords = /\b(detroit|wayne|oakland|macomb|pontiac|southfield|warren|sterling heights|royal oak|livonia|dearborn|redford|taylor|roseville|eastpointe|st\. clair shores|mount clemens|mt\. clemens|westland|inkster|ferndale|hazel park|madison heights|auburn hills|waterford|commerce township|rochester|bloomfield|clinton township|shelby township|canton|novi|farmington|romulus|hamtramck|highland park)\b/i;

function canonicalUrl(raw, outlet) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  const expected = outlet === 'WXYZ' ? 'www.wxyz.com' : 'www.clickondetroit.com';
  if (url.protocol !== 'https:' || url.hostname !== expected || !url.pathname.startsWith('/news/')) return null;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function isCrimeLead(title, description) {
  const text = `${title} ${description}`;
  if (!crimeWords.test(text) || unrelatedHeadline.test(title)) return false;
  if (trafficDeath.test(title) && !explicitHomicide.test(title) && !nonTrafficCrimeWords.test(title)) return false;
  return true;
}

function classifyLead(title, description) {
  if (homicideWords.test(title)) return 'Homicide';
  const standard = standardizeOffense(title, description);
  if (standard !== 'Other') return standard;
  if (/\b(break-in|breaking and entering)\b/i.test(`${title} ${description}`)) return 'Burglary / home invasion';
  if (/\b(shooting|shot|gunfire|guns?|firearm|weapon)\b/i.test(`${title} ${description}`)) return 'Weapons offense';
  return 'Other';
}

export function parseFeed(xml, outlet, now = new Date().toISOString()) {
  const items = parser.parse(xml)?.rss?.channel?.item;
  if (!items) throw new Error(`${outlet} RSS did not contain any items`);
  return (Array.isArray(items) ? items : [items]).flatMap((item) => {
    const title = String(item.title || '').trim();
    const description = String(item.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 500);
    const url = canonicalUrl(String(item.link || ''), outlet);
    if (!url || !isCrimeLead(title, description)) return [];
    if (outlet === 'WDIV' && !metroWords.test(`${title} ${description}`)) return [];
    const published = new Date(String(item.pubDate || ''));
    return [{ outlet, url, title, category: classifyLead(title, description), publishedAt: Number.isNaN(published.getTime()) ? null : published.toISOString(), firstSeenAt: now, status: 'new' }];
  });
}

async function getFeed(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Infringe-RSS-Reader/1.0 (+https://github.com/tzytkowski/Infringe)', Accept: 'application/rss+xml, application/xml;q=0.9' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timeout); }
}

async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function collect() {
  const existing = await readJson(leadPath, { updatedAt: '', leads: [] });
  const reviewed = await readJson(reviewedPath, { cases: [] });
  const cited = new Set(reviewed.cases.flatMap((item) => item.articles.map((article) => canonicalUrl(article.url, article.outlet)).filter(Boolean)));
  const byUrl = new Map(existing.leads.filter((item) => item.status !== 'new' || isCrimeLead(item.title, '')).map((item) => {
    const { description: _description, ...metadata } = item;
    return [item.url, { ...metadata, category: classifyLead(item.title, '') }];
  }));
  const errors = [];
  let added = 0;
  for (const feed of feeds) {
    try {
      const leads = parseFeed(await getFeed(feed.url), feed.outlet);
      for (const lead of leads) {
        const previous = byUrl.get(lead.url);
        if (previous) byUrl.set(lead.url, { ...lead, ...previous, category: lead.category });
        else if (!cited.has(lead.url)) { byUrl.set(lead.url, lead); added++; }
      }
      console.log(`${feed.outlet}: checked ${feed.url}, ${leads.length} possible leads`);
    } catch (error) { errors.push(`${feed.url}: ${error.message}`); }
  }
  if (errors.length === feeds.length) throw new Error(`Every RSS feed failed:\n${errors.join('\n')}`);
  const leads = [...byUrl.values()].sort((a, b) => (b.publishedAt || b.firstSeenAt).localeCompare(a.publishedAt || a.firstSeenAt));
  const output = { updatedAt: new Date().toISOString(), leads };
  const articles = leads.filter((item) => item.status === 'new' && item.publishedAt && !cited.has(item.url)).map((item) => ({
    id: createHash('sha256').update(item.url).digest('hex').slice(0, 16),
    outlet: item.outlet,
    url: item.url,
    title: item.title,
    category: item.category || classifyLead(item.title, ''),
    publishedAt: item.publishedAt,
  }));
  await mkdir(new URL('.', leadPath), { recursive: true });
  await writeFile(leadPath, `${JSON.stringify(output, null, 2)}\n`);
  await writeFile(articlePath, `${JSON.stringify({ updatedAt: output.updatedAt, articles }, null, 2)}\n`);
  console.log(`${added} new leads; ${leads.length} total pending/reviewed/dismissed; ${articles.length} current publisher-feed articles. Review ${fileURLToPath(leadPath)}`);
  for (const error of errors) console.warn(`Feed unavailable: ${error}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  collect().catch((error) => { console.error(error); process.exitCode = 1; });
}
