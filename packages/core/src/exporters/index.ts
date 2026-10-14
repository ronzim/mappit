/**
 * Barrel export for all exporters, plus a format dispatcher shared by the
 * CLI and the desktop app.
 */
import type { MappitDataset } from '../types';
import { exportToJson } from './json-exporter';
import { exportToKml } from './kml-exporter';
import { exportToGeoJson } from './geojson-exporter';
import { exportToCsv } from './csv-exporter';
import { exportToE7 } from './e7-exporter';

export { exportToJson, type JsonExportOptions } from './json-exporter';
export { exportToKml, type KmlExportOptions } from './kml-exporter';
export { exportToGeoJson, toGeoJson, type GeoJsonExportOptions } from './geojson-exporter';
export { exportToCsv, CSV_COLUMNS, type CsvExportOptions } from './csv-exporter';
export { exportToE7, toE7Locations, type E7ExportOptions, type E7Location } from './e7-exporter';

/** Supported export formats. */
export type ExportFormat = 'json' | 'kml' | 'geojson' | 'csv' | 'e7';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['json', 'kml', 'geojson', 'csv', 'e7'];

/**
 * Infer the export format from a file name:
 * `.kml`, `.geojson`, `.csv`, `.e7.json` (E7 locations), anything else → JSON.
 */
export function exportFormatFromPath(filePath: string): ExportFormat {
    const name = filePath.toLowerCase();
    if (name.endsWith('.e7.json')) return 'e7';
    if (name.endsWith('.kml')) return 'kml';
    if (name.endsWith('.geojson')) return 'geojson';
    if (name.endsWith('.csv')) return 'csv';
    return 'json';
}

/**
 * Serialise a dataset in the given format with default options.
 */
export function exportDataset(dataset: MappitDataset, format: ExportFormat): string {
    switch (format) {
        case 'kml':
            return exportToKml(dataset);
        case 'geojson':
            return exportToGeoJson(dataset);
        case 'csv':
            return exportToCsv(dataset);
        case 'e7':
            return exportToE7(dataset);
        case 'json':
            return exportToJson(dataset);
        default:
            throw new Error(`Unknown export format "${String(format)}"`);
    }
}
