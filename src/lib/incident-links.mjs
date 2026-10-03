import { standardizeOffense } from './offense-taxonomy.mjs';

const ignoredLocationWords = new Set(['avenue', 'street', 'road', 'drive', 'boulevard', 'highway', 'freeway', 'block', 'near', 'and', 'the', 'east', 'west', 'north', 'south']);

/** @param {string} value */
function locationTokens(value) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((word) => word.length >= 4 && !ignoredLocationWords.has(word)));
}

/** @param {number} value */
function detroitDay(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

/** @param {any} left @param {any} right */
function nearby(left, right) {
  if (![left.longitude, left.latitude, right.longitude, right.latitude].every(Number.isFinite)) return false;
  const latitude = (left.latitude + right.latitude) * Math.PI / 360;
  const x = (left.longitude - right.longitude) * 111.32 * Math.cos(latitude);
  const y = (left.latitude - right.latitude) * 110.57;
  return Math.hypot(x, y) <= 2;
}

/** @param {any} news @param {any} agency */
function likelySameIncident(news, agency) {
  if (news.occurredAt == null || agency.occurredAt == null) return false;
  if (detroitDay(news.occurredAt) !== detroitDay(agency.occurredAt)) return false;
  if (standardizeOffense(news.category, news.description) !== 'Homicide' || standardizeOffense(agency.category, agency.description) !== 'Homicide') return false;
  if (nearby(news, agency)) return true;
  const newsTokens = locationTokens(`${news.intersection || ''} ${news.neighborhood || ''}`);
  const agencyTokens = locationTokens(`${agency.intersection || ''} ${agency.neighborhood || ''}`);
  return [...newsTokens].some((token) => agencyTokens.has(token));
}

/** @param {any[]} incidents */
export function enrichAndLinkIncidents(incidents) {
  const enriched = incidents.map((incident) => ({
    ...incident,
    standardOffense: standardizeOffense(incident.category, incident.description),
    relatedIncidentIds: [],
  }));
  const news = enriched.filter((incident) => incident.source === 'news');
  const agency = enriched.filter((incident) => incident.source === 'detroit' || incident.source === 'clemis');
  for (const report of news) {
    for (const record of agency) {
      if (!likelySameIncident(report, record)) continue;
      report.relatedIncidentIds.push(record.id);
      record.relatedIncidentIds.push(report.id);
    }
  }
  return enriched;
}
