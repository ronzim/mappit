import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
    main: {
        // mappit-core is bundled into the main process, because the packaged
        // app ships without node_modules (see "files" in package.json). It is
        // bundled from source: Rollup can't see the re-exports of the
        // CommonJS build in packages/core/dist.
        plugins: [externalizeDepsPlugin({ exclude: ['mappit-core'] })],
        resolve: {
            alias: {
                'mappit-core': resolve(__dirname, '../core/src/index.ts'),
            },
        },
        build: {
            outDir: 'dist/main',
            rollupOptions: {
                input: resolve(__dirname, 'src/main/index.ts'),
            },
        },
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            outDir: 'dist/preload',
            rollupOptions: {
                input: resolve(__dirname, 'src/preload/index.ts'),
            },
        },
    },
    renderer: {
        root: resolve(__dirname, 'src/renderer'),
        resolve: {
            alias: {
                // deck.gl's @deck.gl/mapbox imports 'mapbox-gl' internally;
                // redirect to maplibre-gl (free, no token required).
                'mapbox-gl': 'maplibre-gl',
            },
        },
        build: {
            outDir: resolve(__dirname, 'dist/renderer'),
            rollupOptions: {
                input: resolve(__dirname, 'src/renderer/index.html'),
            },
        },
    },
});
