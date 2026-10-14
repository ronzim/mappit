# MappIt — Google Location History Viewer & Toolkit

> **Open-source desktop app and CLI to load, filter, and visualize your Google Location History data exported from Google Takeout.**  
> Supports all export formats (Records.json, Timeline.json, Semantic Location History), handles files > 500 MB, and keeps your data 100 % local.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)

**Keywords:** google location history viewer, google takeout visualization, google maps timeline viewer, google location history map, location history export tool, GPS data visualization, google timeline data explorer

---

<details>
<summary><strong>🇬🇧 English summary</strong></summary>

MappIt is a privacy-first toolkit for exploring your Google Location History locally:

- **Electron desktop app** with interactive map (deck.gl + MapLibre), timeline sidebar, activity filters, area search, and KML/JSON/GeoJSON/CSV/E7 export
- **Node.js CLI** for headless processing, filtering, and exporting
- **Core library** (`mappit-core`) usable in your own scripts
- Auto-detects all Google Takeout location formats (Records.json, Timeline.json standard/semantic/iOS, monthly Semantic Location History files)
- Filters by date range, bounding box, or activity type
- Computes stats: distance per activity, monthly summaries, yearly breakdowns
- Exports to JSON, KML, GeoJSON, CSV and E7 locations (`latitudeE7`/`longitudeE7`)

</details>

---

Strumenti per caricare, filtrare e visualizzare i dati di Google Location History scaricati da Google Takeout.

Il repository è un **monorepo npm workspaces** composto da due package:

| Package       | Percorso         | Descrizione                                                                                           |
| ------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `mappit-core` | `packages/core/` | Libreria Node.js + CLI. Carica, normalizza e filtra dati di localizzazione da tutti i formati Google. |
| `mappit-app`  | `packages/app/`  | App Electron per la visualizzazione interattiva dei dati di localizzazione.                           |

---

## Prerequisiti

- Node.js ≥ 20.19 (richiesto da Vite 7 ed electron-vite 5)
- npm ≥ 10

---

## Installazione

```bash
# Clona il repo e installa tutte le dipendenze di entrambi i package
npm install
```

---

## `mappit-core` — Libreria e CLI

### Sviluppo

```bash
# Compila in watch mode (rigenera dist/ ad ogni modifica)
npm run dev --workspace=packages/core

# Oppure dalla cartella del package
cd packages/core
npm run dev
```

La build produce output CommonJS in `packages/core/dist/`.

```bash
# Esegui i test in watch mode
npm run test:watch --workspace=packages/core

# Esegui i test una volta sola
npm run test --workspace=packages/core

# Controlla solo i tipi senza emettere file
npm run typecheck --workspace=packages/core
```

### Build di produzione

```bash
npm run build --workspace=packages/core
# oppure da root, per tutti i package in una volta:
npm run build
```

L'output viene emesso in `packages/core/dist/`:

```
dist/
├── index.js      ← entry point della libreria
├── index.d.ts    ← dichiarazioni TypeScript
├── cli.js        ← entry point della CLI
└── ...           ← sorgenti compilati dei moduli interni
```

### Uso come libreria

```js
// CommonJS
const { loadDataset, filterByDateRange } = require('mappit-core');

// TypeScript / ESM (dopo build)
import { loadDataset, filterByDateRange } from 'mappit-core';

const dataset = await loadDataset('./Takeout/Location History');
const filtered = filterByDateRange(dataset, '2024-01-01', '2024-06-30');
```

### Uso da CLI

Dopo la build, il comando `mappit-core` è disponibile tramite `npx`:

```bash
# Auto-detect del formato (Records.json, Timeline.json, cartella Takeout)
npx mappit-core load ./path/to/data

# Filtra per data
npx mappit-core load ./data --filter-date 2024-01-01 2024-06-30

# Filtra per area geografica (bounding box: lat_min,lng_min,lat_max,lng_max)
npx mappit-core load ./data --filter-area 45.0,9.0,46.0,10.0

# Filtra per tipo di attività
npx mappit-core load ./data --filter-activity WALKING,CYCLING

# Mostra statistiche
npx mappit-core load ./data --stats

# Esportazione
npx mappit-core load ./data --filter-date 2024-01-01 2024-06-30 --export output.json
npx mappit-core load ./data --filter-date 2024-01-01 2024-06-30 --export output.kml
npx mappit-core load ./data --filter-date 2024-01-01 2024-06-30 --export route.e7.json   # E7 per il blog
```

