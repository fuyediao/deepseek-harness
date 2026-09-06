/**
 * GeoCRM Models-card helpers: vendor prefixes, combined labels, and the
 * Not Configured sentinel shared with Host discovery.
 * @module dsh-client-ui-settings-models/geocrm-keyed-models
 */

/**
 * Catalog `description` that means GeoCRM Settings has no BYOK key.
 * Keep this literal in sync with `GEOCRM_NOT_CONFIGURED` in
 * `dsh-client-ui-model-selection` and `GEOCRM_NOT_CONFIGURED_DESCRIPTION`
 * in `dsh-llm-geocrm`.
 */
export const GEOCRM_NOT_CONFIGURED = 'geocrm:not-configured'

/** Vendor labels matching GeoCRM Electron's combined picker string. */
const VENDOR_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  chatgpt: 'OpenAI',
  openai: 'OpenAI',
  gemini: 'Google',
  claude: 'Anthropic',
  anthropic: 'Anthropic',
  grok: 'xAI',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  moonshot: 'Moonshot',
  minimax: 'MiniMax',
  zhipu: 'ZhiPu',
  perplexity: 'Perplexity',
  stepfun: 'StepFun',
}

/** One model row that may carry a composite picker id. */
export interface GeocrmKeyedModelRow {
  /** Composite picker id (`chatgpt:gpt-5.6-sol`), or empty while drafting. */
  readonly id?: unknown
}

/** What the GeoCRM card knows about vendors that have a key. */
export type GeocrmVendorPresence =
  | { readonly status: 'loading' }
  | { readonly status: 'unknown' }
  | { readonly status: 'known'; readonly vendors: ReadonlySet<string> }

/**
 * Vendor slug of a GeoCRM composite picker id.
 * A bare id is its own slug. Whitespace-only input is empty.
 * @param modelId - picker id, possibly `vendor:model`.
 * @returns lowercase vendor slug, or the empty string.
 */
export function geocrmVendorPrefix(modelId: string): string {
  const trimmed = modelId.trim()
  const at = trimmed.indexOf(':')
  return (at === -1 ? trimmed : trimmed.slice(0, at)).toLowerCase()
}

/**
 * Read the trimmed picker id from one catalog row.
 * @param model - drafted or inherited row.
 * @returns the id text, or the empty string when unset.
 */
export function geocrmModelId(model: GeocrmKeyedModelRow): string {
  return typeof model.id === 'string' ? model.id.trim() : ''
}

/**
 * Vendor slugs present in a live discovery list.
 * @param ids - composite picker ids from discovery.
 * @returns lowercase vendor slugs; empty ids are ignored.
 */
export function geocrmVendorsFromIds(ids: readonly string[]): ReadonlySet<string> {
  const vendors = new Set<string>()
  for (const id of ids) {
    const vendor = geocrmVendorPrefix(id)
    if (vendor.length > 0) vendors.add(vendor)
  }
  return vendors
}

/**
 * Keep rows whose vendor is in the keyed set, plus rows that still have no id.
 * @param models - inherited or customized catalog rows.
 * @param vendors - vendor slugs that have a GeoCRM key.
 * @returns detached rows the Models card may show.
 */
export function filterGeocrmModelsByVendors<T extends GeocrmKeyedModelRow>(
  models: readonly T[],
  vendors: ReadonlySet<string>,
): T[] {
  return models.filter((model) => {
    const id = geocrmModelId(model)
    return id.length === 0 || vendors.has(geocrmVendorPrefix(id))
  })
}

/**
 * Rows the GeoCRM Models card should render for one presence answer.
 * Loading hides every identified row so the adapter flagships cannot flash.
 * Unknown presence leaves the list unchanged (same rule as the Host catalog).
 * @param models - inherited or customized catalog rows.
 * @param hideUnkeyed - whether this card filters by key presence.
 * @param presence - live discovery outcome.
 * @returns detached rows to edit and display.
 */
export function visibleGeocrmModels<T extends GeocrmKeyedModelRow>(
  models: readonly T[],
  hideUnkeyed: boolean,
  presence: GeocrmVendorPresence,
): T[] {
  if (!hideUnkeyed || presence.status === 'unknown') return [...models]
  if (presence.status === 'loading') {
    return models.filter(model => geocrmModelId(model).length === 0)
  }
  return filterGeocrmModelsByVendors(models, presence.vendors)
}

/**
 * Brand label for a GeoCRM vendor slug, matching GeoCRM Electron.
 * @param provider - catalog provider id (`chatgpt`, `deepseek`, …).
 * @returns a display name such as `OpenAI`.
 */
export function geocrmVendorDisplayName(provider: string): string {
  const known = VENDOR_DISPLAY_NAMES[provider]
  if (known !== undefined) return known
  return provider
    .split(/[-_]/)
    .filter(part => part.length > 0)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Combined vendor + model label (`OpenAI · GPT-5.6 Sol`).
 * @param modelId - composite picker id.
 * @param modelName - catalog display name.
 * @returns the GeoCRM Electron combined label.
 */
export function geocrmCatalogLabel(modelId: string, modelName: string): string {
  const vendor = geocrmVendorPrefix(modelId)
  if (vendor.length === 0) return modelName
  return `${geocrmVendorDisplayName(vendor)} \u00b7 ${modelName}`
}

/**
 * Whether a discovered row is a GeoCRM vendor with no key.
 * @param model - discovery candidate.
 * @returns true when the row should show Not Configured.
 */
export function isGeocrmCatalogNotConfigured(model: { readonly description?: string }): boolean {
  return model.description === GEOCRM_NOT_CONFIGURED
}
