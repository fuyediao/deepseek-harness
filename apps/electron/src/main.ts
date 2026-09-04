/**
 * Electron main process for the `dsh --profile electron` desktop shell.
 *
 * Source launches (`dsh --profile electron`) spawn this process with two
 * environment facts: `DSH_ELECTRON_IPC_PIPE` (the Host's IPC socket path)
 * and `DSH_ELECTRON_DIST` (the built `@deepseek-ai/dsh-web-frontend` dist
 * root). The installed Windows exe is this process: it execs the bundled
 * Node `dsh --profile electron --no-window` tree and reads the ready line
 * from that child instead.
 * This process owns exactly one privileged custom protocol (`dsh-app://`)
 * that serves the whole application: `/api/*` and `/plugins/*` relay to the
 * Host over the IPC socket as {@link ElectronIpcFetchRequestFrame} frames,
 * `/` renders the dist's `index.html` with the Host's current index
 * injection rows, and every other path is a static file read from the dist
 * root. There is no listening `webServer`; the desktop shell never binds a
 * port. The preload script (`./preload.ts`) carries the live event stream
 * (`window.__DSH_TRANSPORT__.openStream`) over the same socket, because a
 * custom protocol answers request/response, not a persistent multiplexed
 * channel.
 * @module @deepseek-ai/dsh-electron-shell/main
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createConnection, type Socket } from 'node:net'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, protocol, type IpcMainEvent } from 'electron'
import { renderIndexInjections, type IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import {
  ElectronIpcFrameReader,
  encodeFrame,
  parseHostFrame,
  type ElectronIpcHostFrame,
  type ElectronIpcMainFrame,
} from '@deepseek-ai/dsh-electron-ipc'
import {
  PACKAGED_HOST_ARGS,
  resolvePackagedLayout,
  waitForIpcReady,
} from './packaged-host.ts'
import { DESKTOP_WINDOW_CHROME, hideDesktopMenuBar } from './window-chrome.ts'

const SCHEME = 'dsh-app'
const STREAM_FRAME_CHANNEL = 'dsh:stream-frame'
const STREAM_OPEN_CHANNEL = 'dsh:stream-open'
const STREAM_ABORT_CHANNEL = 'dsh:stream-abort'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

interface PendingFetch {
  resolve(frame: Extract<ElectronIpcHostFrame, { t: 'fetch-res' }>): void
  reject(reason: Error): void
}

/** One connected desktop session: the IPC socket to the Host plus request bookkeeping. */
class HostConnection {
  private readonly socket: Socket
  private readonly reader = new ElectronIpcFrameReader()
  private readonly pendingFetches = new Map<string, PendingFetch>()
  private readonly bootWaiters: ((injections: readonly unknown[]) => void)[] = []
  private nextId = 0
  private window: BrowserWindow | undefined

  constructor(pipePath: string) {
    this.socket = createConnection(pipePath)
    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk: string) => { this.onData(chunk) })
    this.socket.on('error', (error) => { this.onDisconnected(error) })
    this.socket.on('close', () => { this.onDisconnected(new Error('electron-shell: the Host IPC socket closed')) })
  }

  attachWindow(window: BrowserWindow): void {
    this.window = window
  }

  private send(frame: ElectronIpcMainFrame): void {
    this.socket.write(encodeFrame(frame))
  }

  private mintId(): string {
    return String(this.nextId++)
  }

  async fetch(request: Request): Promise<Response> {
    const id = this.mintId()
    const body = request.body === null ? undefined : Buffer.from(await request.arrayBuffer()).toString('base64')
    const headers: Record<string, string> = {}
    for (const [key, value] of request.headers) headers[key] = value
    const settled = new Promise<Extract<ElectronIpcHostFrame, { t: 'fetch-res' }>>((resolveFetch, rejectFetch) => {
      this.pendingFetches.set(id, { resolve: resolveFetch, reject: rejectFetch })
    })
    this.send({
      t: 'fetch', id, method: request.method, url: request.url, headers,
      ...body === undefined ? {} : { body },
    })
    const frame = await settled
    return new Response(frame.body === undefined ? undefined : Buffer.from(frame.body, 'base64'), {
      status: frame.status,
      headers: frame.headers,
    })
  }

  async bootInjections(): Promise<readonly unknown[]> {
    const settled = new Promise<readonly unknown[]>((resolveBoot) => { this.bootWaiters.push(resolveBoot) })
    this.send({ t: 'boot-request' })
    return settled
  }

  openStream(id: string, endpoint: string, payload: unknown): void {
    this.send({ t: 'stream-open', id, endpoint, payload })
  }

  abortStream(id: string): void {
    this.send({ t: 'abort', id })
  }

  private onData(chunk: string): void {
    for (const value of this.reader.push(chunk)) {
      let frame: ElectronIpcHostFrame
      try {
        frame = parseHostFrame(value)
      } catch (error) {
        console.error('electron-shell: malformed Host frame', error)
        continue
      }
      this.dispatch(frame)
    }
  }

  private dispatch(frame: ElectronIpcHostFrame): void {
    switch (frame.t) {
      case 'fetch-res': {
        const pending = this.pendingFetches.get(frame.id)
        if (pending === undefined) return
        this.pendingFetches.delete(frame.id)
        pending.resolve(frame)
        return
      }
      case 'boot':
        this.bootWaiters.shift()?.(frame.injections)
        return
      case 'stream-item':
      case 'stream-end':
      case 'stream-error':
        this.window?.webContents.send(STREAM_FRAME_CHANNEL, frame)
        return
      /* v8 ignore next 2 -- closed-union exhaustiveness guard */
      default:
        return
    }
  }

  private onDisconnected(error: Error): void {
    for (const pending of this.pendingFetches.values()) pending.reject(error)
    this.pendingFetches.clear()
    console.error('electron-shell: lost the Host IPC connection', error)
    app.quit()
  }
}

function resolveEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`electron-shell: missing required environment variable ${name}`)
  }
  return value
}

/** Serve one static file from the dist root; traversal outside it is refused. */
async function serveStatic(distRoot: string, pathname: string): Promise<Response> {
  const target = resolve(normalize(join(distRoot, pathname)))
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    return new Response('forbidden', { status: 403 })
  }
  try {
    const body = await readFile(target)
    const contentType = MIME[extname(target)] ?? 'application/octet-stream'
    return new Response(body, { status: 200, headers: { 'content-type': contentType } })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response('not found', { status: 404 })
    throw error
  }
}

async function serveIndex(connection: HostConnection, distRoot: string): Promise<Response> {
  const raw = await readFile(join(distRoot, 'index.html'), 'utf8')
  const injections = await connection.bootInjections()
  const html = renderIndexInjections(raw, injections as IndexInjection[])
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

function createProtocolHandler(connection: HostConnection, distRoot: string): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/index.html') return serveIndex(connection, distRoot)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/plugins/')) return connection.fetch(request)
    return serveStatic(distRoot, url.pathname)
  }
}

function installStreamBridge(connection: HostConnection): void {
  ipcMain.on(STREAM_OPEN_CHANNEL, (_event: IpcMainEvent, message: { id: string; endpoint: string; payload: unknown }) => {
    connection.openStream(message.id, message.endpoint, message.payload)
  })
  ipcMain.on(STREAM_ABORT_CHANNEL, (_event: IpcMainEvent, message: { id: string }) => {
    connection.abortStream(message.id)
  })
}

async function createWindow(connection: HostConnection): Promise<void> {
  const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url))
  const window = new BrowserWindow({
    ...DESKTOP_WINDOW_CHROME,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  hideDesktopMenuBar(window)
  connection.attachWindow(window)
  window.on('closed', () => { app.quit() })
  await window.loadURL(`${SCHEME}://host/`)
}

/**
 * Connect the window to a Host. Source launches inherit the pipe and dist
 * from the parent `dsh` process. The installed exe is Electron, so it starts
 * the bundled Node `dsh` tree itself and reads the ready line from that child.
 * @returns the IPC connection, the frontend dist root, and the Host child when this process spawned it.
 */
async function connectHost(): Promise<{
  connection: HostConnection
  distRoot: string
  host: ChildProcess | undefined
}> {
  if (!app.isPackaged) {
    return {
      connection: new HostConnection(resolveEnv('DSH_ELECTRON_IPC_PIPE')),
      distRoot: resolveEnv('DSH_ELECTRON_DIST'),
      host: undefined,
    }
  }
  const layout = resolvePackagedLayout(process.resourcesPath)
  const host = spawn(layout.nodePath, [layout.dshBinPath, ...PACKAGED_HOST_ARGS], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const pipePath = await waitForIpcReady(host.stdout, 30_000)
  return {
    connection: new HostConnection(pipePath),
    distRoot: layout.distRoot,
    host,
  }
}

async function main(): Promise<void> {
  const { connection, distRoot, host } = await connectHost()
  if (host !== undefined) {
    let quitting = false
    const stopHost = (): void => {
      quitting = true
      host.kill()
    }
    app.on('before-quit', stopHost)
    host.on('exit', () => {
      if (!quitting) app.quit()
    })
  }
  installStreamBridge(connection)
  await app.whenReady()
  protocol.handle(SCHEME, createProtocolHandler(connection, distRoot))
  await createWindow(connection)
}

app.on('window-all-closed', () => { app.quit() })

void main().catch((error: unknown) => {
  console.error('electron-shell: fatal startup failure', error)
  app.exit(1)
})
