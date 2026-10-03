import { DATA_SOURCES, isHomicideOffense, type Incident } from './crime';

export const recordLocation = (record: Incident) =>
  [record.neighborhood, record.intersection, record.county].filter(Boolean).join(', ');

export function recordValues(record: Incident, field: string): string[] {
  const source = DATA_SOURCES.find((entry) => entry.id === record.source)?.label || record.source;
  if (field === 'source') return [source];
  if (field === 'offense') return [record.standardOffense || '', record.category, record.description];
  if (field === 'location') return [recordLocation(record)];
  if (field.startsWith('field:')) return [String(record.fields[field.slice(6)] ?? '')];
  return [record.category, record.description, source, recordLocation(record), ...Object.values(record.fields).map((value) => String(value ?? ''))];
}

export function recordMatchesValue(record: Incident, field: string, selectedValue: string) {
  if (!selectedValue) return true;
  if (field === 'offense' && selectedValue === 'group:homicide') {
    return isHomicideOffense(record.category) || isHomicideOffense(record.description);
  }
  if (field === 'offense' && selectedValue.startsWith('standard:')) return record.standardOffense === selectedValue.slice('standard:'.length);
  return recordValues(record, field).some((value) => value.trim().toLocaleLowerCase() === selectedValue.toLocaleLowerCase());
}
