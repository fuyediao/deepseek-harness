/**
 * GeoCRM Harness tool HTTP: POST `/ai/harness/tools/{name}` with the signed-in
 * session JWT. GeoCRM applies `desktop_agent` and per-entity write grants.
 */

import { normalizeGeoCrmOrigin } from '@deepseek-ai/dsh-llm-geocrm'

/**
 * Read a GeoCRM public or gateway error message.
 * @param raw - response text.
 * @returns the message when present.
 */
export function parseToolError(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown }
    if (typeof parsed.error === 'string' && parsed.error.length > 0) return parsed.error
    if (typeof parsed.error === 'object' && parsed.error !== null) {
      const message = (parsed.error as { message?: unknown }).message
      if (typeof message === 'string' && message.length > 0) return message
    }
  } catch {
    // Status text remains the fallback when the body is not JSON.
  }
  return undefined
}

/**
 * Call one GeoCRM first-party harness tool.
 * @param origin - GeoCRM API origin.
 * @param token - Supabase session JWT.
 * @param tool - first-party tool name.
 * @param args - JSON arguments object (`{}` when the tool takes none).
 * @param signal - optional abort.
 * @returns the tool result text GeoCRM returned.
 */
export async function callHarnessTool(
  origin: string,
  token: string,
  tool: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${normalizeGeoCrmOrigin(origin)}/ai/harness/tools/${encodeURIComponent(tool)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ arguments: args }),
    ...signal === undefined ? {} : { signal },
  })
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(parseToolError(raw) ?? `GeoCRM ${tool} failed with HTTP ${String(response.status)}`)
  }
  let body: { result?: unknown; isError?: unknown }
  try {
    body = JSON.parse(raw) as { result?: unknown; isError?: unknown }
  } catch {
    throw new Error(`GeoCRM ${tool} returned a non-JSON body`)
  }
  const text = typeof body.result === 'string'
    ? body.result
    : JSON.stringify(body.result ?? {})
  if (body.isError === true) throw new Error(text)
  return text
}
