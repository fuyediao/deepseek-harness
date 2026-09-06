/**
 * Register a {@link GeoCrmAdapter} for the `geocrm` provider route on
 * `ctx.llm`. Connection facts resolve per request: the plugin layers its
 * `cordis.yml` entry config under the optional `llm-geocrm` user-settings
 * section and resolves the GeoCRM session token through the optional
 * credential seam, so a changed origin or token reaches the next request
 * without a restart. The retry policy is the one registration-captured fact
 * and re-registers the route in place when it changes.
 * @module @deepseek-ai/dsh-llm-geocrm
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError, resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import {
  DEFAULT_BASE_URL,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GeoCrmAdapter,
} from './adapter.ts'
import type { GeoCrmConnectionOptions } from './adapter.ts'
import { DEFAULT_MODELS, resolveAdvisoryModels } from './catalog.ts'
import type { GeoCrmCatalogModel } from './catalog.ts'
import { normalizeGeoCrmOrigin } from './http.ts'
import { resolveGeoCrmOrigin } from './origin.ts'
import { GeoCrmSessionError, resolveLiveSessionToken } from './session.ts'

export {
  DEFAULT_BASE_URL,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  GeoCrmAdapter,
} from './adapter.ts'
export type { GeoCrmAdapterOptions, GeoCrmConnectionOptions } from './adapter.ts'
export {
  DEFAULT_MODELS,
  GEOCRM_NOT_CONFIGURED_DESCRIPTION,
  STATIC_FLAGSHIP_MODELS,
  catalogEntryName,
  encodeCompositeModelId,
  parseCompositeModelId,
  parseCatalogResponse,
  resolveAdvisoryModels,
  resolveGeoCrmRoute,
  settingsModelAllowlist,
} from './catalog.ts'
export {
  filterByKeyPresence,
  markByKeyPresence,
  parseConfiguredList,
  parseConfiguredProviders,
  parseKeyPresence,
  providerKeyAliases,
  vendorHasConfiguredKey,
} from './keys.ts'
export type { GeoCrmCatalogEntry, GeoCrmCatalogModel } from './catalog.ts'
export { geocrmHttpErrorCode, normalizeGeoCrmOrigin, parseGeoCrmErrorBody } from './http.ts'
export type { GeoCrmErrorBody } from './http.ts'
export {
  BASE_URL_ENV,
  DEPLOYMENT_DOMAIN_ENV,
  originFromDeploymentDomain,
  resolveGeoCrmOrigin,
} from './origin.ts'
export type { GeoCrmOriginConfig } from './origin.ts'
export {
  ACCESS_REFRESH_LEEWAY_MS,
  GeoCrmSessionError,
  jwtExpiryMs,
  refreshCredentialRef,
  refreshGeoCrmSession,
  resolveLiveSessionToken,
  shouldRefreshAccessToken,
} from './session.ts'
export type {
  GeoCrmRefreshedSession,
  GeoCrmSessionStore,
  ResolveLiveSessionTokenRequest,
} from './session.ts'
export {
  chunksFromGeoCrmEvents,
  instructionsOf,
  parseGeoCrmSseEvent,
  readSseData,
  sseDataOf,
  takeLastFrame,
  textOf,
  toGeoCrmInput,
  toGeoCrmReasoningEffort,
  toGeoCrmRequest,
  toGeoCrmTools,
} from './translate.ts'

export const name = 'llm-geocrm'
export const inject = ['llm']

const NS = 'llm-geocrm'
const DEFAULT_API_KEY_ENV = 'GEOCRM_HARNESS_TOKEN'
/** The single provider route this plugin owns. */
const PROVIDER = 'geocrm'

