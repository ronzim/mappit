import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseTimelineSemantic } from '../../src/loaders/timeline-semantic';

const fixture = JSON.parse(
    fs.readFileSync(
        path.resolve(__dirname, '../../../../fixtures/timeline-semantic.json'),
        'utf-8',
    ),
);

describe('parseTimelineSemantic', () => {
    it('returns source "timeline-semantic"', () => {
        const ds = parseTimelineSemantic(fixture);
        expect(ds.source).toBe('timeline-semantic');
    });

    it('loads 2 visits and 1 activity', () => {
        const ds = parseTimelineSemantic(fixture);
        expect(ds.timeline).toHaveLength(3);
        const visits = ds.timeline.filter((e) => e.type === 'visit');
        const activities = ds.timeline.filter((e) => e.type === 'activity');
        expect(visits).toHaveLength(2);
        expect(activities).toHaveLength(1);
    });

    it('parses degree-sign coordinates for visits', () => {
        const ds = parseTimelineSemantic(fixture);
        const visit = ds.timeline[0];
        expect(visit.type).toBe('visit');
        if (visit.type === 'visit') {
            expect(visit.lat).toBeCloseTo(45.4642, 4);
            expect(visit.lng).toBeCloseTo(9.19, 4);
            expect(visit.name).toBe('Duomo di Milano');
            expect(visit.placeId).toBe('ChIJexample_duomo');
        }
    });

    it('normalises activity type', () => {
        const ds = parseTimelineSemantic(fixture);
        const act = ds.timeline[1];
        expect(act.type).toBe('activity');
        if (act.type === 'activity') {
            expect(act.activityType).toBe('WALKING');
            expect(act.distanceMeters).toBe(3850);
        }
    });

    it('parses timelinePath with timestamps', () => {
        const ds = parseTimelineSemantic(fixture);
        const act = ds.timeline[1];
        if (act.type === 'activity') {
            expect(act.path.length).toBe(4);
            expect(act.path[0].lat).toBeCloseTo(45.4642, 4);
            expect(act.path[0].timestamp).toBe('2024-01-15T11:30:00Z');
        }
    });

    it('computes date range', () => {
        const ds = parseTimelineSemantic(fixture);
        expect(ds.dateRange.min).toBe('2024-01-15T10:00:00Z');
        expect(ds.dateRange.max).toBe('2024-01-15T13:30:00Z');
    });

    it('parses start/end locations for activity segments', () => {
        const ds = parseTimelineSemantic(fixture);
        const act = ds.timeline[1];
        if (act.type === 'activity') {
            expect(act.startLocation.lat).toBeCloseTo(45.4642, 4);
            expect(act.endLocation.lat).toBeCloseTo(45.47, 4);
        }
    });

    it('throws on invalid input', () => {
        expect(() => parseTimelineSemantic({})).toThrow('semanticSegments');
    });
});

// Real exports: timelinePath arrives in standalone segments (issue #22)
describe('parseTimelineSemantic – standalone timelinePath segments', () => {
    const pathsFixture = JSON.parse(
        fs.readFileSync(
            path.resolve(__dirname, '../../../../fixtures/timeline-semantic-paths.json'),
            'utf-8',
        ),
    );

    const getActivity = () => {
        const ds = parseTimelineSemantic(pathsFixture);
        const act = ds.timeline.find((e) => e.type === 'activity');
        if (!act || act.type !== 'activity') throw new Error('activity not found');
        return { ds, act };
    };

    it('does not add path-only segments as timeline entries', () => {
        const { ds } = getActivity();
        expect(ds.timeline).toHaveLength(3);
    });

    it('assigns path points to the overlapping activity', () => {
        const { act } = getActivity();
        expect(act.path.length).toBeGreaterThan(0);
        expect(act.path).toHaveLength(4);
    });

    it('drops points outside activities or without time', () => {
        const { act } = getActivity();
        const lats = act.path.map((p) => p.lat);
        expect(lats).not.toContain(45.464); // during the first visit
        expect(lats).not.toContain(45.4701); // during the second visit
        expect(lats).not.toContain(45.4665); // no time
    });

    it('compares times across UTC offsets and sorts the path', () => {
        const { act } = getActivity();
        expect(act.path.map((p) => p.lat)).toEqual([45.4642, 45.466, 45.468, 45.47]);
        expect(act.path[2].timestamp).toBe('2024-01-15T11:50:00.000Z');
    });
});
