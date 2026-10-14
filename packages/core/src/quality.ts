/**
 * Data validation and quality metrics for MappitDataset.
 *
 * - {@link validateDataset} reports invalid coordinates, timestamps and
 *   intervals without changing the dataset.
 * - {@link sanitizeDataset} returns a new dataset without the invalid items.
 * - {@link computeQualityMetrics} measures accuracy distribution, gaps in the
 *   timeline and how many activities have a GPS path. A low path coverage is
 *   the signal of loader bugs such as #22 (paths silently dropped).
 */

import type { ActivitySegment, LocationPoint, MappitDataset, TimelineEntry } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Why an item failed validation. */
export type ValidationReason =
    | 'coords-not-finite'
    | 'coords-out-of-range'
    | 'invalid-timestamp'
    | 'end-before-start'
    | 'path-point-invalid';

/** A single validation problem. */
export interface ValidationIssue {
    /** Where the item lives: `points` or `timeline`. */
    collection: 'points' | 'timeline';
    /** Index of the item in its collection. */
    index: number;
    reason: ValidationReason;
}

/** Result of {@link validateDataset}. */
export interface ValidationReport {
    /** True when no issue was found. */
    valid: boolean;
    /** Total number of issues (also beyond `maxIssues`). */
    issueCount: number;
    /** Issue count for each reason. */
    byReason: Record<ValidationReason, number>;
    /** The first `maxIssues` issues, in dataset order. */
    issues: ValidationIssue[];
}

export interface ValidateOptions {
    /** Maximum number of issues listed in `issues` (default 100). */
    maxIssues?: number;
}

/** A gap between two consecutive timeline entries (or points). */
export interface TimelineGap {
    /** End of the data before the gap (ISO 8601). */
    start: string;
    /** Start of the data after the gap (ISO 8601). */
    end: string;
    hours: number;
}

/** Result of {@link computeQualityMetrics}. */
export interface QualityMetrics {
    /** Distribution of `accuracy` (metres) over raw points; `null` without data. */
    accuracy: {
        count: number;
        min: number;
        median: number;
        p90: number;
        max: number;
        buckets: Array<{ label: string; count: number }>;
    } | null;
    /** Gaps longer than the threshold, computed on the timeline (or on points). */
    gaps: {
        basis: 'timeline' | 'points' | 'none';
        thresholdMinutes: number;
        count: number;
        totalHours: number;
        /** Largest gaps, longest first. */
        largest: TimelineGap[];
    };
    /** How many activities have at least one GPS path point. */
    activityPathCoverage: {
        activities: number;
        withPath: number;
        /** `withPath / activities`, or `null` without activities. */
        ratio: number | null;
    };
}

