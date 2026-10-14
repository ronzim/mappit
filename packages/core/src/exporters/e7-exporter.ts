/**
 * Export a MappitDataset to the E7 "locations" JSON used by the travel blog
 * (and by the legacy Google Records.json):
 *
 * ```json
 * { "locations": [{ "latitudeE7": 454642000, "longitudeE7": 91900000, "timestamp": "…" }] }
 * ```
 *
 * E7 = decimal degrees × 10^7, rounded to an integer. This is the only place
 * where mappit produces E7 coordinates: the internal model stays decimal.
 *
 * Locations come from raw points and from activity GPS paths (a path point
 * without a timestamp takes the activity start). Visits are excluded by
 * default, matching the blog's route extraction. Output is sorted by time.
 */

import type { MappitDataset } from '../types';

/** Options for {@link exportToE7}. */
export interface E7ExportOptions {
    /** Pretty-print with indentation (default `2`). Set `0` for compact. */
    indent?: number;
    /** Also emit one location per visit, at its start time (default `false`). */
    includeVisits?: boolean;
}

/** One location in E7 format. */
export interface E7Location {
    latitudeE7: number;
    longitudeE7: number;
    timestamp: string;
}

const toE7 = (deg: number): number => Math.round(deg * 1e7);

/**
 * Build the `{ locations }` object from a dataset.
 */
export function toE7Locations(
    dataset: MappitDataset,
    options: Omit<E7ExportOptions, 'indent'> = {},
): { locations: E7Location[] } {
    const { includeVisits = false } = options;
    const locations: E7Location[] = [];
    const push = (lat: number, lng: number, timestamp: string) =>
        locations.push({ latitudeE7: toE7(lat), longitudeE7: toE7(lng), timestamp });

    for (const p of dataset.points) push(p.lat, p.lng, p.timestamp);

    for (const e of dataset.timeline) {
        if (e.type === 'activity') {
            for (const p of e.path) push(p.lat, p.lng, p.timestamp ?? e.startTime);
        } else if (includeVisits) {
            push(e.lat, e.lng, e.startTime);
        }
    }

    // Stable sort by instant (handles mixed UTC offsets)
    const indexed = locations.map((l, i) => ({ l, i, t: Date.parse(l.timestamp) }));
    indexed.sort((a, b) => (a.t || 0) - (b.t || 0) || a.i - b.i);
    return { locations: indexed.map((x) => x.l) };
}

/**
 * Serialise a dataset as E7 locations JSON.
 */
export function exportToE7(dataset: MappitDataset, options: E7ExportOptions = {}): string {
    const { indent = 2, ...rest } = options;
    return JSON.stringify(toE7Locations(dataset, rest), null, indent);
}
