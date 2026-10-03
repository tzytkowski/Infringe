export const STANDARD_OFFENSES = [
  { id: 'Homicide', terms: ['HOMICIDE', 'MURDER', 'MANSLAUGHTER'] },
  { id: 'Sexual offense', terms: ['RAPE', 'SEXUAL', 'SEX OFFENSE'] },
  { id: 'Robbery / carjacking', terms: ['ROBBERY', 'CARJACKING'] },
  { id: 'Kidnapping', terms: ['KIDNAP', 'ABDUCTION'] },
  { id: 'Aggravated assault', terms: ['AGGRAVATED ASSAULT', 'FELONIOUS ASSAULT', 'ASSAULT WITH'] },
  { id: 'Burglary / home invasion', terms: ['BURGLARY', 'BREAKING AND ENTERING', 'HOME INVASION'] },
  { id: 'Motor vehicle theft', terms: ['MOTOR VEHICLE THEFT', 'VEHICLE THEFT', 'AUTO THEFT', 'STOLEN VEHICLE'] },
  { id: 'Larceny / theft', terms: ['LARCENY', 'THEFT', 'SHOPLIFT'] },
  { id: 'Arson', terms: ['ARSON'] },
  { id: 'Fraud / forgery', terms: ['FRAUD', 'FORGERY', 'EMBEZZLEMENT', 'IDENTITY THEFT'] },
  { id: 'Property damage', terms: ['VANDAL', 'DAMAGE TO PROPERTY', 'DESTRUCTION OF PROPERTY'] },
  { id: 'Weapons offense', terms: ['WEAPON', 'FIREARM'] },
  { id: 'Drug / narcotic offense', terms: ['DRUG', 'NARCOTIC'] },
  { id: 'Simple assault / intimidation', terms: ['ASSAULT', 'INTIMIDATION', 'STALKING'] },
];

// The scale deliberately stops short of red for every non-homicide category.
// Colors progress continuously from lower-severity green through yellow and
// orange, reserving red for homicide / murder records only.
const SEVERITY_BY_OFFENSE = {
  Homicide: 1,
  'Sexual offense': 0.86,
  'Kidnapping': 0.81,
  'Robbery / carjacking': 0.75,
  'Aggravated assault': 0.69,
  'Weapons offense': 0.64,
  Arson: 0.61,
  'Simple assault / intimidation': 0.53,
  'Burglary / home invasion': 0.49,
  'Motor vehicle theft': 0.44,
  'Drug / narcotic offense': 0.39,
  'Larceny / theft': 0.31,
  'Fraud / forgery': 0.24,
  'Property damage': 0.17,
  Other: 0.28,
};

/** @type {Array<[number, string]>} */
const COLOR_STOPS = [
  [0, '#31c77b'],
  [0.22, '#72d05f'],
  [0.42, '#bdd057'],
  [0.55, '#e8bd4b'],
  [0.69, '#ec923f'],
  [0.87, '#d8643d'],
  [1, '#e5484d'],
];

/** @param {string} category @param {string} [description] */
export function standardizeOffense(category, description = '') {
  const value = `${category} ${description}`.toUpperCase();
  return STANDARD_OFFENSES.find((entry) => entry.terms.some((term) => value.includes(term)))?.id || 'Other';
}

/** @param {string} category */
export function standardCategoryName(category) {
  if (category === 'group:homicide') return 'Homicide';
  return category.startsWith('standard:') ? category.slice('standard:'.length) : null;
}

/** @param {string} category */
export function standardCategoryTerms(category) {
  const name = standardCategoryName(category);
  return STANDARD_OFFENSES.find((entry) => entry.id === name)?.terms || [];
}

/** @param {string} category */
export function isHomicideCategory(category) {
  const name = standardCategoryName(category);
  return name === 'Homicide' || (!name && standardizeOffense(category) === 'Homicide');
}

function colorParts(value) {
  const hex = value.slice(1);
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function interpolateColor(start, end, amount) {
  const from = colorParts(start);
  const to = colorParts(end);
  return `#${from.map((value, index) => Math.round(value + (to[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function categoryNudge(value) {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.charCodeAt(0)) | 0;
  return ((Math.abs(hash) % 11) - 5) / 250;
}

/** Returns a 0–1 ordering for visual severity, not a legal classification. */
export function offenseSeverity(category, description = '', standardOffense = '') {
  const standard = standardOffense || standardizeOffense(category, description);
  if (standard === 'Homicide') return 1;
  const base = SEVERITY_BY_OFFENSE[standard] ?? SEVERITY_BY_OFFENSE.Other;
  return Math.min(0.9, Math.max(0.05, base + categoryNudge(`${category} ${description}`)));
}

/** A continuous green → yellow → orange scale with red reserved for homicide. */
export function offenseColor(category, description = '', standardOffense = '') {
  const severity = offenseSeverity(category, description, standardOffense);
  if (severity === 1) return COLOR_STOPS.at(-1)[1];
  const upperIndex = COLOR_STOPS.findIndex(([stop]) => severity <= stop);
  const [lowerStop, lowerColor] = COLOR_STOPS[Math.max(0, upperIndex - 1)];
  const [upperStop, upperColor] = COLOR_STOPS[upperIndex];
  return interpolateColor(lowerColor, upperColor, (severity - lowerStop) / (upperStop - lowerStop));
}
