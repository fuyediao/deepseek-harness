/**
 * Stage the Windows desktop installer payload and invoke electron-builder.
 * The installed exe is Electron; it execs the bundled Node
 * `dsh --profile electron --no-window` tree. win-x64 only; unsigned.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm,
} from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { resolveWindowsNodePtyAddons } from './build-exe-for-python-sdk-native-pty.ts'
import {
  ELECTRON_HOST_OMIT,
  ELECTRON_RUNTIME_CLOSURE_NAME,
} from './electron-runtime-closure.ts'

const root = resolve(import.meta.dirname, '..')
const HOST_STAGING = 'apps/electron/packaging/host'
const WEB_STAGING = 'apps/electron/packaging/web'
const OUT_DIR = 'dist-electron'
const DSH_BIN = 'node_modules/@deepseek-ai/dsh/lib/bin.js'
const DEPLOY_SOURCE_NODE_MODULES = 'apps/electron/runtime-closure/node_modules'
const HOST_STRIP = ['electron', '@deepseek-ai/dsh-electron-shell'] as const

interface InstallerCli {
  skipBuild: boolean
  skipPack: boolean
  dryRun: boolean
}

/**
 * Parse installer argv. Help exits 0; malformed flags exit 1.
 * @param argv - `process.argv.slice(2)`.
 * @returns the validated flags.
 */
export function parseInstallerCli(argv: string[]): InstallerCli {
  let values: ReturnType<typeof parseRaw>
  try {
    values = parseRaw(argv)
  } catch (error) {
    console.error(`build-electron-installer: ${error instanceof Error ? error.message : String(error)}\n`)
    console.error(usage())
    process.exit(1)
  }
  if (values.help) {
    console.log(usage())
    process.exit(0)
  }
  return {
    skipBuild: values['skip-build'],
    skipPack: values['skip-pack'],
    dryRun: values['dry-run'],
  }
}

/**
 * Fail unless this process can produce the win-x64 NSIS installer.
 * @param platform - `process.platform`.
 * @param arch - `process.arch`.
 */
export function assertWinX64Host(platform: NodeJS.Platform, arch: string): void {
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error(
      `build-electron-installer: Windows x64 only; host is ${platform}-${arch}.`,
    )
  }
}

function parseRaw(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      'skip-build': { type: 'boolean', default: false },
      'skip-pack': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'help': { type: 'boolean', default: false },
    },
  }).values
}

function usage(): string {
  return [
    'Usage: pnpm exec tsx scripts/build-electron-installer.ts [flags]',
    '',
    '  --skip-build  skip `pnpm run build` (lib/ and the web dist must already exist).',
    '  --skip-pack   stage extraResources without invoking electron-builder.',
    '  --dry-run     print every command and filesystem change without executing.',
    '  --help        print this help.',
    '',
    'Produces an unsigned NSIS installer under dist-electron/ for win-x64.',
  ].join('\n')
}

function pnpmInvocation(args: string[]): [command: string, args: string[]] {
  const entrypoint = process.env.npm_execpath?.trim()
  if (entrypoint !== undefined && entrypoint !== '') {
    const extension = extname(entrypoint).toLowerCase()
    if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
      return [process.execPath, [entrypoint, ...args]]
    }
    if (extension !== '.cmd') return [entrypoint, args]
  }
  const home = process.env.PNPM_HOME?.trim()
  if (home !== undefined && home !== '') {
    const packageBin = resolve(home, '..', 'pnpm', 'bin')
    for (const filename of ['pnpm.mjs', 'pnpm.cjs']) {
      const candidate = resolve(packageBin, filename)
      if (existsSync(candidate)) return [process.execPath, [candidate, ...args]]
    }
  }
  if (process.platform === 'win32') {
    throw new Error('build-electron-installer: pnpm must expose a JavaScript entrypoint through npm_execpath or PNPM_HOME on Windows.')
  }
  return ['pnpm', args]
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/** Sequential installer pipeline. */
class ElectronInstallerBuild {
  readonly hostStaging = resolve(root, HOST_STAGING)
  readonly webStaging = resolve(root, WEB_STAGING)

