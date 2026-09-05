/**
 * Desktop sign-in cover: when the Electron renderer occupies `shell.gate`,
 * this module holds the cover phase and resolves the GeoCRM origin / token
 * reference from the settings describe view.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  GEOCRM_DEFAULT_ORIGIN,
  refreshCredentialRef,
  resolveCardOrigin,
} from './geocrm-auth.ts'

export { GEOCRM_DEFAULT_ORIGIN } from './geocrm-auth.ts'
import type { ModelsOperations } from './operations.ts'

/** Settings namespace owned by `@deepseek-ai/dsh-llm-geocrm`. */
export const GEOCRM_SETTINGS_NS = 'llm-geocrm'

/** Default access-token credential reference. */
export const GEOCRM_DEFAULT_KEY_REF = 'GEOCRM_HARNESS_TOKEN'

/**
 * Sidebar brand cell rank on the desktop renderer. Lowest rank renders, so
 * this shadows the official DeepSeek occupants without unloading that plugin.
 */
export const DESKTOP_BRAND_PRIORITY = -10

/** Cover phase while the desktop window decides whether the shell may be used. */
export type SignInGatePhase = 'checking' | 'locked' | 'open'

/** Snapshot the `shell.gate` occupant renders. */
export interface SignInGateState {
  /** Whether the cover is checking, showing sign-in, or gone. */
  phase: SignInGatePhase
  /** GeoCRM API origin the form posts to. */
  origin: string
  /** Credential reference that holds the access JWT. */
  keyRef: string
}

/** The describe face the cover reads: `ensure` plus the held document view. */
export interface SignInGateDescribe {
  /**
   * Resolve once a describe answer is held (or the mirror is unavailable).
   * @returns settlement of the current or newly started read, if any.
   */
  ensure(): Promise<void>
  /**
   * Read the current sync snapshot.
   * @returns status plus the last good view, if any.
   */
  getSnapshot(): { view?: { namespaces?: readonly SettingsNamespaceView[] } | undefined }
}

/** Optional apply argument that forces the cover in tests. */
export interface SignInGateConfig {
  /**
   * Occupy `shell.gate` even when the page is not the Electron `dsh-app:`
   * renderer. The browser Loader creates client entries without yml config,
   * so production desktop detection is the custom protocol, not this flag.
   */
  requireSignIn?: boolean
}

/**
 * Whether this renderer should occupy `shell.gate`.
 * @param config - optional test override.
 * @returns true on `dsh-app:` or when tests set `requireSignIn`.
 */
export function shouldOccupySignInGate(config: SignInGateConfig = {}): boolean {
  const protocol = (globalThis as { location?: { protocol?: string } }).location?.protocol
  return config.requireSignIn === true || protocol === 'dsh-app:'
}

/**
 * Read a non-empty string field from a redacted JSON object.
 * @param source - namespace layer (`base`, `user`, or `value`).
 * @param key - field name.
 * @returns the trimmed string, or undefined.
 */
export function stringField(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return undefined
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/**
 * Resolve the login origin and access-token reference from a describe view.
 * @param view - held settings document, if any.
 * @returns origin and key reference, using shipped defaults when `llm-geocrm` is absent.
 */
export function connectionFromDescribe(
  view: { namespaces?: readonly SettingsNamespaceView[] } | undefined,
): { origin: string; keyRef: string } {
  const row = view?.namespaces?.find(namespace => namespace.ns === GEOCRM_SETTINGS_NS)
  return {
    origin: resolveCardOrigin(
      stringField(row?.base, 'baseURL'),
      stringField(row?.user, 'baseURL') ?? stringField(row?.value, 'baseURL'),
    ),
    keyRef: stringField(row?.value, 'apiKeyEnv') ?? GEOCRM_DEFAULT_KEY_REF,
  }
}

/**
 * Create the cover store and the callbacks `apply` wires to Remote events.
 * @param describe - settings describe face.
 * @param operations - credential reads.
 * @returns store, refresh, unlock, and credential-ref filter.
 */
export function createSignInGate(
  describe: SignInGateDescribe,
  operations: Pick<ModelsOperations, 'describeCredential'>,
): {
  store: SnapshotStore<SignInGateState>
  refresh: () => Promise<void>
  unlock: () => void
  handlesCredentialRefs: (refs: string | readonly string[]) => boolean
} {
  const store = createSnapshotStore<SignInGateState>({
    phase: 'checking',
    origin: GEOCRM_DEFAULT_ORIGIN,
    keyRef: GEOCRM_DEFAULT_KEY_REF,
  })
  return {
    store,
    refresh: () => refreshSignInGate(store, describe, operations.describeCredential),
    unlock: () => { store.update((draft) => { draft.phase = 'open' }) },
    handlesCredentialRefs: (refs) => {
      const list = typeof refs === 'string' ? [refs] : refs
      const { keyRef } = store.getSnapshot()
      return list.includes(keyRef) || list.includes(refreshCredentialRef(keyRef))
    },
  }
}

/**
 * Re-read settings and the access-token credential, then publish the cover phase.
 * @param store - cover snapshot.
 * @param describe - settings describe face.
 * @param describeCredential - credential describe for one reference.
 */
export async function refreshSignInGate(
  store: SnapshotStore<SignInGateState>,
  describe: SignInGateDescribe,
  describeCredential: ModelsOperations['describeCredential'],
): Promise<void> {
  try {
    await describe.ensure()
    const connection = connectionFromDescribe(describe.getSnapshot().view)
    const info = await describeCredential(connection.keyRef)
    store.set({
      phase: info?.configured === true ? 'open' : 'locked',
      origin: connection.origin,
      keyRef: connection.keyRef,
    })
  } catch {
    // describe or credential reads fail closed: keep the window on the
    // sign-in panel instead of opening the shell without a session.
    store.update((draft) => { draft.phase = 'locked' })
  }
}
