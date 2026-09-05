import { request as httpRequest } from 'node:http'
import { describe, expect, it } from 'vitest'

/**
 * Wait until `openExternal` recorded the authorize URL.
 * @param opened - captured URLs.
 * @returns the first authorize URL.
 */
async function waitForOpened(opened: string[]): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const url = opened[0]
    if (url !== undefined) return url
    await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
  }
  throw new Error('openExternal was never called')
}
import {
  callbackLandingHtml,
  createGoogleSignInLock,
  googleAuthorizeUrl,
  isLoopbackHost,
  mintOAuthState,
  originFromIpcPayload,
  parseHttpOrigin,
  runGoogleSignIn,
  type GoogleSignInOutcome,
} from '../src/google-sign-in.ts'

/**
 * Wait until `openExternal` recorded the authorize URL, then POST `/complete`.
 * @param origin - GeoCRM API origin.
 * @param body - complete payload; `state` defaults to the loopback query.
 * @returns the sign-in outcome and captured authorize URLs.
 */
async function completeGoogleSignIn(
  origin: string,
  body: Record<string, unknown>,
): Promise<{ outcome: GoogleSignInOutcome; landing: URL }> {
  const opened: string[] = []
  const pending = runGoogleSignIn(origin, {
    openExternal: async (url) => { opened.push(url) },
    timeoutMs: 5_000,
  })
  const authorize = await waitForOpened(opened)
  const next = new URL(authorize).searchParams.get('next')
  expect(next).toBeTruthy()
  const landing = new URL(next as string)
  const payload = {
    ...body,
    ...body.state === undefined ? { state: landing.searchParams.get('state') } : {},
  }
  await fetch(new URL('/complete', landing), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { outcome: await pending, landing }
}

/**
 * Issue a GET with a spoofed `Host` header.
 * @param url - loopback URL.
 * @param host - `Host` header value.
 * @returns HTTP status.
 */
async function getWithHost(url: URL, host: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { Host: host },
    }, (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

describe('parseHttpOrigin', () => {
  it('keeps a bare http(s) origin and rejects everything else', () => {
    expect(parseHttpOrigin('https://api.example.com/auth/')).toBe('https://api.example.com')
    expect(parseHttpOrigin('http://127.0.0.1:3001')).toBe('http://127.0.0.1:3001')
    expect(() => parseHttpOrigin('')).toThrow('invalid_origin')
    expect(() => parseHttpOrigin(1)).toThrow('invalid_origin')
    expect(() => parseHttpOrigin('not-a-url')).toThrow('invalid_origin')
    expect(() => parseHttpOrigin('file:///tmp')).toThrow('invalid_origin')
    expect(() => parseHttpOrigin('http://user:pass@example.com')).toThrow('invalid_origin')
  })
})

describe('googleAuthorizeUrl', () => {
  it('puts the loopback next on GET /auth/google', () => {
    expect(googleAuthorizeUrl('http://127.0.0.1:3001', 'http://127.0.0.1:9/?state=ab'))
      .toBe('http://127.0.0.1:3001/auth/google?next=http%3A%2F%2F127.0.0.1%3A9%2F%3Fstate%3Dab')
  })
})

describe('mintOAuthState', () => {
  it('returns 48 hex characters', () => {
    const state = mintOAuthState()
    expect(state).toMatch(/^[0-9a-f]{48}$/u)
    expect(mintOAuthState()).not.toBe(state)
  })
})

describe('isLoopbackHost', () => {
  it('accepts only this process 127.0.0.1 listener', () => {
    expect(isLoopbackHost('127.0.0.1:4242', 4242)).toBe(true)
    expect(isLoopbackHost('127.0.0.1', 80)).toBe(true)
    expect(isLoopbackHost('127.0.0.1', 4242)).toBe(false)
    expect(isLoopbackHost('localhost:4242', 4242)).toBe(false)
    expect(isLoopbackHost('evil.example:4242', 4242)).toBe(false)
    expect(isLoopbackHost(undefined, 4242)).toBe(false)
  })
})

describe('callbackLandingHtml', () => {
  it('embeds the CSRF state and posts /complete', () => {
    const html = callbackLandingHtml('abc123')
    expect(html).toContain('"abc123"')
    expect(html).toContain('/complete')
    expect(html).toContain('access_token')
  })
})

describe('originFromIpcPayload', () => {
  it('reads origin from an object payload', () => {
    expect(originFromIpcPayload({ origin: 'http://127.0.0.1:3001' })).toBe('http://127.0.0.1:3001')
    expect(originFromIpcPayload({})).toBeUndefined()
    expect(originFromIpcPayload(null)).toBeUndefined()
    expect(originFromIpcPayload(['http://127.0.0.1:3001'])).toBeUndefined()
    expect(originFromIpcPayload('http://127.0.0.1:3001')).toBeUndefined()
  })
})

describe('runGoogleSignIn', () => {
  it('returns tokens posted by the loopback page', async () => {
    const { outcome, landing } = await completeGoogleSignIn('http://127.0.0.1:3001', {
      access_token: 'jwt',
      refresh_token: 'refresh',
    })
    expect(outcome).toEqual({ ok: true, accessToken: 'jwt', refreshToken: 'refresh' })
    expect(landing.hostname).toBe('127.0.0.1')
  })

  it('omits an empty refresh token', async () => {
    const { outcome } = await completeGoogleSignIn('https://api.example.com', {
      access_token: 'jwt',
      refresh_token: '',
    })
    expect(outcome).toEqual({ ok: true, accessToken: 'jwt' })
  })

  it('maps access_denied to cancelled and other OAuth errors through', async () => {
    await expect(completeGoogleSignIn('http://127.0.0.1:3001', { error: 'access_denied' }))
      .resolves.toMatchObject({ outcome: { ok: false, error: 'cancelled' } })
    await expect(completeGoogleSignIn('http://127.0.0.1:3001', { error: 'server_error' }))
      .resolves.toMatchObject({ outcome: { ok: false, error: 'server_error' } })
  })

  it('refuses a missing access token or a wrong state', async () => {
    await expect(completeGoogleSignIn('http://127.0.0.1:3001', { access_token: '' }))
      .resolves.toMatchObject({ outcome: { ok: false, error: 'missing_token' } })
    await expect(completeGoogleSignIn('http://127.0.0.1:3001', {
      state: 'nope',
      access_token: 'jwt',
    })).resolves.toMatchObject({ outcome: { ok: false, error: 'invalid_state' } })
  })

  it('refuses a non-http origin without opening a browser', async () => {
    const opened: string[] = []
    await expect(runGoogleSignIn('file:///tmp', {
      openExternal: async (url) => { opened.push(url) },
    })).resolves.toEqual({ ok: false, error: 'invalid_origin' })
    expect(opened).toEqual([])
  })

  it('returns unavailable when the system browser cannot open', async () => {
    await expect(runGoogleSignIn('http://127.0.0.1:3001', {
      openExternal: async () => { throw new Error('blocked') },
      timeoutMs: 5_000,
    })).resolves.toEqual({ ok: false, error: 'unavailable' })
  })

  it('returns cancelled when the browser never comes back', async () => {
    await expect(runGoogleSignIn('http://127.0.0.1:3001', {
      openExternal: async () => {},
      timeoutMs: 20,
    })).resolves.toEqual({ ok: false, error: 'cancelled' })
  })

  it('serves the landing page and rejects a spoofed Host', async () => {
    const opened: string[] = []
    const pending = runGoogleSignIn('http://127.0.0.1:3001', {
      openExternal: async (url) => { opened.push(url) },
      timeoutMs: 5_000,
    })
    const authorize = await waitForOpened(opened)
    const landing = new URL(new URL(authorize).searchParams.get('next') as string)
    const html = await (await fetch(landing)).text()
    expect(html).toContain('Returning to GeoCRM Harness')
    expect(await (await fetch(new URL('/favicon.ico', landing))).status).toBe(204)
    expect(await (await fetch(new URL('/missing', landing))).status).toBe(404)
    expect(await getWithHost(landing, 'evil.example:1')).toBe(403)
    await fetch(new URL('/complete', landing), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    await expect(pending).resolves.toEqual({ ok: false, error: 'missing_token' })
  })

  it('rejects a complete body that is not an object', async () => {
    const opened: string[] = []
    const pending = runGoogleSignIn('http://127.0.0.1:3001', {
      openExternal: async (url) => { opened.push(url) },
      timeoutMs: 5_000,
    })
    const authorize = await waitForOpened(opened)
    const landing = new URL(new URL(authorize).searchParams.get('next') as string)
    await fetch(new URL('/complete', landing), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[]',
    })
    await expect(pending).resolves.toEqual({ ok: false, error: 'invalid_state' })
  })
})

describe('createGoogleSignInLock', () => {
  it('refuses a second attempt while the first loopback is open', async () => {
    const lock = createGoogleSignInLock()
    const first = lock.run('http://127.0.0.1:3001', {
      openExternal: async () => {},
      timeoutMs: 200,
    })
    await expect(lock.run('http://127.0.0.1:3001', {
      openExternal: async () => {},
      timeoutMs: 200,
    })).resolves.toEqual({ ok: false, error: 'in_progress' })
    await expect(first).resolves.toEqual({ ok: false, error: 'cancelled' })
  })
})
