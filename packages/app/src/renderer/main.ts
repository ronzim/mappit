/**
 * Renderer entry point — orchestrates modules.
 *
 * Handles: load flow, date picker, summary, search, export, area search,
 * heatmap toggle, cross-module interactions.
 * All data operations go through `window.api` (IPC → main process).
 */

import { state } from './state';
import {
    initMap,
    flyTo,
    fitToBounds,
    getMapBounds,
    setHeatmapMode,
    isHeatmapMode,
} from './map';
import { initSidebar } from './sidebar';
import { initFilters } from './filters';
import { formatNumber, formatKm, getActivityColor } from './constants';
import {
    Chart,
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip as ChartTooltip,
    Legend,
    Colors,
} from 'chart.js';

Chart.register(
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    ChartTooltip,
    Legend,
    Colors,
);

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(sel: string) =>
    document.querySelector<T>(sel)!;

const welcomePanel = $('#welcome');
const appLayout = $('#app-layout');
const statusText = $('#status-text');

// Date picker
const dateStart = $<HTMLInputElement>('#date-start');
const dateEnd = $<HTMLInputElement>('#date-end');
const btnPrev = $<HTMLButtonElement>('#btn-prev');
const btnNext = $<HTMLButtonElement>('#btn-next');
const btnApply = $<HTMLButtonElement>('#btn-apply');

// Sidebar actions
const btnLoadWelcome = $<HTMLButtonElement>('#btn-load-welcome');
const btnLoadNew = $<HTMLButtonElement>('#btn-load-new');
const btnSummary = $<HTMLButtonElement>('#btn-summary');
const btnFiltersToggle = $<HTMLButtonElement>('#btn-filters-toggle');
const btnExport = $<HTMLButtonElement>('#btn-export');

// Search
const searchInput = $<HTMLInputElement>('#search-input');
const searchResults = $('#search-results');
const timeline = $('#timeline');

// Map toolbar
const btnAreaSearch = $<HTMLButtonElement>('#btn-area-search');
const btnHeatmap = $<HTMLButtonElement>('#btn-heatmap');

// Summary overlay
const summaryOverlay = $('#summary-overlay');
const btnCloseSummary = $<HTMLButtonElement>('#btn-close-summary');
const summaryContent = $('#summary-content');
const chartContainer = $('#chart-container');
const yearlyBreakdown = $('#yearly-breakdown');
const btnOverview = $<HTMLButtonElement>('#btn-summary-overview');
const btnYearly = $<HTMLButtonElement>('#btn-summary-yearly');
const btnMonthly = $<HTMLButtonElement>('#btn-summary-monthly');

// Filters panel
const filtersPanel = $('#filters-panel');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setStatus(msg: string, loading = false): void {
    statusText.textContent = msg;
    statusText.classList.toggle('loading', loading);
}

