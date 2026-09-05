/**
 * GeoCRM Google sign-in for the desktop shell.
 * The system browser runs `GET {origin}/auth/google?next=http://127.0.0.1:{port}/`.
 * GeoCRM's `/auth/callback` bridge appends the implicit-flow fragment to that
 * loopback URL. A same-origin page reads the fragment (the HTTP server cannot)
 * and POSTs the tokens back. The shell never registers an OS protocol for this
 * return, so it does not steal `com.geocrm.electron://` from GeoCRM Electron.
 */

import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { GoogleSignInOutcome } from './google-sign-in-ipc.ts'

export type { GoogleSignInOutcome } from './google-sign-in-ipc.ts'
export { GOOGLE_SIGN_IN_CHANNEL } from './google-sign-in-ipc.ts'

/** How long the loopback server waits for the browser to return tokens. */
export const DEFAULT_GOOGLE_SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

/** Injected side effects so tests can drive the loopback without Electron. */
export interface GoogleSignInDeps {
  /**
   * Open the GeoCRM authorize URL in the system browser.
   * @param url - absolute `http(s)` authorize URL.
   */
  openExternal(url: string): Promise<void>
  /** Override the five-minute wait. */
  timeoutMs?: number
}

/**
 * Accept only a bare `http` or `https` origin from the renderer.
 * @param raw - value the sign-in form posted.
 * @returns the origin with no path, userinfo, or trailing slash.
 */
export function parseHttpOrigin(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('invalid_origin')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('invalid_origin')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('invalid_origin')
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('invalid_origin')
  }
  if (url.hostname.length === 0) {
    throw new Error('invalid_origin')
  }
  return url.origin
}

/**
 * Build GeoCRM `GET /auth/google` with a loopback `next`.
 * @param origin - validated GeoCRM API origin.
 * @param next - loopback URL that receives the fragment.
 * @returns the authorize URL opened in the system browser.
 */
export function googleAuthorizeUrl(origin: string, next: string): string {
  return `${origin}/auth/google?next=${encodeURIComponent(next)}`
}

/**
 * Create a one-time CSRF token for the loopback `next` query.
 * @returns 48 hex characters.
 */
export function mintOAuthState(): string {
  return randomBytes(24).toString('hex')
}

/**
 * Whether `Host` is this process's loopback listener.
 * @param host - raw `Host` header.
 * @param port - bound port.
 * @returns true only for `127.0.0.1` with that port (or the implicit default).
 */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (host === undefined) return false
  return host === `127.0.0.1:${String(port)}` || (port === 80 && host === '127.0.0.1')
}

/**
 * Page that forwards the implicit-flow fragment to `POST /complete`.
 * @param state - expected CSRF token.
 * @returns HTML the system browser loads after GeoCRM redirects.
 */
export function callbackLandingHtml(state: string): string {
  const stateJson = JSON.stringify(state)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Returning to GeoCRM Harness</title>
</head>
<body>
<p>Returning to GeoCRM Harness. You can close this tab.</p>
<script>
(function () {
  var params = new URLSearchParams(window.location.hash.slice(1));
  var query = new URLSearchParams(window.location.search);
  query.forEach(function (value, key) {
    if (!params.has(key)) params.set(key, value);
  });
  fetch("/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state: ${stateJson},
      access_token: params.get("access_token") || "",
      refresh_token: params.get("refresh_token") || "",
      error: params.get("error") || params.get("error_description") || ""
    })
  }).catch(function () {});
})();
</script>
</body>
</html>
`
}

/**
 * Run one Google sign-in: bind loopback, open the system browser, wait for tokens.
 * @param originRaw - GeoCRM API origin from the renderer.
 * @param deps - browser open and optional timeout.
 * @returns tokens or a stable error code (`invalid_origin`, `cancelled`,
 *   `unavailable` when the loopback cannot bind, `missing_token`,
 *   `invalid_state`). `in_progress` is owned by the IPC wrapper.
 */
export async function runGoogleSignIn(
  originRaw: unknown,
  deps: GoogleSignInDeps,
): Promise<GoogleSignInOutcome> {
  let origin: string
  try {
    origin = parseHttpOrigin(originRaw)
  } catch {
    return { ok: false, error: 'invalid_origin' }
  }

  const state = mintOAuthState()
  const timeoutMs = deps.timeoutMs ?? DEFAULT_GOOGLE_SIGN_IN_TIMEOUT_MS
  let settled = false
  let finish: (outcome: GoogleSignInOutcome) => void = () => {}
  const completed = new Promise<GoogleSignInOutcome>((resolve) => {
    finish = (outcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
  })

  // Bind the port once. Reading `server.address()` on each request throws
  // `unavailable` after `close()` starts, which is an uncaught main-process
  // exception (the browser still GETs `/` and POSTs `/complete`).
  let port = 0
  const server = createServer((request, response) => {
    try {
      handleLoopbackRequest(request, response, {
        state,
        port,
        complete: finish,
      })
    } catch {
      writeErrorResponse(response)
    }
  })

  try {
    try {
      port = await listenLoopback(server)
    } catch {
      return { ok: false, error: 'unavailable' }
    }
    const next = `http://127.0.0.1:${String(port)}/?state=${state}`
    try {
      await deps.openExternal(googleAuthorizeUrl(origin, next))
    } catch {
      // The OS may have opened the browser anyway; keep the loopback until
      // tokens arrive or the timeout fires.
    }
    const timer = setTimeout(() => {
      finish({ ok: false, error: 'cancelled' })
    }, timeoutMs)
    timer.unref()
    try {
      return await completed
    } finally {
      clearTimeout(timer)
    }
  } finally {
    await closeServer(server)
  }
}

