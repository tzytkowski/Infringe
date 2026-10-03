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
