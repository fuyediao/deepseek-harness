/**
 * Electron renderer bridge for GeoCRM Google sign-in.
 * Present only when the desktop preload exposes `signInWithGoogle`.
 * `dsh web` has no bridge, so the cover hides the Google button.
 */

import { emailFromAccessToken, type GeoCrmSession } from './geocrm-auth.ts'

/** Result object the desktop preload clones across the context bridge. */
export type DesktopGoogleSignInResult =
  | { readonly ok: true; readonly accessToken: string; readonly refreshToken?: string }
  | { readonly ok: false; readonly error: string }

interface DshElectronBridge {
  signInWithGoogle?(this: void, origin: string): Promise<DesktopGoogleSignInResult>
}

function desktopBridge(): DshElectronBridge | undefined {
  return (globalThis as { __dshElectronBridge__?: DshElectronBridge }).__dshElectronBridge__
}

/**
 * Whether this renderer can start GeoCRM Google sign-in.
 * @returns true only when the Electron preload installed the invoke.
 */
export function canDesktopGoogleSignIn(): boolean {
  const signIn = desktopBridge()?.signInWithGoogle
  return typeof signIn === 'function'
}

/**
 * Open the system browser through the desktop shell and wait for tokens.
 * @param origin - GeoCRM API origin the authorize URL uses.
 * @returns the same session object password sign-in stores.
 * @throws Error whose `message` is a stable code (`cancelled`, `unavailable`,
 *   `in_progress`, `invalid_origin`, `missing_token`, `invalid_state`) or a
 *   GeoCRM OAuth error.
 */
export async function desktopGoogleSignIn(origin: string): Promise<GeoCrmSession> {
  const signIn = desktopBridge()?.signInWithGoogle
  if (signIn === undefined) {
    throw new Error('unavailable')
  }
  const result = await signIn(origin)
  if (!result.ok) {
    throw new Error(result.error)
  }
  return {
    accessToken: result.accessToken,
    ...result.refreshToken !== undefined && result.refreshToken.length > 0
      ? { refreshToken: result.refreshToken }
      : {},
    email: emailFromAccessToken(result.accessToken) ?? '',
  }
}

/**
 * Map a desktop Google error code to Models-card copy.
 * @param code - `Error.message` from {@link desktopGoogleSignIn}.
 * @param t - section copy.
 * @returns localized failure text; unknown codes use the generic failure string.
 */
export function googleSignInFailureCopy(
  code: string,
  t: (key: 'googleSignInCancelled' | 'googleSignInInProgress' | 'googleSignInUnavailable' | 'googleSignInFailed') => string,
): string {
  if (code === 'cancelled' || code === 'access_denied') return t('googleSignInCancelled')
  if (code === 'in_progress') return t('googleSignInInProgress')
  if (code === 'unavailable') return t('googleSignInUnavailable')
  return t('googleSignInFailed')
}
