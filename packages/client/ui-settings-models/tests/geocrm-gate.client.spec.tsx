// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { GeoCrmGate } from '../src/client/GeoCrmGate.tsx'
import type { GeoCrmGateProps } from '../src/client/GeoCrmGate.tsx'
import { en } from '../src/client/locales.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import {
  GEOCRM_DEFAULT_KEY_REF,
  GEOCRM_DEFAULT_ORIGIN,
  type SignInGateState,
} from '../src/client/sign-in-gate.ts'

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
    writeSettings: () => Promise.resolve({
      kind: 'written',
      view: { ns: 'llm-geocrm', schema: {}, value: {}, applies: 'live', secrets: [], revision: 1 },
    }),
    discoverModels: () => Promise.resolve({ kind: 'found', models: [] }),
    ...overrides,
  }
}

function mount(state: SignInGateState, overrides: Partial<GeoCrmGateProps> = {}) {
  const store = createSnapshotStore(state)
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: GeoCrmGateProps = {
    useSessions: unusedHook,
    useSessionPendingInteraction: selector => selector(new Map()),
    useWorkspaces: unusedHook,
    operations: operations(),
    unlock: () => {},
    t,
    useGate: bindSnapshotSelector(store),
    ...overrides,
  }
  return { ...render(<GeoCrmGate {...props} />), store }
}

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

describe('GeoCrmGate', () => {
  it('hides the cover once the session is open', () => {
    const { container } = mount({
      phase: 'open',
      origin: GEOCRM_DEFAULT_ORIGIN,
      keyRef: GEOCRM_DEFAULT_KEY_REF,
    })
    expect(container.firstChild).toBeNull()
  })

  it('shows a checking status before the Host read settles', () => {
    mount({
      phase: 'checking',
      origin: GEOCRM_DEFAULT_ORIGIN,
      keyRef: GEOCRM_DEFAULT_KEY_REF,
    })
    expect(screen.getByRole('status').textContent).toContain(en.gateChecking)
    expect(screen.getByText(en.brandName)).toBeTruthy()
  })

  it('unlocks after a password sign-in that grants desktop_agent', async () => {
    const unlock = vi.fn()
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input.includes('/auth/password')) {
        return jsonResponse({ access_token: 'jwt', user: { email: 'ada@example.com' } })
      }
      return jsonResponse({
        result: JSON.stringify({ role: 'member', desktop_modules: ['desktop_agent'] }),
      })
    }))
    mount({
      phase: 'locked',
      origin: GEOCRM_DEFAULT_ORIGIN,
      keyRef: GEOCRM_DEFAULT_KEY_REF,
    }, { unlock })
    expect(screen.getByText(en.gateTitle)).toBeTruthy()
    expect(screen.getByText(en.brandName)).toBeTruthy()
    expect(screen.queryByText(en.signInHint)).toBeNull()
    fireEvent.click(screen.getByText(en.loginModeEmail))
    fireEvent.change(screen.getByLabelText(en.loginEmail), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText(en.loginPassword), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText(en.signIn))
    await waitFor(() => { expect(unlock).toHaveBeenCalled() })
  })

  it('unlocks after a Google sign-in that grants desktop_agent', async () => {
    const unlock = vi.fn()
    const payload = btoa(JSON.stringify({ email: 'ada@example.com' }))
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
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
      result: JSON.stringify({ role: 'member', desktop_modules: ['desktop_agent'] }),
    })))
    mount({
      phase: 'locked',
      origin: GEOCRM_DEFAULT_ORIGIN,
      keyRef: GEOCRM_DEFAULT_KEY_REF,
    }, { unlock })
    fireEvent.click(screen.getByText(en.signInWithGoogle))
    await waitFor(() => { expect(unlock).toHaveBeenCalled() })
  })

  it('stays locked when the access probe fails after sign-in', async () => {
    const removeCredential = vi.fn(() => Promise.resolve(undefined))
    const unlock = vi.fn()
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input.includes('/auth/password')) {
        return jsonResponse({ access_token: 'jwt' })
      }
      return Promise.reject(new Error('probe-down'))
    }))
    mount({
      phase: 'locked',
      origin: GEOCRM_DEFAULT_ORIGIN,
      keyRef: GEOCRM_DEFAULT_KEY_REF,
    }, { unlock, operations: operations({ removeCredential }) })
    fireEvent.click(screen.getByText(en.loginModeEmail))
    fireEvent.change(screen.getByLabelText(en.loginEmail), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText(en.loginPassword), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText(en.signIn))
    await screen.findByText('probe-down')
    expect(unlock).not.toHaveBeenCalled()
    expect(removeCredential).not.toHaveBeenCalled()
  })

  it('clears stored tokens when the account lacks desktop_agent', async () => {
    const removeCredential = vi.fn(() => Promise.resolve(undefined))
    const unlock = vi.fn()
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input.includes('/auth/password')) {
        return jsonResponse({ access_token: 'jwt', refresh_token: 'refresh' })
      }
      return jsonResponse({
        result: JSON.stringify({ role: 'member', desktop_modules: [] }),
      })
    }))
    mount({
      phase: 'locked',
      origin: GEOCRM_DEFAULT_ORIGIN,
      keyRef: GEOCRM_DEFAULT_KEY_REF,
    }, { unlock, operations: operations({ removeCredential }) })
    fireEvent.click(screen.getByText(en.loginModeEmail))
    fireEvent.change(screen.getByLabelText(en.loginEmail), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText(en.loginPassword), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText(en.signIn))
    await waitFor(() => {
      expect(removeCredential).toHaveBeenCalledWith('GEOCRM_HARNESS_TOKEN')
    })
    expect(removeCredential).toHaveBeenCalledWith('GEOCRM_HARNESS_REFRESH')
    expect(unlock).not.toHaveBeenCalled()
  })
})
