/**
 * mappit-app — Electron main process.
 *
 * Responsibilities:
 * - Create the BrowserWindow (contextIsolation, sandbox)
 * - Register IPC handlers that proxy all data operations via mappit-core
 * - Keep the "current dataset" in memory (mutable state lives here)
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
    parseAuto,
    parseRecords,
    parseTimelineStandard,
    parseTimelineSemantic,
    parseTimelineIos,
    parseTakeoutMonthly,
    filterByDateRange,
    filterByArea,
    filterByActivityType,
    computeSummary,
    computeYearlySummary,
    computeMonthlySummary,
    exportDataset,
    exportFormatFromPath,
} from 'mappit-core';
import type { MappitDataset, DataSource, BoundingBox, PlaceVisit } from 'mappit-core';
import type { PlaceSearchHit } from '../shared/ipc-channels';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
/** Full dataset as originally loaded (never mutated by filters). */
let originalDataset: MappitDataset | null = null;
/** Current (possibly filtered) dataset used for stats/export. */
let currentDataset: MappitDataset | null = null;

// ---------------------------------------------------------------------------
// File / directory loading helpers
// ---------------------------------------------------------------------------

/**
 * Recursively find files matching a pattern inside a directory tree.
 * Skips hidden files and NTFS Zone.Identifier alternates.
 */
function findFilesRecursive(dir: string, pattern: RegExp): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
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

/** Load a dataset from a directory (Takeout export tree). */
function loadFromDirectory(dirPath: string): MappitDataset {
    const resolved = path.resolve(dirPath);

    // 1 — Monthly files (e.g. 2024_JANUARY.json) anywhere in the tree
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

    // 2 — Single Records.json or Timeline.json anywhere in the tree
    for (const name of ['Records.json', 'Timeline.json']) {
        const found = findFilesRecursive(resolved, new RegExp(`^${name}$`, 'i'));
        if (found.length > 0) {
            const raw = fs.readFileSync(found[0], 'utf-8');
            return parseAuto(JSON.parse(raw) as unknown);
        }
    }

    throw new Error(`No supported files found in ${resolved}`);
}

/** Load a dataset from a single JSON file with optional format override. */
function loadFromFile(filePath: string, format?: string): MappitDataset {
    const resolved = path.resolve(filePath);
    const raw = fs.readFileSync(resolved, 'utf-8');
    const data: unknown = JSON.parse(raw);

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
                throw new Error(`Unknown format: ${format}`);
        }
    }

    return parseAuto(data);
}

