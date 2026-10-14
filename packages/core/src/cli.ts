#!/usr/bin/env node
/**
 * mappit-core CLI
 *
 * Usage examples:
 *   mappit-core load <path>                                       # auto-detect & show summary
 *   mappit-core load <path> --format records
 *   mappit-core load <path> --filter-date 2024-01-01 2024-06-30
 *   mappit-core load <path> --filter-area 45.0,9.0,46.0,10.0
 *   mappit-core load <path> --filter-activity WALKING,CYCLING
 *   mappit-core load <path> --export output.json
 *   mappit-core load <path> --export output.kml
 *   mappit-core load <path> --stats
 *   mappit-core load <path> --quality                             # validation + quality metrics
 *   mappit-core load <path> --sanitize --export clean.json        # drop invalid items
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import ora from 'ora';

import { VERSION } from './index';
import { detectFormat, parseAuto } from './loaders/auto-detect';
import { parseRecords } from './loaders/records';
import { parseTimelineStandard } from './loaders/timeline-standard';
import { parseTimelineSemantic } from './loaders/timeline-semantic';
import { parseTimelineIos } from './loaders/timeline-ios';
import { parseTakeoutMonthly } from './loaders/takeout-monthly';
import { filterByDateRange, filterByArea, filterByActivityType } from './filters';
import type { BoundingBox } from './filters';
import { computeSummary, computeYearlySummary } from './stats';
import { validateDataset, sanitizeDataset, computeQualityMetrics } from './quality';
import { exportToJson } from './exporters/json-exporter';
import { exportToKml } from './exporters/kml-exporter';
import type { MappitDataset, DataSource } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg: string): never {
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
}

/**
 * Read a JSON file synchronously or identify a directory for monthly loading.
 */
function readInput(filePath: string): { data: unknown; isDirectory: boolean } {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
        die(`file or directory not found: ${resolved}`);
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
        return { data: resolved, isDirectory: true };
    }

    const raw = fs.readFileSync(resolved, 'utf-8');
    return { data: JSON.parse(raw) as unknown, isDirectory: false };
}

/**
 * Recursively collect files matching a pattern from a directory tree.
 */
function findFilesRecursive(dir: string, pattern: RegExp): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        // Skip Zone.Identifier files and hidden files
        if (entry.name.includes(':') || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findFilesRecursive(full, pattern));
        } else if (pattern.test(entry.name)) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Load data from a Takeout directory (or any directory containing supported files).
 *
 * Discovery strategy (first match wins):
 * 1. YYYY_MONTH.json files anywhere in the tree → parseTakeoutMonthly
 * 2. Records.json anywhere in the tree → parseRecords
 * 3. Timeline.json anywhere in the tree → parseAuto
 */
function loadDirectory(dirPath: string): MappitDataset {
    const resolved = path.resolve(dirPath);

    // 1 — Look for monthly files (e.g. 2024_JANUARY.json) anywhere in the tree
    const monthlyFiles = findFilesRecursive(resolved, /^\d{4}_[A-Z]+\.json$/i);
    if (monthlyFiles.length > 0) {
        const fileMap = new Map<string, unknown>();
        for (const f of monthlyFiles) {
            const key = path.basename(f, '.json');
            const raw = fs.readFileSync(f, 'utf-8');
            fileMap.set(key, JSON.parse(raw) as unknown);
        }
        return parseTakeoutMonthly(fileMap);
    }

    // 2 — Look for Records.json or Timeline.json anywhere in the tree
    for (const name of ['Records.json', 'Timeline.json']) {
        const found = findFilesRecursive(resolved, new RegExp(`^${name}$`, 'i'));
        if (found.length > 0) {
            const raw = fs.readFileSync(found[0], 'utf-8');
            return parseAuto(JSON.parse(raw) as unknown);
        }
    }

    die(`no supported files found in ${resolved}`);
}

/**
 * Parse data using a specific format or auto-detect.
 */
function loadDataset(
    data: unknown,
    isDirectory: boolean,
    format?: string,
): MappitDataset {
    if (isDirectory) {
        return loadDirectory(data as string);
    }

    if (format) {
        switch (format as DataSource) {
            case 'records':
                return parseRecords(data);
            case 'timeline-standard':
                return parseTimelineStandard(data);
            case 'timeline-semantic':
                return parseTimelineSemantic(data);
            case 'timeline-ios':
                return parseTimelineIos(data);
            default:
                die(
                    `unknown format "${format}". Valid: records, timeline-standard, timeline-semantic, timeline-ios`,
                );
        }
    }

    return parseAuto(data);
}

