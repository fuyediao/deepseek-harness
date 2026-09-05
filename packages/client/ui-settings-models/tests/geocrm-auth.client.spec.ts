// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EMPLOYEE_ID_PATTERN,
  GEOCRM_DEFAULT_ORIGIN,
  normalizeEmployeeId,
  normalizeGeoCrmOrigin,
  parsePublicError,
  resolveCardOrigin,
  probeAccess,
  refreshCredentialRef,
  resolveEmployeeEmail,
  signInWithPassword,
  emailFromAccessToken,
  fetchSessionEmail,
} from '../src/client/geocrm-auth.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('normalizeEmployeeId', () => {
  it('pads a digit suffix to PS####', () => {
    expect(normalizeEmployeeId('1')).toBe('PS0001')
    expect(normalizeEmployeeId('ps12')).toBe('PS0012')
    expect(normalizeEmployeeId('PS0001')).toBe('PS0001')
    expect(normalizeEmployeeId('0001')).toBe('PS0001')
    expect(normalizeEmployeeId('')).toBe('')
    expect(normalizeEmployeeId('0')).toBe('PS0000')
    expect(EMPLOYEE_ID_PATTERN.test('PS0001')).toBe(true)
  })
})

describe('refreshCredentialRef', () => {
  it('rewrites a _TOKEN suffix and otherwise appends _REFRESH', () => {
    expect(refreshCredentialRef('GEOCRM_HARNESS_TOKEN')).toBe('GEOCRM_HARNESS_REFRESH')
    expect(refreshCredentialRef('CUSTOM')).toBe('CUSTOM_REFRESH')
  })
})

describe('resolveCardOrigin', () => {
  it('prefers a non-local composition origin over the card field', () => {
    expect(resolveCardOrigin('https://api.vps.example', 'http://127.0.0.1:3001'))
      .toBe('https://api.vps.example')
    expect(resolveCardOrigin(GEOCRM_DEFAULT_ORIGIN, 'http://127.0.0.1:4000'))
      .toBe('http://127.0.0.1:4000')
    expect(resolveCardOrigin(undefined, undefined)).toBe(GEOCRM_DEFAULT_ORIGIN)
    expect(resolveCardOrigin('', '')).toBe(GEOCRM_DEFAULT_ORIGIN)
    expect(resolveCardOrigin(GEOCRM_DEFAULT_ORIGIN, undefined)).toBe(GEOCRM_DEFAULT_ORIGIN)
  })
})

describe('normalizeGeoCrmOrigin', () => {
  it('strips trailing slashes', () => {
    expect(normalizeGeoCrmOrigin('http://127.0.0.1:3001///')).toBe('http://127.0.0.1:3001')
  })
})

describe('parsePublicError', () => {
  it('reads a string error and an object message', () => {
    expect(parsePublicError(JSON.stringify({ error: 'Invalid credentials' }))).toBe('Invalid credentials')
    expect(parsePublicError(JSON.stringify({ error: { message: 'nope' } }))).toBe('nope')
    expect(parsePublicError('<html>')).toBeUndefined()
    expect(parsePublicError(JSON.stringify({ error: { message: 1 } }))).toBeUndefined()
    expect(parsePublicError(JSON.stringify({ error: '' }))).toBeUndefined()
  })
})

describe('resolveEmployeeEmail', () => {
  it('returns the matching email', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ email: 'Ada@Example.com' })),
    })))
    await expect(resolveEmployeeEmail('http://127.0.0.1:3001/', 'PS0001', new AbortController().signal))
      .resolves.toBe('ada@example.com')
  })

  it('refuses a missing or malformed email', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({})),
    })))
    await expect(resolveEmployeeEmail('http://127.0.0.1:3001', 'PS0001'))
      .rejects.toThrow(/employee ID/)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      text: () => Promise.resolve(JSON.stringify({ error: 'not_found' })),
    })))
    await expect(resolveEmployeeEmail('http://127.0.0.1:3001', 'PS0001'))
      .rejects.toThrow('not_found')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('not-json'),
    })))
    await expect(resolveEmployeeEmail('http://127.0.0.1:3001', 'PS0001'))
      .rejects.toThrow(/employee ID/)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      text: () => Promise.resolve('nope'),
    })))
    await expect(resolveEmployeeEmail('http://127.0.0.1:3001', 'PS0001'))
      .rejects.toThrow(/employee ID/)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ email: '   ' })),
    })))
    await expect(resolveEmployeeEmail('http://127.0.0.1:3001', 'PS0001'))
      .rejects.toThrow(/employee ID/)
  })
})

