/**
 * Line-delimited JSON frame protocol for the Electron desktop shell's IPC
 * socket: the transport between the Node Host process (holding
 * `ctx.connection` and `ctx.clientModules`, with no listening `webServer`)
 * and the Electron main process, which relays decoded frames to the
 * sandboxed renderer's `window.__DSH_TRANSPORT__` through its own
 * `contextBridge`/`ipcRenderer` channel. Binary bytes (fetch bodies, plugin
 * bundle bytes) travel as base64 strings inside each JSON frame; the socket
 * itself carries UTF-8 text, one frame per `\n`-terminated line.
 *
 * The two directions do not share a frame set: the main process only ever
 * sends {@link ElectronIpcMainFrame} and only ever receives {@link
 * ElectronIpcHostFrame}, matching who is entitled to mint `id` (whoever
 * opens a request or stream mints; the other side only ever echoes it).
 * @module @deepseek-ai/dsh-electron-ipc
 */

/** Request or logical-stream identifier minted by the Electron main process. */
export type ElectronIpcRequestId = string

/** One unary fetch request, sent by the Electron main process. */
export interface ElectronIpcFetchRequestFrame {
  readonly t: 'fetch'
  readonly id: ElectronIpcRequestId
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  /** Base64-encoded request body, absent for bodyless methods. */
  readonly body?: string
}

/** Open one logical Gateway Remote stream, sent by the Electron main process. */
export interface ElectronIpcStreamOpenFrame {
  readonly t: 'stream-open'
  readonly id: ElectronIpcRequestId
  readonly endpoint: string
  readonly payload: unknown
}

/** Cancel an in-flight fetch request or open stream, sent by the Electron main process. */
export interface ElectronIpcAbortFrame {
  readonly t: 'abort'
  readonly id: ElectronIpcRequestId
}

/**
 * One-shot request for the current index-document injection rows, sent by
 * the Electron main process right after it connects. There is exactly one
 * outstanding request per connection, so it carries no id.
 */
export interface ElectronIpcBootRequestFrame {
  readonly t: 'boot-request'
}

/** Every frame the Host accepts from the Electron main process. */
export type ElectronIpcMainFrame =
  | ElectronIpcFetchRequestFrame
  | ElectronIpcStreamOpenFrame
  | ElectronIpcAbortFrame
  | ElectronIpcBootRequestFrame

/** Complete unary response, sent by the Host. */
export interface ElectronIpcFetchResponseFrame {
  readonly t: 'fetch-res'
  readonly id: ElectronIpcRequestId
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  /** Base64-encoded response body, absent for empty bodies. */
  readonly body?: string
}

/** One decoded value from an open Gateway Remote stream, sent by the Host. */
export interface ElectronIpcStreamItemFrame {
  readonly t: 'stream-item'
  readonly id: ElectronIpcRequestId
  readonly value?: unknown
}

/** Normal completion of an open Gateway Remote stream, sent by the Host. */
export interface ElectronIpcStreamEndFrame {
  readonly t: 'stream-end'
  readonly id: ElectronIpcRequestId
}

/** Stable Host failure or transport failure for one open stream, sent by the Host. */
export interface ElectronIpcStreamErrorFrame {
  readonly t: 'stream-error'
  readonly id: ElectronIpcRequestId
  readonly failure:
    | { readonly kind: 'remote'; readonly code: string; readonly message: string; readonly details: object }
    | { readonly kind: 'carrier'; readonly message: string }
}

/**
 * Answer to {@link ElectronIpcBootRequestFrame}: the current
 * `webserver/index-inject` row table, opaque to this protocol (its concrete
 * `IndexInjection` shape lives in `@deepseek-ai/dsh-host-webserver`, which
 * this zero-dependency package does not import). The Electron main process
 * renders it into the served `index.html` with that package's
 * `renderIndexInjections`.
 */
export interface ElectronIpcBootFrame {
  readonly t: 'boot'
  readonly injections: readonly unknown[]
}

/** Every frame the Electron main process accepts from the Host. */
export type ElectronIpcHostFrame =
  | ElectronIpcFetchResponseFrame
  | ElectronIpcStreamItemFrame
  | ElectronIpcStreamEndFrame
  | ElectronIpcStreamErrorFrame
  | ElectronIpcBootFrame

/**
 * Serialize one frame as a single `\n`-terminated JSON line.
 * @param frame - the frame to send.
 * @returns UTF-8 text ready to write to the socket.
 */
export function encodeFrame(frame: ElectronIpcMainFrame | ElectronIpcHostFrame): string {
  return `${JSON.stringify(frame)}\n`
}

/**
 * Buffers raw socket chunks and yields complete `\n`-terminated lines as
 * parsed JSON values. Validation of the parsed shape is the caller's job
 * ({@link parseMainFrame} / {@link parseHostFrame}); this class owns only the
 * byte-to-line-to-JSON split, so partial writes across chunk boundaries never
 * lose or merge a frame.
 */
export class ElectronIpcFrameReader {
  private buffered = ''