  constructor(private readonly cli: InstallerCli) {}

  /** Verify the desktop Host closure before compiling or packaging. */
  async verifyClosure(): Promise<void> {
    await this.runPnpm('desktop Host closure', ['exec', 'tsx', 'scripts/verify-electron-runtime-closure.ts'])
    await this.runPnpm('desktop Host closure file', ['exec', 'tsx', 'scripts/gen-electron-runtime-closure.ts', '--check'])
  }

  /** Build package artifacts unless `--skip-build` was passed. */
  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log('build-electron-installer: skipping pnpm run build (--skip-build)')
      return
    }
    await this.runPnpm('build', ['run', 'build'])
  }

  /** Clear and deploy the Host closure, then drop Electron-asar packages. */
  async deployHost(): Promise<void> {
    if (this.hostStaging === root || root.startsWith(this.hostStaging + sep)) {
      throw new Error(`build-electron-installer: refusing to clear staging dir ${this.hostStaging}: it contains the repo root.`)
    }
    if (this.cli.dryRun) console.log(`build-electron-installer: [dry-run] rm -rf ${this.hostStaging}`)
    else await rm(this.hostStaging, { recursive: true, force: true })
    await this.runPnpm('deploy', [
      '--filter',
      ELECTRON_RUNTIME_CLOSURE_NAME,
      'deploy',
      '--legacy',
      '--prod',
      '--config.node-linker=hoisted',
      '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true',
      this.hostStaging,
    ])
    await this.restoreLegacyHoists()
    await this.materializeStagedLinks()
    await this.stripHostAsarPackages()
    await this.copyNodeBinary()
    if (!this.cli.dryRun) {
      if (!existsSync(join(this.hostStaging, DSH_BIN))) {
        throw new Error(`build-electron-installer: ${join(this.hostStaging, DSH_BIN)} missing after deploy.`)
      }
      resolveWindowsNodePtyAddons(join(this.hostStaging, 'node_modules', 'node-pty'), 'x64')
    }
  }

  /** Copy the built frontend dist the packaged shell serves. */
  async stageWebDist(): Promise<void> {
    const require = (await import('node:module')).createRequire(import.meta.url)
    let distRoot: string
    try {
      distRoot = join(dirname(require.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist')
    } catch {
      throw new Error('build-electron-installer: @deepseek-ai/dsh-web-frontend is not resolvable; run pnpm run build.')
    }
    if (this.cli.dryRun) {
      console.log(`build-electron-installer: [dry-run] rm -rf ${this.webStaging}`)
      console.log(`build-electron-installer: [dry-run] cp ${distRoot} ${this.webStaging}`)
      return
    }
    if (!existsSync(join(distRoot, 'index.html'))) {
      throw new Error(`build-electron-installer: web dist is missing index.html at ${distRoot}.`)
    }
    await rm(this.webStaging, { recursive: true, force: true })
    await mkdir(dirname(this.webStaging), { recursive: true })
    await cp(distRoot, this.webStaging, {
      recursive: true,
      filter: source => !source.endsWith('.map') && !source.includes(`${sep}preview${sep}`) && !source.endsWith(`${sep}preview.html`),
    })
  }

  /** Invoke electron-builder unless `--skip-pack`. */
  async pack(): Promise<void> {
    if (this.cli.skipPack) {
      console.log('build-electron-installer: skipping electron-builder (--skip-pack)')
      return
    }
    await this.runPnpm('electron-builder', [
      'exec',
      'electron-builder',
      '--project',
      resolve(root, 'apps/electron'),
      '--config',
      resolve(root, 'apps/electron/electron-builder.yml'),
      '--win',
      '--x64',
    ])
  }

  private async restoreLegacyHoists(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-electron-installer: [dry-run] restore direct dependencies omitted by legacy deploy')
      return
    }
    const manifestPath = join(this.hostStaging, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const sourceNodeModules = resolve(root, DEPLOY_SOURCE_NODE_MODULES)
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      const destination = join(this.hostStaging, 'node_modules', dependency)
      if (existsSync(destination)) continue
      const source = join(sourceNodeModules, dependency)
      if (!existsSync(source)) {
        throw new Error(
          `build-electron-installer: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`,
        )
      }
      await mkdir(dirname(destination), { recursive: true })
      const nestedNodeModules = join(source, 'node_modules')
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
    }
  }

  private async materializeStagedLinks(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-electron-installer: [dry-run] materialize staged package links')
      return
    }
    const nodeModules = join(this.hostStaging, 'node_modules')
    let remaining = await this.findSymlink(nodeModules)
    while (remaining !== undefined) {
      const segments = remaining.slice(nodeModules.length + 1).split(sep)
      const binIndex = segments.lastIndexOf('.bin')
      if (binIndex >= 0) {
        await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
        remaining = await this.findSymlink(nodeModules)
        continue
      }
      const destination = remaining
      const source = await realpath(destination)
      const nestedNodeModules = join(source, 'node_modules')
      await rm(destination, { recursive: true, force: true })
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      remaining = await this.findSymlink(nodeModules)
    }
  }

  private async findSymlink(directory: string): Promise<string | undefined> {
    if (!existsSync(directory)) return undefined
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) return path
      if (metadata.isDirectory()) {
        const nested = await this.findSymlink(path)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }

  private async stripHostAsarPackages(): Promise<void> {
    for (const name of HOST_STRIP) {
      const destination = join(this.hostStaging, 'node_modules', ...name.split('/'))
      if (this.cli.dryRun) {
        console.log(`build-electron-installer: [dry-run] rm -rf ${destination}`)
        continue
      }
      await rm(destination, { recursive: true, force: true })
    }
    for (const name of ELECTRON_HOST_OMIT) {
      if ((HOST_STRIP as readonly string[]).includes(name)) continue
      const destination = join(this.hostStaging, 'node_modules', ...name.split('/'))
      if (this.cli.dryRun) console.log(`build-electron-installer: [dry-run] rm -rf ${destination}`)
      else await rm(destination, { recursive: true, force: true })
    }
  }

  private async copyNodeBinary(): Promise<void> {
    const destination = join(this.hostStaging, 'node.exe')
    if (this.cli.dryRun) {
      console.log(`build-electron-installer: [dry-run] cp ${process.execPath} ${destination}`)
      return
    }
    await copyFile(process.execPath, destination)
  }

  private async run(label: string, command: string, args: string[]): Promise<void> {
    const printable = formatCommand(command, args)
    if (this.cli.dryRun) {
      console.log(`build-electron-installer: [dry-run] ${printable}`)
      return
    }
    console.log(`build-electron-installer: ${label}: ${printable}`)
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, CI: 'true' },
      })
      child.once('error', (error) => {
        reject(new Error(`build-electron-installer: ${label} failed to spawn: ${error.message} (${printable})`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolvePromise()
          return
        }
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
        reject(new Error(`build-electron-installer: ${label} failed (${cause}): ${printable}`))
      })
    })
  }

  private async runPnpm(label: string, args: string[]): Promise<void> {
    const [command, invocationArgs] = pnpmInvocation(args)
    await this.run(label, command, invocationArgs)
  }
}

async function main(): Promise<void> {
  const cli = parseInstallerCli(process.argv.slice(2))
  assertWinX64Host(process.platform, process.arch)
  const pipeline = new ElectronInstallerBuild(cli)
  console.log(`build-electron-installer: staging host ${pipeline.hostStaging}`)
  console.log(`build-electron-installer: staging web ${pipeline.webStaging}`)
  console.log(`build-electron-installer: output ${resolve(root, OUT_DIR)}`)
  await pipeline.verifyClosure()
  await pipeline.build()
  await pipeline.deployHost()
  await pipeline.stageWebDist()
  await pipeline.pack()
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
