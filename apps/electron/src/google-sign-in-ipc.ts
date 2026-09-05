/**
 * IPC names and result objects for desktop Google sign-in.
 * The preload script imports only this module so the sandboxed renderer
 * bundle never pulls in the loopback HTTP server.
 */

/** Renderer → main invoke channel for GeoCRM `GET /auth/google`. */
export const GOOGLE_SIGN_IN_CHANNEL = 'dsh:google-sign-in'

/** Outcome of one desktop Google sign-in attempt. */
export type GoogleSignInOutcome =
  | { readonly ok: true; readonly accessToken: string; readonly refreshToken?: string }
  | { readonly ok: false; readonly error: string }
