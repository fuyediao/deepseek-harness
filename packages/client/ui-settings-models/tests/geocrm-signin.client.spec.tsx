// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { GeoCrmSignIn } from '../src/client/GeoCrmSignIn.tsx'
import { en } from '../src/client/locales.ts'
import type { ModelsOperations } from '../src/client/operations.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const t = (key: keyof typeof en): string => en[key]

function operations(overrides: Partial<ModelsOperations> = {}): ModelsOperations {
  return {
    describeCredential: () => Promise.resolve({ configured: false, writable: true }),
    storeCredential: () => Promise.resolve(undefined),
    removeCredential: () => Promise.resolve(undefined),
    writeSettings: () => Promise.resolve({ kind: 'written', view: {
      ns: 'llm-geocrm', schema: {}, value: {}, applies: 'live', secrets: [], revision: 1,
    } }),
    discoverModels: () => Promise.resolve({ kind: 'found', models: [] }),
    ...overrides,
  }
}

function mount(props: Partial<ComponentProps<typeof GeoCrmSignIn>> = {}) {
  return render(<GeoCrmSignIn
    origin="http://127.0.0.1:3001"
    keyRef="GEOCRM_HARNESS_TOKEN"
    operations={operations()}
    t={t}
    disabled={false}
    keyLocked={false}
    configured={false}
    onCredentialChange={() => {}}
    {...props}
  />)
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

describe('GeoCrmSignIn', () => {
  it('signs in with email and shows a missing desktop_agent warning', async () => {
    const storeCredential = vi.fn(() => Promise.resolve(undefined))
    const onCredentialChange = vi.fn()
    const onAccess = vi.fn()
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (String(input).includes('/auth/password')) {
        return jsonResponse({
          access_token: 'jwt',
          refresh_token: 'refresh',
          user: { email: 'ada@example.com' },
        })
      }
      return jsonResponse({
        result: JSON.stringify({ role: 'member', desktop_modules: [], readable_entities: [] }),
      })
    }))
    mount({ operations: operations({ storeCredential }), onCredentialChange, onAccess })
    fireEvent.click(screen.getByText(en.loginModeEmail))
    fireEvent.change(screen.getByLabelText(en.loginEmail), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText(en.loginPassword), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText(en.signIn))
    await waitFor(() => { expect(storeCredential).toHaveBeenCalledWith('GEOCRM_HARNESS_TOKEN', 'jwt') })
    expect(storeCredential).toHaveBeenCalledWith('GEOCRM_HARNESS_REFRESH', 'refresh')
    expect(onCredentialChange).toHaveBeenCalled()
    await screen.findByText(`${en.accountSignedIn} ada@example.com`)
    expect(screen.getByText((content) => content.includes(en.accountNoDesktopAgent))).toBeTruthy()
    expect(onAccess).toHaveBeenCalledWith(expect.objectContaining({ desktopAgent: false }))
    fireEvent.click(screen.getByText(en.loginModeEmployeeId))
    expect(screen.getByLabelText(en.employeeId)).toBeTruthy()
  })

  it('reports a refused credential write and a later access-check failure', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (String(input).includes('resolve-employee-id')) {
        return jsonResponse({ email: 'ada@example.com' })
      }
      if (String(input).includes('/auth/password')) {
        return jsonResponse({ access_token: 'jwt', refresh_token: 'refresh' })
      }
      return Promise.reject(new Error('probe-down'))
    }))
    const storeCredential = vi.fn()
      .mockResolvedValueOnce('locked')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
    mount({ operations: operations({ storeCredential }) })
    fireEvent.change(screen.getByLabelText(en.employeeId), { target: { value: 'PS0001' } })
    fireEvent.change(screen.getByLabelText(en.loginPassword), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText(en.signIn))
    await screen.findByText('locked')
    fireEvent.click(screen.getByText(en.signIn))
    await screen.findByText('probe-down')
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (String(input).includes('resolve-employee-id')) {
        return jsonResponse({ email: 'ada@example.com' })
      }
      if (String(input).includes('/auth/password')) {
        return jsonResponse({ access_token: 'jwt', refresh_token: 'refresh' })
      }
      return Promise.reject('probe-down')
    }))
    fireEvent.change(screen.getByLabelText(en.loginPassword), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText(en.signIn))
    await screen.findByText(en.accessCheckFailed)
  })

  it('reports a thrown sign-in Error and a non-Error rejection', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce('down'))
    mount()
    fireEvent.change(screen.getByLabelText(en.employeeId), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(en.loginPassword), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText(en.signIn))
    await screen.findByText('offline')
    fireEvent.click(screen.getByText(en.signIn))
    await screen.findByText(en.loginFailed)
  })

  it('signs out a stored token and reports a refused remove', async () => {
    const removeCredential = vi.fn()
      .mockResolvedValueOnce('cannot-unset')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('cannot-unset-refresh')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
    const onCredentialChange = vi.fn()
    mount({
      configured: true,
      operations: operations({ removeCredential }),
      onCredentialChange,
    })
    fireEvent.click(screen.getByText(en.signOut))
    await screen.findByText('cannot-unset')
    fireEvent.click(screen.getByText(en.signOut))
    await screen.findByText('cannot-unset-refresh')
    fireEvent.click(screen.getByText(en.signOut))
    await waitFor(() => { expect(onCredentialChange).toHaveBeenCalled() })
  })

  it('unsets the access token when the refresh token cannot be stored', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (String(input).includes('/auth/password')) {
        return jsonResponse({ access_token: 'jwt', refresh_token: 'refresh' })
      }
      return jsonResponse({
        result: JSON.stringify({ role: 'member', desktop_modules: ['desktop_agent'] }),
      })
    }))
    const storeCredential = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('refresh-locked')
    const removeCredential = vi.fn(() => Promise.resolve(undefined))
    mount({ operations: operations({ storeCredential, removeCredential }) })
    fireEvent.click(screen.getByText(en.loginModeEmail))
    fireEvent.change(screen.getByLabelText(en.loginEmail), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText(en.loginPassword), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText(en.signIn))
    await screen.findByText('refresh-locked')
    expect(removeCredential).toHaveBeenCalledWith('GEOCRM_HARNESS_TOKEN')
  })

  it('hides Google sign-in when the desktop bridge is absent', () => {
    mount()
    expect(screen.queryByText(en.signInWithGoogle)).toBeNull()
    expect(screen.queryByText(en.signInDivider)).toBeNull()
  })

  it('stores a Google session from the desktop bridge', async () => {
    const payload = btoa(JSON.stringify({ email: 'ada@example.com' }))
      .replace(/=+$/u, '')
      .replace(/\+/gu, '-')
      .replace(/\//gu, '_')
    const signInWithGoogle = vi.fn(() => Promise.resolve({
      ok: true as const,
      accessToken: `aaa.${payload}.sig`,
      refreshToken: 'refresh',
    }))
    vi.stubGlobal('__dshElectronBridge__', { signInWithGoogle })
    const storeCredential = vi.fn(() => Promise.resolve(undefined))
    const onAccess = vi.fn()
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
      result: JSON.stringify({ role: 'member', desktop_modules: ['desktop_agent'] }),
    })))
    mount({ operations: operations({ storeCredential }), onAccess })
    fireEvent.click(screen.getByText(en.signInWithGoogle))
    await waitFor(() => { expect(storeCredential).toHaveBeenCalledWith('GEOCRM_HARNESS_TOKEN', `aaa.${payload}.sig`) })
    expect(storeCredential).toHaveBeenCalledWith('GEOCRM_HARNESS_REFRESH', 'refresh')
    expect(signInWithGoogle).toHaveBeenCalledWith('http://127.0.0.1:3001')
    expect(onAccess).toHaveBeenCalledWith(expect.objectContaining({ desktopAgent: true }))
    await screen.findByText(`${en.accountSignedIn} ada@example.com`)
    expect(screen.queryByText(en.signInWithGoogle)).toBeNull()
  })

  it('asks /auth/me when the Google JWT has no email and maps a cancelled attempt', async () => {
    const signInWithGoogle = vi.fn()
      .mockResolvedValueOnce({ ok: true, accessToken: 'opaque', refreshToken: 'refresh' })
      .mockRejectedValueOnce(new Error('cancelled'))
    vi.stubGlobal('__dshElectronBridge__', { signInWithGoogle })
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (String(input).includes('/auth/me')) {
        return jsonResponse({ user: { email: 'ada@example.com' } })
      }
      return jsonResponse({
        result: JSON.stringify({ role: 'member', desktop_modules: ['desktop_agent'] }),
      })
    }))
    mount()
    fireEvent.click(screen.getByText(en.signInWithGoogle))
    await screen.findByText(`${en.accountSignedIn} ada@example.com`)
    fireEvent.click(screen.getByText(en.signOut))
    await waitFor(() => { expect(screen.getByText(en.signInWithGoogle)).toBeTruthy() })
    fireEvent.click(screen.getByText(en.signInWithGoogle))
    await screen.findByText(en.googleSignInCancelled)
  })

  it('hides Google sign-in when a session is already stored', () => {
    vi.stubGlobal('__dshElectronBridge__', {
      signInWithGoogle: () => Promise.resolve({ ok: false, error: 'x' }),
    })
    mount({ configured: true })
    expect(screen.queryByText(en.signInWithGoogle)).toBeNull()
  })

  it('stores a Google session without an email when /auth/me is empty', async () => {
    vi.stubGlobal('__dshElectronBridge__', {
      signInWithGoogle: () => Promise.resolve({ ok: true as const, accessToken: 'opaque' }),
    })
    const storeCredential = vi.fn(() => Promise.resolve(undefined))
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (String(input).includes('/auth/me')) {
        return jsonResponse({})
      }
      return jsonResponse({
        result: JSON.stringify({ role: 'member', desktop_modules: ['desktop_agent'] }),
      })
    }))
    mount({ operations: operations({ storeCredential }) })
    fireEvent.click(screen.getByText(en.signInWithGoogle))
    await waitFor(() => { expect(storeCredential).toHaveBeenCalledWith('GEOCRM_HARNESS_TOKEN', 'opaque') })
    expect(screen.queryByText(en.accountSignedIn, { exact: false })).toBeNull()
  })

  it('reports a non-Error Google rejection as a generic failure', async () => {
    vi.stubGlobal('__dshElectronBridge__', {
      signInWithGoogle: () => Promise.reject('down'),
    })
    mount()
    fireEvent.click(screen.getByText(en.signInWithGoogle))
    await screen.findByText(en.googleSignInFailed)
  })
})
