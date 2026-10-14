/**
 * Filtering functions for MappitDataset.
 *
 * All filters return a **new** dataset — the original is never mutated.
 */

import type {
    MappitDataset,
    LocationPoint,
    TimelineEntry,
    PlaceVisit,
    ActivitySegment,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Geographic bounding box (south-west to north-east). */
export interface BoundingBox {
    /** Southern latitude (minimum). */
    south: number;
    /** Western longitude (minimum). */
    west: number;
    /** Northern latitude (maximum). */
    north: number;
    /** Eastern longitude (maximum). */
    east: number;
}

function isInBounds(lat: number, lng: number, bounds: BoundingBox): boolean {
    return (
        lat >= bounds.south &&
        lat <= bounds.north &&
        lng >= bounds.west &&
        lng <= bounds.east
    );
}

/** @internal Recompute `dateRange` from the remaining points and entries. */
export function recomputeDateRange(
    points: LocationPoint[],
    timeline: TimelineEntry[],
): { min: string; max: string } {
    const timestamps: string[] = [];

    for (const p of points) {
        timestamps.push(p.timestamp);
    }
    for (const e of timeline) {
        timestamps.push(e.startTime);
        timestamps.push(e.endTime);
    }

    if (timestamps.length === 0) {
        return { min: '', max: '' };
    }

    timestamps.sort();
    return { min: timestamps[0], max: timestamps[timestamps.length - 1] };
}

function cloneDataset(
    ds: MappitDataset,
    points: LocationPoint[],
    timeline: TimelineEntry[],
): MappitDataset {
    return {
        source: ds.source,
        dateRange: recomputeDateRange(points, timeline),
        points,
        timeline,
    };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * Filter a dataset by date range (inclusive on both ends).
 *
 * Points and timeline entries whose timestamp falls outside
 * `[start, end]` are removed.
 *
 * @param dataset  The source dataset.
 * @param start    ISO-8601 start date (inclusive).
 * @param end      ISO-8601 end date (inclusive).
 */
export function filterByDateRange(
    dataset: MappitDataset,
    start: string,
    end: string,
): MappitDataset {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();

    if (isNaN(startMs) || isNaN(endMs)) {
        throw new Error(
            `Invalid date range: start="${start}", end="${end}"`,
        );
    }

    const points = dataset.points.filter((p) => {
        const t = new Date(p.timestamp).getTime();
        return t >= startMs && t <= endMs;
    });

    const timeline = dataset.timeline.filter((e) => {
        const s = new Date(e.startTime).getTime();
        const eEnd = new Date(e.endTime).getTime();
        // Keep if the entry overlaps [start, end]
        return s <= endMs && eEnd >= startMs;
    });

    return cloneDataset(dataset, points, timeline);
}

/**
 * Filter a dataset to only include entries within a geographic bounding box.
 *
 * - **Points**: kept if their coordinates fall within the box.
 * - **Visits**: kept if their coordinates fall within the box.
 * - **Activities**: kept if *any* of their path points, start, or end
 *   location falls within the box.
 */
export function filterByArea(
    dataset: MappitDataset,
    bounds: BoundingBox,
): MappitDataset {
    const points = dataset.points.filter((p) =>
        isInBounds(p.lat, p.lng, bounds),
    );

    const timeline = dataset.timeline.filter((entry) => {
        if (entry.type === 'visit') {
            return isInBounds(entry.lat, entry.lng, bounds);
        }
        // activity
        const act = entry as ActivitySegment;
        if (isInBounds(act.startLocation.lat, act.startLocation.lng, bounds)) {
            return true;
        }
        if (isInBounds(act.endLocation.lat, act.endLocation.lng, bounds)) {
            return true;
        }
        return act.path.some((pt) => isInBounds(pt.lat, pt.lng, bounds));
    });

    return cloneDataset(dataset, points, timeline);
}

/**
 * Filter a dataset to only include entries matching the given activity types.
 *
 * The comparison uses the *normalised* group name (e.g. `"WALKING"`,
 * `"DRIVING"`).
 *
 * - **Points**: kept if `activityType` is in the list (or if the point has
 *   no `activityType` and `includeUntyped` is true).
 * - **Visits**: always kept (visits don't have activity types).
 * - **Activities**: kept if their `activityType` is in the list.
 *
 * @param dataset       Source dataset.
 * @param types         Array of normalised activity group names.
 * @param includeUntyped  Keep points without an activityType (default `true`).
 */
export function filterByActivityType(
    dataset: MappitDataset,
    types: string[],
    includeUntyped = true,
): MappitDataset {
    const typeSet = new Set(types.map((t) => t.toUpperCase()));

    const points = dataset.points.filter((p) => {
        if (!p.activityType) return includeUntyped;
        return typeSet.has(p.activityType.toUpperCase());
    });

    const timeline = dataset.timeline.filter((entry) => {
        if (entry.type === 'visit') return true;
        return typeSet.has(entry.activityType.toUpperCase());
    });

    return cloneDataset(dataset, points, timeline);
}
