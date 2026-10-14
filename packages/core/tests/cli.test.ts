import { describe, it, expect } from 'vitest';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const CLI = path.resolve(__dirname, '../dist/cli.js');
const FIXTURES = path.resolve(__dirname, '../../../fixtures');

const run = (args: string[], opts?: ExecFileSyncOptions): string => {
    return execFileSync(
        process.execPath,
        [CLI, ...args],
        { encoding: 'utf-8', timeout: 15_000, ...opts },
    );
};

// ---------------------------------------------------------------------------
// Help & version
// ---------------------------------------------------------------------------
describe('CLI — help & version', () => {
    it('shows help with --help', () => {
        const out = run(['--help']);
        expect(out).toContain('mappit-core');
        expect(out).toContain('load <path>');
    });

    it('shows version with --version', () => {
        const out = run(['--version']);
        expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('shows load subcommand help', () => {
        const out = run(['load', '--help']);
        expect(out).toContain('--format');
        expect(out).toContain('--filter-date');
        expect(out).toContain('--filter-area');
        expect(out).toContain('--filter-activity');
        expect(out).toContain('--export');
        expect(out).toContain('--stats');
    });
});

// ---------------------------------------------------------------------------
// Load command
// ---------------------------------------------------------------------------
describe('CLI — load', () => {
    it('loads records.json and prints summary', () => {
        const out = run(['load', path.join(FIXTURES, 'records.json')]);
        expect(out).toContain('records');
        expect(out).toContain('Raw points:');
        expect(out).toContain('Dataset Summary');
    });

    it('loads timeline-standard.json', () => {
        const out = run(['load', path.join(FIXTURES, 'timeline-standard.json')]);
        expect(out).toContain('timeline-standard');
        expect(out).toContain('Timeline entries:');
    });

    it('loads timeline-semantic.json', () => {
        const out = run(['load', path.join(FIXTURES, 'timeline-semantic.json')]);
        expect(out).toContain('timeline-semantic');
    });

    it('loads timeline-ios.json', () => {
        const out = run(['load', path.join(FIXTURES, 'timeline-ios.json')]);
        expect(out).toContain('timeline-ios');
    });

    it('respects --format override', () => {
        const out = run([
            'load',
            path.join(FIXTURES, 'records.json'),
            '--format',
            'records',
        ]);
        expect(out).toContain('records');
    });

    it('exits with error for non-existent file', () => {
        expect(() => run(['load', '/tmp/__no_such_file__.json'])).toThrow();
    });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
describe('CLI — filters', () => {
    it('filters by date range', () => {
        const out = run([
            'load',
            path.join(FIXTURES, 'records.json'),
            '--filter-date',
            '2024-01-15T09:00:00Z',
            '2024-01-15T10:30:00Z',
            '--stats',
        ]);
        expect(out).toContain('Dataset Summary');
    });

    it('filters by area', () => {
        // The records fixture has points around 45.4 N, 9.1 E
        const out = run([
            'load',
            path.join(FIXTURES, 'records.json'),
            '--filter-area',
            '45.0,9.0,46.0,10.0',
            '--stats',
        ]);
        expect(out).toContain('Dataset Summary');
    });

    it('filters by activity on semantic timeline', () => {
        const out = run([
            'load',
            path.join(FIXTURES, 'timeline-semantic.json'),
            '--filter-activity',
            'WALKING',
            '--stats',
        ]);
        expect(out).toContain('Dataset Summary');
    });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
describe('CLI — export', () => {
    it('exports to JSON', () => {
        const outFile = path.join(os.tmpdir(), `mappit-test-${Date.now()}.json`);
        try {
            const out = run([
                'load',
                path.join(FIXTURES, 'records.json'),
                '--export',
                outFile,
            ]);
            // Spinner output goes to stdout; the file should exist
            expect(fs.existsSync(outFile)).toBe(true);
            const content = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
            expect(content).toHaveProperty('source', 'records');
            expect(content).toHaveProperty('points');
        } finally {
            if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
        }
    });

    it('exports to KML', () => {
        const outFile = path.join(os.tmpdir(), `mappit-test-${Date.now()}.kml`);
        try {
            const out = run([
                'load',
                path.join(FIXTURES, 'timeline-semantic.json'),
                '--export',
                outFile,
            ]);
            expect(fs.existsSync(outFile)).toBe(true);
            const content = fs.readFileSync(outFile, 'utf-8');
            expect(content).toContain('<?xml');
            expect(content).toContain('<kml');
        } finally {
            if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
        }
    });

    it('exports filtered data', () => {
        const outFile = path.join(os.tmpdir(), `mappit-test-${Date.now()}.json`);
        try {
            run([
                'load',
                path.join(FIXTURES, 'records.json'),
                '--filter-date',
                '2024-01-15T09:00:00Z',
                '2024-01-15T10:30:00Z',
                '--export',
                outFile,
            ]);
            const content = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
            // Only points within the date range should be exported
            expect(content.points.length).toBeLessThanOrEqual(4);
        } finally {
            if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
        }
    });
});

// ---------------------------------------------------------------------------
// Stats flag
// ---------------------------------------------------------------------------
describe('CLI — stats', () => {
    it('prints stats when --stats is passed', () => {
        const out = run([
            'load',
            path.join(FIXTURES, 'timeline-semantic.json'),
            '--stats',
        ]);
        expect(out).toContain('Dataset Summary');
        expect(out).toContain('Source format:');
        expect(out).toContain('Date range:');
    });

    it('prints stats by default when no export / filter', () => {
        const out = run(['load', path.join(FIXTURES, 'records.json')]);
        expect(out).toContain('Dataset Summary');
    });
});

// ---------------------------------------------------------------------------
// Quality & sanitize
// ---------------------------------------------------------------------------
describe('CLI — quality', () => {
    it('prints quality metrics with --quality', () => {
        const out = run(['load', path.join(FIXTURES, 'timeline-semantic-paths.json'), '--quality']);
        expect(out).toContain('Data Quality');
        expect(out).toContain('Validation:        ok');
        expect(out).toContain('Activities w/ path: 1 / 1 (100.0%)');
        expect(out).not.toContain('Dataset Summary');
    });

    it('drops invalid items with --sanitize', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mappit-'));
        const input = path.join(tmp, 'dirty.json');
        fs.writeFileSync(
            input,
            JSON.stringify({
                semanticSegments: [
                    {
                        startTime: '2024-01-15T10:00:00Z',
                        endTime: '2024-01-15T11:00:00Z',
                        visit: { topCandidate: { placeLocation: { latLng: '45.46°, 9.19°' } } },
                    },
                    {
                        startTime: '2024-01-15T12:00:00Z',
                        endTime: '2024-01-15T11:30:00Z',
                        visit: { topCandidate: { placeLocation: { latLng: '45.47°, 9.17°' } } },
                    },
                ],
            }),
        );
        const out = run(['load', input, '--sanitize', '--quality']);
        expect(out).toContain('1 invalid item removed');
        expect(out).toContain('Validation:        ok');
        fs.rmSync(tmp, { recursive: true, force: true });
    });
});

// ---------------------------------------------------------------------------
// Export formats (GeoJSON, CSV, E7)
// ---------------------------------------------------------------------------
describe('CLI — export formats', () => {
    const input = path.join(FIXTURES, 'timeline-semantic-paths.json');
    const withTmp = (name: string, fn: (out: string) => void) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mappit-'));
        try {
            fn(path.join(tmp, name));
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    };

    it('exports GeoJSON from the .geojson extension', () => {
        withTmp('out.geojson', (out) => {
            run(['load', input, '--export', out]);
            expect(JSON.parse(fs.readFileSync(out, 'utf-8')).type).toBe('FeatureCollection');
        });
    });

    it('exports CSV from the .csv extension', () => {
        withTmp('out.csv', (out) => {
            run(['load', input, '--export', out]);
            expect(fs.readFileSync(out, 'utf-8').split('\n')[0]).toContain('kind,timestamp');
        });
    });

    it('exports E7 locations from the .e7.json extension', () => {
        withTmp('route.e7.json', (out) => {
            run(['load', input, '--export', out]);
            const { locations } = JSON.parse(fs.readFileSync(out, 'utf-8'));
            expect(locations).toHaveLength(4);
            expect(locations[0]).toHaveProperty('latitudeE7');
        });
    });

    it('honours --export-format over the extension', () => {
        withTmp('route.json', (out) => {
            run(['load', input, '--export', out, '--export-format', 'e7']);
            expect(JSON.parse(fs.readFileSync(out, 'utf-8'))).toHaveProperty('locations');
        });
    });
});