Tutte le opzioni:

```
mappit-core load <path>

Positionals:
  path  Percorso a un file JSON o directory Takeout         [string] [required]

Options:
  -f, --format           Forza un formato specifico (auto-detect di default)
         [string] [choices: records, timeline-standard, timeline-semantic,
                                                                 timeline-ios]
  -d, --filter-date      Filtra per intervallo date (due date ISO)       [array]
  -a, --filter-area      Filtra per bounding box: south,west,north,east [string]
      --filter-activity   Filtra per tipo di attività (separati da virgola)
                                                                        [string]
  -e, --export           Esporta su file (.json, .kml, .geojson, .csv, .e7.json)  [string]
      --export-format    Forza il formato (json, kml, geojson, csv, e7)  [string]
  -s, --stats            Mostra statistiche di riepilogo
                                                      [boolean] [default: false]
```

### Migrazione dalla CLI legacy

Se usavi la vecchia CLI basata su Electron (`src/main.js`), ecco la mappatura dei comandi:

| Vecchio comando                          | Nuovo comando                             |
| ---------------------------------------- | ----------------------------------------- |
| `--loadfile ./Records.json`              | `load ./Records.json`                     |
| `--filterdate '2022-08-06' '2022-08-17'` | `--filter-date 2022-08-06 2022-08-17`     |
| `--filterspace` (non implementato)       | `--filter-area south,west,north,east`     |
| `--writeOutput`                          | `--export output.json`                    |
| `--plot heatmap --render`                | (visualizzazione → `mappit-app`, Fase 4+) |

> La vecchia CLI richiedeva Electron per funzionare. La nuova CLI è un programma Node.js puro e non ha dipendenze grafiche.

### Formati dati supportati

| Formato                                       | Rilevamento automatico                                |
| --------------------------------------------- | ----------------------------------------------------- |
| `Records.json` (legacy, pre-2024)             | presenza di `{ locations: [...] }`                    |
| `Timeline.json` Standard                      | presenza di `{ timelineObjects: [...] }`              |
| `Timeline.json` Semantic                      | presenza di `{ semanticSegments: [...] }`             |
| `Timeline.json` iOS                           | struttura ad array `[{ startTime, visit\|activity }]` |
| File mensili Takeout (`2024_JANUARY.json`, …) | directory con file `YYYY_MONTH.json`                  |

---

## `mappit-app` — App Electron

App desktop per esplorare i dati di Google Location History. Usa `mappit-core` come motore dati e comunica via IPC tipizzati con architettura sicura (`contextIsolation`, `contextBridge`).

### Funzionalità attuali

- Caricamento file o directory Takeout tramite dialog nativo di Electron
- Scansione ricorsiva delle directory (gestisce la struttura annidata di Google Takeout)
- Auto-detect del formato (tutti e 5 i formati supportati dal core)
- Visualizzazione summary: statistiche generali, distanza per attività, breakdown annuale
- Filtro per intervallo date con ricalcolo statistiche
- Export dataset filtrato in JSON, KML, GeoJSON, CSV o E7

### Architettura

| Processo | Entry point                  | Ruolo                                                          |
| -------- | ---------------------------- | -------------------------------------------------------------- |
| Main     | `src/main/index.ts`          | Gestisce finestra, dialog, e operazioni dati via `mappit-core` |
| Preload  | `src/preload/index.ts`       | Espone `window.api` tipizzato via `contextBridge`              |
| Renderer | `src/renderer/main.ts`       | UI, stato locale, rendering summary                            |
| Shared   | `src/shared/ipc-channels.ts` | Tipi IPC condivisi (`InvokeArgs`, `InvokeResult`)              |

### Sviluppo

```bash
# Dev mode con hot-reload (electron-vite)
npm run dev --workspace=packages/app

# Build di produzione
npm run build --workspace=packages/app

# Controlla solo i tipi senza emettere file
npm run typecheck --workspace=packages/app
```

