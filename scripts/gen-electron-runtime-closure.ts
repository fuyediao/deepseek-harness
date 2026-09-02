/**
 * Write `apps/electron/runtime-closure/package.json` from the Host/desktop
 * dependency union. `--check` compares the checked-in file without writing.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  ELECTRON_RUNTIME_CLOSURE_MANIFEST,
  electronRuntimeClosureDependencies,
  renderElectronRuntimeClosureManifest,
} from './electron-runtime-closure.ts'

const root = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { check: { type: 'boolean', default: false } },
})

const manifestPath = resolve(root, ELECTRON_RUNTIME_CLOSURE_MANIFEST)
const expected = renderElectronRuntimeClosureManifest(await electronRuntimeClosureDependencies(root))

if (values.check) {
  let actual = ''
  try {
    actual = await readFile(manifestPath, 'utf8')
  } catch {
    console.error(`gen-electron-runtime-closure: missing ${ELECTRON_RUNTIME_CLOSURE_MANIFEST}`)
    process.exitCode = 1
  }
  if (actual !== expected) {
    console.error(`gen-electron-runtime-closure: ${ELECTRON_RUNTIME_CLOSURE_MANIFEST} is stale; run pnpm exec tsx scripts/gen-electron-runtime-closure.ts`)
    process.exitCode = 1
  } else {
    console.log(`gen-electron-runtime-closure: ${ELECTRON_RUNTIME_CLOSURE_MANIFEST} matches the Host/desktop union.`)
  }
} else {
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, expected)
  console.log(`gen-electron-runtime-closure: wrote ${ELECTRON_RUNTIME_CLOSURE_MANIFEST}`)
}