/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-geocrm` settings-section shape. Every field is optional in
 * yml: a missing session token resolves through {@link Config.apiKeyEnv} at
 * each request (a request without any token fails with `MISSING_CREDENTIAL`,
 * not at plugin load).
 */
export interface Config {
  /** Credential reference resolved per request; defaults to `GEOCRM_HARNESS_TOKEN`. */
  apiKeyEnv?: string
  /**
   * GeoCRM API origin. Falls back to `$GEOCRM_BASE_URL`, then
   * `$GEOCRM_DEPLOYMENT_DOMAIN` as `https://api.{domain}`, then
   * `http://127.0.0.1:3001`. A launch-environment origin wins over this field.
   */
  baseURL?: string
  /** Advisory models shown by discovery consumers; defaults to the static flagships. */
  models?: GeoCrmCatalogModel[]
  /** Positive context capacity used when the selected model has no exact value. */
  defaultContextWindow?: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses normal mode with five retries. */
  retryPolicy?: RetryPolicyConfig
}

const catalogModel: z<GeoCrmCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
})

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().default(DEFAULT_BASE_URL),
  models: z.array(catalogModel).default([...DEFAULT_MODELS]),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
})

/** One resolution's complete request facts. */
export type ResolvedGeoCrmOptions = GeoCrmConnectionOptions

/**
 * The one explicit resolve step from raw config to validated connection
 * facts. Programmatic construction may bypass Schemastery normalization, so
 * every default and bound is re-judged here.
 * @param config - raw plugin config or resolved settings snapshot.
 * @param environment - launch snapshot; origin env vars are read from here.
 * @returns validated connection facts plus the credential reference.
 */
export function resolveAdapterOptions(
  config: Config,
  environment?: Pick<LaunchEnvironmentSnapshot, 'get'>,
): ResolvedGeoCrmOptions {
  if (config.defaultContextWindow !== undefined
    && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) {
    throw new Error('llm-geocrm: defaultContextWindow must be a positive integer')
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-geocrm: streamIdleTimeoutMs must be a positive finite number no greater than ${String(MAX_TIMER_DELAY_MS)}`,
    )
  }
  if (config.baseURL !== undefined && config.baseURL.length === 0) {
    throw new Error('llm-geocrm: baseURL must be a non-empty origin')
  }
  const baseURL = resolveGeoCrmOrigin(config, environment)
  return {
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    baseURL,
    models: resolveAdvisoryModels(config.models),
    defaultContextWindow: config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-geocrm: retryPolicy'),
  }
}

/**
 * Mount the GeoCRM adapter on `ctx.llm`.
 * @param ctx - host context with `llm` injected.
 * @param config - composition entry config; settings may override it later.
 * @returns nothing; registrations dispose with the fiber.
 */
export function apply(ctx: Context, config: Config): void {
  const environment = launchEnvironmentOf(ctx)
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: ResolvedGeoCrmOptions | undefined
  const options = (): ResolvedGeoCrmOptions => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw, environment)
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-geocrm: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  options()
  const entry: Config = {
    apiKeyEnv: config.apiKeyEnv,
    baseURL: resolveGeoCrmOrigin(config, environment),
    models: config.models,
    defaultContextWindow: config.defaultContextWindow,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    retryPolicy: config.retryPolicy,
  }
  current = () => entry

  const resolveApiKey = async (connection: ResolvedGeoCrmOptions): Promise<string> => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    try {
      const token = await resolveLiveSessionToken({
        origin: normalizeGeoCrmOrigin(connection.baseURL),
        apiKeyEnv: ref,
        ...credentials === undefined ? {} : { store: credentials },
        ambient: name => launchEnvironmentOf(ctx).get(name)?.value,
      })
      if (token !== undefined) return assertUsableApiKey(token, 'llm-geocrm', ref)
    } catch (error) {
      if (error instanceof GeoCrmSessionError) {
        throw new LlmError(error.message, error.code)
      }
      throw error
    }
    throw new LlmError(
      `llm-geocrm: no GeoCRM session token for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the desktop Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  const adapter = new GeoCrmAdapter({ options, resolveApiKey })
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'GeoCRM', settingsNs: NS, settingsPath: [] },
  ])
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  ctx.llm.registerModelDiscovery(NS, (request, signal) => adapter.discover(request, signal))
  let registeredPolicy = options().retryPolicy
  const ensureRegistrationFacts = (): void => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, entry, {
      setSource: (source) => {
        current = source
      },
      onChange: ensureRegistrationFacts,
    })
  })
}