La build produce output in `packages/app/dist/`:

```
dist/
├── main/       ← main process bundle
├── preload/    ← preload script bundle
└── renderer/   ← HTML + CSS + JS per il renderer
```

### Stack tecnologico

- **Electron** v33+ con `contextIsolation: true`, `nodeIntegration: false`
- **electron-vite** v5 per build orchestration (main, preload, renderer)
- **Vite** v7 come bundler per il renderer
- **Vanilla TypeScript** per la UI (nessun framework)

> L'app include mappa interattiva (deck.gl + MapLibre), sidebar timeline, filtri attività, ricerca luoghi, area search, summary con grafici, e export KML/JSON/GeoJSON/CSV/E7.

### Distribuzione

L'app può essere pacchettizzata per Windows, macOS e Linux tramite electron-builder:

```bash
# Build + package per la piattaforma corrente
npm run dist --workspace=packages/app

# Oppure per piattaforme specifiche
npm run dist:win --workspace=packages/app
npm run dist:mac --workspace=packages/app
npm run dist:linux --workspace=packages/app
```

Gli artefatti vengono generati in `packages/app/release/`.

---

## Script dal root del monorepo

```bash
npm run build        # build di tutti i package
npm run test         # test di tutti i package
npm run lint         # ESLint su tutti i sorgenti TypeScript
npm run format       # Prettier su tutti i sorgenti TypeScript
```

---

## Documentazione API

La documentazione API di `mappit-core` è generata con [TypeDoc](https://typedoc.org/) a partire dai commenti JSDoc nel codice sorgente.

```bash
# Genera la documentazione HTML in packages/core/docs/
npm run docs --workspace=packages/core
```

Apri `packages/core/docs/index.html` nel browser per consultarla.

---

## Fixtures di test

La cartella `fixtures/` contiene file di esempio per ogni formato, usati dai test unitari:

```
fixtures/
├── records.json            ← Records.json (formato legacy)
├── timeline-standard.json  ← Timeline.json con timelineObjects
├── timeline-semantic.json  ← Timeline.json con semanticSegments
├── timeline-ios.json       ← Timeline.json formato iOS (array)
└── 2024_JANUARY.json       ← file mensile Takeout
```

---

## Struttura del repo

```
mappit-core/
├── packages/
│   ├── core/               ← mappit-core (libreria + CLI)
│   │   ├── src/
│   │   ├── dist/           ← output build (gitignored)
│   │   ├── docs/           ← documentazione API TypeDoc (gitignored)
│   │   ├── tests/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── typedoc.json
│   │   └── vitest.config.ts
│   └── app/                ← mappit-app (Electron)
│       ├── src/
│       │   ├── main/       ← main process
│       │   ├── preload/    ← preload script (contextBridge)
│       │   ├── renderer/   ← UI (HTML + CSS + TS)
│       │   └── shared/     ← tipi IPC condivisi
│       ├── dist/           ← output build (gitignored)
│       ├── electron.vite.config.ts
│       ├── package.json
│       └── tsconfig.json
├── fixtures/               ← dati di test per tutti i formati
├── .github/workflows/      ← CI/CD (lint, test, build)
├── tsconfig.base.json      ← tsconfig condiviso
├── eslint.config.js
├── package.json            ← workspace root
├── ROADMAP.md              ← piano di sviluppo dettagliato
└── DECISIONS.md            ← registro decisioni implementative
```

---

## Formati dati Google — Riferimento

Per la specifica completa dei formati di esportazione di Google Location History, vedi [locationhistoryformat.com](https://locationhistoryformat.com/).

Riepilogo dei campi principali:

- **`latitudeE7` / `longitudeE7`**: coordinate in formato E7 (gradi × 10⁷, intero)
- **`timestamp`**: ISO 8601 UTC
- **`velocity`**: m/s
- **`accuracy`**: raggio in metri
- **`placeVisit`**: visita a un luogo con `placeId`, `duration`, `location`
- **`activitySegment`**: spostamento con `activityType`, `duration`, `simplifiedRawPath`

---

## Roadmap

Vedi [ROADMAP.md](ROADMAP.md) per il piano dettagliato suddiviso in fasi.
