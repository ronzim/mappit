/**
 * Export a MappitDataset to CSV, one row per location.
 *
 * Rows, in dataset order:
 * - `point`: a raw point
 * - `visit`: a visit (`timestamp` = start, `end_time` = end)
 * - `path`: a GPS point of an activity path (`timestamp` falls back to the
 *   activity start when the point has none)
 * - `activity`: for activities without a path, two rows with the start and
 *   end location (at `startTime` and `endTime`), so no activity is lost
 *
 * Coordinates are decimal degrees. Values are quoted per RFC 4180 when needed.
 */

import type { MappitDataset } from '../types';

/** Options for {@link exportToCsv}. */
export interface CsvExportOptions {
    /** Field separator (default `,`). */
    delimiter?: string;
    /** Line ending (default `\n`). */
    newline?: string;
}

/** Column order of the CSV output. */
export const CSV_COLUMNS = [
    'kind',
    'timestamp',
    'end_time',
    'lat',
    'lng',
    'activity_type',
    'accuracy',
    'name',
    'place_id',
] as const;

type Row = Partial<Record<(typeof CSV_COLUMNS)[number], string | number | undefined>>;

function cell(value: string | number | undefined, delimiter: string): string {
    if (value === undefined || value === null) return '';
    const s = String(value);
    return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialise a dataset as CSV text, with a header row.
 */
export function exportToCsv(dataset: MappitDataset, options: CsvExportOptions = {}): string {
    const { delimiter = ',', newline = '\n' } = options;
    const rows: Row[] = [];

    for (const p of dataset.points) {
        rows.push({
            kind: 'point',
            timestamp: p.timestamp,
            lat: p.lat,
            lng: p.lng,
            activity_type: p.activityType,
            accuracy: p.accuracy,
        });
    }

    for (const e of dataset.timeline) {
        if (e.type === 'visit') {
            rows.push({
                kind: 'visit',
                timestamp: e.startTime,
                end_time: e.endTime,
                lat: e.lat,
                lng: e.lng,
                name: e.name,
                place_id: e.placeId,
            });
        } else if (e.path.length === 0) {
            for (const [loc, t] of [
                [e.startLocation, e.startTime],
                [e.endLocation, e.endTime],
            ] as const) {
                rows.push({
                    kind: 'activity',
                    timestamp: t,
                    lat: loc.lat,
                    lng: loc.lng,
                    activity_type: e.activityType,
                });
            }
        } else {
            for (const p of e.path) {
                rows.push({
                    kind: 'path',
                    timestamp: p.timestamp ?? e.startTime,
                    lat: p.lat,
                    lng: p.lng,
                    activity_type: e.activityType,
                });
            }
        }
    }

    const lines = [CSV_COLUMNS.join(delimiter)];
    for (const r of rows) {
        lines.push(CSV_COLUMNS.map((c) => cell(r[c], delimiter)).join(delimiter));
    }
    return lines.join(newline) + newline;
}
