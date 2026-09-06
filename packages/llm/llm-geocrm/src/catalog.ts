/**
 * GeoCRM catalog ids, composite route ids, and the static fallback list used
 * when the desktop adapter cannot ask `GET /ai/models`.
 * @module dsh-llm-geocrm/catalog
 */

import { configuredIdsFromEntries, parseConfiguredList } from './keys.ts'

/**
 * Catalog `description` the composer treats as "no vendor key in GeoCRM".
 * Keep this literal in sync with `GEOCRM_NOT_CONFIGURED` in
 * `dsh-client-ui-model-selection` and `dsh-client-ui-settings-models`.
 */
export const GEOCRM_NOT_CONFIGURED_DESCRIPTION = 'geocrm:not-configured'

/** One allowlisted GeoCRM catalog row, matching `GET /ai/models` JSON. */
export interface GeoCrmCatalogEntry {
  /** Vendor model id sent on the Responses `model` field. */
  readonly id: string
  /** GeoCRM provider slug sent as `x-geocrm-provider`. */
  readonly provider: string
  /** English display name when the endpoint supplies one. */
  readonly labelEn?: string
  /** Whether this id is the provider default when `model` is omitted. */
  readonly default?: boolean
  /** Whether the model accepts image input at the vendor. */
  readonly vision?: boolean
  /**
   * Whether GeoCRM Settings has a BYOK key for this vendor.
   * Absent means unknown; `false` becomes {@link GEOCRM_NOT_CONFIGURED_DESCRIPTION}.
   */
  readonly configured?: boolean
}

/** Advisory catalog row stored on the adapter config or settings section. */
export interface GeoCrmCatalogModel {
  /** Composite `provider:model` id, or a bare vendor id unique in the catalog. */
  readonly id: string
  /** Display name shown by discovery consumers. */
  readonly name?: string
  /** Optional distinction from otherwise similar models. */
  readonly description?: string
  /** Combined request and response context when known. */
  readonly contextWindow?: number
  /** Per-request output cap when known. */
  readonly maxTokens?: number
}

/** Separator between the GeoCRM provider slug and the vendor model id. */
const COMPOSITE_SEPARATOR = ':'

/** Flagship rows shown before a live catalog fetch succeeds. */
export const STATIC_FLAGSHIP_MODELS: readonly GeoCrmCatalogEntry[] = Object.freeze([
  { id: 'gpt-5.6-sol', provider: 'chatgpt', labelEn: 'GPT-5.6 Sol', default: true, vision: true },
  { id: 'gemini-3.1-pro-preview', provider: 'gemini', labelEn: 'Gemini 3.1 Pro', default: true, vision: true },
  { id: 'claude-opus-5', provider: 'claude', labelEn: 'Opus 5', default: true, vision: true },
  { id: 'grok-4.5', provider: 'grok', labelEn: 'Grok 4.5', default: true, vision: true },
  { id: 'deepseek-v4-flash', provider: 'deepseek', labelEn: 'DeepSeek V4 Flash', default: true },
])

/** Default advisory catalog: composite ids so colliding vendor ids stay distinct. */
export const DEFAULT_MODELS: readonly GeoCrmCatalogModel[] = Object.freeze(
  STATIC_FLAGSHIP_MODELS.map(entry => ({
    id: encodeCompositeModelId(entry.provider, entry.id),
    name: catalogEntryName(entry),
  })),
)

/**
 * Display name for one catalog row.
 * @param entry - live or static catalog row.
 * @returns `labelEn` when present, otherwise the vendor model id.
 */
export function catalogEntryName(entry: GeoCrmCatalogEntry): string {
  return entry.labelEn ?? entry.id
}

/**
 * Encode one catalog row as a picker id that remains unique across providers.
 * @param provider - GeoCRM provider slug.
 * @param model - vendor model id.
 * @returns `provider:model`.
 */
export function encodeCompositeModelId(provider: string, model: string): string {
  return `${provider}${COMPOSITE_SEPARATOR}${model}`
}

/**
 * Split a picker id into the GeoCRM slug and the vendor model id.
 * A bare id (no separator) is a vendor model id with an unknown provider.
 * @param modelId - composite or bare model id.
 * @returns provider slug when present, plus the vendor model id.
 */
export function parseCompositeModelId(modelId: string): { provider?: string; model: string } {
  const separator = modelId.indexOf(COMPOSITE_SEPARATOR)
  if (separator <= 0) return { model: modelId }
  return {
    provider: modelId.slice(0, separator),
    model: modelId.slice(separator + 1),
  }
}

/**
 * Resolve the GeoCRM slug and vendor model id for one request.
 * A composite id wins. A bare id that appears once in the catalog uses that
 * row's provider. Multiple catalog hits refuse the ambiguous id. An unknown
 * bare id defaults to `deepseek` so a typed DeepSeek id still routes.
 * @param modelId - composite or bare model id from {@link GenerateOptions.model}.
 * @param catalog - live or static catalog used to disambiguate bare ids.
 * @returns the header slug and the wire `model` field.
 */