export interface QualityOptions {
    /** Minimum gap length to report, in minutes (default 60). */
    gapThresholdMinutes?: number;
    /** How many of the largest gaps to list (default 5). */
    topGaps?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const REASONS: ValidationReason[] = [
    'coords-not-finite',
    'coords-out-of-range',
    'invalid-timestamp',
    'end-before-start',
    'path-point-invalid',
];

const ACCURACY_BUCKETS: Array<{ label: string; max: number }> = [
    { label: '≤10 m', max: 10 },
    { label: '≤50 m', max: 50 },
    { label: '≤100 m', max: 100 },
    { label: '≤500 m', max: 500 },
    { label: '>500 m', max: Infinity },
];

function coordsProblem(lat: unknown, lng: unknown): ValidationReason | null {
    if (typeof lat !== 'number' || typeof lng !== 'number') return 'coords-not-finite';
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'coords-not-finite';
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return 'coords-out-of-range';
    return null;
}

function time(value: unknown): number {
    return typeof value === 'string' && value ? Date.parse(value) : NaN;
}

function intervalProblem(startTime: string, endTime: string): ValidationReason | null {
    const s = time(startTime);
    const e = time(endTime);
    if (Number.isNaN(s) || Number.isNaN(e)) return 'invalid-timestamp';
    if (e < s) return 'end-before-start';
    return null;
}

function pointProblem(p: LocationPoint): ValidationReason | null {
    return coordsProblem(p.lat, p.lng) ?? (Number.isNaN(time(p.timestamp)) ? 'invalid-timestamp' : null);
}

/** Problems that make a timeline entry unusable (the entry gets removed). */
function entryProblem(e: TimelineEntry): ValidationReason | null {
    const coords =
        e.type === 'visit'
            ? coordsProblem(e.lat, e.lng)
            : (coordsProblem(e.startLocation?.lat, e.startLocation?.lng) ??
              coordsProblem(e.endLocation?.lat, e.endLocation?.lng));
    return coords ?? intervalProblem(e.startTime, e.endTime);
}

function isValidPathPoint(p: ActivitySegment['path'][number]): boolean {
    if (coordsProblem(p.lat, p.lng)) return false;
    return p.timestamp === undefined || !Number.isNaN(time(p.timestamp));
}

function percentile(sorted: number[], q: number): number {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[idx];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check coordinates (finite, lat ±90, lng ±180), timestamps and intervals of
 * every point, timeline entry and activity path point.
 */
export function validateDataset(
    dataset: MappitDataset,
    options: ValidateOptions = {},
): ValidationReport {
    const maxIssues = options.maxIssues ?? 100;
    const byReason = Object.fromEntries(REASONS.map((r) => [r, 0])) as Record<
        ValidationReason,
        number
    >;
    const issues: ValidationIssue[] = [];
    let issueCount = 0;

    const report = (collection: ValidationIssue['collection'], index: number, reason: ValidationReason) => {
        issueCount++;
        byReason[reason]++;
        if (issues.length < maxIssues) issues.push({ collection, index, reason });
    };

    dataset.points.forEach((p, i) => {
        const reason = pointProblem(p);
        if (reason) report('points', i, reason);
    });

    dataset.timeline.forEach((e, i) => {
        const reason = entryProblem(e);
        if (reason) report('timeline', i, reason);
        if (e.type === 'activity') {
            for (const p of e.path ?? []) {
                if (!isValidPathPoint(p)) report('timeline', i, 'path-point-invalid');
            }
        }
    });

    return { valid: issueCount === 0, issueCount, byReason, issues };
}

/**
 * Return a new dataset without invalid points and timeline entries; invalid
 * path points are removed from their activity, which is kept.
 * The input dataset is not modified.
 */
export function sanitizeDataset(dataset: MappitDataset): MappitDataset {
    const points = dataset.points.filter((p) => !pointProblem(p));
    const timeline = dataset.timeline
        .filter((e) => !entryProblem(e))
        .map((e) => {
            if (e.type !== 'activity') return e;
            const path = (e.path ?? []).filter(isValidPathPoint);
            return path.length === e.path?.length ? e : { ...e, path };
        });
    return { ...dataset, points, timeline };
}

/**
 * Compute quality metrics: accuracy distribution of raw points, gaps in the
 * timeline (or in the points, for datasets without a timeline) and the share
 * of activities with a GPS path. Invalid timestamps are ignored.
 */
export function computeQualityMetrics(
    dataset: MappitDataset,
    options: QualityOptions = {},
): QualityMetrics {
    const thresholdMinutes = options.gapThresholdMinutes ?? 60;
    const topGaps = options.topGaps ?? 5;

    // Accuracy
    const acc = dataset.points
        .map((p) => p.accuracy)
        .filter((a): a is number => typeof a === 'number' && Number.isFinite(a) && a >= 0)
        .sort((a, b) => a - b);
    const accuracy =
        acc.length === 0
            ? null
            : {
                  count: acc.length,
                  min: acc[0],
                  median: percentile(acc, 0.5),
                  p90: percentile(acc, 0.9),
                  max: acc[acc.length - 1],
                  buckets: ACCURACY_BUCKETS.map((b, i) => ({
                      label: b.label,
                      count: acc.filter(
                          (a) => a <= b.max && (i === 0 || a > ACCURACY_BUCKETS[i - 1].max),
                      ).length,
                  })),
              };

    // Gaps: intervals [start, end] sorted by start; a gap is time not covered
    // by any interval seen so far.
    let basis: QualityMetrics['gaps']['basis'] = 'none';
    let intervals: Array<{ s: number; e: number; sIso: string; eIso: string }> = [];
    if (dataset.timeline.length > 0) {
        basis = 'timeline';
        intervals = dataset.timeline.map((x) => ({
            s: time(x.startTime),
            e: time(x.endTime),
            sIso: x.startTime,
            eIso: x.endTime,
        }));
    } else if (dataset.points.length > 0) {
        basis = 'points';
        intervals = dataset.points.map((p) => ({
            s: time(p.timestamp),
            e: time(p.timestamp),
            sIso: p.timestamp,
            eIso: p.timestamp,
        }));
    }
    intervals = intervals
        .filter((x) => !Number.isNaN(x.s) && !Number.isNaN(x.e) && x.e >= x.s)
        .sort((a, b) => a.s - b.s);

    const gaps: TimelineGap[] = [];
    const thresholdMs = thresholdMinutes * 60_000;
    let coveredUntil = -Infinity;
    let coveredUntilIso = '';
    for (const x of intervals) {
        if (coveredUntil !== -Infinity && x.s - coveredUntil > thresholdMs) {
            gaps.push({
                start: coveredUntilIso,
                end: x.sIso,
                hours: (x.s - coveredUntil) / 3_600_000,
            });
        }
        if (x.e > coveredUntil) {
            coveredUntil = x.e;
            coveredUntilIso = x.eIso;
        }
    }
    const totalHours = gaps.reduce((sum, g) => sum + g.hours, 0);
    const largest = [...gaps].sort((a, b) => b.hours - a.hours).slice(0, topGaps);

    // Activity path coverage
    const activities = dataset.timeline.filter((e): e is ActivitySegment => e.type === 'activity');
    const withPath = activities.filter((a) => (a.path?.length ?? 0) > 0).length;

    return {
        accuracy,
        gaps: { basis, thresholdMinutes, count: gaps.length, totalHours, largest },
        activityPathCoverage: {
            activities: activities.length,
            withPath,
            ratio: activities.length === 0 ? null : withPath / activities.length,
        },
    };
}