describe('signInWithPassword', () => {
  it('returns the access token and refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        access_token: 'jwt',
        refresh_token: 'refresh',
        user: { email: 'ada@example.com' },
      })),
    })))
    await expect(signInWithPassword('http://127.0.0.1:3001', 'Ada@Example.com', 'secret', new AbortController().signal))
      .resolves.toEqual({ accessToken: 'jwt', refreshToken: 'refresh', email: 'ada@example.com' })
  })

  it('falls back to the submitted email when the user object is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ access_token: 'jwt' })),
    })))
    await expect(signInWithPassword('http://127.0.0.1:3001', 'ada@example.com', 'secret'))
      .resolves.toEqual({ accessToken: 'jwt', email: 'ada@example.com' })
  })

  it('refuses missing tokens and HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({})),
    })))
    await expect(signInWithPassword('http://127.0.0.1:3001', 'ada@example.com', 'secret'))
      .rejects.toThrow(/Invalid credentials/)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      text: () => Promise.resolve(JSON.stringify({ error: 'Invalid credentials' })),
    })))
    await expect(signInWithPassword('http://127.0.0.1:3001', 'ada@example.com', 'x'))
      .rejects.toThrow('Invalid credentials')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('nope'),
    })))
    await expect(signInWithPassword('http://127.0.0.1:3001', 'ada@example.com', 'x'))
      .rejects.toThrow(/Invalid credentials/)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      text: () => Promise.resolve('nope'),
    })))
    await expect(signInWithPassword('http://127.0.0.1:3001', 'ada@example.com', 'x'))
      .rejects.toThrow(/Invalid credentials/)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ access_token: '', user: { email: '' } })),
    })))
    await expect(signInWithPassword('http://127.0.0.1:3001', 'ada@example.com', 'secret'))
      .rejects.toThrow(/Invalid credentials/)
  })
})

function jwtWith(payload: object): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/=+$/u, '')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
  return `aaa.${encoded}.sig`
}

describe('emailFromAccessToken', () => {
  it('reads a lowercased email claim and ignores everything else', () => {
    expect(emailFromAccessToken(jwtWith({ email: 'Ada@Example.com' }))).toBe('ada@example.com')
    expect(emailFromAccessToken(jwtWith({ email: '   ' }))).toBeUndefined()
    expect(emailFromAccessToken(jwtWith({}))).toBeUndefined()
    expect(emailFromAccessToken('not-a-jwt')).toBeUndefined()
    expect(emailFromAccessToken('aaa..sig')).toBeUndefined()
    expect(emailFromAccessToken('aaa.%%%')).toBeUndefined()
  })
})

describe('fetchSessionEmail', () => {
  it('returns the JWT claim without calling /auth/me', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchSessionEmail('http://127.0.0.1:3001', jwtWith({ email: 'Ada@Example.com' })))
      .resolves.toBe('ada@example.com')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to GET /auth/me when the token has no email', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ user: { email: 'Ada@Example.com' } })),
    })))
    await expect(fetchSessionEmail(
      'http://127.0.0.1:3001/',
      'opaque',
      new AbortController().signal,
    )).resolves.toBe('ada@example.com')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      text: () => Promise.resolve('nope'),
    })))
    await expect(fetchSessionEmail('http://127.0.0.1:3001', 'opaque')).resolves.toBeUndefined()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('not-json'),
    })))
    await expect(fetchSessionEmail('http://127.0.0.1:3001', 'opaque')).resolves.toBeUndefined()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ user: { email: '   ' } })),
    })))
    await expect(fetchSessionEmail('http://127.0.0.1:3001', 'opaque')).resolves.toBeUndefined()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({})),
    })))
    await expect(fetchSessionEmail('http://127.0.0.1:3001', 'opaque')).resolves.toBeUndefined()
  })
})

describe('probeAccess', () => {
  it('reads desktop_agent and role', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        result: JSON.stringify({
          role: 'group_admin',
          desktop_modules: ['desktop_agent', 'desktop_mail'],
          readable_entities: ['customers'],
        }),
        isError: false,
      })),
    })))
    await expect(probeAccess('http://127.0.0.1:3001', 'jwt', new AbortController().signal)).resolves.toEqual({
      role: 'group_admin',
      desktopAgent: true,
      readableEntities: ['customers'],
    })
  })

  it('defaults a missing role and treats a tool error as failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        result: JSON.stringify({ desktop_modules: [1], readable_entities: [1] }),
      })),
    })))
    await expect(probeAccess('http://127.0.0.1:3001', 'jwt')).resolves.toEqual({
      role: 'member',
      desktopAgent: false,
      readableEntities: [],
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ isError: true, result: 'forbidden' })),
    })))
    await expect(probeAccess('http://127.0.0.1:3001', 'jwt')).rejects.toThrow('forbidden')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ isError: true })),
    })))
    await expect(probeAccess('http://127.0.0.1:3001', 'jwt')).rejects.toThrow('Access check failed')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 403,
      text: () => Promise.resolve(JSON.stringify({
        error: 'Harness is not enabled for this account.',
        code: 'harness_forbidden',
      })),
    })))
    await expect(probeAccess('http://127.0.0.1:3001', 'jwt'))
      .rejects.toThrow('Harness is not enabled for this account.')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 401,
      text: () => Promise.resolve('nope'),
    })))
    await expect(probeAccess('http://127.0.0.1:3001', 'jwt'))
      .rejects.toThrow(/HTTP 401/)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('nope'),
    })))
    await expect(probeAccess('http://127.0.0.1:3001', 'jwt')).rejects.toThrow('Access check failed')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ result: 'not-json' })),
    })))
    await expect(probeAccess('http://127.0.0.1:3001', 'jwt')).resolves.toEqual({
      role: 'member',
      desktopAgent: false,
      readableEntities: [],
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ result: { role: 'admin' } })),
    })))
    await expect(probeAccess('http://127.0.0.1:3001', 'jwt')).resolves.toEqual({
      role: 'member',
      desktopAgent: false,
      readableEntities: [],
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        result: JSON.stringify({ role: '', desktop_modules: 'nope', readable_entities: 'nope' }),
      })),
    })))
    await expect(probeAccess('http://127.0.0.1:3001', 'jwt')).resolves.toEqual({
      role: 'member',
      desktopAgent: false,
      readableEntities: [],
    })
  })
})
