import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    exportToGeoJson,
    exportToCsv,
    exportToE7,
    toE7Locations,
    exportDataset,
    exportFormatFromPath,
    CSV_COLUMNS,
} from '../../src/exporters';
import { parseTimelineSemantic } from '../../src/loaders/timeline-semantic';
import type { MappitDataset } from '../../src/types';

const FIXTURES = path.resolve(__dirname, '../../../../fixtures');

function makeDataset(): MappitDataset {
    return {
        source: 'timeline-semantic',
        dateRange: { min: '2024-01-15T10:00:00Z', max: '2024-01-15T13:00:00Z' },
        points: [
            { timestamp: '2024-01-15T09:00:00Z', lat: 45.1, lng: 9.1, accuracy: 12, activityType: 'WALKING' },
        ],
        timeline: [
            {
                type: 'visit',
                startTime: '2024-01-15T10:00:00Z',
                endTime: '2024-01-15T11:00:00Z',
                lat: 45.4642,
                lng: 9.19,
                name: 'Duomo, "Milano"',
                placeId: 'p1',
            },
            {
                type: 'activity',
                startTime: '2024-01-15T11:00:00Z',
                endTime: '2024-01-15T12:00:00Z',
                activityType: 'WALKING',
                distanceMeters: 1000,
                startLocation: { lat: 45.4642, lng: 9.19 },
                endLocation: { lat: 45.47, lng: 9.17 },
                path: [
                    { lat: 45.4642, lng: 9.19, timestamp: '2024-01-15T11:00:00Z' },
                    { lat: 45.4671234, lng: 9.1800005 },
                    { lat: 45.47, lng: 9.17, timestamp: '2024-01-15T12:00:00+01:00' },
                ],
            },
            {
                type: 'activity',
                startTime: '2024-01-15T12:30:00Z',
                endTime: '2024-01-15T13:00:00Z',
                activityType: 'IN_VEHICLE',
                startLocation: { lat: 45.47, lng: 9.17 },
                endLocation: { lat: 45.5, lng: 9.2 },
                path: [],
            },
        ],
    };
}

// ---------------------------------------------------------------------------
describe('exportToGeoJson', () => {
    const fc = JSON.parse(exportToGeoJson(makeDataset()));

    it('returns a FeatureCollection with one feature per point/entry', () => {
        expect(fc.type).toBe('FeatureCollection');
        expect(fc.features).toHaveLength(4);
        expect(fc.features.map((f: { properties: { kind: string } }) => f.properties.kind)).toEqual([
            'point',
            'visit',
            'activity',
            'activity',
        ]);
    });

    it('uses [lng, lat] order', () => {
        expect(fc.features[1].geometry).toEqual({ type: 'Point', coordinates: [9.19, 45.4642] });
    });

    it('builds activity lines from the path, or from start/end without path', () => {
        expect(fc.features[2].geometry.type).toBe('LineString');
        expect(fc.features[2].geometry.coordinates).toHaveLength(3);
        expect(fc.features[2].properties.timestamps).toEqual([
            '2024-01-15T11:00:00Z',
            null,
            '2024-01-15T12:00:00+01:00',
        ]);
        expect(fc.features[3].geometry.coordinates).toEqual([
            [9.17, 45.47],
            [9.2, 45.5],
        ]);
        expect(fc.features[3].properties.pathPoints).toBe(0);
    });

    it('can skip points or timeline', () => {
        expect(JSON.parse(exportToGeoJson(makeDataset(), { includePoints: false })).features).toHaveLength(3);
        expect(JSON.parse(exportToGeoJson(makeDataset(), { includeTimeline: false })).features).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
describe('exportToCsv', () => {
    const lines = exportToCsv(makeDataset()).trimEnd().split('\n');

    it('writes the header and one row per point, visit and path point', () => {
        expect(lines[0]).toBe(CSV_COLUMNS.join(','));
        expect(lines).toHaveLength(1 + 1 + 1 + 3);
        expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(['point', 'visit', 'path', 'path', 'path']);
    });

    it('quotes values with delimiters or quotes', () => {
        expect(lines[2]).toContain('"Duomo, ""Milano"""');
    });

    it('falls back to the activity start for path points without timestamp', () => {
        expect(lines[4].split(',')[1]).toBe('2024-01-15T11:00:00Z');
    });

    it('supports a custom delimiter', () => {
        expect(exportToCsv(makeDataset(), { delimiter: ';' }).split('\n')[0]).toBe(CSV_COLUMNS.join(';'));
    });
});

// ---------------------------------------------------------------------------
describe('exportToE7', () => {
    it('produces { locations } with integer E7 coordinates', () => {
        const out = JSON.parse(exportToE7(makeDataset()));
        expect(Object.keys(out)).toEqual(['locations']);
        for (const l of out.locations) {
            expect(Object.keys(l)).toEqual(['latitudeE7', 'longitudeE7', 'timestamp']);
            expect(Number.isInteger(l.latitudeE7)).toBe(true);
            expect(Number.isInteger(l.longitudeE7)).toBe(true);
        }
        expect(out.locations).toContainEqual({
            latitudeE7: 454671234,
            longitudeE7: 91800005,
            timestamp: '2024-01-15T11:00:00Z',
        });
    });

    it('includes raw points and path points, but not visits by default', () => {
        expect(toE7Locations(makeDataset()).locations).toHaveLength(1 + 3);
        expect(toE7Locations(makeDataset(), { includeVisits: true }).locations).toHaveLength(1 + 1 + 3);
    });

    it('sorts by instant, across UTC offsets', () => {
        const ts = toE7Locations(makeDataset()).locations.map((l) => l.timestamp);
        // 12:00+01:00 is 11:00Z: same instant as the activity start, kept in input order
        expect(ts).toEqual([
            '2024-01-15T09:00:00Z',
            '2024-01-15T11:00:00Z',
            '2024-01-15T11:00:00Z',
            '2024-01-15T12:00:00+01:00',
        ]);
    });

    it('converts back to the original degrees (blog maps.js divides by 1e7)', () => {
        const ds = parseTimelineSemantic(
            JSON.parse(fs.readFileSync(path.join(FIXTURES, 'timeline-semantic-paths.json'), 'utf-8')),
        );
        const { locations } = toE7Locations(ds);
        expect(locations).toHaveLength(4);
        expect(locations[0].latitudeE7 / 1e7).toBeCloseTo(45.4642, 7);
        expect(locations[0].longitudeE7 / 1e7).toBeCloseTo(9.19, 7);
    });
});

// ---------------------------------------------------------------------------
describe('exportFormatFromPath / exportDataset', () => {
    it('infers the format from the file name', () => {
        expect(exportFormatFromPath('a/b/out.kml')).toBe('kml');
        expect(exportFormatFromPath('OUT.GEOJSON')).toBe('geojson');
        expect(exportFormatFromPath('out.csv')).toBe('csv');
        expect(exportFormatFromPath('route.e7.json')).toBe('e7');
        expect(exportFormatFromPath('out.json')).toBe('json');
        expect(exportFormatFromPath('out')).toBe('json');
    });

    it('dispatches to the right exporter', () => {
        const ds = makeDataset();
        expect(exportDataset(ds, 'geojson')).toBe(exportToGeoJson(ds));
        expect(exportDataset(ds, 'csv')).toBe(exportToCsv(ds));
        expect(exportDataset(ds, 'e7')).toBe(exportToE7(ds));
        expect(exportDataset(ds, 'kml')).toContain('<kml');
        expect(JSON.parse(exportDataset(ds, 'json')).source).toBe('timeline-semantic');
    });
});
