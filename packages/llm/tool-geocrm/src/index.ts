/**
 * Register GeoCRM first-party Harness tools on `ctx.tools`. Each call posts
 * to `{origin}/ai/harness/tools/{name}` with `GEOCRM_HARNESS_TOKEN`. Origin
 * and token reference prefer the live `llm-geocrm` settings section when that
 * namespace is registered. A launch-environment origin wins over a stored
 * `baseURL`.
 * @module @deepseek-ai/dsh-tool-geocrm
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import {
  DEFAULT_BASE_URL,
  resolveGeoCrmOrigin,
  resolveLiveSessionToken,
} from '@deepseek-ai/dsh-llm-geocrm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import { GEOCRM_TOOLS } from './catalog.ts'
import { callHarnessTool } from './http.ts'

export const name = 'tool-geocrm'
export const inject = ['tools']

const DEFAULT_API_KEY_ENV = 'GEOCRM_HARNESS_TOKEN'

export { GEOCRM_TOOLS } from './catalog.ts'
export type { GeoCrmToolSpec } from './catalog.ts'
export { callHarnessTool, parseToolError } from './http.ts'

/**
 * Plugin config. Every field is optional: a missing origin or token reference
 * falls back to the live `llm-geocrm` settings section, then these defaults.
 */
export interface Config {
  /** Credential reference resolved per call; defaults to `GEOCRM_HARNESS_TOKEN`. */
  apiKeyEnv?: string
  /** GeoCRM API origin; defaults to `http://127.0.0.1:3001`. */
  baseURL?: string
}

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().default(DEFAULT_BASE_URL),
})

/** Resolved origin and credential reference for one tool call. */
export interface GeoCrmToolConnection {
  /** GeoCRM API origin without a trailing slash. */
  readonly baseURL: string
  /** Credential reference name. */
  readonly apiKeyEnv: string
}

/**
 * Resolve the origin and token reference. The `llm-geocrm` settings section
 * wins when it is registered so the Models card and these tools share one origin.
 * @param ctx - host context that may carry `settings`.
 * @param config - this plugin's entry config.
 * @returns validated connection facts.
 */
export function resolveConnection(ctx: Context, config: Config): GeoCrmToolConnection {
  const settings = ctx.get('settings')
  const section = settings?.describe().find(entry => entry.ns === 'llm-geocrm')?.value
  const fromSettings = typeof section === 'object' && section !== null && !Array.isArray(section)
    ? section as Record<string, unknown>
    : {}
  const rawBase = typeof fromSettings.baseURL === 'string' && fromSettings.baseURL.length > 0
    ? fromSettings.baseURL
    : config.baseURL
  const apiKeyEnv = typeof fromSettings.apiKeyEnv === 'string' && fromSettings.apiKeyEnv.length > 0
    ? fromSettings.apiKeyEnv
    : (config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  return {
    baseURL: resolveGeoCrmOrigin({ ...rawBase === undefined ? {} : { baseURL: rawBase } }, launchEnvironmentOf(ctx)),
    apiKeyEnv,
  }
}

/**
 * Resolve the GeoCRM session token for one call, rotating it when needed.
 * @param ctx - host context that may carry `credentials`.
 * @param connection - origin and access-token reference.
 * @returns a usable Bearer token.
 */
export async function resolveToken(ctx: Context, connection: GeoCrmToolConnection): Promise<string> {
  const credentials = ctx.get('credentials')
  const token = await resolveLiveSessionToken({
    origin: connection.baseURL,
    apiKeyEnv: connection.apiKeyEnv,
    ...credentials === undefined ? {} : { store: credentials },
    ambient: name => launchEnvironmentOf(ctx).get(name)?.value,
  })
  if (token !== undefined && token.length > 0) return token
  throw new Error(
    `tool-geocrm: no GeoCRM session token for ${connection.apiKeyEnv}; sign in on the desktop Models page `
    + `or export ${connection.apiKeyEnv} in the launching environment`,
  )
}

/**
 * Register the GeoCRM Harness tools.
 * @param ctx - host context with `tools` injected.
 * @param config - composition entry config.
 */
export function apply(ctx: Context, config: Config): void {
  for (const spec of GEOCRM_TOOLS) {
    ctx.tools.register(defineTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      isConcurrencySafe: () => spec.kind === 'search',
      presentCall: args => ({
        card: 'generic',
        title: spec.name,
        kind: spec.kind,
        rawInput: args,
      }),
      async execute(args, exec) {
        const connection = resolveConnection(ctx, config)
        const token = await resolveToken(ctx, connection)
        return callHarnessTool(
          connection.baseURL,
          token,
          spec.name,
          args as Record<string, unknown>,
          exec.signal,
        )
      },
    }))
  }
}
