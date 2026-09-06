/**
 * GeoCRM BYOK key presence: which catalog vendors have a key in Settings.
 * Presence comes from `GET /ai/settings/configured` (ids only), then
 * `POST /ai/settings/connectivity` (providers that appear have a key;
 * probe success is ignored), or from a catalog row's `configured` flag.
 * @module dsh-llm-geocrm/keys
 */

import type { GeoCrmCatalogEntry } from './catalog.ts'

/**
 * Slugs that share one GeoCRM BYOK bag entry.
 * @param provider - catalog provider id (`chatgpt`, `claude`, `deepseek`, …).
 * @returns lowercase aliases that count as the same key.
 */
export function providerKeyAliases(provider: string): readonly string[] {
  const id = provider.trim().toLowerCase()
  switch (id) {
    case 'chatgpt':
    case 'openai':
      return ['chatgpt', 'openai']
    case 'claude':
    case 'anthropic':
      return ['claude', 'anthropic']
    default:
      return id.length === 0 ? [] : [id]
  }
}

/**
 * Whether a catalog vendor has a key among the configured provider ids.
 * @param provider - catalog provider id.
 * @param configured - lowercase provider ids that have a key.
 * @returns true when any alias is present.
 */
export function vendorHasConfiguredKey(
  provider: string,
  configured: ReadonlySet<string>,
): boolean {
  return providerKeyAliases(provider).some(alias => configured.has(alias))
}

/**
 * Parse `GET /ai/settings/configured` (`{ configured: string[] }`).
 * @param body - decoded JSON value.
 * @returns lowercase provider ids, or `null` when the body is not that payload.
 */
export function parseConfiguredList(body: unknown): ReadonlySet<string> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const configured = (body as { configured?: unknown }).configured
  if (!Array.isArray(configured)) return null
  const ids = new Set<string>()
  for (const id of configured) {
    if (typeof id !== 'string' || id.trim().length === 0) return null
    ids.add(id.trim().toLowerCase())
  }
  return ids
}

/**
 * Parse `POST /ai/settings/connectivity` for key presence only.
 * A valid body is `{ models: [{ model: string }] }`. Catalog JSON
 * (`{ models: [{ id, provider }] }`) is rejected so a wrong URL cannot
 * hide every vendor.
 * @param body - decoded JSON value.
 * @returns lowercase provider ids, or `null` when the body is not the
 *   connectivity payload.
 */
export function parseConfiguredProviders(body: unknown): ReadonlySet<string> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const models = (body as { models?: unknown }).models
  if (!Array.isArray(models)) return null
  const configured = new Set<string>()
  for (const row of models) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return null
    const id = (row as { model?: unknown }).model
    if (typeof id !== 'string' || id.trim().length === 0) return null
    configured.add(id.trim().toLowerCase())
  }
  return configured
}

/**
 * Accept either the configured-id list or the connectivity probe payload.
 * @param body - decoded JSON value.
 * @returns lowercase provider ids, or `null` when neither payload matches.
 */
export function parseKeyPresence(body: unknown): ReadonlySet<string> | null {
  return parseConfiguredList(body) ?? parseConfiguredProviders(body)
}

/**
 * Keep only vendors that have a GeoCRM key when presence is known.
 * `configured: false` on a catalog row is also dropped when presence is unknown.
 * @param entries - live catalog rows.
 * @param configured - provider ids that have a key, or `null` when unknown.
 * @returns detached rows the composer may list.
 */
export function filterByKeyPresence(
  entries: readonly GeoCrmCatalogEntry[],
  configured: ReadonlySet<string> | null,
): GeoCrmCatalogEntry[] {
  if (configured === null) return entries.filter(entry => entry.configured !== false)
  return entries.filter(entry => vendorHasConfiguredKey(entry.provider, configured))
}

/**
 * Stamp each catalog row with whether its vendor has a key.
 * Presence unknown leaves existing `configured` flags in place.
 * @param entries - live catalog rows.
 * @param configured - provider ids that have a key, or `null` when unknown.
 * @returns detached rows, including vendors with no key.
 */
export function markByKeyPresence(
  entries: readonly GeoCrmCatalogEntry[],
  configured: ReadonlySet<string> | null,
): GeoCrmCatalogEntry[] {
  if (configured === null) {
    return entries.map(entry => ({ ...entry }))
  }
  return entries.map(entry => ({
    ...entry,
    configured: vendorHasConfiguredKey(entry.provider, configured),
  }))
}
