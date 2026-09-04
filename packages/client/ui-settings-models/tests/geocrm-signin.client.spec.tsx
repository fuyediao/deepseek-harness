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
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (String(input).includes('/auth/password')) {
        return jsonResponse({ access_token: 'jwt', user: { email: 'ada@example.com' } })
      }
      return jsonResponse({
        result: JSON.stringify({ role: 'member', desktop_modules: [], readable_entities: [] }),
      })
    }))
    mount({ operations: operations({ storeCredential }), onCredentialChange })
    fireEvent.click(screen.getByText(en.loginModeEmail))
    fireEvent.change(screen.getByLabelText(en.loginEmail), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText(en.loginPassword), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText(en.signIn))
    await waitFor(() => { expect(storeCredential).toHaveBeenCalledWith('GEOCRM_HARNESS_TOKEN', 'jwt') })
    expect(onCredentialChange).toHaveBeenCalled()
    await screen.findByText(`${en.accountSignedIn} ada@example.com`)
    expect(screen.getByText((content) => content.includes(en.accountNoDesktopAgent))).toBeTruthy()
    fireEvent.click(screen.getByText(en.loginModeEmployeeId))
    expect(screen.getByLabelText(en.employeeId)).toBeTruthy()
  })

  it('reports a refused credential write and a later access-check failure', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (String(input).includes('resolve-employee-id')) {
        return jsonResponse({ email: 'ada@example.com' })
      }
      if (String(input).includes('/auth/password')) {
        return jsonResponse({ access_token: 'jwt' })
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
        return jsonResponse({ access_token: 'jwt' })
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
    const onCredentialChange = vi.fn()
    mount({
      configured: true,
      operations: operations({ removeCredential }),
      onCredentialChange,
    })
    fireEvent.click(screen.getByText(en.signOut))
    await screen.findByText('cannot-unset')
    fireEvent.click(screen.getByText(en.signOut))
    await waitFor(() => { expect(onCredentialChange).toHaveBeenCalled() })
  })
})