/** Load from a path that can be either a file or a directory. */
function loadFromPath(filePath: string, format?: string): MappitDataset {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        return loadFromDirectory(filePath);
    }
    return loadFromFile(filePath, format);
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'MappIt',
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // required for preload to use Node.js APIs
        },
    });

    // In dev mode, load the Vite dev server URL; in production, load the built HTML.
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    if (process.env.NODE_ENV === 'development' && rendererUrl) {
        mainWindow.loadURL(rendererUrl);
    } else {
        mainWindow.loadFile(
            path.join(__dirname, '../renderer/index.html'),
        );
    }

    // Open external links in the default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
    // --- dialog:openFile ---------------------------------------------------
    ipcMain.handle('dialog:openFile', async () => {
        // Try file selection first; on Linux GTK, combining openFile +
        // openDirectory forces directory-only mode, so we try file first
        // and fall back to directory picker if the user cancels.
        const fileResult = await dialog.showOpenDialog({
            title: 'Open Location File or Folder',
            properties: ['openFile'],
            filters: [
                { name: 'JSON files', extensions: ['json'] },
                { name: 'All files', extensions: ['*'] },
            ],
        });
        if (!fileResult.canceled && fileResult.filePaths.length > 0) {
            return fileResult.filePaths[0];
        }

        // User cancelled — offer directory picker as second chance
        const dirResult = await dialog.showOpenDialog({
            title: 'Open Takeout Folder',
            properties: ['openDirectory'],
        });
        if (!dirResult.canceled && dirResult.filePaths.length > 0) {
            return dirResult.filePaths[0];
        }

        return null;
    });

    // --- dialog:saveFile ---------------------------------------------------
    ipcMain.handle(
        'dialog:saveFile',
        async (
            _event,
            args: { defaultName?: string; filters?: Array<{ name: string; extensions: string[] }> },
        ) => {
            const result = await dialog.showSaveDialog({
                defaultPath: args.defaultName,
                filters: args.filters ?? [
                    { name: 'KML files', extensions: ['kml'] },
                    { name: 'JSON files', extensions: ['json'] },
                    { name: 'All files', extensions: ['*'] },
                ],
            });
            if (result.canceled || !result.filePath) return null;
            return result.filePath;
        },
    );

    // --- dataset:load ------------------------------------------------------
    ipcMain.handle(
        'dataset:load',
        (_event, args: { filePath: string; format?: string }) => {
            const ds = loadFromPath(args.filePath, args.format);
            originalDataset = ds;
            currentDataset = ds;
            // Also push to renderer as an event
            mainWindow?.webContents.send('dataset:loaded', ds);
            return ds;
        },
    );

    // --- dataset:filter ----------------------------------------------------
    ipcMain.handle(
        'dataset:filter',
        (
            _event,
            args: {
                dateRange?: { start: string; end: string };
                area?: BoundingBox;
                activityTypes?: string[];
            },
        ) => {
            if (!originalDataset) {
                throw new Error('No dataset loaded');
            }

            // Always filter from the original, unfiltered dataset
            let ds: MappitDataset = originalDataset;

            if (args.dateRange) {
                ds = filterByDateRange(ds, args.dateRange.start, args.dateRange.end);
            }
            if (args.area) {
                ds = filterByArea(ds, args.area);
            }
            if (args.activityTypes && args.activityTypes.length > 0) {
                ds = filterByActivityType(ds, args.activityTypes);
            }

            // Update current dataset to the filtered version
            currentDataset = ds;
            mainWindow?.webContents.send('dataset:loaded', ds);
            return ds;
        },
    );

    // --- dataset:stats -----------------------------------------------------
    ipcMain.handle('dataset:stats', () => {
        if (!currentDataset) return null;
        return computeSummary(currentDataset);
    });

    // --- dataset:yearlyStats -----------------------------------------------
    ipcMain.handle('dataset:yearlyStats', () => {
        if (!currentDataset) return [];
        return computeYearlySummary(currentDataset);
    });

    // --- dataset:monthlyStats -----------------------------------------------
    ipcMain.handle('dataset:monthlyStats', () => {
        if (!currentDataset) return [];
        return computeMonthlySummary(currentDataset);
    });

    // --- dataset:searchPlaces -----------------------------------------------
    ipcMain.handle(
        'dataset:searchPlaces',
        (_event, args: { query: string }): PlaceSearchHit[] => {
            if (!currentDataset) return [];
            const q = args.query.toLowerCase().trim();
            if (q.length < 2) return [];

            const hits: PlaceSearchHit[] = [];
            currentDataset.timeline.forEach((entry, index) => {
                if (entry.type !== 'visit') return;
                const visit = entry as PlaceVisit;
                const name = (visit.name ?? '').toLowerCase();
                const pid = (visit.placeId ?? '').toLowerCase();
                let score = 0;
                if (name === q) score = 1;
                else if (name.startsWith(q)) score = 0.8;
                else if (name.includes(q)) score = 0.6;
                else if (pid.includes(q)) score = 0.4;
                if (score > 0) hits.push({ index, visit, score });
            });
            hits.sort((a, b) => b.score - a.score);
            return hits.slice(0, 50);
        },
    );

    // --- dataset:export ----------------------------------------------------
    ipcMain.handle(
        'dataset:export',
        (_event, args: { filePath: string }) => {
            if (!currentDataset) {
                throw new Error('No dataset loaded');
            }

            const format = exportFormatFromPath(args.filePath);
            fs.writeFileSync(args.filePath, exportDataset(currentDataset, format), 'utf-8');
            return true;
        },
    );
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
        // macOS: re-create window when dock icon is clicked
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
