/**
 * GeoCRM session rotation for the desktop Host. Password sign-in stores an
 * access JWT and a refresh token; this module refreshes through
 * `POST /auth/refresh` before `exp` so the next model or tool call keeps working.
 * @module dsh-llm-geocrm/session
 */

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { normalizeGeoCrmOrigin } from './http.ts'

/** Refresh when the access JWT has this many milliseconds or fewer left. */
export const ACCESS_REFRESH_LEEWAY_MS = 5 * 60 * 1000

/** One rotated GeoCRM session. */
export interface GeoCrmRefreshedSession {
  /** Replacement access JWT. */
  readonly accessToken: string
  /** Replacement refresh token when GoTrue rotated it. */
  readonly refreshToken?: string
}

/** Durable store used to read and persist the session pair. */
export interface GeoCrmSessionStore {
  /**
   * Read one credential reference.
   * @param ref - access or refresh reference.
   * @returns the stored value, or `undefined` when unset.
   */
  resolve(ref: string): Promise<{ value: string } | undefined>
  /**
   * Persist one credential reference.
   * @param ref - access or refresh reference.
   * @param value - the new secret.
   */
  set?(ref: string, value: string): Promise<void>
}

/** Inputs for {@link resolveLiveSessionToken}. */
export interface ResolveLiveSessionTokenRequest {
  /** GeoCRM API origin. */
  readonly origin: string
  /** Access-token credential reference (`GEOCRM_HARNESS_TOKEN` by default). */
  readonly apiKeyEnv: string
  /** Credentials seam, when the Host has one. */
  readonly store?: GeoCrmSessionStore
  /**
   * Launch-environment fallback for a reference.
   * @param ref - credential reference name.
   * @returns the ambient value, or `undefined`.
   */
  readonly ambient?: (ref: string) => string | undefined
  /** Clock override for tests. */
  readonly now?: number
  /** Optional abort for the refresh POST. */
  readonly signal?: AbortSignal
}

/** Thrown when a stored session is expired and rotation failed. */
export class GeoCrmSessionError extends Error {
  /** Harness error code the LLM adapter maps this failure to. */
  readonly code: 'AUTH'

  /**
   * @param message - operator-facing diagnostic.
   */
  constructor(message: string) {
    super(message)
    this.name = 'GeoCrmSessionError'
    this.code = 'AUTH'
  }
}

let refreshChain: Promise<void> = Promise.resolve()

/**
 * Derive the refresh-token credential reference from the access-token name.
 * `GEOCRM_HARNESS_TOKEN` becomes `GEOCRM_HARNESS_REFRESH`; any other name
 * appends `_REFRESH`.
 * @param apiKeyEnv - access-token reference.
 * @returns the refresh-token reference.
 */
export function refreshCredentialRef(apiKeyEnv: string): string {
  const access = credentialRef(apiKeyEnv)
  return credentialRef(
    access.endsWith('_TOKEN') ? `${access.slice(0, -'_TOKEN'.length)}_REFRESH` : `${access}_REFRESH`,
  )
}

/**
 * Read `exp` from a JWT payload without verifying the signature.
 * @param token - compact JWT.
 * @returns expiry in milliseconds, or `undefined` when the token is not a JWT
 *   with a numeric `exp` (paste tokens are left alone).
 */
export function jwtExpiryMs(token: string): number | undefined {
  const payload = decodeJwtPayload(token)
  if (payload === undefined || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    return undefined
  }
  return payload.exp * 1000
}

/**
 * Whether this access token should be rotated before the next request.
 * @param token - current access JWT or opaque paste token.
 * @param now - clock in milliseconds.
 * @param leewayMs - remaining lifetime that still triggers a refresh.
 * @returns true when the token has a numeric `exp` and remaining life is at most `leewayMs`.
 */
export function shouldRefreshAccessToken(
  token: string,
  now = Date.now(),
  leewayMs = ACCESS_REFRESH_LEEWAY_MS,
): boolean {
  const expiry = jwtExpiryMs(token)
  if (expiry === undefined) return false
  return expiry - now <= leewayMs
}

/**
 * Call GeoCRM `POST /auth/refresh` with a stored refresh token.
 * @param origin - GeoCRM API origin.
 * @param refreshToken - current refresh token.
 * @param signal - optional abort.
 * @returns the rotated session.
 */
