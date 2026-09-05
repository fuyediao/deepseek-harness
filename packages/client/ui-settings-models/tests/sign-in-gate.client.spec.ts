// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  GEOCRM_DEFAULT_KEY_REF,
  GEOCRM_DEFAULT_ORIGIN,
  connectionFromDescribe,
  createSignInGate,
  refreshSignInGate,
  shouldOccupySignInGate,
  stringField,
} from '../src/client/sign-in-gate.ts'

function namespace(overrides: Partial<SettingsNamespaceView> = {}): SettingsNamespaceView {
  return {
    ns: 'llm-geocrm',
    schema: {},
    value: {},
    applies: 'live',
    secrets: [],
    revision: 1,
    ...overrides,
  }
}

describe('shouldOccupySignInGate', () => {
  it('is off by default in a browser test page', () => {
    expect(shouldOccupySignInGate()).toBe(false)
    expect(shouldOccupySignInGate({})).toBe(false)
  })

  it('turns on for tests and for the Electron custom protocol', () => {
    expect(shouldOccupySignInGate({ requireSignIn: true })).toBe(true)
    const location = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { protocol: 'dsh-app:' },
    })
    expect(shouldOccupySignInGate()).toBe(true)
    Object.defineProperty(window, 'location', { configurable: true, value: location })
  })
})

describe('connectionFromDescribe', () => {
  it('uses shipped defaults when the GeoCRM namespace is absent', () => {
    expect(connectionFromDescribe(undefined)).toEqual({
      origin: GEOCRM_DEFAULT_ORIGIN,
      keyRef: GEOCRM_DEFAULT_KEY_REF,
    })
    expect(connectionFromDescribe({ namespaces: [] })).toEqual({
      origin: GEOCRM_DEFAULT_ORIGIN,
      keyRef: GEOCRM_DEFAULT_KEY_REF,
    })
    expect(connectionFromDescribe({})).toEqual({
      origin: GEOCRM_DEFAULT_ORIGIN,
      keyRef: GEOCRM_DEFAULT_KEY_REF,
    })
  })

  it('prefers composition origin, then the user or resolved card origin', () => {
    expect(connectionFromDescribe({
      namespaces: [namespace({
        base: { baseURL: 'https://api.powersource.app' },
        user: { baseURL: 'http://127.0.0.1:9' },
        value: { baseURL: 'http://127.0.0.1:9', apiKeyEnv: 'CUSTOM_TOKEN' },
      })],
    })).toEqual({
      origin: 'https://api.powersource.app',
      keyRef: 'CUSTOM_TOKEN',
    })
    expect(connectionFromDescribe({
      namespaces: [namespace({
        user: { baseURL: 'https://card.example' },
        value: { baseURL: 'https://card.example' },
      })],
    })).toEqual({
      origin: 'https://card.example',
      keyRef: GEOCRM_DEFAULT_KEY_REF,
    })
  })

  it('ignores blank and non-object layers', () => {
    expect(stringField(undefined, 'baseURL')).toBeUndefined()
    expect(stringField([], 'baseURL')).toBeUndefined()
    expect(stringField({ baseURL: '   ' }, 'baseURL')).toBeUndefined()
    expect(stringField({ baseURL: 1 }, 'baseURL')).toBeUndefined()
  })
})

describe('refreshSignInGate', () => {
  it('opens when the access token is already stored', async () => {
    const gate = createSignInGate(
      {
        ensure: () => Promise.resolve(),
        getSnapshot: () => ({ view: { namespaces: [namespace()] } }),
      },
      { describeCredential: () => Promise.resolve({ configured: true, writable: true }) },
    )
    expect(gate.store.getSnapshot().phase).toBe('checking')
    await gate.refresh()
    expect(gate.store.getSnapshot()).toMatchObject({
      phase: 'open',
      origin: GEOCRM_DEFAULT_ORIGIN,
      keyRef: GEOCRM_DEFAULT_KEY_REF,
    })
    gate.unlock()
    expect(gate.store.getSnapshot().phase).toBe('open')
  })

  it('locks when the token is missing and when a Host read fails', async () => {
    const store = createSnapshotStore({
      phase: 'checking' as const,
      origin: GEOCRM_DEFAULT_ORIGIN,
      keyRef: GEOCRM_DEFAULT_KEY_REF,
    })
    await refreshSignInGate(
      store,
      { ensure: () => Promise.resolve(), getSnapshot: () => ({}) },
      () => Promise.resolve({ configured: false, writable: true }),
    )
    expect(store.getSnapshot().phase).toBe('locked')
    await refreshSignInGate(
      store,
      { ensure: () => Promise.resolve(), getSnapshot: () => ({}) },
      () => Promise.resolve(undefined),
    )
    expect(store.getSnapshot().phase).toBe('locked')
    await refreshSignInGate(
      store,
      { ensure: () => Promise.reject(new Error('describe-down')), getSnapshot: () => ({}) },
      () => Promise.resolve({ configured: true, writable: true }),
    )
    expect(store.getSnapshot().phase).toBe('locked')
  })

  it('watches the access and refresh credential references', () => {
    const gate = createSignInGate(
      { ensure: () => Promise.resolve(), getSnapshot: () => ({}) },
      { describeCredential: () => Promise.resolve(undefined) },
    )
    expect(gate.handlesCredentialRefs(['OPENAI_API_KEY'])).toBe(false)
    expect(gate.handlesCredentialRefs('OPENAI_API_KEY')).toBe(false)
    expect(gate.handlesCredentialRefs(['GEOCRM_HARNESS_TOKEN'])).toBe(true)
    expect(gate.handlesCredentialRefs('GEOCRM_HARNESS_TOKEN')).toBe(true)
    expect(gate.handlesCredentialRefs(['GEOCRM_HARNESS_REFRESH'])).toBe(true)
  })
})
