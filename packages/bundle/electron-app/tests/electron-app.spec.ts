/**
 * Desktop runtime glue behavior: the IPC listener mounts with no `webServer`,
 * the desktop-surface prompt section registers, and spawning the Electron
 * shell (or not, under `--no-window`) carries the resolved dist and IPC
 * endpoint through environment variables. Closing the spawned process
 * requests `ctx.appExit`.
 */

import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { apply, Config, electronShellEnv, internals } from '../src/index.ts'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}))

const originalResolveDistRoot = internals.resolveDistRoot
const originalResolveShellMain = internals.resolveShellMain
const originalResolveElectronBinary = internals.resolveElectronBinary

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(spawn).mockReset()
  internals.resolveDistRoot = originalResolveDistRoot
  internals.resolveShellMain = originalResolveShellMain
  internals.resolveElectronBinary = originalResolveElectronBinary
})

type FakeChild = ChildProcess & { kill: ReturnType<typeof vi.fn> }

function fakeChild(): FakeChild {
  const stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  const stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  return Object.assign(new EventEmitter(), { kill: vi.fn(), stdout, stderr }) as unknown as FakeChild
}

/** Fake ctx.connection carrying only the one method electron-runtime calls. */
function provideConnection(ctx: Context): void {
  ctx.provide('connection', {
    createSharedFetchHandler: () => ({ fetch: async () => new Response(null, { status: 404 }) }),
  } as unknown as HostConnectionHandle)
}

function provideClientModules(ctx: Context): void {
  ctx.provide('clientModules', { resolveResource: () => undefined } as never)
}