export async function refreshGeoCrmSession(
  origin: string,
  refreshToken: string,
  signal?: AbortSignal,
): Promise<GeoCrmRefreshedSession> {
  const response = await fetch(`${normalizeGeoCrmOrigin(origin)}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
    ...signal === undefined ? {} : { signal },
  })
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(authErrorMessage(raw, `GeoCRM refresh failed with HTTP ${String(response.status)}`))
  }
  let parsed: { access_token?: unknown; refresh_token?: unknown }
  try {
    parsed = JSON.parse(raw) as { access_token?: unknown; refresh_token?: unknown }
  } catch {
    throw new Error('GeoCRM refresh returned a non-JSON body')
  }
  if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
    throw new Error('GeoCRM refresh returned no access token')
  }
  return {
    accessToken: parsed.access_token,
    ...typeof parsed.refresh_token === 'string' && parsed.refresh_token.length > 0
      ? { refreshToken: parsed.refresh_token }
      : {},
  }
}

/**
 * Resolve a usable GeoCRM access token, rotating it when `exp` is inside the
 * leeway and a refresh token is stored.
 * @param request - origin, references, and stores.
 * @returns the access token, or `undefined` when none is stored.
 */
export async function resolveLiveSessionToken(
  request: ResolveLiveSessionTokenRequest,
): Promise<string | undefined> {
  const accessRef = credentialRef(request.apiKeyEnv)
  const refreshRef = refreshCredentialRef(request.apiKeyEnv)
  const now = request.now ?? Date.now()
  const access = await readSecret(request, accessRef)
  if (access === undefined) return undefined
  const refresh = await readSecret(request, refreshRef)
  if (refresh === undefined || !shouldRefreshAccessToken(access, now)) {
    return usableAccessToken(access, refresh, now)
  }

  return await withRefreshLock(async () => {
    const latestAccess = await readSecret(request, accessRef)
    if (latestAccess === undefined) return undefined
    const latestRefresh = await readSecret(request, refreshRef)
    if (latestRefresh === undefined || !shouldRefreshAccessToken(latestAccess, now)) {
      return usableAccessToken(latestAccess, latestRefresh, now)
    }
    try {
      const next = await refreshGeoCrmSession(request.origin, latestRefresh, request.signal)
      await persistRotated(request.store, accessRef, refreshRef, next)
      return next.accessToken
    } catch (error) {
      const expiry = jwtExpiryMs(latestAccess)
      if (expiry !== undefined && expiry <= now) {
        throw new GeoCrmSessionError(
          error instanceof Error
            ? error.message
            : 'GeoCRM session expired; sign in again on the Models page',
        )
      }
      return latestAccess
    }
  })
}

/**
 * Refuse an expired access JWT when no refresh token can rotate it.
 * A still-valid access token is returned even without a refresh token.
 * @param access - stored access JWT.
 * @param refresh - stored refresh token, when one exists.
 * @param now - clock in milliseconds.
 * @returns the access token when it can still be sent.
 */
function usableAccessToken(
  access: string,
  refresh: string | undefined,
  now: number,
): string {
  const expiry = jwtExpiryMs(access)
  if (refresh === undefined && expiry !== undefined && expiry <= now) {
    throw new GeoCrmSessionError('GeoCRM session expired; sign in again on the Models page')
  }
  return access
}

/**
 * Decode the JWT payload object without verifying it.
 * @param token - compact JWT.
 * @returns the payload object, or `undefined` when it is not a JSON object.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed
  } catch {
    // Paste tokens and truncated JWTs stay opaque; callers skip refresh.
    return undefined
  }
}

/**
 * Read a public `{ error }` message from a GeoCRM auth body.
 * @param raw - response text.
 * @param fallback - message when the body is not that document.
 * @returns operator-facing text.
 */
function authErrorMessage(raw: string, fallback: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown }
    if (typeof parsed.error === 'string' && parsed.error.length > 0) return parsed.error
  } catch {
    // Status text remains the fallback when the body is not JSON.
  }
  return fallback
}

/**
 * Read one secret from the store, then the launch environment.
 * @param request - resolution inputs.
 * @param ref - credential reference.
 * @returns a non-empty value, or `undefined`.
 */
async function readSecret(
  request: ResolveLiveSessionTokenRequest,
  ref: string,
): Promise<string | undefined> {
  if (request.store !== undefined) {
    const hit = await request.store.resolve(ref)
    if (hit !== undefined && hit.value.length > 0) return hit.value
  }
  const ambient = request.ambient?.(ref)
  if (ambient !== undefined && ambient.length > 0) return ambient
  return undefined
}

/**
 * Persist a rotated pair. Launch-environment refs may refuse writes; the
 * caller still receives the new access token for this request.
 * @param store - optional credentials seam.
 * @param accessRef - access-token reference.
 * @param refreshRef - refresh-token reference.
 * @param next - rotated session.
 */
async function persistRotated(
  store: GeoCrmSessionStore | undefined,
  accessRef: string,
  refreshRef: string,
  next: GeoCrmRefreshedSession,
): Promise<void> {
  if (store?.set === undefined) return
  try {
    await store.set(accessRef, next.accessToken)
  } catch {
    // Launch-environment refs refuse writes; this request still uses the rotated JWT.
  }
  if (next.refreshToken === undefined) return
  try {
    await store.set(refreshRef, next.refreshToken)
  } catch {
    // Same write refusal as the access ref; the in-memory token is enough for this call.
  }
}

/**
 * Serialize overlapping refresh attempts so GoTrue rotation stays single-flight.
 * @param work - the refresh-or-reread body.
 * @returns the body's result.
 */
async function withRefreshLock<T>(work: () => Promise<T>): Promise<T> {
  let release!: () => void
  const previous = refreshChain
  refreshChain = new Promise((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await work()
  } finally {
    release()
  }
}
