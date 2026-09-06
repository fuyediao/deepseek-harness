/**
 * `GeoCrmAdapter`: fetch against a GeoCRM BYOK origin, translating Codex-subset
 * Responses SSE into harness stream chunks. Connection facts arrive through a
 * thunk resolved once per operation and the session token through a
 * per-request resolver, so the registering plugin owns validation and
 * credential policy.
 * @module dsh-llm-geocrm/adapter
 */

import {
  attributionHeaders,
  LlmAdapter,
  LlmError,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmDiscoveredModel,
  LlmModelDiscoveryRequest,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import {
  catalogEntriesToDiscovered,
  catalogEntriesToModels,
  encodeCompositeModelId,
  parseCatalogResponse,
  resolveGeoCrmRoute,
  settingsModelAllowlist,
  STATIC_FLAGSHIP_MODELS,
  type GeoCrmCatalogEntry,
  type GeoCrmCatalogModel,
} from './catalog.ts'
import {
  filterByKeyPresence,
  markByKeyPresence,
  parseConfiguredList,
  parseConfiguredProviders,
} from './keys.ts'
import { geocrmHttpErrorCode, normalizeGeoCrmOrigin, parseGeoCrmErrorBody } from './http.ts'
import { chunksFromGeoCrmEvents, parseGeoCrmSseEvent, readSseData, toGeoCrmRequest } from './translate.ts'

/** Default combined context used when a catalog row has no exact value. */
export const DEFAULT_CONTEXT_WINDOW = 200_000

/** Default maximum provider idle time while one stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

/** Default GeoCRM API origin for a local `geocrm-api` process. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:3001'

/** Idle-watchdog code translated to harness `TIMEOUT`. */
const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT'

/** Validated connection facts for one resolution generation. */
export interface GeoCrmConnectionOptions {
  /** Credential reference resolved per request. */
  readonly apiKeyEnv: CredentialRef
  /** GeoCRM API origin (no `/ai` suffix). */
  readonly baseURL: string
  /** Advisory models shown when a live catalog fetch is unavailable. */
  readonly models: readonly GeoCrmCatalogModel[]
  /** Combined-context fallback for models without an exact value. */
  readonly defaultContextWindow: number
  /** Maximum provider idle time while one stream read is outstanding. */
  readonly streamIdleTimeoutMs: number
  /** Provider-owned retry policy captured at registration. */
  readonly retryPolicy: ResolvedRetryPolicy
}

/** Construction hooks for {@link GeoCrmAdapter}. */
export interface GeoCrmAdapterOptions {
  /** Current connection facts; called once per operation. */
  readonly options: () => GeoCrmConnectionOptions
  /**
   * Resolve the GeoCRM session token for this connection snapshot.
   * @param connection - the snapshot whose credential reference to resolve.
   * @returns a usable Bearer token.
   */
  readonly resolveApiKey: (connection: GeoCrmConnectionOptions) => Promise<string>
}

/**
 * One adapter instance serves the `geocrm` route. Model ids are composite
 * `provider:model` picker ids; the wire request strips the slug into
 * `x-geocrm-provider` and sends the vendor id as `model`.
 */
export class GeoCrmAdapter extends LlmAdapter {
  constructor(private readonly config: GeoCrmAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'GeoCRM' }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.config.options().retryPolicy
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const connection = this.config.options()
    try {
      const token = await this.config.resolveApiKey(connection)
      const origin = normalizeGeoCrmOrigin(connection.baseURL)
      const [live, configured] = await Promise.all([
        this.fetchCatalog(origin, token),
        this.fetchConfiguredProviders(origin, token),
      ])
      const keyed = filterByKeyPresence(live, configured)
      const allow = settingsModelAllowlist(connection.models)
      return catalogEntriesToModels(
        provider,
        allow === null
          ? keyed
          : keyed.filter(entry => allow.has(encodeCompositeModelId(entry.provider, entry.id))),
      )
    } catch {
      // Advisory catalog remains the answer when the token is missing or the
      // origin is unreachable; stream still fails at the Responses POST.
      return connection.models.map(model => ({
        provider,
        id: model.id,
        name: model.name ?? model.id,
        ...model.description === undefined ? {} : { description: model.description },
      }))
    }
  }

  override async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const connection = this.config.options()
    const catalog = await this.tryLiveCatalog(connection) ?? entriesFromAdvisory(connection.models)
    const route = resolveGeoCrmRoute(model, catalog)
    const match = catalog.find(entry => entry.provider === route.provider && entry.id === route.model)
    const advisory = connection.models.find(entry => entry.id === model)
    return {
      provider,
      id: model,
      name: match?.labelEn ?? advisory?.name ?? model,
      ...advisory?.description === undefined ? {} : { description: advisory.description },
      ...match?.vision === true ? { inputModalities: ['text', 'image'] } : {},
      context: {
        contextWindow: advisory?.contextWindow ?? connection.defaultContextWindow,
      },
      ...advisory?.maxTokens === undefined ? {} : { defaultMaxTokens: advisory.maxTokens },
    }
  }

  override async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    const connection = this.config.options()
    const apiKey = await this.config.resolveApiKey(connection)
    const resolved = await this.resolveModel(provider, model, signal)
    return {
      model: resolved,
      stream: options => this.streamResolved(connection, apiKey, model, options),
    }
  }

  override async* stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const connection = this.config.options()
    const apiKey = await this.config.resolveApiKey(connection)
    yield* this.streamResolved(connection, apiKey, options.model, options)
  }

  /**
   * Interrogate `GET /ai/models?client=electron` for one draft endpoint.
   * A missing draft token uses the stored session token. When that is also
   * missing, the static flagship list is the answer so the card can still
   * show models before sign-in.
   * @param request - draft endpoint and optional one-shot token.
   * @param signal - caller cancellation.
   * @returns discovered composite model ids in catalog order.
   */
  async discover(
    request: LlmModelDiscoveryRequest,
    signal?: AbortSignal,
  ): Promise<readonly LlmDiscoveredModel[]> {
    const origin = normalizeGeoCrmOrigin(request.baseURL ?? this.config.options().baseURL)
    const token = await this.discoveryToken(request)
    if (token === undefined) {
      return catalogEntriesToDiscovered(STATIC_FLAGSHIP_MODELS)
    }
    const entries = await this.fetchCatalog(origin, token, signal)
    const configured = await this.fetchConfiguredProviders(origin, token)
    return catalogEntriesToDiscovered(markByKeyPresence(entries, configured))
  }

  /**
   * Token for one discovery: a key typed on the card, else the stored session.
   * @param request - draft interrogation payload.
   * @returns a usable Bearer token, or `undefined` when none is stored.
   */
  private async discoveryToken(request: LlmModelDiscoveryRequest): Promise<string | undefined> {
    if (request.apiKey !== undefined && request.apiKey.length > 0) return request.apiKey
    try {
      const token = await this.config.resolveApiKey(this.config.options())
      return token.length === 0 ? undefined : token
    } catch (error) {
      if (error instanceof LlmError && error.code === 'AUTH') throw error
      // Draft interrogation without a stored session still shows flagships.
      return undefined
    }
  }

  /**
   * Stream one already-resolved connection generation.
   * The idle watchdog wraps the whole turn — catalog GET, Responses POST, and
   * SSE reads — because Node does not flush HTTP headers until the first write,
   * so a hung POST never reaches the body reader.
   * @param connection - snapshot whose origin and idle bound apply.
   * @param apiKey - Bearer token captured with that snapshot.
   * @param model - picker model id from the request.
   * @param options - assembled harness request.
   * @returns harness chunks for this complete GeoCRM turn.
   */
  private async* streamResolved(
    connection: GeoCrmConnectionOptions,
    apiKey: string,
    model: string,
    options: GenerateOptions,
  ): AsyncIterable<StreamChunk> {
    using watchdog = idleWatchdog(options.signal, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE)
    const iterator = this.collectTurn(
      connection,
      apiKey,
      model,
      options,
      watchdog.signal,
      () => { watchdog.pulse() },
    )[Symbol.asyncIterator]()
    try {
      while (true) {
        const result: IteratorResult<StreamChunk> = await watchdog.next<StreamChunk>(iterator)
        if (result.done) break
        yield result.value
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError('GeoCRM stream idle timeout', 'TIMEOUT', { cause: error })
      }
      throw error
    } finally {
      try {
        await iterator.return(undefined)
      } catch (_streamTeardown: unknown) {
        // The watchdog already owns termination; a return-time abort cannot add a second outcome.
      }
    }
  }

  /**
   * Fetch one GeoCRM turn and emit its harness chunks.
   * @param connection - snapshot whose origin applies.
   * @param apiKey - Bearer token captured with that snapshot.
   * @param model - picker model id from the request.
   * @param options - assembled harness request.
   * @param signal - fused caller and idle-watchdog cancellation.
   * @param onActivity - re-arm the idle timer after each SSE frame.
   * @returns harness chunks for this complete GeoCRM turn.
   */
  private async* collectTurn(
    connection: GeoCrmConnectionOptions,
    apiKey: string,
    model: string,
    options: GenerateOptions,
    signal: AbortSignal,
    onActivity: () => void,
  ): AsyncGenerator<StreamChunk> {
    const origin = normalizeGeoCrmOrigin(connection.baseURL)
    const catalog = await this.tryLiveCatalog(connection, apiKey, signal)
      ?? entriesFromAdvisory(connection.models)
    const route = resolveGeoCrmRoute(model, catalog)
    const response = await this.postResponses(origin, apiKey, route, options, signal)
    if (response.body === null) {
      throw new LlmError('GeoCRM Responses response had no body', 'TRANSPORT')
    }
    const events = []
    for await (const value of readSseData(response.body, signal)) {
      onActivity()
      const event = parseGeoCrmSseEvent(value)
      if (event !== undefined) events.push(event)
    }
    yield* chunksFromGeoCrmEvents(events)
  }

  /**
   * Load a live catalog when a token is available; otherwise `undefined`.
   * @param connection - current origin and credential reference.
   * @param apiKey - already-resolved token, when the caller has one.
   * @param signal - caller cancellation.
   * @returns live rows, or `undefined` when the token or fetch is unavailable.
   */
  private async tryLiveCatalog(
    connection: GeoCrmConnectionOptions,
    apiKey?: string,
    signal?: AbortSignal,
  ): Promise<GeoCrmCatalogEntry[] | undefined> {
    try {
      const token = apiKey ?? await this.config.resolveApiKey(connection)
      return await this.fetchCatalog(normalizeGeoCrmOrigin(connection.baseURL), token, signal)
    } catch {
      // Advisory catalog remains the answer when the token is missing or the
      // origin is unreachable; stream still fails at the Responses POST.
      return undefined
    }
  }

  /**
   * GET `/ai/models?client=electron`.
   * @param origin - GeoCRM API origin.
   * @param apiKey - Supabase session JWT.
   * @param signal - caller cancellation.
   * @returns parsed catalog rows.
   */
  private async fetchCatalog(
    origin: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<GeoCrmCatalogEntry[]> {
    const response = await this.request(`${origin}/ai/models?client=electron`, {
      method: 'GET',
      headers: {
        ...attributionHeaders(),
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      ...signal === undefined ? {} : { signal },
    })
    if (!response.ok) {
      throw await this.refuse(response, origin)
    }
    return parseCatalogResponse(await response.json() as unknown)
  }

  /**
   * `GET /ai/settings/configured` (ids only), then
   * `POST /ai/settings/connectivity` if that route is absent.
   * A failed or unrecognized body leaves presence unknown so the catalog stays listed.
   * @param origin - GeoCRM API origin.
   * @param apiKey - Supabase session JWT.
   * @returns lowercase provider ids, or `null` when presence is unknown.
   */
  private async fetchConfiguredProviders(
    origin: string,
    apiKey: string,
  ): Promise<ReadonlySet<string> | null> {
    const headers = {
      ...attributionHeaders(),
      authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
    }
    try {
      const listed = await this.request(`${origin}/ai/settings/configured`, {
        method: 'GET',
        headers,
      })
      if (listed.ok) {
        const parsed = parseConfiguredList(await listed.json() as unknown)
        if (parsed !== null) return parsed
      }
    } catch {
      // Fall through to the connectivity probe.
    }
    try {
      const response = await this.request(`${origin}/ai/settings/connectivity`, {
        method: 'POST',
        headers,
      })
      if (!response.ok) return null
      return parseConfiguredProviders(await response.json() as unknown)
    } catch {
      // Presence is advisory; the catalog stays listed when neither route answers.
      return null
    }
  }

  /**
   * POST `/ai/harness/responses`.
   * @param origin - GeoCRM API origin.
   * @param apiKey - Supabase session JWT.
   * @param route - resolved GeoCRM slug and vendor model id.
   * @param options - assembled harness request.
   * @returns the accepted SSE response.
   */
  private async postResponses(
    origin: string,
    apiKey: string,
    route: { provider: string; model: string },
    options: GenerateOptions,
    signal: AbortSignal,
  ): Promise<Response> {
    const response = await this.request(`${origin}/ai/harness/responses`, {
      method: 'POST',
      headers: {
        ...attributionHeaders(),
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'x-geocrm-provider': route.provider,
      },
      body: JSON.stringify(toGeoCrmRequest(options, route.model)),
      signal,
    })
    if (!response.ok) {
      throw await this.refuse(response, origin)
    }
    return response
  }

  /**
   * One GeoCRM fetch. Transport failures become `TRANSPORT` unless the caller aborted.
   * @param url - absolute GeoCRM URL.
   * @param init - fetch init.
   * @returns the HTTP response.
   */
  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init)
    } catch (error: unknown) {
      if (init.signal?.aborted === true) throw error
      throw new LlmError(
        `GeoCRM request to ${url} failed`,
        'TRANSPORT',
        { cause: error },
      )
    }
  }

  /**
   * Classify a non-2xx GeoCRM response.
   * @param response - failed HTTP response.
   * @param origin - origin named in the diagnostic.
   * @returns a refused {@link LlmError}.
   */
  private async refuse(response: Response, origin: string): Promise<LlmError> {
    const raw = await response.text()
    const error = parseGeoCrmErrorBody(raw)
    const message = error.message ?? `GeoCRM API error (HTTP ${String(response.status)}) at ${origin}`
    return new LlmError(message, geocrmHttpErrorCode(response.status, error), {
      cause: new Error(raw.length > 0 ? raw : `GeoCRM HTTP ${String(response.status)}`),
      status: response.status,
    })
  }
}

/**
 * Project advisory settings rows into catalog entries for route resolution.
 * Composite ids supply the slug; bare ids stay provider-unknown until
 * {@link resolveGeoCrmRoute} applies its default.
 * @param models - settings or composition catalog.
 * @returns catalog rows used only to disambiguate picker ids.
 */
function entriesFromAdvisory(models: readonly GeoCrmCatalogModel[]): GeoCrmCatalogEntry[] {
  return models.map((model) => {
    const separator = model.id.indexOf(':')
    if (separator <= 0) return { id: model.id, provider: 'deepseek' }
    return {
      id: model.id.slice(separator + 1),
      provider: model.id.slice(0, separator),
      ...model.name === undefined ? {} : { labelEn: model.name },
    }
  })
}
