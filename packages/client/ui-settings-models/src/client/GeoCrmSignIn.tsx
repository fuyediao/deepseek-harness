/**
 * GeoCRM employee-id or email password sign-in on the Models card.
 * Stores the access JWT through the credentials Remote and probes
 * `list_my_access` so the card can show `desktop_agent`.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { GeoCrmAccess } from './geocrm-auth.ts'
import {
  normalizeEmployeeId,
  probeAccess,
  resolveEmployeeEmail,
  signInWithPassword,
} from './geocrm-auth.ts'
import type { ModelsOperations } from './operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Login identifier the form currently collects. */
export type GeoCrmLoginMode = 'employeeId' | 'email'

/** Props of {@link GeoCrmSignIn}. */
export interface GeoCrmSignInProps {
  /** GeoCRM API origin as the card currently shows it. */
  origin: string
  /** Credential reference that receives the access token. */
  keyRef: string
  /** Host operations that store and remove the session token. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable the form (read-only settings or a parent write in flight). */
  disabled: boolean
  /** The launch environment already owns this reference. */
  keyLocked: boolean
  /** Whether a session token is already stored. */
  configured: boolean
  /** Refresh the card's credential hint after a store or remove. */
  onCredentialChange: () => void
}

/**
 * Render GeoCRM sign-in and the last access probe from this card session.
 * @param props - origin, credential writes, and copy.
 * @returns the sign-in block.
 */
export function GeoCrmSignIn(props: GeoCrmSignInProps): ReactNode {
  const { t } = props
  const [mode, setMode] = useState<GeoCrmLoginMode>('employeeId')
  const [employeeId, setEmployeeId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [sessionEmail, setSessionEmail] = useState<string | undefined>(undefined)
  const [access, setAccess] = useState<GeoCrmAccess | undefined>(undefined)
  const disabled = props.disabled || busy || props.keyLocked

  const signIn = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      let account = email.trim().toLowerCase()
      if (mode === 'employeeId') {
        const id = normalizeEmployeeId(employeeId)
        if (id.length === 0) {
          setFailure(employeeId.trim().length === 0 ? t('employeeIdRequired') : t('employeeIdInvalid'))
          return
        }
        account = await resolveEmployeeEmail(props.origin, id)
      } else if (account.length === 0) {
        setFailure(t('emailRequired'))
        return
      }
      if (password.length === 0) {
        setFailure(t('passwordRequired'))
        return
      }
      const session = await signInWithPassword(props.origin, account, password)
      const stored = await props.operations.storeCredential(props.keyRef, session.accessToken)
      if (stored !== undefined) {
        setFailure(stored)
        return
      }
      setPassword('')
      setSessionEmail(session.email)
      props.onCredentialChange()
      try {
        setAccess(await probeAccess(props.origin, session.accessToken))
      } catch (error: unknown) {
        setAccess(undefined)
        setFailure(error instanceof Error ? error.message : t('accessCheckFailed'))
      }
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : t('loginFailed'))
    } finally {
      setBusy(false)
    }
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const removed = await props.operations.removeCredential(props.keyRef)
      if (removed !== undefined) {
        setFailure(removed)
        return
      }
      setAccess(undefined)
      setSessionEmail(undefined)
      props.onCredentialChange()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['signIn']}>
      <p className={styles['advancedHint']}>{t('signInHint')}</p>
      <div className={styles['modeRow']} role="group" aria-label={t('loginMode')}>
        <button
          type="button"
          className={styles['secondaryButton']}
          aria-pressed={mode === 'employeeId'}
          disabled={disabled}
          onClick={() => { setMode('employeeId') }}
        >
          {t('loginModeEmployeeId')}
        </button>
        <button
          type="button"
          className={styles['secondaryButton']}
          aria-pressed={mode === 'email'}
          disabled={disabled}
          onClick={() => { setMode('email') }}
        >
          {t('loginModeEmail')}
        </button>
      </div>
      {mode === 'employeeId'
        ? (
          <div className={styles['field']}>
            <span className={styles['fieldLabel']}>{t('employeeId')}</span>
            <input
              className={styles['input']}
              type="text"
              autoComplete="username"
              value={employeeId}
              placeholder={t('employeeIdPlaceholder')}
              aria-label={t('employeeId')}
              disabled={disabled}
              onChange={(event) => { setEmployeeId(event.target.value) }}
            />
          </div>
        )
        : (
          <div className={styles['field']}>
            <span className={styles['fieldLabel']}>{t('loginEmail')}</span>
            <input
              className={styles['input']}
              type="email"
              autoComplete="username"
              value={email}
              placeholder={t('loginEmailPlaceholder')}
              aria-label={t('loginEmail')}
              disabled={disabled}
              onChange={(event) => { setEmail(event.target.value) }}
            />
          </div>
        )}
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('loginPassword')}</span>
        <input
          className={styles['input']}
          type="password"
          autoComplete="current-password"
          value={password}
          placeholder={t('loginPasswordPlaceholder')}
          aria-label={t('loginPassword')}
          disabled={disabled}
          onChange={(event) => { setPassword(event.target.value) }}
        />
      </div>
      <div className={styles['signInActions']}>
        <button
          type="button"
          className={styles['primaryButton']}
          disabled={disabled}
          onClick={() => { void signIn() }}
        >
          {busy ? t('signingIn') : t('signIn')}
        </button>
        {props.configured || sessionEmail !== undefined
          ? (
            <button
              type="button"
              className={styles['secondaryButton']}
              disabled={disabled}
              onClick={() => { void signOut() }}
            >
              {t('signOut')}
            </button>
          )
          : null}
      </div>
      {sessionEmail === undefined
        ? null
        : <p className={styles['savedNotice']}>{`${t('accountSignedIn')} ${sessionEmail}`}</p>}
      {access === undefined
        ? null
        : (
          <p className={access.desktopAgent ? styles['savedNotice'] : styles['notice']}>
            {`${t('accountRole')} ${access.role}. ${
              access.desktopAgent ? t('accountDesktopAgent') : t('accountNoDesktopAgent')
            }`}
          </p>
        )}
      {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
    </div>
  )
}
