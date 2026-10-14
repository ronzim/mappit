/**
 * Export a MappitDataset to GeoJSON (RFC 7946).
 *
 * - Raw points → `Point` features (`kind: "point"`)
 * - Visits → `Point` features (`kind: "visit"`)
 * - Activities → `LineString` features (`kind: "activity"`) built from the
 *   GPS path, or from start/end location when the path has fewer than 2 points
 *
 * Coordinates follow the GeoJSON order `[lng, lat]`.
 */

import type { MappitDataset } from '../types';

/** Options for {@link exportToGeoJson}. */
export interface GeoJsonExportOptions {
    /** Pretty-print with indentation (default `2`). Set `0` for compact. */
    indent?: number;
    /** Include raw points (default `true`). */
    includePoints?: boolean;
    /** Include visits and activities (default `true`). */
    includeTimeline?: boolean;
}

type Position = [number, number];

interface Feature {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: Position } | { type: 'LineString'; coordinates: Position[] };
    properties: Record<string, unknown>;
}

/** Drop `undefined` values so the output stays compact. */
function clean(props: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined));
}

/**
 * Build a GeoJSON `FeatureCollection` object from a dataset.
 */
export function toGeoJson(
    dataset: MappitDataset,
    options: Omit<GeoJsonExportOptions, 'indent'> = {},
): { type: 'FeatureCollection'; features: Feature[] } {
    const { includePoints = true, includeTimeline = true } = options;
    const features: Feature[] = [];

    if (includePoints) {
        for (const p of dataset.points) {
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
                properties: clean({
                    kind: 'point',
                    timestamp: p.timestamp,
                    accuracy: p.accuracy,
                    velocity: p.velocity,
                    heading: p.heading,
                    altitude: p.altitude,
                    activityType: p.activityType,
                }),
            });
        }
    }

    if (includeTimeline) {
        for (const e of dataset.timeline) {
            if (e.type === 'visit') {
                features.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
                    properties: clean({
                        kind: 'visit',
                        startTime: e.startTime,
                        endTime: e.endTime,
                        name: e.name,
                        placeId: e.placeId,
                        semanticType: e.semanticType,
                    }),
                });
            } else {
                const coords: Position[] =
                    e.path.length >= 2
                        ? e.path.map((p) => [p.lng, p.lat])
                        : [
                              [e.startLocation.lng, e.startLocation.lat],
                              [e.endLocation.lng, e.endLocation.lat],
                          ];
                features.push({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: coords },
                    properties: clean({
                        kind: 'activity',
                        startTime: e.startTime,
                        endTime: e.endTime,
                        activityType: e.activityType,
                        distanceMeters: e.distanceMeters,
                        pathPoints: e.path.length,
                        timestamps:
                            e.path.length >= 2 && e.path.some((p) => p.timestamp)
                                ? e.path.map((p) => p.timestamp ?? null)
                                : undefined,
                    }),
                });
            }
        }
    }

    return { type: 'FeatureCollection', features };
}

/**
 * Serialise a dataset as a GeoJSON string.
 */
export function exportToGeoJson(dataset: MappitDataset, options: GeoJsonExportOptions = {}): string {
    const { indent = 2, ...rest } = options;
    return JSON.stringify(toGeoJson(dataset, rest), null, indent);
}
