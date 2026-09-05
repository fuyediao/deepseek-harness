// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canDesktopGoogleSignIn,
  desktopGoogleSignIn,
  googleSignInFailureCopy,
} from '../src/client/desktop-auth.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const t = (
  key: 'googleSignInCancelled' | 'googleSignInInProgress' | 'googleSignInUnavailable' | 'googleSignInFailed',
): string => en[key]

describe('canDesktopGoogleSignIn', () => {
  it('is false without the Electron preload invoke', () => {
    expect(canDesktopGoogleSignIn()).toBe(false)
  })

  it('is true when the preload exposes signInWithGoogle', () => {
    vi.stubGlobal('__dshElectronBridge__', { signInWithGoogle: () => Promise.resolve({ ok: false, error: 'x' }) })
    expect(canDesktopGoogleSignIn()).toBe(true)
    vi.stubGlobal('__dshElectronBridge__', { signInWithGoogle: 1 })
    expect(canDesktopGoogleSignIn()).toBe(false)
  })
})

describe('desktopGoogleSignIn', () => {
  it('throws unavailable when the bridge is missing', async () => {
    await expect(desktopGoogleSignIn('http://127.0.0.1:3001')).rejects.toThrow('unavailable')
    vi.stubGlobal('__dshElectronBridge__', {})
    await expect(desktopGoogleSignIn('http://127.0.0.1:3001')).rejects.toThrow('unavailable')
  })

  it('throws the desktop error code when the shell refuses', async () => {
    vi.stubGlobal('__dshElectronBridge__', {
      signInWithGoogle: () => Promise.resolve({ ok: false as const, error: 'cancelled' }),
    })
    await expect(desktopGoogleSignIn('http://127.0.0.1:3001')).rejects.toThrow('cancelled')
  })

  it('returns a session from the access JWT email claim', async () => {
    const payload = btoa(JSON.stringify({ email: 'Ada@Example.com' }))
      .replace(/=+$/u, '')
      .replace(/\+/gu, '-')
      .replace(/\//gu, '_')
    vi.stubGlobal('__dshElectronBridge__', {
      signInWithGoogle: () => Promise.resolve({
        ok: true as const,
        accessToken: `aaa.${payload}.sig`,
        refreshToken: 'refresh',
      }),
    })
    await expect(desktopGoogleSignIn('http://127.0.0.1:3001')).resolves.toEqual({
      accessToken: `aaa.${payload}.sig`,
      refreshToken: 'refresh',
      email: 'ada@example.com',
    })
  })

  it('omits an empty refresh token and an email-less JWT', async () => {
    vi.stubGlobal('__dshElectronBridge__', {
      signInWithGoogle: () => Promise.resolve({
        ok: true as const,
        accessToken: 'not-a-jwt',
        refreshToken: '',
      }),
    })
    await expect(desktopGoogleSignIn('http://127.0.0.1:3001')).resolves.toEqual({
      accessToken: 'not-a-jwt',
      email: '',
    })
  })
})

describe('googleSignInFailureCopy', () => {
  it('maps stable codes and treats every other code as a generic failure', () => {
    expect(googleSignInFailureCopy('cancelled', t)).toBe(en.googleSignInCancelled)
    expect(googleSignInFailureCopy('access_denied', t)).toBe(en.googleSignInCancelled)
    expect(googleSignInFailureCopy('in_progress', t)).toBe(en.googleSignInInProgress)
    expect(googleSignInFailureCopy('unavailable', t)).toBe(en.googleSignInUnavailable)
    expect(googleSignInFailureCopy('missing_token', t)).toBe(en.googleSignInFailed)
    expect(googleSignInFailureCopy('invalid_state', t)).toBe(en.googleSignInFailed)
  })
})
