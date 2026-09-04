/**
 * GeoCRM public login and harness access probe used by the desktop Models card.
 * The renderer talks to the GeoCRM API origin the same way GeoCRM Electron
 * does (`POST /auth/password`, `POST /auth/public/resolve-employee-id`). The
 * resulting access token is stored through the credentials Remote; this module
 * never keeps the password.
 */

/** Employee id accepted by GeoCRM after normalization (`PS` plus four digits). */
export const EMPLOYEE_ID_PATTERN = /^PS\d{4}$/iu

/** One successful password sign-in. */
export interface GeoCrmSession {
  /** Supabase access JWT stored as `GEOCRM_HARNESS_TOKEN`. */
  readonly accessToken: string
  /** Account email returned by GeoCRM, or the email used to sign in. */
  readonly email: string
}

/** Harness ACL snapshot from `list_my_access`. */
export interface GeoCrmAccess {
  /** GeoCRM role (`member`, `group_admin`, `global_leader`, `system_admin`). */
  readonly role: string
  /** Whether `desktop_modules` includes `desktop_agent`. */
  readonly desktopAgent: boolean
  /** Entity keys the caller may read. */
  readonly readableEntities: readonly string[]
}

/**
 * Strip trailing slashes from a GeoCRM API origin.
 * @param baseURL - origin as the card shows it.
 * @returns origin used as the prefix for `/auth/*` and `/ai/harness/tools/*`.
 */
export function normalizeGeoCrmOrigin(baseURL: string): string {
  return baseURL.replace(/\/+$/u, '')
}

/**
 * Normalize typed employee-id input to `PS####`.
 * @param raw - field value as typed.
 * @returns `PS` plus a four-digit suffix, or empty when no digits are present.
 */
export function normalizeEmployeeId(raw: string): string {
  const stripped = raw.trim().replace(/^ps/iu, '')
  const digits = stripped.replace(/\D/gu, '').slice(0, 4)
  if (digits.length === 0) return ''
  const suffix = /^0+$/u.test(digits) ? '0' : digits.replace(/^0+/u, '').slice(0, 4)
  return `PS${suffix.padStart(4, '0')}`
}

/**
 * Read a GeoCRM public-error message (`{"error":"..."}` or a gateway object).
 * @param raw - response text.
 * @returns the message when present.
 */
export function parsePublicError(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown }
    if (typeof parsed.error === 'string' && parsed.error.length > 0) return parsed.error
    if (typeof parsed.error === 'object' && parsed.error !== null) {
      const message = (parsed.error as { message?: unknown }).message
      if (typeof message === 'string' && message.length > 0) return message
    }
  } catch {
    // Status text remains the fallback when the body is not JSON.
  }
  return undefined
}

/**
 * Resolve a `PS####` employee id to the account email.
 * @param origin - GeoCRM API origin.
 * @param employeeId - already-normalized employee id.
 * @param signal - optional abort.
 * @returns the matching email.
 */
export async function resolveEmployeeEmail(
  origin: string,
  employeeId: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${normalizeGeoCrmOrigin(origin)}/auth/public/resolve-employee-id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: employeeId }),
    ...signal === undefined ? {} : { signal },
  })
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(parsePublicError(raw) ?? 'Could not resolve that employee ID')
  }
  let parsed: { email?: unknown }
  try {
    parsed = JSON.parse(raw) as { email?: unknown }
  } catch {
    throw new Error('Could not resolve that employee ID')
  }
  if (typeof parsed.email !== 'string' || parsed.email.trim().length === 0) {
    throw new Error('Could not resolve that employee ID')
  }
  return parsed.email.trim().toLowerCase()
}

/**
 * Sign in with email and password against GeoCRM `POST /auth/password`.
 * @param origin - GeoCRM API origin.
 * @param email - account email.
 * @param password - account password; not stored.
 * @param signal - optional abort.
 * @returns the access token and email.
 */
export async function signInWithPassword(
  origin: string,
  email: string,
  password: string,
  signal?: AbortSignal,
): Promise<GeoCrmSession> {
  const normalized = email.trim().toLowerCase()
  const response = await fetch(`${normalizeGeoCrmOrigin(origin)}/auth/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normalized, password }),
    ...signal === undefined ? {} : { signal },
  })
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(parsePublicError(raw) ?? 'Invalid credentials')
  }
  let parsed: { access_token?: unknown; user?: { email?: unknown } }
  try {
    parsed = JSON.parse(raw) as { access_token?: unknown; user?: { email?: unknown } }
  } catch {
    throw new Error('Invalid credentials')
  }
  if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
    throw new Error('Invalid credentials')
  }
  const userEmail = typeof parsed.user?.email === 'string' && parsed.user.email.length > 0
    ? parsed.user.email
    : normalized
  return { accessToken: parsed.access_token, email: userEmail }
}

/**
 * Probe harness ACL through `POST /ai/harness/tools/list_my_access`.
 * @param origin - GeoCRM API origin.
 * @param token - session JWT.
 * @param signal - optional abort.
 * @returns role and whether `desktop_agent` is granted.
 */
export async function probeAccess(
  origin: string,
  token: string,
  signal?: AbortSignal,
): Promise<GeoCrmAccess> {
  const response = await fetch(`${normalizeGeoCrmOrigin(origin)}/ai/harness/tools/list_my_access`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ arguments: {} }),
    ...signal === undefined ? {} : { signal },
  })
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(parsePublicError(raw) ?? `Access check failed with HTTP ${String(response.status)}`)
  }
  let body: { result?: unknown; isError?: unknown }
  try {
    body = JSON.parse(raw) as { result?: unknown; isError?: unknown }
  } catch {
    throw new Error('Access check failed')
  }
  if (body.isError === true) {
    throw new Error(typeof body.result === 'string' ? body.result : 'Access check failed')
  }
  let payload: Record<string, unknown>
  try {
    payload = typeof body.result === 'string'
      ? JSON.parse(body.result) as Record<string, unknown>
      : {}
  } catch {
    payload = {}
  }
  const modules = Array.isArray(payload.desktop_modules)
    ? payload.desktop_modules.filter((entry): entry is string => typeof entry === 'string')
    : []
  const readable = Array.isArray(payload.readable_entities)
    ? payload.readable_entities.filter((entry): entry is string => typeof entry === 'string')
    : []
  return {
    role: typeof payload.role === 'string' && payload.role.length > 0 ? payload.role : 'member',
    desktopAgent: modules.includes('desktop_agent'),
    readableEntities: readable,
  }
}
