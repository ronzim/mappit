/**
 * Loader for the **Timeline Semantic** format (newer Google Takeout export).
 *
 * Input shape:
 * ```json
 * { "semanticSegments": [
 *     { startTime, endTime, visit?: {…}, activity?: {…}, timelinePath?: […] }
 * ] }
 * ```
 *
 * Coordinates are encoded as `"45.4642°, 9.1900°"` degree-sign strings.
 *
 * In real exports `timelinePath` is not attached to activity segments: it
 * comes in standalone segments (`startTime`, `endTime`, `timelinePath` only),
 * whose points are assigned to the activities they fall into by time.
 */

import type {
  MappitDataset,
  PlaceVisit,
  ActivitySegment,
  TimelineEntry,
} from '../types';
import { parseDegreeString } from '../geo';
import { getGroupedActivityType } from '../activity-mapping';

// ---------------------------------------------------------------------------
// Raw JSON shapes
// ---------------------------------------------------------------------------

interface RawVisit {
  topCandidate?: {
    placeId?: string;
    placeLocation?: { latLng?: string };
    semanticType?: string;
    name?: string;
    probability?: number;
  };
  editConfirmationStatus?: string;
}

interface RawActivity {
  start?: { latLng?: string };
  end?: { latLng?: string };
  topCandidate?: { type?: string; probability?: number };
  distanceMeters?: number;
  editConfirmationStatus?: string;
}

interface RawPathPoint {
  point?: string;
  time?: string;
}

interface RawSemanticSegment {
  startTime?: string;
  endTime?: string;
  visit?: RawVisit;
  activity?: RawActivity;
  timelinePath?: RawPathPoint[];
}

interface RawSemanticFile {
  semanticSegments?: RawSemanticSegment[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a Google Timeline Semantic JSON file.
 *
 * Expects `{ semanticSegments: [...] }` and normalises each segment into
 * the unified {@link TimelineEntry} model.
 *
 * @param data - Raw parsed JSON (typically from `JSON.parse`).
 * @returns A {@link MappitDataset} with `source: 'timeline-semantic'`.
 * @throws If the input does not contain a `semanticSegments` array.
 */
export function parseTimelineSemantic(data: unknown): MappitDataset {
  const raw = data as RawSemanticFile;
  if (!raw?.semanticSegments || !Array.isArray(raw.semanticSegments)) {
    throw new Error(
      'Invalid Timeline Semantic: missing "semanticSegments" array',
    );
  }

  const timeline: TimelineEntry[] = [];
  const orphanPaths: RawPathPoint[][] = [];
  let min = '';
  let max = '';

  for (const seg of raw.semanticSegments) {
    const startTime = seg.startTime ?? '';
    const endTime = seg.endTime ?? '';

    // Track date range
    if (startTime && (!min || startTime < min)) min = startTime;
    if (endTime && (!max || endTime > max)) max = endTime;

    if (seg.visit) {
      const entry = parseVisit(seg.visit, startTime, endTime);
      if (entry) timeline.push(entry);
    } else if (seg.activity) {
      const entry = parseActivitySegment(
        seg.activity,
        startTime,
        endTime,
        seg.timelinePath,
      );
      if (entry) timeline.push(entry);
    } else if (seg.timelinePath) {
      // In real exports, GPS paths live in standalone segments that carry
      // only startTime/endTime/timelinePath (see issue #22).
      orphanPaths.push(seg.timelinePath);
    }
  }

  assignOrphanPaths(timeline, orphanPaths);

  return {
    source: 'timeline-semantic',
    dateRange: { min, max },
    points: [],
    timeline,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseVisit(
  v: RawVisit,
  startTime: string,
  endTime: string,
): PlaceVisit | null {
  const locStr = v.topCandidate?.placeLocation?.latLng;
  if (!locStr) return null;
  const coords = parseDegreeString(locStr);
  if (!coords) return null;

  return {
    type: 'visit',
    startTime,
    endTime,
    lat: coords.lat,
    lng: coords.lng,
    placeId: v.topCandidate?.placeId,
    name: v.topCandidate?.name,
    semanticType: v.topCandidate?.semanticType,
    editConfirmationStatus: v.editConfirmationStatus,
  };
}

/**
 * Assign the points of standalone `timelinePath` segments to the activities
 * whose time interval contains each point's `time` (bounds inclusive).
 *
 * Only activities without an inline path are filled, to avoid duplicates.
 * Points with no `time`, or outside every activity (e.g. during a visit),
 * are dropped. Times are compared as instants, so mixed UTC offsets work.
 */
function assignOrphanPaths(
  timeline: TimelineEntry[],
  orphanPaths: RawPathPoint[][],
): void {
  if (orphanPaths.length === 0) return;

  const targets = timeline
    .filter((e): e is ActivitySegment => e.type === 'activity' && e.path.length === 0)
    .map((a) => ({ a, start: Date.parse(a.startTime), end: Date.parse(a.endTime) }))
    .filter((t) => !Number.isNaN(t.start) && !Number.isNaN(t.end))
    .sort((x, y) => x.start - y.start);
  if (targets.length === 0) return;

  const filled = new Set<ActivitySegment>();

  for (const rawPath of orphanPaths) {
    for (const p of rawPath) {
      if (!p.point || !p.time) continue;
      const t = Date.parse(p.time);
      if (Number.isNaN(t)) continue;

      // Last target with start <= t (binary search)
      let lo = 0;
      let hi = targets.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (targets[mid].start <= t) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (idx < 0 || t > targets[idx].end) continue;

      const pt = parseDegreeString(p.point);
      if (!pt) continue;
      targets[idx].a.path.push({ lat: pt.lat, lng: pt.lng, timestamp: p.time });
      filled.add(targets[idx].a);
    }
  }

  for (const a of filled) {
    a.path.sort((x, y) => Date.parse(x.timestamp ?? '') - Date.parse(y.timestamp ?? ''));
  }
}

function parseActivitySegment(
  a: RawActivity,
  startTime: string,
  endTime: string,
  rawPath?: RawPathPoint[],
): ActivitySegment | null {
  const startCoords = a.start?.latLng
    ? parseDegreeString(a.start.latLng)
    : null;
  const endCoords = a.end?.latLng ? parseDegreeString(a.end.latLng) : null;
  if (!startCoords || !endCoords) return null;

  const path = (rawPath ?? [])
    .map((p) => {
      const pt = p.point ? parseDegreeString(p.point) : null;
      if (!pt) return null;
      return { lat: pt.lat, lng: pt.lng, ...(p.time ? { timestamp: p.time } : {}) };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return {
    type: 'activity',
    startTime,
    endTime,
    activityType: a.topCandidate?.type
      ? getGroupedActivityType(a.topCandidate.type)
      : 'UNKNOWN',
    distanceMeters: a.distanceMeters,
    startLocation: startCoords,
    endLocation: endCoords,
    path,
  };
}
