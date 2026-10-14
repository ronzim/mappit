import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateDataset, sanitizeDataset, computeQualityMetrics } from '../src/quality';
import { parseTimelineSemantic } from '../src/loaders/timeline-semantic';
import { parseRecords } from '../src/loaders/records';
import type { MappitDataset, LocationPoint, TimelineEntry } from '../src/types';

const FIXTURES = path.resolve(__dirname, '../../../fixtures');
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8'));

const ds = (points: LocationPoint[] = [], timeline: TimelineEntry[] = []): MappitDataset => ({
    source: 'records',
    dateRange: { min: '', max: '' },
    points,
    timeline,
});

const pt = (timestamp: string, lat = 45, lng = 9, accuracy?: number): LocationPoint => ({
    timestamp,
    lat,
    lng,
    ...(accuracy !== undefined ? { accuracy } : {}),
});

const visit = (startTime: string, endTime: string, lat = 45, lng = 9): TimelineEntry => ({
    type: 'visit',
    startTime,
    endTime,
    lat,
    lng,
});

const activity = (
    startTime: string,
    endTime: string,
    path: Array<{ lat: number; lng: number; timestamp?: string }> = [],
): TimelineEntry => ({
    type: 'activity',
    startTime,
    endTime,
    activityType: 'WALKING',
    startLocation: { lat: 45, lng: 9 },
    endLocation: { lat: 45.1, lng: 9.1 },
    path,
});

// ---------------------------------------------------------------------------
// validateDataset
// ---------------------------------------------------------------------------
describe('validateDataset', () => {
    it('accepts a valid dataset', () => {
        const r = validateDataset(
            ds([pt('2024-01-01T10:00:00Z')], [visit('2024-01-01T10:00:00Z', '2024-01-01T11:00:00Z')]),
        );
        expect(r.valid).toBe(true);
        expect(r.issueCount).toBe(0);
    });

    it('accepts the bundled fixtures', () => {
        for (const name of ['timeline-semantic.json', 'timeline-semantic-paths.json']) {
            expect(validateDataset(parseTimelineSemantic(load(name))).valid).toBe(true);
        }
        expect(validateDataset(parseRecords(load('records.json'))).valid).toBe(true);
    });

    it('flags coordinates out of range and not finite', () => {
        const r = validateDataset(
            ds([
                pt('2024-01-01T10:00:00Z', 91, 9),
                pt('2024-01-01T10:00:00Z', 45, -181),
                pt('2024-01-01T10:00:00Z', NaN, 9),
            ]),
        );
        expect(r.byReason['coords-out-of-range']).toBe(2);
        expect(r.byReason['coords-not-finite']).toBe(1);
        expect(r.issues.map((i) => i.index)).toEqual([0, 1, 2]);
    });

    it('flags missing or invalid timestamps and reversed intervals', () => {
        const r = validateDataset(
            ds(
                [pt(''), pt('not a date')],
                [
                    visit('2024-01-01T12:00:00Z', '2024-01-01T11:00:00Z'),
                    activity('', '2024-01-01T11:00:00Z'),
                ],
            ),
        );
        expect(r.byReason['invalid-timestamp']).toBe(3);
        expect(r.byReason['end-before-start']).toBe(1);
        expect(r.issues.filter((i) => i.collection === 'timeline')).toHaveLength(2);
    });

    it('flags invalid path points', () => {
        const r = validateDataset(
            ds(
                [],
                [
                    activity('2024-01-01T10:00:00Z', '2024-01-01T11:00:00Z', [
                        { lat: 45, lng: 9, timestamp: '2024-01-01T10:10:00Z' },
                        { lat: 200, lng: 9 },
                        { lat: 45, lng: 9, timestamp: 'bad' },
                    ]),
                ],
            ),
        );
        expect(r.byReason['path-point-invalid']).toBe(2);
    });

    it('caps the listed issues but keeps the full count', () => {
        const points = Array.from({ length: 10 }, () => pt('2024-01-01T10:00:00Z', 99, 9));
        const r = validateDataset(ds(points), { maxIssues: 3 });
        expect(r.issues).toHaveLength(3);
        expect(r.issueCount).toBe(10);
    });
});