/**
 * Pretty-print dataset summary to stdout.
 */
function printSummary(ds: MappitDataset): void {
    const s = computeSummary(ds);

    console.log('\n  Dataset Summary');
    console.log('─'.repeat(45));
    console.log(`Source format:     ${ds.source}`);
    console.log(`Date range:        ${s.dateRange.min || '—'}  →  ${s.dateRange.max || '—'}`);
    console.log(`Raw points:        ${s.totalPoints.toLocaleString()}`);
    console.log(`Timeline entries:  ${(s.visits + s.activities).toLocaleString()}`);
    console.log(`  Visits:          ${s.visits.toLocaleString()}`);
    console.log(`  Activities:      ${s.activities.toLocaleString()}`);
    console.log(`Unique places:     ${s.uniquePlaces.toLocaleString()}`);
    console.log(`Total distance:    ${(s.totalDistanceMeters / 1000).toFixed(1)} km`);

    if (Object.keys(s.distanceByActivity).length > 0) {
        console.log('\nDistance by activity:');
        const sorted = Object.entries(s.distanceByActivity).sort(
            (a, b) => b[1] - a[1],
        );
        for (const [type, meters] of sorted) {
            console.log(
                `  ${type.padEnd(20)} ${(meters / 1000).toFixed(1).padStart(10)} km`,
            );
        }
    }

    const yearly = computeYearlySummary(ds);
    if (yearly.length > 1) {
        console.log('\nYearly breakdown:');
        for (const y of yearly) {
            const ys = y.summary;
            console.log(
                `  ${y.label}:  ${ys.visits} visits, ${ys.activities} activities, ${(ys.totalDistanceMeters / 1000).toFixed(0)} km`,
            );
        }
    }

    console.log();
}

/**
 * Pretty-print validation report and quality metrics to stdout.
 */
function printQuality(ds: MappitDataset): void {
    const v = validateDataset(ds);
    const q = computeQualityMetrics(ds);

    console.log('\n  Data Quality');
    console.log('─'.repeat(45));
    console.log(`Validation:        ${v.valid ? 'ok' : `${v.issueCount.toLocaleString()} issues`}`);
    for (const [reason, count] of Object.entries(v.byReason)) {
        if (count > 0) console.log(`  ${reason.padEnd(20)} ${count.toLocaleString().padStart(10)}`);
    }

    const cov = q.activityPathCoverage;
    if (cov.ratio !== null) {
        console.log(
            `Activities w/ path: ${cov.withPath.toLocaleString()} / ${cov.activities.toLocaleString()} (${(cov.ratio * 100).toFixed(1)}%)`,
        );
    }

    if (q.accuracy) {
        const a = q.accuracy;
        console.log(`Accuracy (m):      median ${a.median}, p90 ${a.p90}, max ${a.max}`);
        for (const b of a.buckets) {
            console.log(`  ${b.label.padEnd(20)} ${b.count.toLocaleString().padStart(10)}`);
        }
    }

    const g = q.gaps;
    if (g.basis !== 'none') {
        console.log(
            `Gaps > ${g.thresholdMinutes} min:     ${g.count.toLocaleString()} (${g.totalHours.toFixed(1)} h, on ${g.basis})`,
        );
        for (const gap of g.largest) {
            console.log(`  ${gap.start} → ${gap.end}  ${gap.hours.toFixed(1)} h`);
        }
    }

    console.log();
}

/**
 * Apply all filters specified via CLI flags.
 */
function applyFilters(
    ds: MappitDataset,
    filterDate?: string[],
    filterArea?: string,
    filterActivity?: string,
): MappitDataset {
    let result = ds;

    if (filterDate && filterDate.length >= 2) {
        const [start, end] = filterDate;
        result = filterByDateRange(result, start, end);
    }

    if (filterArea) {
        const parts = filterArea.split(',').map(Number);
        if (parts.length !== 4 || parts.some(isNaN)) {
            die('--filter-area expects 4 comma-separated numbers: south,west,north,east');
        }
        const [south, west, north, east] = parts;
        const bounds: BoundingBox = { south, west, north, east };
        result = filterByArea(result, bounds);
    }

    if (filterActivity) {
        const types = filterActivity.split(',').map((t) => t.trim());
        result = filterByActivityType(result, types);
    }

    return result;
}

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

