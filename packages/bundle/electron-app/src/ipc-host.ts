/**
 * Host half of the Electron desktop shell's IPC socket. `ElectronIpcHost`
 * owns the listener, accepts exactly one connection (the spawned Electron
 * main process; a second concurrent connection attempt is refused), and
 * dispatches every {@link ElectronIpcMainFrame} against the Connection fetch
 * handler, the client-modules bundle-resource lookup, and the Typert
 * Gateway's logical-stream driver — the same three seams the served Web
 * surface uses, carried over a socket instead of `ctx.webServer`.
 * @module @deepseek-ai/dsh-electron-app/ipc-host
 */

import { randomBytes } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ElectronIpcFrameReader,
  encodeFrame,
  parseMainFrame,
  type ElectronIpcFetchRequestFrame,
  type ElectronIpcHostFrame,
  type ElectronIpcMainFrame,
} from '@deepseek-ai/dsh-electron-ipc'

/** The `/plugins`/`/api` fetch surface this Host relays over the socket. */
export interface ElectronFetchHandler {
  fetch(request: Request): Promise<Response>
}

/** The `/plugins`-relative bundle-resource lookup this Host relays over the socket. */
export interface ElectronBundleResources {
  resolveResource(resourceUrl: string): { body: Buffer; contentType: string } | undefined
}

/** The Typert Gateway's carrier-independent logical-stream driver. */
export interface ElectronStreamGateway {
  wireStream: {
    open(endpoint: string, payload: unknown, signal: AbortSignal): Promise<AsyncIterable<unknown>>
    failure(error: unknown): { code: string; message: string; details: object }
  }
}

/** Dependencies {@link ElectronIpcHost} dispatches every frame against. */
export interface ElectronIpcHostDeps {
  /** Answers `/api/*` fetch frames; `connection.createSharedFetchHandler('/api')`. */
  readonly fetchHandler: ElectronFetchHandler
  /** Answers `/plugins/*` fetch frames directly, with no HTTP round trip. */
  readonly clientModules: ElectronBundleResources
  /** Answers `boot-request` frames with the current index-injection rows. */
  readonly collectIndexInjections: () => readonly unknown[]
  /** Drives `stream-open` frames; absent when no Gateway is mounted. */
  readonly streamGateway: ElectronStreamGateway | undefined
}

/**
 * A fresh, collision-resistant IPC endpoint path for this process.
 * @returns a Windows named-pipe path, or a POSIX socket file path under the system temp directory.
 */