describe('electron-app runtime glue', () => {
  it('starts the IPC listener with no webServer, registers the desktop-surface prompt, and does not spawn under --no-window', async () => {
    const ctx = new Context()
    provideConnection(ctx)
    provideClientModules(ctx)
    apply(ctx, new Config({ openWindow: false }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(ctx.get('webServer')).toBeUndefined()
    expect(spawn).not.toHaveBeenCalled()

    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(entry => entry.name === 'app:electron-surface')
    expect(section?.text).toContain('DeepSeek Harness desktop app')
    expect(assembly.sections.some(entry => entry.name === 'harness:source')).toBe(true)

    await ctx.fiber.dispose()
  })

  it('spawns the resolved Electron binary and shell entry with the IPC pipe and dist root in env, and forwards exit to appExit', async () => {
    internals.resolveDistRoot = () => '/fixtures/dist'
    internals.resolveShellMain = () => '/fixtures/shell/main.js'
    internals.resolveElectronBinary = () => '/fixtures/electron-bin'
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child)

    const ctx = new Context()
    provideConnection(ctx)
    provideClientModules(ctx)
    const exits: number[] = []
    ctx.provide('appExit', (code: number) => { exits.push(code) })
    apply(ctx, new Config({ openWindow: true }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(spawn).toHaveBeenCalledTimes(1)
    const [binary, args, options] = vi.mocked(spawn).mock.calls[0]!
    expect(binary).toBe('/fixtures/electron-bin')
    expect(args).toEqual(['/fixtures/shell/main.js'])
    expect((options as { stdio: unknown }).stdio).toEqual(['ignore', 'pipe', 'pipe'])
    const env = (options as { env: Record<string, string> }).env
    expect(env.DSH_ELECTRON_DIST).toBe('/fixtures/dist')
    const pipePath = env.DSH_ELECTRON_IPC_PIPE
    expect(typeof pipePath).toBe('string')
    expect(pipePath?.length).toBeGreaterThan(0)

    const writeOut = vi.spyOn(process.stdout, 'write')
    const writeErr = vi.spyOn(process.stderr, 'write')
    child.stdout?.emit('data', 'from-electron-out')
    child.stderr?.emit('data', 'from-electron-err')
    expect(writeOut).toHaveBeenCalledWith('from-electron-out')
    expect(writeErr).toHaveBeenCalledWith('from-electron-err')

    child.emit('exit', 7)
    expect(exits).toEqual([7])
    child.emit('exit', null)
    expect(exits).toEqual([7, 0])

    await ctx.fiber.dispose()
    expect(child.kill).toHaveBeenCalled()
  })

  it('resolves the built web frontend dist from this package', () => {
    const distRoot = originalResolveDistRoot()
    expect(distRoot.replaceAll('\\', '/')).toMatch(/\/apps\/web\/dist$/)
  })

  it('prints a startup failure when the frontend dist cannot be resolved', async () => {
    internals.resolveDistRoot = () => {
      throw new Error('frontend missing')
    }
    internals.resolveShellMain = () => '/fixtures/shell/main.js'
    internals.resolveElectronBinary = () => '/fixtures/electron-bin'
    const errors: unknown[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const ctx = new Context()
    provideConnection(ctx)
    provideClientModules(ctx)
    const exits: number[] = []
    ctx.provide('appExit', (code: number) => { exits.push(code) })
    apply(ctx, new Config({ openWindow: true }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(spawn).not.toHaveBeenCalled()
    expect(exits).toEqual([1])
    expect(String(errors[0])).toContain('failed to start the Electron window')

    await ctx.fiber.dispose()
  })

  it('drops inherited Electron-parent hijack keys before spawning the window', () => {
    process.env.ELECTRON_RUN_AS_NODE = '1'
    process.env.electron_no_asar = '1'
    process.env.CHROME_CRASHPAD_PIPE_NAME = '\\\\.\\pipe\\cursor-crashpad'
    process.env.PATH = process.env.PATH ?? 'C:\\Windows\\System32'
    try {
      const env = electronShellEnv('\\\\.\\pipe\\dsh-electron-test', '/fixtures/dist')
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
      expect(env.electron_no_asar).toBeUndefined()
      expect(env.CHROME_CRASHPAD_PIPE_NAME).toBeUndefined()
      expect(env.DSH_ELECTRON_IPC_PIPE).toBe('\\\\.\\pipe\\dsh-electron-test')
      expect(env.DSH_ELECTRON_DIST).toBe('/fixtures/dist')
      expect(env.PATH).toBeDefined()
    } finally {
      delete process.env.ELECTRON_RUN_AS_NODE
      delete process.env.electron_no_asar
      delete process.env.CHROME_CRASHPAD_PIPE_NAME
    }
  })

  it('forwards a spawn failure to appExit', async () => {
    internals.resolveDistRoot = () => '/fixtures/dist'
    internals.resolveShellMain = () => '/fixtures/shell/main.js'
    internals.resolveElectronBinary = () => '/fixtures/electron-bin'
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child)
    const errors: unknown[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    const ctx = new Context()
    provideConnection(ctx)
    provideClientModules(ctx)
    const exits: number[] = []
    ctx.provide('appExit', (code: number) => { exits.push(code) })
    apply(ctx, new Config({ openWindow: true }))
    await new Promise(resolve => setTimeout(resolve, 0))

    child.emit('error', new Error('spawn electron ENOENT'))
    expect(exits).toEqual([1])
    expect(String(errors[0])).toContain('failed to spawn the Electron window')

    await ctx.fiber.dispose()
  })

  it('ignores spawn exit and error when the launcher did not provide appExit', async () => {
    internals.resolveDistRoot = () => '/fixtures/dist'
    internals.resolveShellMain = () => '/fixtures/shell/main.js'
    internals.resolveElectronBinary = () => '/fixtures/electron-bin'
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const ctx = new Context()
    provideConnection(ctx)
    provideClientModules(ctx)
    apply(ctx, new Config({ openWindow: true }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(() => {
      child.emit('error', new Error('spawn electron ENOENT'))
      child.emit('exit', 1)
    }).not.toThrow()

    await ctx.fiber.dispose()
  })

  it('answers a real socket handshake through the started IPC listener', async () => {
    const ctx = new Context()
    provideConnection(ctx)
    provideClientModules(ctx)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx, new Config({ openWindow: false }))
    await new Promise(resolve => setTimeout(resolve, 0))

    const line = log.mock.calls.map(call => String(call[0])).find(text => text.startsWith('dsh electron: ipc ready at '))
    if (line === undefined) throw new Error('expected the ipc-ready line to print')
    const pipePath = line.replace('dsh electron: ipc ready at ', '')

    const socket = await new Promise<import('node:net').Socket>((resolve, reject) => {
      const candidate = createConnection(pipePath)
      candidate.once('connect', () => { resolve(candidate) })
      candidate.once('error', reject)
    })
    const response = await new Promise<string>((resolve) => {
      socket.setEncoding('utf8')
      socket.once('data', (chunk: string) => { resolve(chunk) })
      socket.write('{"t":"boot-request"}\n')
    })
    expect(JSON.parse(response.trim())).toEqual({ t: 'boot', injections: [] })
    socket.destroy()

    await ctx.fiber.dispose()
  })

  it('mounts file-upload so session-controller can activate', () => {
    const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
    expect(patch).toContain('id: file-upload')
    expect(patch).toContain("name: '@deepseek-ai/dsh-client-file-upload'")
    expect(patch).toContain('id: session-controller')
  })
})
