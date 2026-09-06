/**
 * GeoCRM Models-card filtering: hide inherited or customized rows whose
 * vendor has no key, using the vendor prefixes from a live discovery list.
 * @module dsh-client-ui-settings-models/geocrm-keyed-models
 */

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
