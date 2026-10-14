/**
 * mappit-core
 * Core library for loading and processing Google Location History data.
 */

export const VERSION = '0.1.0';

// Phase 1.1 — Geographic & math utilities
export {
  type LatLng,
  degToRad,
  distance,
  countNearbyPoints,
  normalize,
  mean,
  e7ToDecimal,
  parseGeoUri,
  parseDegreeString,
} from './geo';

// Phase 1.2 — Constants
export {
  COLORSCALE,
  VIRIDIS_MOD,
  ACTIVITY_COLOR_MAP,
  MARGIN,
} from './constants';

// Phase 1.3 — Unified data model
export type {
  LocationPoint,
  PlaceVisit,
  ActivitySegment,
  TimelineEntry,
  DataSource,
  MappitDataset,
} from './types';

// Phase 1.4 — Activity grouping
export {
  activityGroupMapping,
  getGroupedActivityType,
} from './activity-mapping';

// Phase 1.5–1.10 — Loaders
export {
  parseRecords,
  parseTimelineStandard,
  parseTimelineSemantic,
  parseTimelineIos,
  parseTakeoutMonthly,
  detectFormat,
  parseAuto,
  type DetectedFormat,
} from './loaders';

// Phase 2.1 — Filters
export {
  filterByDateRange,
  filterByArea,
  filterByActivityType,
  type BoundingBox,
} from './filters';

// Phase 2.2 — Transforms
export { simplifyDataset, timelineToPoints } from './transforms';

// Phase 2.3 — Statistics
export {
  computeSummary,
  computeYearlySummary,
  computeMonthlySummary,
  type DatasetSummary,
  type PeriodSummary,
} from './stats';

// Data validation & quality metrics
export {
  validateDataset,
  sanitizeDataset,
  computeQualityMetrics,
  type ValidationReason,
  type ValidationIssue,
  type ValidationReport,
  type ValidateOptions,
  type TimelineGap,
  type QualityMetrics,
  type QualityOptions,
} from './quality';

// Phase 2.4–2.5 — Exporters
export {
  exportToJson,
  exportToKml,
  type JsonExportOptions,
  type KmlExportOptions,
} from './exporters';
