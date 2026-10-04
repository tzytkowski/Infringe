import { DATA_SOURCES, type Incident } from './crime';

export const recordLocation = (record: Incident) =>
  [record.neighborhood, record.intersection, record.county].filter(Boolean).join(', ');

export function recordValues(record: Incident, field: string): string[] {
  const source = DATA_SOURCES.find((entry) => entry.id === record.source)?.label || record.source;
  if (field === 'source') return [source];
  // The offense dropdown is a cross-source filter, so expose only the
  // normalized family. Original source labels remain available in the record
  // details without creating duplicate filter choices.
  if (field === 'offense') return [record.standardOffense || 'Other'];
  if (field === 'location') return [recordLocation(record)];
  if (field.startsWith('field:')) return [String(record.fields[field.slice(6)] ?? '')];
  return [record.category, record.description, source, recordLocation(record), ...Object.values(record.fields).map((value) => String(value ?? ''))];
}

export function recordMatchesValue(record: Incident, field: string, selectedValue: string) {
  if (!selectedValue) return true;
  if (field === 'offense' && selectedValue.startsWith('standard:')) return record.standardOffense === selectedValue.slice('standard:'.length);
  return recordValues(record, field).some((value) => value.trim().toLocaleLowerCase() === selectedValue.toLocaleLowerCase());
}