function toDateInputValue(iso: string): string {
    return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Load dataset flow
// ---------------------------------------------------------------------------

async function handleLoad(): Promise<void> {
    try {
        setStatus('Opening file picker…');
        const filePath = await window.api.openFile();
        if (!filePath) {
            setStatus('Ready');
            return;
        }

        setStatus(`Loading ${filePath}…`, true);
        const ds = await window.api.loadDataset(filePath);

        state.setOriginalDateRange(ds.dateRange.min, ds.dateRange.max);

        dateStart.value = toDateInputValue(ds.dateRange.min);
        dateEnd.value = toDateInputValue(ds.dateRange.max);
        dateStart.min = toDateInputValue(ds.dateRange.min);
        dateEnd.max = toDateInputValue(ds.dateRange.max);

        state.setDataset(ds);

        welcomePanel.classList.add('hidden');
        appLayout.classList.remove('hidden');

        setStatus(
            `${formatNumber(ds.timeline.length)} entries | ${ds.source} | ${ds.dateRange.min.slice(0, 10)} → ${ds.dateRange.max.slice(0, 10)}`,
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`Error: ${msg}`);
    }
}

// ---------------------------------------------------------------------------
// Date range filter
// ---------------------------------------------------------------------------

async function applyDateFilter(): Promise<void> {
    const start = dateStart.value;
    const end = dateEnd.value;
    if (!start || !end) return;

    try {
        setStatus('Filtering…', true);
        const filtered = await window.api.filterDataset({
            dateRange: { start, end },
        });
        state.setDataset(filtered);
        setStatus(
            `${formatNumber(filtered.timeline.length)} entries | ${start} → ${end}`,
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`Error: ${msg}`);
    }
}

function shiftDateRange(direction: -1 | 1): void {
    const s = new Date(dateStart.value);
    const e = new Date(dateEnd.value);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return;

    const rangeDays = Math.max(
        1,
        Math.round((e.getTime() - s.getTime()) / 86_400_000),
    );

    s.setDate(s.getDate() + direction * rangeDays);
    e.setDate(e.getDate() + direction * rangeDays);
    dateStart.value = s.toISOString().slice(0, 10);
    dateEnd.value = e.toISOString().slice(0, 10);
    applyDateFilter();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

async function handleExport(): Promise<void> {
    try {
        const filePath = await window.api.saveFile({
            defaultName: 'mappit-export.kml',
            filters: [
                { name: 'KML files', extensions: ['kml'] },
                { name: 'GeoJSON files', extensions: ['geojson'] },
                { name: 'CSV files', extensions: ['csv'] },
                { name: 'E7 locations (travel blog)', extensions: ['e7.json'] },
                { name: 'JSON files', extensions: ['json'] },
                { name: 'All files', extensions: ['*'] },
            ],
        });
        if (!filePath) return;

        setStatus('Exporting…', true);
        await window.api.exportDataset(filePath);
        setStatus(`Exported to ${filePath}`);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`Export error: ${msg}`);
    }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

function handleSearchInput(): void {
    if (searchTimeout) clearTimeout(searchTimeout);
    const query = searchInput.value.trim();

    if (query.length < 2) {
        clearSearch();
        return;
    }

    searchTimeout = setTimeout(async () => {
        const hits = await window.api.searchPlaces(query);
        if (hits.length === 0) {
            searchResults.innerHTML =
                '<div class="empty-msg">No results found.</div>';
        } else {
            searchResults.innerHTML = hits
                .map(
                    (h) => `
                <div class="search-hit" data-index="${h.index}">
                    <span class="timeline-dot" style="background: #FFC107"></span>
                    <div>
                        <div class="search-hit-name">${h.visit.name ?? 'Visit'}</div>
                        <div class="search-hit-time">${h.visit.startTime.slice(0, 10)}</div>
                    </div>
                </div>`,
                )
                .join('');

            searchResults.querySelectorAll('.search-hit').forEach((el) => {
                el.addEventListener('click', () => {
                    const idx = parseInt(
                        (el as HTMLElement).dataset.index ?? '-1',
                        10,
                    );
                    if (idx >= 0) {
                        // Find the entry in the full dataset timeline and fly to it
                        const ds = state.dataset;
                        if (ds && ds.timeline[idx]) {
                            const entry = ds.timeline[idx];
                            if (entry.type === 'visit') {
                                flyTo(entry.lng, entry.lat);
                            }
                        }
                    }
                });
            });
        }

        searchResults.classList.remove('hidden');
        timeline.classList.add('hidden');
    }, 250);
}

function clearSearch(): void {
    searchResults.classList.add('hidden');
    searchResults.innerHTML = '';
    timeline.classList.remove('hidden');
}

searchInput.addEventListener('input', handleSearchInput);
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        searchInput.value = '';
        clearSearch();
    }
});

// ---------------------------------------------------------------------------
// Area search (filter to map viewport)
// ---------------------------------------------------------------------------

async function handleAreaSearch(): Promise<void> {
    const bounds = getMapBounds();
    if (!bounds) return;

    try {
        setStatus('Filtering by area…', true);
        const filtered = await window.api.filterDataset({
            area: bounds,
        });
        state.setDataset(filtered);
        setStatus(
            `${formatNumber(filtered.timeline.length)} entries in area`,
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`Error: ${msg}`);
    }
}

// ---------------------------------------------------------------------------
// Heatmap toggle
// ---------------------------------------------------------------------------

function toggleHeatmap(): void {
    const newMode = !isHeatmapMode();
    setHeatmapMode(newMode);
    btnHeatmap.classList.toggle('active', newMode);
}

// ---------------------------------------------------------------------------
// Summary overlay with Chart.js
// ---------------------------------------------------------------------------

let distanceChart: Chart | null = null;
let visitsChart: Chart | null = null;

type SummaryView = 'overview' | 'yearly' | 'monthly';
let currentSummaryView: SummaryView = 'overview';

