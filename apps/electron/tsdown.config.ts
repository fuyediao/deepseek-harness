import { defineConfig } from 'tsdown'

const shared = {
  outDir: 'lib',
  platform: 'node' as const,
  target: 'es2024',
  dts: false,
  clean: false,
  // The Electron main/preload processes resolve their own bundled `electron`
  // module at runtime; bundling it here would pull in its Node-side path
  // resolution shim instead of the real in-process API surface.
  external: ['electron'],
}

/**
 * The Electron shell ships two entries: the main process (package.json
 * `main`, ESM) and the preload script the main process points
 * `webPreferences` at. A sandboxed renderer only executes CJS preloads, so
 * the preload entry is emitted as `preload.cjs`. Declarations come from
 * `tsc -b` (dts: false), matching every package.
 */
export default defineConfig([
  {
    ...shared,
    entry: ['lib/types/main.js'],
    format: ['esm'],
    fixedExtension: false,
  },
  {
    ...shared,
    entry: ['lib/types/preload.js'],
    format: ['cjs'],
    fixedExtension: true,
  },
])
