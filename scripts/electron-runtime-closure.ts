/**
 * Compute the Windows desktop installer Host closure: the Python runtime's
 * preset-closed Host graph, plus the Web/desktop Client roster, minus the
 * packages that live in the Electron asar or are Web-only carriers.
 */
import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Workspace filter name and package.json `name` of the deploy root. */
export const ELECTRON_RUNTIME_CLOSURE_NAME = 'dsh-electron-runtime-closure'

/** Deploy-root manifest relative to the repository root. */
export const ELECTRON_RUNTIME_CLOSURE_MANIFEST = 'apps/electron/runtime-closure/package.json'

/** Packages the Host tree must not carry: they belong to the Electron asar or the Web carrier. */
export const ELECTRON_HOST_OMIT = [
  'electron',
  '@deepseek-ai/dsh-electron-shell',
  '@deepseek-ai/dsh-web-frontend',
  '@deepseek-ai/dsh-client-hmr',
  '@deepseek-ai/dsh-host-frontend-static',
  '@deepseek-ai/dsh-host-directory-picker-auto',
  '@deepseek-ai/dsh-host-directory-picker-browse',
  'open',
] as const

const SOURCE_MANIFESTS = [
  'python/sdk-runtime/package.json',
  'packages/bundle/base/package.json',
  'packages/bundle/web-app/package.json',
  'packages/bundle/electron-app/package.json',
] as const

const EXTRA_DEPENDENCIES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-electron-app',
  '@deepseek-ai/dsh-electron-ipc',
] as const

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

/**
 * Union the Host and desktop Client workspace dependencies the installer deploys.
 * @param root - repository root.
 * @returns sorted package name → `workspace:^` (or the source range for non-workspace extras).
 */
export async function electronRuntimeClosureDependencies(root: string): Promise<Record<string, string>> {
  const omit = new Set<string>(ELECTRON_HOST_OMIT)
  const dependencies: Record<string, string> = {}
  for (const relative of SOURCE_MANIFESTS) {
    const manifest = await loadManifest(resolve(root, relative))
    mergeWorkspace(dependencies, manifest.dependencies, omit)
    mergeWorkspace(dependencies, manifest.peerDependencies, omit)
  }
  for (const name of EXTRA_DEPENDENCIES) {
    if (!omit.has(name)) dependencies[name] = 'workspace:^'
  }
  await closeRequiredWorkspacePeers(root, dependencies, omit)
  return Object.fromEntries(Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right)))
}

/**
 * Render the private deploy-root manifest.
 * @param dependencies - computed Host closure.
 * @returns pretty-printed package.json text with a trailing newline.
 */
export function renderElectronRuntimeClosureManifest(dependencies: Record<string, string>): string {
  return `${JSON.stringify({
    name: ELECTRON_RUNTIME_CLOSURE_NAME,
    description: 'Dependency-only deploy root defining the Node Host the Windows desktop installer execs as dsh --profile electron --no-window.',
    version: '0.0.1',
    private: true,
    type: 'module',
    dependencies,
  }, null, 2)}\n`
}

function mergeWorkspace(
  target: Record<string, string>,
  source: Record<string, string> | undefined,
  omit: ReadonlySet<string>,
): void {
  for (const [name, range] of Object.entries(source ?? {})) {
    if (omit.has(name) || !range.startsWith('workspace:')) continue
    target[name] = range
  }
}

/**
 * Add required workspace peers reached from the seeded closure.
 * `verifyRuntimeClosure` walks the same graph and refuses a deploy root that
 * lists a package without its required workspace peers (`auto-install-peers=false`).
 * @param root - repository root.
 * @param dependencies - in-place closure being closed.
 * @param omit - packages that must stay out of the Host tree.
 */
async function closeRequiredWorkspacePeers(
  root: string,
  dependencies: Record<string, string>,
  omit: ReadonlySet<string>,
): Promise<void> {
  const workspace = await loadWorkspacePackages(root)
  const seen = new Set<string>()
  const queue = Object.keys(dependencies).filter(name => workspace.has(name))
  while (queue.length > 0) {
    const name = queue.pop()
    if (name === undefined || seen.has(name)) continue
    seen.add(name)
    const current = workspace.get(name)
    if (current === undefined) continue
    const peers = current.peerDependencies ?? {}
    const peerMeta = current.peerDependenciesMeta ?? {}
    for (const peer of Object.keys(peers)) {
      if (!workspace.has(peer) || peerMeta[peer]?.optional === true || omit.has(peer)) continue
      if (dependencies[peer] === undefined) dependencies[peer] = 'workspace:^'
      if (!seen.has(peer)) queue.push(peer)
    }
    const nested = {
      ...current.dependencies,
      ...current.optionalDependencies,
    }
    for (const dependency of Object.keys(nested)) {
      if (!workspace.has(dependency) || omit.has(dependency) || seen.has(dependency)) continue
      queue.push(dependency)
    }
  }
}

async function loadWorkspacePackages(root: string): Promise<Map<string, PackageManifest>> {
  const paths = globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: root })
    .sort()
    .map(relative => resolve(root, relative))
  const result = new Map<string, PackageManifest>()
  for (const path of paths) {
    const manifest = await loadManifest(path)
    if (manifest.name !== undefined) result.set(manifest.name, manifest)
  }
  return result
}

async function loadManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}
