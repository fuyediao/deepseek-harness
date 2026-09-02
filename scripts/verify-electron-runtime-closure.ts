/**
 * The desktop installer Host closure must stay a closed preset/peer graph and
 * must not list the Electron asar or Web-only carrier packages.
 */
import { resolve } from 'node:path'
import {
  ELECTRON_HOST_OMIT,
  ELECTRON_RUNTIME_CLOSURE_MANIFEST,
  electronRuntimeClosureDependencies,
} from './electron-runtime-closure.ts'
import { verifyRuntimeClosure } from './verify-runtime-closure.ts'

const root = resolve(import.meta.dirname, '..')
const expected = await electronRuntimeClosureDependencies(root)
const result = await verifyRuntimeClosure(root, ELECTRON_RUNTIME_CLOSURE_MANIFEST)
const failures = [...result.failures]

for (const name of ELECTRON_HOST_OMIT) {
  if (expected[name] !== undefined) {
    failures.push(`${name} must not appear in the desktop Host closure`)
  }
}

if (failures.length > 0) {
  console.error('verify-electron-runtime-closure: the desktop Host closure is incomplete or carries Electron/Web-only packages:')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    `verify-electron-runtime-closure: ${String(Object.keys(expected).length)} packages; `
    + `${String(result.presetCount)} agent presets and ${String(result.workspacePackageCount)} workspace packages form a closed graph.`,
  )
}
