/**
 * GeoCRM BYOK key presence: which catalog vendors have a key in Settings.
 * Presence comes from `POST /ai/settings/connectivity` (providers that
 * appear have a key; probe success is ignored) or from a catalog row's
 * `configured` flag. The sentinel description is what the desktop picker
 * translates to Not Configured.
 * @module dsh-llm-geocrm/keys
 */

import type { GeoCrmCatalogEntry } from './catalog.ts'

/**
 * Slugs that share one GeoCRM BYOK bag entry.
 * @param provider - catalog provider id (`chatgpt`, `claude`, …).
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
 * Whether a catalog vendor has a key among the connectivity provider ids.
 * @param provider - catalog provider id.
 * @param configured - lowercase provider ids that appeared in connectivity.
 * @returns true when any alias is present.
 */
export function vendorHasConfiguredKey(
  provider: string,
  configured: ReadonlySet<string>,
): boolean {
  return providerKeyAliases(provider).some(alias => configured.has(alias))
}

/**
 * Parse `POST /ai/settings/connectivity` for key presence only.
 * A valid body is `{ models: [{ model: string }] }`. Catalog JSON
 * (`{ models: [{ id, provider }] }`) is rejected so a wrong URL cannot
 * mark every vendor as missing a key.
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
 * Stamp `configured` from a connectivity id set. `null` leaves catalog flags.
 * @param entries - live catalog rows.
 * @param configured - connectivity provider ids, or `null` when unknown.
 * @returns detached rows with `configured` set when presence is known.
 */
export function applyKeyPresence(
  entries: readonly GeoCrmCatalogEntry[],
  configured: ReadonlySet<string> | null,
): GeoCrmCatalogEntry[] {
  if (configured === null) return [...entries]
  return entries.map(entry => ({
    ...entry,
    configured: vendorHasConfiguredKey(entry.provider, configured),
  }))
}
