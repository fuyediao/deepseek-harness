/**
 * Resolve the GeoCRM API origin from the launch environment, then config.
 * Desktop deployments switch backends with `.env`, not the Models card.
 * @module dsh-llm-geocrm/origin
 */

import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { DEFAULT_BASE_URL } from './adapter.ts'
import { normalizeGeoCrmOrigin } from './http.ts'

/** Full GeoCRM API origin (`https://api.example.com`). */
export const BASE_URL_ENV = 'GEOCRM_BASE_URL'

/** Deployment hostname; becomes `https://api.{domain}` when {@link BASE_URL_ENV} is unset. */
export const DEPLOYMENT_DOMAIN_ENV = 'GEOCRM_DEPLOYMENT_DOMAIN'

/** Inputs that can name an origin before the hardcoded local default. */
export interface GeoCrmOriginConfig {
  /** Explicit origin from composition or a settings section. */
  readonly baseURL?: string
}

/**
 * Build `https://api.{host}` from a GeoCRM deployment domain.
 * Accepts a bare host, a URL, or an `api.`-prefixed host.
 * @param raw - `GEOCRM_DEPLOYMENT_DOMAIN` as written.
 * @returns the API origin, or `undefined` when nothing usable remains.
 */
export function originFromDeploymentDomain(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const host = raw.trim()
    .replace(/^https?:\/\//iu, '')
    .replace(/\/+$/u, '')
    .replace(/^api\./iu, '')
  if (host.length === 0) return undefined
  return `https://api.${host}`
}

/**
 * Resolve the GeoCRM API origin. A launch-environment origin wins so a VPS
 * `.env` is the switch; the Models card is not.
 * @param config - composition or settings snapshot.
 * @param environment - launch snapshot; omitted in programmatic construction.
 * @returns origin without a trailing slash.
 */
export function resolveGeoCrmOrigin(
  config: GeoCrmOriginConfig,
  environment?: Pick<LaunchEnvironmentSnapshot, 'get'>,
): string {
  const fromBase = environment?.get(BASE_URL_ENV)?.value.trim()
  if (fromBase !== undefined && fromBase.length > 0) return normalizeGeoCrmOrigin(fromBase)
  const fromDomain = originFromDeploymentDomain(environment?.get(DEPLOYMENT_DOMAIN_ENV)?.value)
  if (fromDomain !== undefined) return fromDomain
  const fromConfig = config.baseURL?.trim()
  if (fromConfig !== undefined && fromConfig.length > 0) return normalizeGeoCrmOrigin(fromConfig)
  return DEFAULT_BASE_URL
}
