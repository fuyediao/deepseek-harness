/**
 * @deepseek-ai/dsh-electron-app — the desktop-surface bundle's runtime glue
 * plugin plus the bundle patch (`cordis.patch.yml`, declared by the
 * `dsh.bundle.patch` manifest field). The plugin owns the desktop glue: it
 * starts the IPC listener over `ctx.connection`'s shared fetch handler and
 * `ctx.clientModules`' bundle resources — with no listening `webServer` — then
 * spawns the built `@deepseek-ai/dsh-electron-shell` (Electron main process),
 * pointed at the resolved `@deepseek-ai/dsh-web-frontend` dist and the IPC
 * endpoint through environment variables. Closing every window or the
 * spawned process exiting requests `ctx.appExit` with its code, so the
 * desktop app and the dsh process it runs inside share one lifetime.
 * @module @deepseek-ai/dsh-electron-app
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { addHarnessSourceSection } from '@deepseek-ai/dsh-app-boot'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway/types'
import { API_PATH } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-modules'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { ElectronIpcHost } from './ipc-host.ts'

/** Stable Cordis plugin name. */
export const name = 'electron-runtime'

/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** Services required before the desktop runtime can mount. */
export const inject = ['connection', 'clientModules']

/** Plugin config: whether this invocation spawns the Electron window. */
export interface Config {
  /** `false` starts the IPC listener without spawning Electron (composition smokes). */
  openWindow: boolean
}

export const Config: z<Config> = z.object({
  openWindow: z.boolean().default(true),
})

/** Resolve the built `@deepseek-ai/dsh-web-frontend` dist root directory. */
function resolveDistRoot(): string {
  const require = createRequire(import.meta.url)
  try {
    return join(dirname(require.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist')
  } catch {
    /* v8 ignore next 2 -- reachable only when the frontend package is absent from the checkout */
    throw new Error('electron-app: @deepseek-ai/dsh-web-frontend is not resolvable from this composition')
  }
}

/** Resolve the built `@deepseek-ai/dsh-electron-shell` main-process entry. */
function resolveShellMain(): string {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve('@deepseek-ai/dsh-electron-shell')
  } catch {
    /* v8 ignore next 2 -- reachable only when the shell package is absent from the checkout */
    throw new Error('electron-app: @deepseek-ai/dsh-electron-shell is not resolvable from this composition')
  }
}

/**
 * Resolve the installed Electron binary's path. Electron's own bundled
 * `.d.ts` always types the package as the in-process API surface (`app`,
 * `BrowserWindow`, ...); outside Electron — this is a plain Node Host
 * process — `require('electron')` instead returns that path as a string, per
 * the package's own documented Node-side contract. The cast names exactly
 * that narrowing gap; nothing here can express it in types.
 */
function resolveElectronBinary(): string {
  const require = createRequire(import.meta.url)
  const electronPath = require('electron') as unknown as string
  if (typeof electronPath !== 'string' || electronPath === '') {
    throw new Error('electron-app: the installed "electron" package did not resolve to a binary path')
  }
  return electronPath
}

/** Parent-Electron keys that make a nested `electron.exe` run as Node or attach to the parent's crashpad. */
const NESTED_ELECTRON_HIJACK_KEYS = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'CHROME_CRASHPAD_PIPE_NAME',
] as const

/**
 * Environment for the spawned desktop window.
 * Starts from {@link scrubbedParentEnv}, drops keys that an Electron parent
 * (VS Code, Cursor) injects into its integrated terminal, then sets the IPC
 * pipe and frontend dist. Those inherited keys otherwise make `electron.exe`
 * run as Node or hang on the parent's crashpad pipe, so the Host prints
 * `ipc ready` and no window appears.
 * @param pipePath - Host IPC endpoint.
 * @param distRoot - built `@deepseek-ai/dsh-web-frontend` dist.
 * @returns spawn `env`.
 */
export function electronShellEnv(pipePath: string, distRoot: string): Record<string, string> {
  const hijack = new Set(NESTED_ELECTRON_HIJACK_KEYS.map(name => name.toLowerCase()))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(scrubbedParentEnv())) {
    if (!hijack.has(key.toLowerCase())) env[key] = value
  }
  env.DSH_ELECTRON_IPC_PIPE = pipePath
  env.DSH_ELECTRON_DIST = distRoot
  return env
}

/** Test hooks for dist/shell/binary resolution; production never mutates them. */
export const internals: {
  resolveDistRoot: () => string
  resolveShellMain: () => string
  resolveElectronBinary: () => string
} = { resolveDistRoot, resolveShellMain, resolveElectronBinary }

/** Gather the current index-injection rows with no `webServer`/HTTP round trip. */
function collectIndexInjections(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

/** Model-visible orientation for sessions created through `dsh --profile electron`. */
function desktopSurfacePrompt(): string {
  return 'You are interacting with the user through the GeoCRM Harness desktop app, an Electron window running the same '
    + 'conversation interface as the Web GUI. When the user refers to "this window" or "this app" without naming another '
    + 'target, they mean this window. There is no browser address bar or separate tab context; the window shows exactly '
    + 'one session. The app has no listening network server, so there is no URL to share or open elsewhere.'
}

/**
 * Mount the desktop runtime: the IPC listener, the desktop-surface prompt
 * section, and — unless `openWindow` is false — the spawned Electron
 * process.
 * @param ctx - plugin context carrying `connection` and `clientModules`.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['systemPrompt'], (promptCtx) => {
    addHarnessSourceSection(promptCtx, SOURCE_ROOT)
    promptCtx.systemPrompt.section({
      name: 'app:electron-surface',
      // Shares the Web surface's single "which surface" prompt slot; the two
      // are mutually exclusive per composition.
      order: promptCtx.systemPrompt.getSectionOrder('WEB_SURFACE'),
      text: desktopSurfacePrompt,
    })
  })

  ctx.effect(async () => {
    const streamGateway: TypertGateway | undefined = ctx.get('typertGateway')
    const host = new ElectronIpcHost({
      fetchHandler: ctx.connection.createSharedFetchHandler(API_PATH),
      clientModules: ctx.clientModules,
      collectIndexInjections: () => collectIndexInjections(ctx),
      streamGateway,
    })
    await host.listen()
    console.log(`dsh electron: ipc ready at ${host.pipePath}`)

    let child: ChildProcess | undefined
    if (config.openWindow) {
      try {
        const binary = internals.resolveElectronBinary()
        const shellMain = internals.resolveShellMain()
        const distRoot = internals.resolveDistRoot()
        child = spawn(binary, [shellMain], {
          env: electronShellEnv(host.pipePath, distRoot),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: false,
        })
        child.stdout?.setEncoding('utf8')
        child.stderr?.setEncoding('utf8')
        child.stdout?.on('data', (chunk: string) => { process.stdout.write(chunk) })
        child.stderr?.on('data', (chunk: string) => { process.stderr.write(chunk) })
        child.on('error', (error) => {
          console.error('electron-app: failed to spawn the Electron window', error)
          ctx.get('appExit')?.(1)
        })
        child.on('exit', (code) => {
          ctx.get('appExit')?.(code ?? 0)
        })
        console.log(`dsh electron: opening window via ${binary}`)
      } catch (error) {
        console.error('electron-app: failed to start the Electron window', error)
        ctx.get('appExit')?.(1)
        throw error
      }
    }

    return async () => {
      child?.kill()
      await host.dispose()
    }
  }, 'electron-runtime: ipc host + window')
}