export function resolveDefaultPipePath(): string {
  const token = randomBytes(8).toString('hex')
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\dsh-electron-${String(process.pid)}-${token}`
    : join(tmpdir(), `dsh-electron-${String(process.pid)}-${token}.sock`)
}

/** Answer one `fetch` frame from `/plugins/*` bundle resources or the Connection fetch handler. */
async function dispatchFetch(
  deps: Pick<ElectronIpcHostDeps, 'fetchHandler' | 'clientModules'>,
  frame: ElectronIpcFetchRequestFrame,
): Promise<Extract<ElectronIpcHostFrame, { t: 'fetch-res' }>> {
  const url = new URL(frame.url, 'http://dsh.internal')
  if (url.pathname.startsWith('/plugins/')) {
    const resource = deps.clientModules.resolveResource(`${url.pathname}${url.search}`)
    if (resource === undefined) return { t: 'fetch-res', id: frame.id, status: 404, headers: {} }
    return {
      t: 'fetch-res',
      id: frame.id,
      status: 200,
      headers: { 'content-type': resource.contentType },
      body: resource.body.toString('base64'),
    }
  }
  const request = new Request(url, {
    method: frame.method,
    headers: frame.headers,
    ...frame.body === undefined ? {} : { body: Buffer.from(frame.body, 'base64') },
  })
  const response = await deps.fetchHandler.fetch(request)
  const headers: Record<string, string> = {}
  for (const [key, value] of response.headers) headers[key] = value
  const bytes = Buffer.from(await response.arrayBuffer())
  return {
    t: 'fetch-res',
    id: frame.id,
    status: response.status,
    headers,
    ...bytes.byteLength === 0 ? {} : { body: bytes.toString('base64') },
  }
}

/** Drive one `stream-open` frame end to end, forwarding item/end/error frames as they occur. */
async function driveStream(
  gateway: ElectronStreamGateway,
  send: (frame: ElectronIpcHostFrame) => void,
  id: string,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<void> {
  try {
    const stream = await gateway.wireStream.open(endpoint, payload, signal)
    for await (const value of stream) {
      if (signal.aborted) return
      send({ t: 'stream-item', id, ...value === undefined ? {} : { value } })
    }
    if (!signal.aborted) send({ t: 'stream-end', id })
  } catch (error) {
    if (signal.aborted) return
    const failure = gateway.wireStream.failure(error)
    send({ t: 'stream-error', id, failure: { kind: 'remote', code: failure.code, message: failure.message, details: failure.details } })
  }
}

/**
 * The Electron desktop shell's IPC listener: one socket server accepting
 * exactly one connection, dispatching {@link ElectronIpcMainFrame}s against
 * {@link ElectronIpcHostDeps} and writing {@link ElectronIpcHostFrame}
 * responses back.
 */
export class ElectronIpcHost {
  /** The endpoint path Electron's main process connects to. */
  readonly pipePath: string

  private readonly server: Server
  private readonly reader = new ElectronIpcFrameReader()
  private readonly aborters = new Map<string, AbortController>()
  private socket: Socket | undefined

  constructor(private readonly deps: ElectronIpcHostDeps, pipePath: string = resolveDefaultPipePath()) {
    this.pipePath = pipePath
    this.server = createServer((socket) => { this.onConnection(socket) })
  }

  /** Start listening. Resolves once the endpoint is bound. */
  listen(): Promise<void> {
    return new Promise((resolveListen, rejectListen) => {
      const onError = (error: Error): void => { rejectListen(error) }
      this.server.once('error', onError)
      this.server.listen(this.pipePath, () => {
        this.server.off('error', onError)
        resolveListen()
      })
    })
  }

  /** Abort every open stream, close the connection and listener, and remove a POSIX socket file. */
  async dispose(): Promise<void> {
    for (const controller of this.aborters.values()) controller.abort()
    this.aborters.clear()
    this.socket?.destroy()
    await new Promise<void>((resolveClose) => { this.server.close(() => { resolveClose() }) })
    if (process.platform !== 'win32') {
      await unlink(this.pipePath).catch(() => {
        // Best-effort cleanup: a socket file that was never created, or
        // already removed by another cleanup path, leaves nothing to unlink.
      })
    }
  }

  private onConnection(socket: Socket): void {
    if (this.socket !== undefined) {
      socket.destroy()
      return
    }
    this.socket = socket
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { this.onData(chunk) })
    socket.on('close', () => {
      if (this.socket === socket) this.socket = undefined
    })
  }

  private send(frame: ElectronIpcHostFrame): void {
    this.socket?.write(encodeFrame(frame))
  }

  private onData(chunk: string): void {
    for (const value of this.reader.push(chunk)) {
      let frame: ElectronIpcMainFrame
      try {
        frame = parseMainFrame(value)
      } catch (error) {
        console.error('electron-app: malformed frame from the Electron main process', error)
        continue
      }
      this.dispatch(frame)
    }
  }

  private dispatch(frame: ElectronIpcMainFrame): void {
    switch (frame.t) {
      case 'boot-request':
        this.send({ t: 'boot', injections: this.deps.collectIndexInjections() })
        return
      case 'abort':
        this.aborters.get(frame.id)?.abort()
        this.aborters.delete(frame.id)
        return
      case 'fetch':
        void dispatchFetch(this.deps, frame)
          .then(response => { this.send(response) })
          .catch((error: unknown) => {
            this.send({
              t: 'fetch-res',
              id: frame.id,
              status: 500,
              headers: {},
              body: Buffer.from(error instanceof Error ? error.message : String(error)).toString('base64'),
            })
          })
        return
      case 'stream-open': {
        const gateway = this.deps.streamGateway
        if (gateway === undefined) {
          this.send({
            t: 'stream-error',
            id: frame.id,
            failure: { kind: 'carrier', message: 'electron-app: no Typert Gateway is mounted' },
          })
          return
        }
        const controller = new AbortController()
        this.aborters.set(frame.id, controller)
        void driveStream(gateway, sent => { this.send(sent) }, frame.id, frame.endpoint, frame.payload, controller.signal)
          .finally(() => { this.aborters.delete(frame.id) })
      }
    }
  }
}
