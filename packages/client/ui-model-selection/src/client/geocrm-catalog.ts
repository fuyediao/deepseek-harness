/**
 * Present GeoCRM composite catalog rows the way GeoCRM Electron groups vendors.
 * Selection still uses the `geocrm` route; visual group keys are not routes.
 */

import type { ModelCatalogModel, ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'

/**
 * Catalog `description` that means GeoCRM Settings has no BYOK key.
 * Must match `GEOCRM_NOT_CONFIGURED_DESCRIPTION` in `dsh-llm-geocrm`.
 */
export const GEOCRM_NOT_CONFIGURED = 'geocrm:not-configured'

/** Flagship vendor slugs first, matching GeoCRM Electron's picker order. */
export const GEOCRM_VENDOR_ORDER = ['chatgpt', 'gemini', 'claude', 'grok'] as const

const VENDOR_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  chatgpt: 'OpenAI',
  openai: 'OpenAI',
  claude: 'Anthropic',
  anthropic: 'Anthropic',
  gemini: 'Google',
  grok: 'xAI',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  moonshot: 'Moonshot',
  minimax: 'MiniMax',
  zhipu: 'ZhiPu',
  perplexity: 'Perplexity',
  stepfun: 'StepFun',
}

/** A catalog group whose `routeId` is what `session.selectModel` stores. */
export interface PresentedModelGroup {
  /** React and aria key; vendor groups use `geocrm:<slug>`. */
  readonly key: string
  /** Route id sent as `ModelSelection.provider`. */
  readonly routeId: string
  /** Visible group heading. */
  readonly name: string
  /** Models in this visual group, in catalog order. */
  readonly models: readonly ModelCatalogModel[]
}

/**
 * Brand-cased label for a GeoCRM vendor slug.
 * @param provider - catalog provider id (`chatgpt`, `deepseek`, …).
 * @returns a display name such as `Gemini`, not `gemini`.
 */
export function vendorDisplayName(provider: string): string {
  const known = VENDOR_DISPLAY_NAMES[provider]
  if (known !== undefined) return known
  return provider
    .split(/[-_]/)
    .filter(part => part.length > 0)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Split a composite picker id into the GeoCRM vendor slug and vendor model id.
 * @param modelId - `provider:model` or a bare vendor id.
 * @returns the slug when present, plus the vendor model id.
 */
export function parseGeocrmCompositeId(modelId: string): { vendor?: string; model: string } {
  const separator = modelId.indexOf(':')
  if (separator <= 0) return { model: modelId }
  return { vendor: modelId.slice(0, separator), model: modelId.slice(separator + 1) }
}

/**
 * Whether a catalog row is a GeoCRM vendor with no key in Settings.
 * @param model - picker row (description carries the sentinel).
 * @returns true when menus must omit the row.
 */
export function isGeocrmNotConfigured(model: { readonly description?: string }): boolean {
  return model.description === GEOCRM_NOT_CONFIGURED
}

/**
 * Combined vendor + model label used by GeoCRM Electron's picker trigger.
 * @param modelId - picker model id (composite on the `geocrm` route).
 * @param modelName - catalog display name.
 * @param routeId - DSH provider route (`geocrm` or another adapter).
 * @returns `Vendor · name` on the GeoCRM route; otherwise `modelName`.
 */
export function geocrmCombinedLabel(modelId: string, modelName: string, routeId: string): string {
  if (routeId !== 'geocrm') return modelName
  const { vendor } = parseGeocrmCompositeId(modelId)
  if (vendor === undefined) return modelName
  return `${vendorDisplayName(vendor)} \u00b7 ${modelName}`
}

/**
 * Split a `geocrm` group into vendor headings; leave every other group intact.
 * Vendors with no key (`geocrm:not-configured`) are omitted so menus cannot
 * pick a model GeoCRM would refuse.
 * @param groups - Host catalog groups (`group.id` is the selectable route).
 * @returns visual groups that still select `provider: geocrm` for composites.
 */
export function presentGeocrmCatalog(groups: readonly ModelProviderGroup[]): PresentedModelGroup[] {
  return groups.flatMap((group) => {
    if (group.id !== 'geocrm') {
      return [{ key: group.id, routeId: group.id, name: group.name, models: group.models }]
    }
    const byVendor = new Map<string, ModelCatalogModel[]>()
    const leftovers: ModelCatalogModel[] = []
    for (const model of group.models) {
      if (isGeocrmNotConfigured(model)) continue
      const { vendor } = parseGeocrmCompositeId(model.id)
      if (vendor === undefined) {
        leftovers.push(model)
        continue
      }
      const list = byVendor.get(vendor) ?? []
      list.push(model)
      byVendor.set(vendor, list)
    }
    const presented: PresentedModelGroup[] = []
    const seen = new Set<string>()
    for (const vendor of GEOCRM_VENDOR_ORDER) {
      const models = byVendor.get(vendor)
      if (models === undefined) continue
      presented.push({
        key: `geocrm:${vendor}`,
        routeId: 'geocrm',
        name: vendorDisplayName(vendor),
        models,
      })
      seen.add(vendor)
    }
    for (const [vendor, models] of byVendor) {
      if (seen.has(vendor)) continue
      presented.push({
        key: `geocrm:${vendor}`,
        routeId: 'geocrm',
        name: vendorDisplayName(vendor),
        models,
      })
    }
    if (leftovers.length > 0) {
      presented.push({
        key: 'geocrm',
        routeId: 'geocrm',
        name: group.name,
        models: leftovers,
      })
    }
    return presented
  })
}

/**
 * Find the Host catalog row for the session's current selection.
 * Looks at raw groups, including rows {@link presentGeocrmCatalog} omits.
 * @param groups - Host catalog groups.
 * @param current - stored provider/model pair.
 * @returns the matching row, or `undefined` when the catalog does not list it.
 */
export function lookupCatalogModel(
  groups: readonly ModelProviderGroup[],
  current: { readonly provider: string; readonly model: string } | null,
): { readonly routeId: string; readonly model: ModelCatalogModel } | undefined {
  if (current === null) return undefined
  for (const group of groups) {
    if (group.id !== current.provider) continue
    const model = group.models.find(row => row.id === current.model)
    if (model !== undefined) return { routeId: group.id, model }
  }
  return undefined
}
