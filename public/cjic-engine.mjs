export function prepareChunk(source, year, data) {
  const columns = Object.fromEntries(data.fields.map((name, index) => [name, index]));
  const values = Uint32Array.from(data.values);
  const count = data.masks.length;
  const ids = new Float64Array(count);
  for (let row = 0; row < count; row++) ids[row] = Number(data.dictionaries[columns.MICR_INCIDENTS_ID][values[row * data.fields.length + columns.MICR_INCIDENTS_ID]]);
  return { source, year, fields: data.fields, dictionaries: data.dictionaries, values, masks: Uint32Array.from(data.masks), count, columns, ids };
}

function value(chunk, row, field) {
  const column = chunk.columns[field];
  return column === undefined ? '' : chunk.dictionaries[column][chunk.values[row * chunk.fields.length + column]];
}

function groupFor(chunk, row) {
  const group = value(chunk, row, 'O_CRIME_AGAINST') || value(chunk, row, 'CRIME_AGAINST');
  return ['Person', 'Property', 'Society'].includes(group) ? group : 'Other';
}

export function queryCJIC(manifest, chunks, filters) {
  const { sources, period, category = '', races = [], search = '', offset = 0, limit = 300, scope = 'all', analysisOnly = false } = filters;
  const term = search.trim().toLowerCase();
  const raceMask = races.reduce((mask, race) => {
    const index = manifest.races.indexOf(race);
    return index < 0 ? mask : mask | (2 ** index);
  }, 0);
  const filteredByRace = races.length > 0;
  const available = chunks.filter((chunk) => sources.includes(chunk.source) && (period === 'all' || String(chunk.year) === period));
  const references = [];
  const areas = new Map();
  const geography = new Map(manifest.areas.map((area) => [area.key, area]));
  const sourceCounts = Object.fromEntries(sources.map((source) => [source, 0]));
  const groups = {};
  const byYear = new Map();
  const byOffense = new Map();
  const victimRaces = {};
  const victimAges = {};
  const victimSex = {};
  let total = 0;
  const inScope = (area, key = area.key) => scope === 'all' || scope === `county:${area.county}` || scope === key;
  // Keep zero-match municipalities, especially villages nested inside townships.
  // Otherwise a village can incorrectly inherit the township's heat and tooltip.
  for (const location of manifest.areas) {
    const key = location.precision === 'county' ? `${location.county}|__county__` : location.key;
    if (inScope(location, key) && !areas.has(key)) {
      areas.set(key, { ...location, key, city: location.precision === 'county' ? 'Unresolved reporting locations' : location.city, crime: 0, victims: 0, races: {}, reportingLabels: [] });
    }
  }
  const increment = (table, key) => { if (key) table[key] = (table[key] || 0) + 1; };
  const tally = (table, key, source) => {
    if (!table.has(key)) table.set(key, { key, crime: 0, victims: 0 });
    table.get(key)[source === 'cjic-crime' ? 'crime' : 'victims']++;
  };

  available.forEach((chunk, chunkIndex) => {
    const matchingValues = term ? chunk.dictionaries.map((dictionary) => Uint8Array.from(dictionary.map((entry) => entry.toLowerCase().includes(term) ? 1 : 0))) : null;
    const categoryIndex = category ? chunk.dictionaries[chunk.columns.MICR_OFFENSE].indexOf(category) : -1;
    if (category && categoryIndex < 0) return;
    for (let row = 0; row < chunk.count; row++) {
      const rowStart = row * chunk.fields.length;
      if (category && chunk.values[rowStart + chunk.columns.MICR_OFFENSE] !== categoryIndex) continue;
      if (filteredByRace && !(chunk.masks[row] & raceMask)) continue;
      if (matchingValues && !matchingValues.some((matches, column) => matches[chunk.values[rowStart + column]])) continue;
      const rawKey = `${value(chunk, row, 'COUNTY_DESCRIPTION')}|${value(chunk, row, 'CITY_DESCRIPTION')}`;
      const location = geography.get(rawKey);
      if (!location) throw new Error(`Missing reporting geography for ${rawKey}`);
      const key = location.precision === 'county' ? `${location.county}|__county__` : rawKey;
      if (!inScope(location, key)) continue;
      total++;
      if (!analysisOnly) references.push(chunkIndex * 1_048_576 + row);
      sourceCounts[chunk.source]++;
      const group = groupFor(chunk, row);
      groups[group] = (groups[group] || 0) + 1;
      if (analysisOnly) {
        tally(byYear, String(chunk.year), chunk.source);
        tally(byOffense, value(chunk, row, 'MICR_OFFENSE'), chunk.source);
        if (chunk.source === 'cjic-victim') {
          increment(victimRaces, value(chunk, row, 'RACE') || 'Not reported');
          increment(victimAges, value(chunk, row, 'VICTIM_AGE_GROUP') || 'Not reported');
          increment(victimSex, value(chunk, row, 'SEX') || 'Not reported');
        }
      }
      if (!areas.has(key)) areas.set(key, { ...location, key, city: location.precision === 'county' ? 'Unresolved reporting locations' : location.city, crime: 0, victims: 0, races: {}, reportingLabels: [] });
      const area = areas.get(key);
      if (!area.reportingLabels.includes(location.city)) area.reportingLabels.push(location.city);
      area[chunk.source === 'cjic-crime' ? 'crime' : 'victims']++;
      // The displayed race breakdown uses victim rows when that source is selected.
      if (chunk.source === 'cjic-victim' || !sources.includes('cjic-victim')) {
        manifest.races.forEach((race, index) => {
          if (chunk.masks[row] & (2 ** index)) area.races[race] = (area.races[race] || 0) + 1;
        });
      }
    }
  });
  references.sort((a, b) => {
    const aChunk = available[Math.floor(a / 1_048_576)];
    const bChunk = available[Math.floor(b / 1_048_576)];
    return bChunk.year - aChunk.year || bChunk.ids[b % 1_048_576] - aChunk.ids[a % 1_048_576] || a - b;
  });
  const incidents = references.slice(offset, offset + limit).map((reference) => {
    const chunk = available[Math.floor(reference / 1_048_576)];
    const row = reference % 1_048_576;
    const fields = Object.fromEntries(chunk.fields.map((field) => [field, value(chunk, row, field)]));
    const location = geography.get(`${fields.COUNTY_DESCRIPTION}|${fields.CITY_DESCRIPTION}`);
    return {
      id: `${chunk.source}-${chunk.year}-${row}`, source: chunk.source,
      category: fields.MICR_OFFENSE, description: fields.MICR_OFFENSE,
      occurredAt: null, year: chunk.year, county: fields.COUNTY_DESCRIPTION,
      neighborhood: fields.CITY_DESCRIPTION, intersection: null, precinct: null, status: fields.ARREST || null,
      longitude: null, latitude: null, locationPrecision: location.precision,
      areaKey: location.precision === 'county' ? `${location.county}|__county__` : location.key,
      race: chunk.source === 'cjic-victim' ? fields.RACE || 'Not reported' : undefined,
      victimRaces: manifest.races.filter((race, index) => chunk.masks[row] & (2 ** index)), fields,
    };
  });
  return { incidents, total, nextOffset: Math.min(offset + incidents.length, total), sourceCounts, areas: [...areas.values()], groups, fetchedAt: new Date().toISOString(),
    ...(analysisOnly ? { analysis: { byYear: [...byYear.values()].sort((a, b) => Number(a.key) - Number(b.key)), byOffense: [...byOffense.values()].sort((a, b) => b.crime - a.crime || b.victims - a.victims || a.key.localeCompare(b.key)), victimRaces, victimAges, victimSex } } : {}) };
}
