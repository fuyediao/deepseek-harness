/**
 * GeoCRM employee-id or email password sign-in on the Models card.
 * The desktop renderer also offers Google through the Electron preload
 * (`GET /auth/google` in the system browser). Stores the access JWT and
 * refresh token through the credentials Remote and probes `list_my_access`
 * so the card can show `desktop_agent`.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  canDesktopGoogleSignIn,
  desktopGoogleSignIn,
  googleSignInFailureCopy,
} from './desktop-auth.ts'
import type { GeoCrmAccess, GeoCrmSession } from './geocrm-auth.ts'
import {
  fetchSessionEmail,
  normalizeEmployeeId,
  probeAccess,
  refreshCredentialRef,
  resolveEmployeeEmail,
  signInWithPassword,
} from './geocrm-auth.ts'
import type { ModelsOperations } from './operations.ts'
import type { en } from './locales.ts'
import cover from './GeoCrmSignIn.module.css'
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
  /**
   * After a stored sign-in, the last `list_my_access` probe (or `undefined`
   * when that probe failed). The desktop cover unlocks only on `desktopAgent`.
   */
  onAccess?: (access: GeoCrmAccess | undefined) => void
  /** Hide the Models-card hint when the form sits on the full-window cover. */
  hideHint?: boolean
  /** Use the full-window cover field chrome instead of the Models-card controls. */
  cover?: boolean
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
  const [googleBusy, setGoogleBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [sessionEmail, setSessionEmail] = useState<string | undefined>(undefined)
  const [access, setAccess] = useState<GeoCrmAccess | undefined>(undefined)
  const disabled = props.disabled || busy || googleBusy || props.keyLocked
  const showGoogle = canDesktopGoogleSignIn() && !props.configured && sessionEmail === undefined

  const persistSession = async (session: GeoCrmSession): Promise<void> => {
    const stored = await props.operations.storeCredential(props.keyRef, session.accessToken)
    if (stored !== undefined) {
      setFailure(stored)
      return
    }
    if (session.refreshToken !== undefined) {
      const storedRefresh = await props.operations.storeCredential(
        refreshCredentialRef(props.keyRef),
        session.refreshToken,
      )
      if (storedRefresh !== undefined) {
        await props.operations.removeCredential(props.keyRef)
        setFailure(storedRefresh)
        return
      }
    }
    setPassword('')
    setSessionEmail(session.email.length > 0 ? session.email : undefined)
    props.onCredentialChange()
    try {
      const next = await probeAccess(props.origin, session.accessToken)
      setAccess(next)
      props.onAccess?.(next)
    } catch (error: unknown) {
      setAccess(undefined)
      setFailure(error instanceof Error ? error.message : t('accessCheckFailed'))
      props.onAccess?.(undefined)
    }
  }

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
      await persistSession(await signInWithPassword(props.origin, account, password))
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : t('loginFailed'))
    } finally {
      setBusy(false)
    }
  }

  const signInGoogle = async (): Promise<void> => {
    setGoogleBusy(true)
    setFailure(undefined)
    try {
      const session = await desktopGoogleSignIn(props.origin)
      const emailHint = session.email.length > 0
        ? session.email
        : await fetchSessionEmail(props.origin, session.accessToken) ?? ''
      await persistSession({ ...session, email: emailHint })
    } catch (error: unknown) {
      setFailure(googleSignInFailureCopy(
        error instanceof Error ? error.message : 'failed',
        t,
      ))
    } finally {
      setGoogleBusy(false)
    }
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const removed = await props.operations.removeCredential(props.keyRef)
      const removedRefresh = await props.operations.removeCredential(refreshCredentialRef(props.keyRef))
      if (removed !== undefined) {
        setFailure(removed)
        return
      }
      if (removedRefresh !== undefined) {
        setFailure(removedRefresh)
        return
      }
      setAccess(undefined)
      setSessionEmail(undefined)
      props.onCredentialChange()
    } finally {
      setBusy(false)
    }
  }

  const onCover = props.cover === true
  const formClass = onCover ? cover.form : styles['signIn']
  const modeRowClass = onCover ? cover.modeRow : styles['modeRow']
  const modeButtonClass = onCover ? cover.modeButton : styles['secondaryButton']
  const fieldClass = onCover ? cover.field : styles['field']
  const fieldLabelClass = onCover ? cover.fieldLabel : styles['fieldLabel']
  const inputClass = onCover ? cover.input : styles['input']
  const actionsClass = onCover ? cover.actions : styles['signInActions']
  const submitClass = onCover ? cover.submit : styles['primaryButton']

  return (
    <div className={formClass}>
      {props.hideHint === true ? null : <p className={styles['advancedHint']}>{t('signInHint')}</p>}
      {showGoogle
        ? (
          <>
            <button
              type="button"
              className={cover.google}
              disabled={disabled}
              onClick={() => { void signInGoogle() }}
            >
              <GoogleMark />
              {googleBusy ? t('signingInWithGoogle') : t('signInWithGoogle')}
            </button>
            <div className={cover.divider}>{t('signInDivider')}</div>
          </>
        )
        : null}
      <div className={modeRowClass} role="group" aria-label={t('loginMode')}>
        <button
          type="button"
          className={modeButtonClass}
          aria-pressed={mode === 'employeeId'}
          disabled={disabled}
          onClick={() => { setMode('employeeId') }}
        >
          {t('loginModeEmployeeId')}
        </button>
        <button
          type="button"
          className={modeButtonClass}
          aria-pressed={mode === 'email'}
          disabled={disabled}
          onClick={() => { setMode('email') }}
        >
          {t('loginModeEmail')}
        </button>
      </div>
      {mode === 'employeeId'
        ? (
          <div className={fieldClass}>
            <span className={fieldLabelClass}>{t('employeeId')}</span>
            <input
              className={inputClass}
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
          <div className={fieldClass}>
            <span className={fieldLabelClass}>{t('loginEmail')}</span>
            <input
              className={inputClass}
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
      <div className={fieldClass}>
        <span className={fieldLabelClass}>{t('loginPassword')}</span>
        <input
          className={inputClass}
          type="password"
          autoComplete="current-password"
          value={password}
          placeholder={t('loginPasswordPlaceholder')}
          aria-label={t('loginPassword')}
          disabled={disabled}
          onChange={(event) => { setPassword(event.target.value) }}
        />
      </div>
      <div className={actionsClass}>
        <button
          type="button"
          className={submitClass}
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

/**
 * Official four-color Google "G" mark for the desktop sign-in button.
 * @returns decorative SVG (hidden from the accessibility tree).
 */
function GoogleMark(): ReactNode {
  return (
    <svg className={cover.googleMark} width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  )
}
