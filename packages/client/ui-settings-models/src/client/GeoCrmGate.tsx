/**
 * Full-window GeoCRM sign-in cover for the desktop `shell.gate` seat.
 * Returns null once a stored session exists or a fresh sign-in grants
 * `desktop_agent`. The Models card still owns sign-out.
 */

import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GeoCrmAccess } from './geocrm-auth.ts'
import { refreshCredentialRef } from './geocrm-auth.ts'
import { GeoCrmBrandMark } from './GeoCrmBrand.tsx'
import { GeoCrmSignIn } from './GeoCrmSignIn.tsx'
import type { ModelsOperations } from './operations.ts'
import type { SignInGateState } from './sign-in-gate.ts'
import type { en } from './locales.ts'
import css from './GeoCrmGate.module.css'

/** Copy function shared by the cover chrome. */
type GateCopy = (key: keyof typeof en) => string

/**
 * Render the product mark and name above the cover title.
 * @param t - section copy.
 * @returns the brand row.
 */
function GateBrand({ t }: { t: GateCopy }) {
  return (
    <div className={css.brand}>
      <GeoCrmBrandMark size={36} />
      <span className={css.brandName}>{t('brandName')}</span>
    </div>
  )
}

/** Registration-side dependencies of {@link GeoCrmGate}. */
export interface GeoCrmGateInjected {
  /** Host credential writes used by the form. */
  operations: ModelsOperations
  /**
   * Open the shell after a fresh sign-in that granted `desktop_agent`.
   * Stored-session unlocks go through the cover store, not this callback.
   */
  unlock: () => void
  /** Section copy (same dictionary as the Models card). */
  t: (key: keyof typeof en) => string
  hooks: {
    /** Cover phase, origin, and credential reference. */
    gate: SnapshotStore<SignInGateState>
  }
}

/** Runtime share plus this cover's injected face. */
export type GeoCrmGateProps =
  PropsRuntime<'shell.gate'> & InjectFace<GeoCrmGateInjected>

/**
 * Render the blocking sign-in cover, or null once the shell may be used.
 * @param props - cover store, credential operations, and copy.
 * @returns the cover, a checking panel, or null.
 */
export function GeoCrmGate(props: GeoCrmGateProps): ReactNode {
  const { operations, unlock, t, useGate } = props
  const state = useGate(snapshot => snapshot)

  if (state.phase === 'open') return null

  if (state.phase === 'checking') {
    return (
      <div className={css.panel} role="status" aria-live="polite">
        <div className={css.card}>
          <GateBrand t={t} />
          <p className={css.checking}>{t('gateChecking')}</p>
        </div>
      </div>
    )
  }

  const onAccess = (access: GeoCrmAccess | undefined): void => {
    if (access?.desktopAgent === true) {
      unlock()
      return
    }
    if (access === undefined) return
    void operations.removeCredential(state.keyRef)
    void operations.removeCredential(refreshCredentialRef(state.keyRef))
  }

  return (
    <div className={css.panel}>
      <div className={css.card}>
        <GateBrand t={t} />
        <h1 className={css.title}>{t('gateTitle')}</h1>
        <GeoCrmSignIn
          origin={state.origin}
          keyRef={state.keyRef}
          operations={operations}
          t={t}
          disabled={false}
          keyLocked={false}
          configured={false}
          hideHint
          cover
          onCredentialChange={() => {}}
          onAccess={onAccess}
        />
      </div>
    </div>
  )
}