/**
 * Bind `127.0.0.1:0` and return the assigned port.
 * @param server - idle HTTP server.
 * @returns the ephemeral port.
 */
export async function listenLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.listen(0, '127.0.0.1', onListening)
  })
  return loopbackPort(server)
}

function loopbackPort(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('unavailable')
  }
  return address.port
}

/**
 * Close a loopback response after an unexpected handler failure.
 * @param response - the in-flight ServerResponse.
 */
function writeErrorResponse(response: ServerResponse): void {
  if (response.writableEnded) return
  try {
    if (!response.headersSent) response.writeHead(500)
    response.end()
  } catch {
    // The socket is already gone; nothing else can write this response.
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => { resolve() })
    // close() is a no-op when listen never succeeded.
    if (!server.listening) resolve()
  })
}

interface LoopbackComplete {
  readonly state: string
  readonly port: number
  complete(outcome: GoogleSignInOutcome): void
}

function handleLoopbackRequest(
  request: IncomingMessage,
  response: ServerResponse,
  session: LoopbackComplete,
): void {
  if (!isLoopbackHost(request.headers.host, session.port)) {
    response.writeHead(403)
    response.end()
    return
  }
  const path = request.url === undefined ? '/' : (request.url.split('?')[0] ?? '/')
  if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(callbackLandingHtml(session.state))
    return
  }
  if (request.method === 'GET' && path === '/favicon.ico') {
    response.writeHead(204)
    response.end()
    return
  }
  if (request.method === 'POST' && path === '/complete') {
    void settleFromComplete(request, response, session)
    return
  }
  response.writeHead(404)
  response.end()
}

async function settleFromComplete(
  request: IncomingMessage,
  response: ServerResponse,
  session: LoopbackComplete,
): Promise<void> {
  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch {
    response.writeHead(400)
    response.end()
    session.complete({ ok: false, error: 'missing_token' })
    return
  }
  const parsed = parseCompleteBody(body)
  if (parsed.state !== session.state) {
    response.writeHead(403)
    response.end()
    session.complete({ ok: false, error: 'invalid_state' })
    return
  }
  response.writeHead(204)
  response.end()
  if (parsed.error.length > 0) {
    session.complete({
      ok: false,
      error: parsed.error === 'access_denied' ? 'cancelled' : parsed.error,
    })
    return
  }
  if (parsed.accessToken.length === 0) {
    session.complete({ ok: false, error: 'missing_token' })
    return
  }
  session.complete({
    ok: true,
    accessToken: parsed.accessToken,
    ...parsed.refreshToken.length > 0 ? { refreshToken: parsed.refreshToken } : {},
  })
}

function parseCompleteBody(body: unknown): {
  state: string
  accessToken: string
  refreshToken: string
  error: string
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { state: '', accessToken: '', refreshToken: '', error: '' }
  }
  const record = body as Record<string, unknown>
  return {
    state: typeof record.state === 'string' ? record.state : '',
    accessToken: typeof record.access_token === 'string' ? record.access_token : '',
    refreshToken: typeof record.refresh_token === 'string' ? record.refresh_token : '',
    error: typeof record.error === 'string' ? record.error : '',
  }
}

/**
 * Read `origin` from the renderer invoke payload.
 * @param payload - `{ origin }` from preload, or anything else.
 * @returns the raw origin value, or `undefined`.
 */
export function originFromIpcPayload(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  return (payload as { origin?: unknown }).origin
}

/**
 * Serialize Google sign-in so a second click cannot start another loopback.
 * @returns a `run` that returns `in_progress` while one attempt is open.
 */
export function createGoogleSignInLock(): {
  /**
   * Run one attempt, or refuse if another is already open.
   * @param originRaw - GeoCRM API origin from the renderer.
   * @param deps - browser open and optional timeout.
   * @returns tokens or an error code.
   */
  run(originRaw: unknown, deps: GoogleSignInDeps): Promise<GoogleSignInOutcome>
} {
  let pending: Promise<GoogleSignInOutcome> | undefined
  return {
    async run(originRaw, deps) {
      if (pending !== undefined) return { ok: false, error: 'in_progress' }
      const next = runGoogleSignIn(originRaw, deps)
      pending = next
      try {
        return await next
      } finally {
        pending = undefined
      }
    },
  }
}

async function readJsonBody(request: IncomingMessage, limit = 16_384): Promise<unknown> {
  const raw = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buffer.length
      if (size > limit) {
        request.destroy()
        reject(new Error('too_large'))
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    request.on('error', reject)
  })
  return JSON.parse(raw) as unknown
}