/**
 * Entry point for the mappit-core CLI.
 *
 * Parses command-line arguments via yargs and orchestrates loading,
 * filtering, statistics, and export operations.
 *
 * @param argv - Optional array of arguments (defaults to `process.argv`).
 */
export function run(argv?: string[]): void {
    const args = argv ?? hideBin(process.argv);

    yargs(args)
        .scriptName('mappit-core')
        .version(VERSION)
        .usage('$0 <command> [options]')
        .command(
            'load <path>',
            'Load a Google Location History file or directory',
            (y) =>
                y
                    .positional('path', {
                        describe: 'Path to a JSON file or Takeout directory',
                        type: 'string',
                        demandOption: true,
                    })
                    .option('format', {
                        alias: 'f',
                        describe: 'Force a specific format instead of auto-detecting',
                        choices: [
                            'records',
                            'timeline-standard',
                            'timeline-semantic',
                            'timeline-ios',
                        ] as const,
                        type: 'string',
                    })
                    .option('filter-date', {
                        alias: 'd',
                        describe: 'Filter by date range (two ISO dates)',
                        type: 'string',
                        array: true,
                        nargs: 2,
                    })
                    .option('filter-area', {
                        alias: 'a',
                        describe: 'Filter by bounding box: south,west,north,east',
                        type: 'string',
                    })
                    .option('filter-activity', {
                        describe:
                            'Filter by activity types (comma-separated, e.g. WALKING,CYCLING)',
                        type: 'string',
                    })
                    .option('export', {
                        alias: 'e',
                        describe: 'Export to file (.json or .kml)',
                        type: 'string',
                    })
                    .option('stats', {
                        alias: 's',
                        describe: 'Print summary statistics',
                        type: 'boolean',
                        default: false,
                    })
                    .option('quality', {
                        alias: 'q',
                        describe: 'Print validation report and data quality metrics',
                        type: 'boolean',
                        default: false,
                    })
                    .option('sanitize', {
                        describe: 'Drop invalid points and timeline entries before filtering',
                        type: 'boolean',
                        default: false,
                    }),
            (cmdArgv) => {
                const spinner = ora({ stream: process.stdout });

                try {
                    // 1 — Load
                    spinner.start('Loading data…');
                    const { data, isDirectory } = readInput(cmdArgv.path as string);
                    let ds = loadDataset(data, isDirectory, cmdArgv.format);
                    spinner.succeed(
                        `Loaded ${ds.source} — ${ds.points.length} points, ${ds.timeline.length} timeline entries`,
                    );

                    // 1b — Sanitize
                    if (cmdArgv.sanitize) {
                        const before = ds.points.length + ds.timeline.length;
                        ds = sanitizeDataset(ds);
                        const removed = before - ds.points.length - ds.timeline.length;
                        spinner.succeed(`Sanitized — ${removed} invalid items removed`);
                    }

                    // 2 — Filter
                    const hasFilters =
                        cmdArgv.filterDate || cmdArgv.filterArea || cmdArgv.filterActivity;
                    if (hasFilters) {
                        spinner.start('Applying filters…');
                        ds = applyFilters(
                            ds,
                            cmdArgv.filterDate as string[] | undefined,
                            cmdArgv.filterArea,
                            cmdArgv.filterActivity,
                        );
                        spinner.succeed(
                            `Filtered — ${ds.points.length} points, ${ds.timeline.length} timeline entries`,
                        );
                    }

                    // 3 — Stats
                    if (cmdArgv.stats || (!cmdArgv.export && !hasFilters && !cmdArgv.quality)) {
                        printSummary(ds);
                    }
                    if (cmdArgv.quality) {
                        printQuality(ds);
                    }

                    // 4 — Export
                    if (cmdArgv.export) {
                        spinner.start(`Exporting to ${cmdArgv.export}…`);
                        const ext = path.extname(cmdArgv.export).toLowerCase();
                        let content: string;

                        if (ext === '.kml') {
                            content = exportToKml(ds);
                        } else {
                            content = exportToJson(ds);
                        }

                        fs.writeFileSync(cmdArgv.export, content, 'utf-8');
                        spinner.succeed(`Written to ${cmdArgv.export}`);
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    spinner.fail(msg);
                    process.exit(1);
                }
            },
        )
        .demandCommand(1, 'Please specify a command (e.g. "load")')
        .strict()
        .help()
        .alias('h', 'help')
        .parseSync();
}

run();