  /**
   * Feed one socket chunk and return every complete line it completed, as
   * parsed JSON values.
   * @param chunk - raw bytes or text read from the socket.
   * @returns parsed values, oldest first; empty when no line completed yet.
   * @throws {SyntaxError} when a completed line is not valid JSON.
   */
  push(chunk: string | Buffer): unknown[] {
    this.buffered += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const values: unknown[] = []
    let newlineIndex = this.buffered.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = this.buffered.slice(0, newlineIndex)
      this.buffered = this.buffered.slice(newlineIndex + 1)
      if (line.length > 0) values.push(JSON.parse(line))
      newlineIndex = this.buffered.indexOf('\n')
    }
    return values
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireId(frame: Record<string, unknown>, context: string): ElectronIpcRequestId {
  if (typeof frame.id !== 'string' || frame.id === '') {
    throw new Error(`electron-ipc: ${context} needs a non-empty string id`)
  }
  return frame.id
}

function requireHeaders(frame: Record<string, unknown>, context: string): Record<string, string> {
  if (!isRecord(frame.headers)) throw new Error(`electron-ipc: ${context} needs a headers object`)
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(frame.headers)) {
    if (typeof value === 'string') headers[key.toLowerCase()] = value
  }
  return headers
}

function requireOptionalBody(frame: Record<string, unknown>, context: string): string | undefined {
  const body = frame.body
  if (body === undefined) return undefined
  if (typeof body !== 'string') throw new Error(`electron-ipc: ${context} body must be a base64 string`)
  return body
}

/**
 * Validate a parsed JSON value as one frame the Host accepts.
 * @param value - a value produced by {@link ElectronIpcFrameReader.push}.
 * @returns the validated frame.
 * @throws {Error} when the value is not a well-formed {@link ElectronIpcMainFrame}.
 */
export function parseMainFrame(value: unknown): ElectronIpcMainFrame {
  if (!isRecord(value)) throw new Error(`electron-ipc: frame is not an object: ${String(value)}`)
  if (value.t === 'boot-request') return { t: 'boot-request' }
  const id = requireId(value, `${String(value.t)} frame`)
  switch (value.t) {
    case 'abort':
      return { t: 'abort', id }
    case 'stream-open':
      if (typeof value.endpoint !== 'string' || value.endpoint === '') {
        throw new Error(`electron-ipc: stream-open ${id} needs a non-empty endpoint`)
      }
      return { t: 'stream-open', id, endpoint: value.endpoint, payload: value.payload }
    case 'fetch': {
      if (typeof value.method !== 'string' || typeof value.url !== 'string') {
        throw new Error(`electron-ipc: fetch ${id} needs string method and url`)
      }
      const body = requireOptionalBody(value, `fetch ${id}`)
      return {
        t: 'fetch',
        id,
        method: value.method,
        url: value.url,
        headers: requireHeaders(value, `fetch ${id}`),
        ...body === undefined ? {} : { body },
      }
    }
    default:
      throw new Error(`electron-ipc: unknown frame type ${JSON.stringify(value.t)}`)
  }
}

/**
 * Validate a parsed JSON value as one frame the Electron main process accepts.
 * @param value - a value produced by {@link ElectronIpcFrameReader.push}.
 * @returns the validated frame.
 * @throws {Error} when the value is not a well-formed {@link ElectronIpcHostFrame}.
 */
export function parseHostFrame(value: unknown): ElectronIpcHostFrame {
  if (!isRecord(value)) throw new Error(`electron-ipc: frame is not an object: ${String(value)}`)
  if (value.t === 'boot') {
    if (!Array.isArray(value.injections)) throw new Error('electron-ipc: boot frame needs an injections array')
    return { t: 'boot', injections: value.injections }
  }
  const id = requireId(value, `${String(value.t)} frame`)
  switch (value.t) {
    case 'stream-item':
      return { t: 'stream-item', id, ...value.value === undefined ? {} : { value: value.value } }
    case 'stream-end':
      return { t: 'stream-end', id }
    case 'stream-error': {
      const failure = value.failure
      if (!isRecord(failure)) throw new Error(`electron-ipc: stream-error ${id} needs a failure object`)
      if (failure.kind === 'remote') {
        if (typeof failure.code !== 'string' || typeof failure.message !== 'string' || !isRecord(failure.details)) {
          throw new Error(`electron-ipc: stream-error ${id} remote failure needs code, message, and details`)
        }
        return { t: 'stream-error', id, failure: { kind: 'remote', code: failure.code, message: failure.message, details: failure.details } }
      }
      if (failure.kind === 'carrier') {
        if (typeof failure.message !== 'string') {
          throw new Error(`electron-ipc: stream-error ${id} carrier failure needs a message`)
        }
        return { t: 'stream-error', id, failure: { kind: 'carrier', message: failure.message } }
      }
      throw new Error(`electron-ipc: stream-error ${id} has an unknown failure kind ${JSON.stringify(failure.kind)}`)
    }
    case 'fetch-res': {
      if (typeof value.status !== 'number') throw new Error(`electron-ipc: fetch-res ${id} needs a numeric status`)
      const body = requireOptionalBody(value, `fetch-res ${id}`)
      return {
        t: 'fetch-res',
        id,
        status: value.status,
        headers: requireHeaders(value, `fetch-res ${id}`),
        ...body === undefined ? {} : { body },
      }
    }
    default:
      throw new Error(`electron-ipc: unknown frame type ${JSON.stringify(value.t)}`)
  }
}