export function resolveGeoCrmRoute(
  modelId: string,
  catalog: readonly GeoCrmCatalogEntry[],
): { provider: string; model: string } {
  const parsed = parseCompositeModelId(modelId)
  if (parsed.provider !== undefined) {
    if (parsed.model.length === 0) {
      throw new Error(`llm-geocrm: model id "${modelId}" is missing the vendor model id`)
    }
    return { provider: parsed.provider, model: parsed.model }
  }
  const matches = catalog.filter(entry => entry.id === parsed.model)
  if (matches.length > 1) {
    const slugs = matches.map(entry => entry.provider).join(', ')
    throw new Error(
      `llm-geocrm: model id "${modelId}" is used by more than one GeoCRM provider (${slugs}); use provider:model`,
    )
  }
  const unique = matches[0]
  if (unique !== undefined) return { provider: unique.provider, model: parsed.model }
  return { provider: 'deepseek', model: parsed.model }
}

/**
 * Live `GET /ai/models` rows plus optional BYOK presence from the same body.
 */
export interface GeoCrmCatalogPayload {
  /** Catalog rows in endpoint order. */
  readonly entries: GeoCrmCatalogEntry[]
  /**
   * Provider ids that have a key, when the body stamps them
   * (`configured` array or a complete set of per-row flags).
   */
  readonly configured: ReadonlySet<string> | null
}

/**
 * Parse the JSON body of `GET /ai/models`.
 * @param body - decoded JSON value.
 * @returns catalog rows in endpoint order; unknown or incomplete rows are dropped.
 */
export function parseCatalogResponse(body: unknown): GeoCrmCatalogEntry[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return []
  const models = (body as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  const seen = new Set<string>()
  const entries: GeoCrmCatalogEntry[] = []
  for (const row of models) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue
    const record = row as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.length === 0) continue
    if (typeof record.provider !== 'string' || record.provider.length === 0) continue
    const key = encodeCompositeModelId(record.provider, record.id)
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({
      id: record.id,
      provider: record.provider,
      ...typeof record.labelEn === 'string' && record.labelEn.length > 0 ? { labelEn: record.labelEn } : {},
      ...record.default === true ? { default: true } : {},
      ...record.vision === true ? { vision: true } : {},
      ...record.configured === false ? { configured: false } : {},
      ...record.configured === true ? { configured: true } : {},
    })
  }
  return entries
}

/**
 * Parse `GET /ai/models` rows and the optional BYOK presence stamp.
 * Prefers a top-level `configured` id list, then complete per-row flags.
 * @param body - decoded JSON value.
 * @returns catalog rows plus presence, or unknown presence when unstamped.
 */
export function parseCatalogPayload(body: unknown): GeoCrmCatalogPayload {
  const entries = parseCatalogResponse(body)
  return {
    entries,
    configured: parseConfiguredList(body) ?? configuredIdsFromEntries(entries),
  }
}

/**
 * Turn catalog rows into advisory picker models on the `geocrm` route.
 * @param route - registered provider route (`geocrm`).
 * @param entries - live or static catalog rows.
 * @returns detached model info in catalog order.
 */
export function catalogEntriesToModels(
  route: string,
  entries: readonly GeoCrmCatalogEntry[],
): {
  provider: string
  id: string
  name: string
  description?: string
  inputModalities?: readonly ('text' | 'image')[]
}[] {
  return entries.map(entry => ({
    provider: route,
    id: encodeCompositeModelId(entry.provider, entry.id),
    name: catalogEntryName(entry),
    ...entry.configured === false ? { description: GEOCRM_NOT_CONFIGURED_DESCRIPTION } : {},
    ...entry.vision === true ? { inputModalities: ['text', 'image'] as const } : {},
  }))
}

/**
 * Turn catalog rows into discovery candidates a settings card may adopt.
 * @param entries - live or static catalog rows.
 * @returns detached discovered models in catalog order.
 */
export function catalogEntriesToDiscovered(entries: readonly GeoCrmCatalogEntry[]): {
  id: string
  name?: string
  description?: string
}[] {
  return entries.map(entry => ({
    id: encodeCompositeModelId(entry.provider, entry.id),
    ...entry.labelEn === undefined ? {} : { name: entry.labelEn },
    ...entry.configured === false ? { description: GEOCRM_NOT_CONFIGURED_DESCRIPTION } : {},
  }))
}

/**
 * Treat the settings `models` array as a picker allowlist only after it
 * differs from the adapter default flagships.
 * @param models - resolved advisory catalog.
 * @returns composite ids to keep, or `null` to leave the live catalog uncut.
 */
export function settingsModelAllowlist(
  models: readonly GeoCrmCatalogModel[],
): ReadonlySet<string> | null {
  const defaults = new Set(DEFAULT_MODELS.map(model => model.id))
  if (models.length === defaults.size && models.every(model => defaults.has(model.id))) {
    return null
  }
  return new Set(models.map(model => model.id))
}

/**
 * Validate and detach an advisory settings catalog.
 * @param models - raw catalog, or `undefined` to use {@link DEFAULT_MODELS}.
 * @returns detached rows with unique non-empty ids.
 */
export function resolveAdvisoryModels(
  models: readonly GeoCrmCatalogModel[] | undefined,
): GeoCrmCatalogModel[] {
  const source = models ?? DEFAULT_MODELS
  const seen = new Set<string>()
  return source.map((model) => {
    if (model.id.length === 0) throw new Error('llm-geocrm: catalog model ids must be non-empty')
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-geocrm: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `llm-geocrm: catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens !== undefined
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `llm-geocrm: catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    if (seen.has(model.id)) throw new Error(`llm-geocrm: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    }
  })
}
