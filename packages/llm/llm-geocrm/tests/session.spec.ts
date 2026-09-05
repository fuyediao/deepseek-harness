import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACCESS_REFRESH_LEEWAY_MS,
  GeoCrmSessionError,
  jwtExpiryMs,
  refreshCredentialRef,
  refreshGeoCrmSession,
  resolveLiveSessionToken,
  shouldRefreshAccessToken,
} from '../src/session.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Build an unsigned JWT with the given payload.
 * @param payload - claims to encode.
 * @returns a compact JWT.
 */
function jwtWith(payload: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

const now = 1_700_000_000_000

describe('refreshCredentialRef', () => {
  it('rewrites a _TOKEN suffix and otherwise appends _REFRESH', () => {
    expect(refreshCredentialRef('GEOCRM_HARNESS_TOKEN')).toBe('GEOCRM_HARNESS_REFRESH')
    expect(refreshCredentialRef('CUSTOM')).toBe('CUSTOM_REFRESH')
  })
})

describe('jwtExpiryMs', () => {
  it('reads numeric exp and ignores opaque or malformed tokens', () => {
    expect(jwtExpiryMs(jwtWith({ exp: 1_700_000_100 }))).toBe(1_700_000_100_000)
    expect(jwtExpiryMs('opaque')).toBeUndefined()
    expect(jwtExpiryMs('a.@@@.c')).toBeUndefined()
    expect(jwtExpiryMs(jwtWith({}))).toBeUndefined()
    expect(jwtExpiryMs(jwtWith({ exp: '1' }))).toBeUndefined()
    expect(jwtExpiryMs(jwtWith([]))).toBeUndefined()
  })
})

describe('shouldRefreshAccessToken', () => {
  it('refreshes inside the leeway and leaves opaque tokens alone', () => {
    expect(shouldRefreshAccessToken('opaque', now)).toBe(false)
    expect(shouldRefreshAccessToken(jwtWith({ exp: (now + ACCESS_REFRESH_LEEWAY_MS + 1_000) / 1000 }), now))
      .toBe(false)
    expect(shouldRefreshAccessToken(jwtWith({ exp: (now + 60_000) / 1000 }), now)).toBe(true)
    expect(shouldRefreshAccessToken(jwtWith({ exp: (now - 1_000) / 1000 }), now)).toBe(true)
    expect(shouldRefreshAccessToken(jwtWith({ exp: (now + 1_000) / 1000 }))).toBe(true)
  })
})

describe('refreshGeoCrmSession', () => {
  it('returns the rotated pair and keeps a missing refresh token optional', async () => {
    const fetchMock = vi.fn((_input: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ access_token: 'next' })),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(refreshGeoCrmSession('http://127.0.0.1:3001/', 'old', new AbortController().signal))
      .resolves.toEqual({ accessToken: 'next' })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ access_token: 'next', refresh_token: 'rotated' })),
    })))
    await expect(refreshGeoCrmSession('http://127.0.0.1:3001', 'old'))
      .resolves.toEqual({ accessToken: 'next', refreshToken: 'rotated' })
  })

  it('refuses HTTP, non-JSON, and empty-access responses', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ error: 'Invalid refresh token' })),
    })))
    await expect(refreshGeoCrmSession('http://127.0.0.1:3001', 'old'))
      .rejects.toThrow('Invalid refresh token')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 401,
      text: () => Promise.resolve('nope'),
    })))
    await expect(refreshGeoCrmSession('http://127.0.0.1:3001', 'old'))
      .rejects.toThrow(/HTTP 401/)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('nope'),
    })))
    await expect(refreshGeoCrmSession('http://127.0.0.1:3001', 'old'))
      .rejects.toThrow(/non-JSON/)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ access_token: '' })),
    })))
    await expect(refreshGeoCrmSession('http://127.0.0.1:3001', 'old'))
      .rejects.toThrow(/no access token/)
  })
})

