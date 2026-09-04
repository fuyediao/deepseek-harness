/**
 * GeoCRM HTTP error mapping and origin normalization for the desktop adapter.
 * @module dsh-llm-geocrm/http
 */

import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
  QUOTA_EXCEEDED_CODE,
} from '@deepseek-ai/dsh-llm'

/** Parsed GeoCRM JSON error body (`{ error: { message, type }, code }`). */
export interface GeoCrmErrorBody {
  /** Stable GeoCRM error type (`invalid_model`, `missing_api_key`, …). */
  readonly type?: string
  /** Human-readable refusal. */
  readonly message?: string
  /** Duplicate of `type` at the document root, when present. */
  readonly code?: string
}

/**
 * Strip a trailing slash from a GeoCRM API origin.
 * @param baseURL - configured origin, possibly with a trailing slash.
 * @returns origin used as the prefix for `/ai/models` and `/ai/harness/responses`.
 */
export function normalizeGeoCrmOrigin(baseURL: string): string {
  return baseURL.replace(/\/+$/u, '')
}

/**
 * Read a GeoCRM JSON error from a failed HTTP body.
 * @param raw - response text.
 * @returns message and type when the body matches the gateway error document.
 */
export function parseGeoCrmErrorBody(raw: string): GeoCrmErrorBody {
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: unknown; type?: unknown }
      code?: unknown
    }
    const type = typeof parsed.error?.type === 'string'
      ? parsed.error.type
      : typeof parsed.code === 'string' ? parsed.code : undefined
    const message = typeof parsed.error?.message === 'string' ? parsed.error.message : undefined
    return {
      ...type === undefined ? {} : { type },
      ...message === undefined ? {} : { message },
      ...typeof parsed.code === 'string' ? { code: parsed.code } : {},
    }
  } catch {
    // The HTTP status remains authoritative when a gateway returns non-JSON.
    return {}
  }
}

/**
 * Map an HTTP status and GeoCRM error type to a stable {@link LlmError} code.
 * @param status - status of a non-2xx GeoCRM response.
 * @param error - parsed error body, when available.
 * @returns the normalized harness error code.
 */
export function geocrmHttpErrorCode(status: number, error?: GeoCrmErrorBody): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 413 || status === 422) return 'INVALID_REQUEST'
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(' ')
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE
    return 'INVALID_REQUEST'
  }
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}