function setSummaryTab(view: SummaryView): void {
    currentSummaryView = view;
    btnOverview.classList.toggle('btn-primary-sm', view === 'overview');
    btnYearly.classList.toggle('btn-primary-sm', view === 'yearly');
    btnMonthly.classList.toggle('btn-primary-sm', view === 'monthly');
    // Remove active-plain style from non-active tabs
    for (const b of [btnOverview, btnYearly, btnMonthly]) {
        if (!b.classList.contains('btn-primary-sm')) {
            b.classList.add('btn-sm');
        }
    }
    showSummary();
}

async function showSummary(): Promise<void> {
    const [stats, yearly, monthly] = await Promise.all([
        window.api.getStats(),
        window.api.getYearlyStats(),
        window.api.getMonthlyStats(),
    ]);

    if (!stats) {
        summaryContent.innerHTML = '<p class="muted">No data.</p>';
        yearlyBreakdown.innerHTML = '';
        chartContainer.classList.add('hidden');
        summaryOverlay.classList.remove('hidden');
        return;
    }

    // Always show overview stats
    summaryContent.innerHTML = `
        <dl class="summary-grid">
            <dt>Date range</dt>
            <dd>${stats.dateRange.min?.slice(0, 10) ?? '—'} → ${stats.dateRange.max?.slice(0, 10) ?? '—'}</dd>
            <dt>Raw points</dt>
            <dd>${formatNumber(stats.totalPoints)}</dd>
            <dt>Visits</dt>
            <dd>${formatNumber(stats.visits)}</dd>
            <dt>Activities</dt>
            <dd>${formatNumber(stats.activities)}</dd>
            <dt>Unique places</dt>
            <dd>${formatNumber(stats.uniquePlaces)}</dd>
            <dt>Total distance</dt>
            <dd>${formatKm(stats.totalDistanceMeters)} km</dd>
        </dl>
        ${renderDistanceTable(stats.distanceByActivity)}`;

    // Build charts & table for selected view
    if (currentSummaryView === 'overview') {
        yearlyBreakdown.innerHTML = '';
        chartContainer.classList.add('hidden');
        buildActivityChart(stats.distanceByActivity);
    } else if (currentSummaryView === 'yearly') {
        renderPeriodTable(yearly, 'Year');
        buildPeriodCharts(yearly);
    } else {
        renderPeriodTable(monthly, 'Month');
        buildPeriodCharts(monthly);
    }

    summaryOverlay.classList.remove('hidden');
}

function renderDistanceTable(
    distanceByActivity: Record<string, number>,
): string {
    const entries = Object.entries(distanceByActivity).sort(
        (a, b) => b[1] - a[1],
    );
    if (entries.length === 0) return '';
    return `
        <h3 style="margin-top:16px;font-size:14px;color:var(--text-muted);">Distance by Activity</h3>
        <table class="activity-table">
            <thead><tr><th>Activity</th><th>Distance</th></tr></thead>
            <tbody>${entries.map(([t, m]) => `<tr><td>${t}</td><td>${formatKm(m)} km</td></tr>`).join('')}</tbody>
        </table>`;
}

interface PeriodData {
    label: string;
    summary: {
        visits: number;
        activities: number;
        totalDistanceMeters: number;
    };
}

function renderPeriodTable(data: PeriodData[], columnName: string): void {
    if (data.length === 0) {
        yearlyBreakdown.innerHTML = '';
        return;
    }
    yearlyBreakdown.innerHTML = `
        <h3>${columnName}ly Breakdown</h3>
        <table class="activity-table">
            <thead><tr><th>${columnName}</th><th>Visits</th><th>Activities</th><th>Distance</th></tr></thead>
            <tbody>${data.map((p) => `<tr><td>${p.label}</td><td>${formatNumber(p.summary.visits)}</td><td>${formatNumber(p.summary.activities)}</td><td>${formatKm(p.summary.totalDistanceMeters)} km</td></tr>`).join('')}</tbody>
        </table>`;
}