// ---------------------------------------------------------------------------
// sanitizeDataset
// ---------------------------------------------------------------------------
describe('sanitizeDataset', () => {
    const dirty = ds(
        [pt('2024-01-01T10:00:00Z'), pt('2024-01-01T10:00:00Z', 99, 9), pt('')],
        [
            visit('2024-01-01T10:00:00Z', '2024-01-01T11:00:00Z'),
            visit('2024-01-01T12:00:00Z', '2024-01-01T11:00:00Z'),
            activity('2024-01-01T11:00:00Z', '2024-01-01T12:00:00Z', [
                { lat: 45, lng: 9 },
                { lat: 45, lng: 999 },
            ]),
        ],
    );

    it('removes invalid points and entries, and invalid path points', () => {
        const clean = sanitizeDataset(dirty);
        expect(clean.points).toHaveLength(1);
        expect(clean.timeline).toHaveLength(2);
        const act = clean.timeline.find((e) => e.type === 'activity');
        expect(act?.type === 'activity' && act.path).toHaveLength(1);
        expect(validateDataset(clean).valid).toBe(true);
    });

    it('recomputes dateRange from the remaining items', () => {
        const withRange = { ...dirty, dateRange: { min: '1999-01-01T00:00:00Z', max: '2099-01-01T00:00:00Z' } };
        const clean = sanitizeDataset(withRange);
        expect(clean.dateRange.min).toBe('2024-01-01T10:00:00Z');
        expect(clean.dateRange.max).toBe('2024-01-01T12:00:00Z');
    });

    it('does not modify the input', () => {
        sanitizeDataset(dirty);
        expect(dirty.points).toHaveLength(3);
        expect(dirty.timeline).toHaveLength(3);
        const act = dirty.timeline[2];
        expect(act.type === 'activity' && act.path).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// computeQualityMetrics
// ---------------------------------------------------------------------------
describe('computeQualityMetrics', () => {
    it('computes the accuracy distribution', () => {
        const q = computeQualityMetrics(
            ds([5, 20, 20, 80, 300, 1000].map((a, i) => pt(`2024-01-01T10:0${i}:00Z`, 45, 9, a))),
        );
        expect(q.accuracy).toMatchObject({ count: 6, min: 5, median: 20, p90: 1000, max: 1000 });
        expect(q.accuracy?.buckets.map((b) => b.count)).toEqual([1, 2, 1, 1, 1]);
    });

    it('returns null accuracy without data', () => {
        expect(computeQualityMetrics(ds([pt('2024-01-01T10:00:00Z')])).accuracy).toBeNull();
    });

    it('finds timeline gaps above the threshold, handling overlaps', () => {
        const q = computeQualityMetrics(
            ds(
                [],
                [
                    visit('2024-01-01T08:00:00Z', '2024-01-01T12:00:00Z'),
                    activity('2024-01-01T09:00:00Z', '2024-01-01T10:00:00Z'), // inside the visit
                    visit('2024-01-01T12:30:00Z', '2024-01-01T13:00:00Z'), // 30 min gap: below
                    visit('2024-01-01T16:00:00Z', '2024-01-01T17:00:00Z'), // 3 h gap
                    visit('2024-01-02T17:00:00Z', '2024-01-02T18:00:00Z'), // 24 h gap
                ],
            ),
        );
        expect(q.gaps.basis).toBe('timeline');
        expect(q.gaps.count).toBe(2);
        expect(q.gaps.totalHours).toBeCloseTo(27);
        expect(q.gaps.largest[0]).toEqual({
            start: '2024-01-01T17:00:00Z',
            end: '2024-01-02T17:00:00Z',
            hours: 24,
        });
    });

    it('uses points when there is no timeline', () => {
        const q = computeQualityMetrics(
            ds([pt('2024-01-01T10:00:00Z'), pt('2024-01-01T10:30:00Z'), pt('2024-01-01T14:30:00Z')]),
            { gapThresholdMinutes: 60 },
        );
        expect(q.gaps.basis).toBe('points');
        expect(q.gaps.count).toBe(1);
        expect(q.gaps.largest[0].hours).toBe(4);
    });

    it('measures activity path coverage', () => {
        const q = computeQualityMetrics(
            ds(
                [],
                [
                    activity('2024-01-01T10:00:00Z', '2024-01-01T11:00:00Z', [{ lat: 45, lng: 9 }]),
                    activity('2024-01-01T12:00:00Z', '2024-01-01T13:00:00Z'),
                ],
            ),
        );
        expect(q.activityPathCoverage).toEqual({ activities: 2, withPath: 1, ratio: 0.5 });
    });

    // Regression for #22: standalone timelinePath segments must end up in activities
    it('reports full path coverage for real-format semantic exports (#22)', () => {
        const q = computeQualityMetrics(parseTimelineSemantic(load('timeline-semantic-paths.json')));
        expect(q.activityPathCoverage.activities).toBeGreaterThan(0);
        expect(q.activityPathCoverage.ratio).toBe(1);
    });
});
