# AGENTS.md

## Cos'è
Toolkit open-source per caricare, filtrare e visualizzare in locale la Google Location History esportata da Google Takeout: libreria + CLI (`mappit-core`) e app desktop Electron (`mappit-app`). Scheda: `my_notes/_Personali/Progetti/mappit.md`. Fa parte del Progetto Viaggi.

## Stack
Stack di default: `my_notes/_Personali/Progetti/_Stack.md`. Qui solo le deviazioni.
- Monorepo npm workspaces: `packages/core` e `packages/app` (l'app dipende dal core)
- Core: Node.js puro, build con `tsc` (niente Vite), output CommonJS, TypeScript strict; CLI con yargs, `ora@5` (v6+ è solo ESM), stream-json
- App: **niente Vue**. Il renderer è in TypeScript vanilla con stato pub/sub (`AppState`); build con electron-vite v5
- Mappa: **deck.gl su MapLibre (stile CartoDB Dark Matter), non Google Maps**; nessuna API key. Alias Vite `mapbox-gl → maplibre-gl` per `@deck.gl/mapbox`
- Grafici con Chart.js
- Niente Tailwind/daisyUI, Pinia, Vue Router, Zod, Supabase, Vercel AI SDK
- Prettier oltre a ESLint 9 (flat config)
- Vitest solo nel core; nessun test per l'app
- Distribuzione: electron-builder + pubblicazione npm di `mappit-core`; nessun deploy Vercel

## Comandi
```bash
npm install                                  # installa tutti i workspace
npm run build                                # build di tutti i package
npm run test                                 # test di tutti i package (di fatto solo core)
npm run lint                                 # ESLint su packages/*/src
npm run format                               # Prettier su packages/*/src/**/*.ts

npm run dev --workspace=packages/core        # tsc in watch
npm run test --workspace=packages/core       # vitest run
npm run test:watch --workspace=packages/core
npm run typecheck --workspace=packages/core
npm run docs --workspace=packages/core       # TypeDoc in packages/core/docs/

npm run dev --workspace=packages/app         # electron-vite dev (hot reload)
npm run build --workspace=packages/app
npm run typecheck --workspace=packages/app
npm run dist --workspace=packages/app        # build + electron-builder (anche dist:win / dist:mac / dist:linux)

# CLI dopo la build del core
node packages/core/dist/cli.js load <path> [--filter-date A B] [--filter-area s,w,n,e] [--filter-activity X,Y] [--stats] [--export out.json|out.kml]
```

## Struttura
- `packages/core/src/` — `loaders/` (un loader per formato Google + auto-detect), `filters.ts`, `stats.ts`, `transforms.ts`, `exporters/` (JSON, KML), `activity-mapping.ts`, `types.ts`, `cli.ts`, `index.ts`
- `packages/core/tests/` — test Vitest, con la stessa struttura di `src/`
- `packages/app/src/main/` — main process Electron (dataset in memoria, dialog, IPC)
- `packages/app/src/preload/` — espone `window.api` tipizzato via `contextBridge`
- `packages/app/src/renderer/` — UI: `map.ts` (deck.gl + MapLibre), `sidebar.ts`, `filters.ts`, `state.ts`
- `packages/app/src/shared/ipc-channels.ts` — tipi IPC (`InvokeArgs` / `InvokeResult`)
- `fixtures/` — un file di esempio per ogni formato, condiviso dai test
- `DECISIONS.md` — registro delle decisioni tecniche (da leggere prima di cambiare architettura)
- `ROADMAP.md` — piano per fasi
- Root: `Records.json`, `simplified_data.json`, `suggestions.md` — TODO: residui della versione legacy, verificare se si possono rimuovere

## Servizi esterni e variabili d'ambiente
- Tile mappa: CartoDB Dark Matter (pubbliche, senza token)
- Nessuna variabile d'ambiente per il codice
- Segreti CI: `NPM_TOKEN` (pubblicazione npm), `GITHUB_TOKEN` (electron-builder)

## Deploy
- `.github/workflows/ci.yml`: lint, test del core (Node 18/20/22), typecheck, build e package Electron su ubuntu/windows/macos con upload degli artefatti. Parte su push verso `main`/`refactoring` e PR verso `main`. **Il branch di default è `master`**: un push su master non avvia la CI. TODO: allineare i branch
- `.github/workflows/publish.yml`: a ogni GitHub Release pubblica `mappit-core` su npm (`--provenance --access public`)
- App: artefatti in `packages/app/release/` (Windows `dir` x64, Linux AppImage/deb, macOS dmg)

## Convenzioni
- Il core resta senza UI né I/O di file: i loader ricevono un oggetto JSON già parsato. La lettura dei file e lo streaming spettano a CLI/app
- Modello unico `MappitDataset` (`points` + `timeline`); coordinate sempre in gradi decimali `lat`/`lng`, mai E7
- I tipi di attività grezzi di Google vengono ricondotti a gruppi stabili in `activity-mapping.ts`
- I filtri sono immutabili (restituiscono un nuovo dataset); `filterByActivityType` mantiene sempre le visite; il filtro date tiene le entry che si sovrappongono al range
- Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (necessario per il preload). Il main tiene `originalDataset` (mai modificato) e `currentDataset`
- Formato condiviso con il blog: il blog si aspetta `{ locations: [{ latitudeE7, longitudeE7, timestamp }] }`, mentre l'export di mappit produce `lat`/`lng` decimali. Oggi la conversione è manuale (vedi `PLAN.md` nella repo blog)
- Prettier: virgolette singole, `printWidth` 100. TODO: `.prettierrc` dice `tabWidth: 2` ma il codice usa 4 spazi