function buildActivityChart(distanceByActivity: Record<string, number>): void {
    const entries = Object.entries(distanceByActivity).sort(
        (a, b) => b[1] - a[1],
    );
    if (entries.length === 0) return;

    chartContainer.classList.remove('hidden');

    // Distance by activity bar chart
    const canvas = document.getElementById(
        'chart-distance',
    ) as HTMLCanvasElement;
    if (distanceChart) distanceChart.destroy();
    distanceChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: entries.map(([t]) => t),
            datasets: [
                {
                    label: 'Distance (km)',
                    data: entries.map(([, m]) => m / 1000),
                    backgroundColor: entries.map(([t]) => getActivityColor(t)),
                },
            ],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { color: '#8893a7' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                },
                y: {
                    ticks: { color: '#e0e0e0', font: { size: 11 } },
                    grid: { display: false },
                },
            },
        },
    });

    // Hide visits chart in overview mode
    const visitsCanvas = document.getElementById(
        'chart-visits',
    ) as HTMLCanvasElement;
    visitsCanvas.style.display = 'none';
}

function buildPeriodCharts(data: PeriodData[]): void {
    if (data.length === 0) {
        chartContainer.classList.add('hidden');
        return;
    }

    chartContainer.classList.remove('hidden');

    const labels = data.map((p) => p.label);

    // Distance chart
    const distCanvas = document.getElementById(
        'chart-distance',
    ) as HTMLCanvasElement;
    if (distanceChart) distanceChart.destroy();
    distanceChart = new Chart(distCanvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Distance (km)',
                    data: data.map(
                        (p) => p.summary.totalDistanceMeters / 1000,
                    ),
                    backgroundColor: '#1a73e8',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { color: '#8893a7', maxRotation: 45 },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                },
                y: {
                    ticks: { color: '#8893a7' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                },
            },
        },
    });

    // Visits chart
    const visitsCanvas = document.getElementById(
        'chart-visits',
    ) as HTMLCanvasElement;
    visitsCanvas.style.display = '';
    if (visitsChart) visitsChart.destroy();
    visitsChart = new Chart(visitsCanvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Visits',
                    data: data.map((p) => p.summary.visits),
                    backgroundColor: '#FFC107',
                },
                {
                    label: 'Activities',
                    data: data.map((p) => p.summary.activities),
                    backgroundColor: '#4CAF50',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#e0e0e0' },
                },
            },
            scales: {
                x: {
                    ticks: { color: '#8893a7', maxRotation: 45 },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                },
                y: {
                    ticks: { color: '#8893a7' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                },
            },
        },
    });
}

// ---------------------------------------------------------------------------
// Map ↔ sidebar interaction (selection → camera)
// ---------------------------------------------------------------------------

state.subscribe((event) => {
    if (event === 'selection-changed' && state.selectedIndex !== null) {
        const entry = state.filteredEntries[state.selectedIndex];
        if (!entry) return;

        if (entry.type === 'visit') {
            flyTo(entry.lng, entry.lat);
        } else if (entry.path.length > 0) {
            const coords = entry.path.map(
                (p) => [p.lng, p.lat] as [number, number],
            );
            fitToBounds(coords);
        }
    }
});

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

btnLoadWelcome.addEventListener('click', handleLoad);
btnLoadNew.addEventListener('click', handleLoad);
btnApply.addEventListener('click', applyDateFilter);
btnPrev.addEventListener('click', () => shiftDateRange(-1));
btnNext.addEventListener('click', () => shiftDateRange(1));
btnSummary.addEventListener('click', showSummary);
btnCloseSummary.addEventListener('click', () => {
    summaryOverlay.classList.add('hidden');
    if (distanceChart) distanceChart.destroy();
    if (visitsChart) visitsChart.destroy();
    distanceChart = null;
    visitsChart = null;
});
btnFiltersToggle.addEventListener('click', () =>
    filtersPanel.classList.toggle('hidden'),
);
btnExport.addEventListener('click', handleExport);
btnAreaSearch.addEventListener('click', handleAreaSearch);
btnHeatmap.addEventListener('click', toggleHeatmap);

// Summary tabs
btnOverview.addEventListener('click', () => setSummaryTab('overview'));
btnYearly.addEventListener('click', () => setSummaryTab('yearly'));
btnMonthly.addEventListener('click', () => setSummaryTab('monthly'));

// IPC push events from main process
window.api.onDatasetLoaded(() => {
    /* handled via state subscriptions */
});
window.api.onError((msg) => setStatus(`Error: ${msg}`));

// ---------------------------------------------------------------------------
// Init modules
// ---------------------------------------------------------------------------

initMap('map');
initSidebar();
initFilters();
setStatus('Ready');

