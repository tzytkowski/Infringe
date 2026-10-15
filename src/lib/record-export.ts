import { comparisonCSV } from './cjic-comparison';
import { DATA_SOURCES, recordDate, type Incident } from './crime';
import { recordLocation } from './record-filter';

export function recordsCSV(records: Incident[]) {
  return comparisonCSV([
    ['Record ID', 'Source', 'Standard offense', 'Original offense', 'Description', 'Reported date', 'Location', 'Latitude', 'Longitude', 'Original fields (JSON)'],
    ...records.map((record) => [record.id, DATA_SOURCES.find((source) => source.id === record.source)?.label || record.source, record.standardOffense || '', record.category, record.description, recordDate(record), recordLocation(record), record.latitude, record.longitude, JSON.stringify(record.fields)]),
  ]);
}

export function downloadCSV(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