describe('resolveLiveSessionToken', () => {
  it('reads the store then the launch environment', async () => {
    await expect(resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
    })).resolves.toBeUndefined()

    const empty = {
      resolve: () => Promise.resolve({ value: '' }),
    }
    await expect(resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      store: empty,
      ambient: (ref) => ref === 'GEOCRM_HARNESS_TOKEN' ? 'env-jwt' : undefined,
    })).resolves.toBe('env-jwt')

    await expect(resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      store: { resolve: () => Promise.resolve(undefined) },
      ambient: () => '',
    })).resolves.toBeUndefined()

    await expect(resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      store: { resolve: () => Promise.resolve({ value: 'stored' }) },
    })).resolves.toBe('stored')
  })

  it('rotates a near-expiry JWT and persists both secrets', async () => {
    const values = new Map<string, string>([
      ['GEOCRM_HARNESS_TOKEN', jwtWith({ exp: (now + 30_000) / 1000 })],
      ['GEOCRM_HARNESS_REFRESH', 'old-refresh'],
    ])
    const next = jwtWith({ exp: (now + 3_600_000) / 1000 })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ access_token: next, refresh_token: 'rotated' })),
    })))
    const token = await resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      now,
      store: {
        resolve: (ref) => {
          const value = values.get(ref)
          return Promise.resolve(value === undefined ? undefined : { value })
        },
        set: (ref, value) => {
          values.set(ref, value)
          return Promise.resolve()
        },
      },
    })
    expect(token).toBe(next)
    expect(values.get('GEOCRM_HARNESS_TOKEN')).toBe(next)
    expect(values.get('GEOCRM_HARNESS_REFRESH')).toBe('rotated')
  })

  it('keeps the previous refresh token when GoTrue omits a new one', async () => {
    const values = new Map<string, string>([
      ['GEOCRM_HARNESS_TOKEN', jwtWith({ exp: (now + 30_000) / 1000 })],
      ['GEOCRM_HARNESS_REFRESH', 'old-refresh'],
    ])
    const next = jwtWith({ exp: (now + 3_600_000) / 1000 })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ access_token: next })),
    })))
    await resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      now,
      store: {
        resolve: (ref) => Promise.resolve({ value: values.get(ref)! }),
        set: (ref, value) => {
          values.set(ref, value)
          return Promise.resolve()
        },
      },
    })
    expect(values.get('GEOCRM_HARNESS_REFRESH')).toBe('old-refresh')
  })

  it('survives a refused persist and a missing set hook', async () => {
    const near = jwtWith({ exp: (now + 30_000) / 1000 })
    const next = jwtWith({ exp: (now + 3_600_000) / 1000 })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ access_token: next, refresh_token: 'rotated' })),
    })))
    await expect(resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      now,
      store: {
        resolve: (ref) => Promise.resolve({
          value: ref === 'GEOCRM_HARNESS_TOKEN' ? near : 'old-refresh',
        }),
        set: () => Promise.reject(new Error('env-locked')),
      },
    })).resolves.toBe(next)

    await expect(resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      now,
      store: {
        resolve: (ref) => Promise.resolve({
          value: ref === 'GEOCRM_HARNESS_TOKEN' ? near : 'old-refresh',
        }),
      },
    })).resolves.toBe(next)
  })

  it('returns the current access token when refresh fails before expiry', async () => {
    const near = jwtWith({ exp: (now + 30_000) / 1000 })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject('down')))
    await expect(resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      now,
      store: {
        resolve: (ref) => Promise.resolve({
          value: ref === 'GEOCRM_HARNESS_TOKEN' ? near : 'old-refresh',
        }),
      },
    })).resolves.toBe(near)
  })

  it('throws AUTH when an expired JWT cannot be refreshed', async () => {
    const expired = jwtWith({ exp: (now - 1_000) / 1000 })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ error: 'Invalid refresh token' })),
    })))
    await expect(resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      now,
      store: {
        resolve: (ref) => Promise.resolve({
          value: ref === 'GEOCRM_HARNESS_TOKEN' ? expired : 'old-refresh',
        }),
      },
    })).rejects.toBeInstanceOf(GeoCrmSessionError)
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject('down')))
    await expect(resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      now,
      store: {
        resolve: (ref) => Promise.resolve({
          value: ref === 'GEOCRM_HARNESS_TOKEN' ? expired : 'old-refresh',
        }),
      },
    })).rejects.toMatchObject({ code: 'AUTH', message: /sign in again/ })
  })

  it('single-flights overlapping refreshes and rereads after the lock', async () => {
    const expired = jwtWith({ exp: (now - 1_000) / 1000 })
    const next = jwtWith({ exp: (now + 3_600_000) / 1000 })
    const values = new Map<string, string>([
      ['GEOCRM_HARNESS_TOKEN', expired],
      ['GEOCRM_HARNESS_REFRESH', 'old-refresh'],
    ])
    let inflight = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      inflight += 1
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      return {
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ access_token: next, refresh_token: 'rotated' })),
      }
    }))
    const store = {
      resolve: (ref: string) => {
        const value = values.get(ref)
        return Promise.resolve(value === undefined ? undefined : { value })
      },
      set: (ref: string, value: string) => {
        values.set(ref, value)
        return Promise.resolve()
      },
    }
    const request = {
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      now,
      store,
    }
    const [first, second] = await Promise.all([
      resolveLiveSessionToken(request),
      resolveLiveSessionToken(request),
    ])
    expect(first).toBe(next)
    expect(second).toBe(next)
    expect(inflight).toBe(1)
  })

  it('returns undefined when the access token disappears under the lock', async () => {
    let reads = 0
    const near = jwtWith({ exp: (now + 30_000) / 1000 })
    await expect(resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      now,
      store: {
        resolve: (ref) => {
          reads += 1
          if (ref === 'GEOCRM_HARNESS_REFRESH') return Promise.resolve({ value: 'old-refresh' })
          if (reads <= 2) return Promise.resolve({ value: near })
          return Promise.resolve(undefined)
        },
      },
    })).resolves.toBeUndefined()
  })

  it('returns the current access token when the refresh token disappears under the lock', async () => {
    let refreshReads = 0
    const near = jwtWith({ exp: (now + 30_000) / 1000 })
    await expect(resolveLiveSessionToken({
      origin: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      now,
      store: {
        resolve: (ref) => {
          if (ref === 'GEOCRM_HARNESS_TOKEN') return Promise.resolve({ value: near })
          refreshReads += 1
          return Promise.resolve(refreshReads === 1 ? { value: 'old-refresh' } : undefined)
        },
      },
    })).resolves.toBe(near)
  })
})
