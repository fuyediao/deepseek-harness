import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmGeocrm from '../src/index.ts'
import { DEFAULT_BASE_URL, DEFAULT_CONTEXT_WINDOW, DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../src/adapter.ts'
import { DEFAULT_MODELS } from '../src/catalog.ts'
import * as session from '../src/session.ts'
import { mockGeoCrm } from './mock-server.ts'

/**
 * Build an unsigned JWT with the given payload.
 * @param payload - claims to encode.
 * @returns a compact JWT.
 */
function jwtWith(payload: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('resolveAdapterOptions', () => {
  it('materializes defaults', () => {
    const resolved = LlmGeocrm.resolveAdapterOptions({})
    expect(resolved.baseURL).toBe(DEFAULT_BASE_URL)
    expect(resolved.defaultContextWindow).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(resolved.streamIdleTimeoutMs).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    expect(resolved.models).toEqual([...DEFAULT_MODELS])
    expect(resolved.apiKeyEnv).toBe('GEOCRM_HARNESS_TOKEN')
  })

  it('rejects invalid bounds', () => {
    expect(() => LlmGeocrm.resolveAdapterOptions({ defaultContextWindow: 0 }))
      .toThrow(/defaultContextWindow/)
    expect(() => LlmGeocrm.resolveAdapterOptions({ streamIdleTimeoutMs: 0 }))
      .toThrow(/streamIdleTimeoutMs/)
    expect(() => LlmGeocrm.resolveAdapterOptions({ baseURL: '' }))
      .toThrow(/baseURL/)
    expect(LlmGeocrm.resolveAdapterOptions(
      { baseURL: 'http://ignored' },
      { get: (name) => name === 'GEOCRM_BASE_URL'
        ? { value: 'https://api.vps.example/', source: 'project-env' as const }
        : undefined },
    ).baseURL).toBe('https://api.vps.example')
  })
})

describe('apply', () => {
  it('registers the geocrm route and discovers models', async () => {
    const server = await mockGeoCrm((_request, response) => {
      response.end(JSON.stringify({
        models: [{ id: 'deepseek-v4-flash', provider: 'deepseek', labelEn: 'Flash' }],
      }))
    })
    vi.stubEnv('GEOCRM_HARNESS_TOKEN', 'env-jwt')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmGeocrm, { baseURL: server.origin })
    try {
      expect(ctx.llm.listConfigurableProviders()).toEqual([
        { provider: 'geocrm', displayName: 'GeoCRM', settingsNs: 'llm-geocrm', settingsPath: [] },
      ])
      const models = await ctx.llm.listModels('geocrm')
      expect(models.map(model => model.id)).toContain('deepseek:deepseek-v4-flash')
      const discovered = await ctx.llm.discoverModels('llm-geocrm', {
        baseURL: server.origin,
        apiKey: 'typed',
      })
      expect(discovered[0]?.id).toBe('deepseek:deepseek-v4-flash')
    } finally {
      await ctx.fiber.dispose()
      await server.close()
    }
  })

  it('fails a request without a session token', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmGeocrm, {})
    try {
      const chunks: unknown[] = []
      for await (const chunk of ctx.llm.stream({
        provider: 'geocrm',
        model: 'deepseek:deepseek-v4-flash',
        messages: [],
      })) {
        chunks.push(chunk)
      }
      expect(chunks.at(-1)).toMatchObject({
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('fails when the credentials seam has no stored token', async () => {
    const ctx = new Context()
    ctx.provide('credentials', {
      resolve: () => Promise.resolve(undefined),
    } as never)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmGeocrm, {})
    try {
      const chunks: unknown[] = []
      for await (const chunk of ctx.llm.stream({
        provider: 'geocrm',
        model: 'deepseek:deepseek-v4-flash',
        messages: [],
      })) {
        chunks.push(chunk)
      }
      expect(chunks.at(-1)).toMatchObject({
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('resolves the token through credentials and keeps the last good settings', async () => {
    let current: LlmGeocrm.Config = { baseURL: 'http://127.0.0.1:3001' }
    let hooks: { setSource: (source: () => LlmGeocrm.Config) => void; onChange: () => void } | undefined
    const ctx = new Context()
    ctx.provide('settings', {
      installSection(
        _owner: unknown,
        _ns: unknown,
        _schema: unknown,
        _entry: unknown,
        next: { setSource: (source: () => LlmGeocrm.Config) => void; onChange: () => void },
      ) {
        hooks = next
        next.setSource(() => current)
        next.onChange()
      },
    } as never)
    ctx.provide('credentials', {
      resolve: () => Promise.resolve({ value: 'cred-jwt' }),
    } as never)
    const errors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { errors.push(error) }) as typeof ctx.logger.error
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmGeocrm, { baseURL: 'http://127.0.0.1:3001' })
    try {
      current = { defaultContextWindow: 0 }
      hooks?.onChange()
      const models = await ctx.llm.listModels('geocrm')
      expect(models.length).toBeGreaterThan(0)
      expect(errors.length).toBeGreaterThan(0)

      current = { retryPolicy: { mode: 'always' } }
      hooks?.onChange()
      expect(ctx.llm.listConfigurableProviders()[0]?.provider).toBe('geocrm')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses to start from an invalid composition entry', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await expect(ctx.plugin(LlmGeocrm, { baseURL: '' })).rejects.toThrow(/baseURL/)
    await ctx.fiber.dispose()
  })

  it('maps an expired session to AUTH and rethrows other refresh failures', async () => {
    const expired = jwtWith({ exp: 1 })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ error: 'Invalid refresh token' })),
    })))
    const ctx = new Context()
    ctx.provide('credentials', {
      resolve: (ref: string) => Promise.resolve({
        value: String(ref).endsWith('_REFRESH') ? 'old-refresh' : expired,
      }),
    } as never)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmGeocrm, {})
    try {
      const chunks: unknown[] = []
      for await (const chunk of ctx.llm.stream({
        provider: 'geocrm',
        model: 'deepseek:deepseek-v4-flash',
        messages: [],
      })) {
        chunks.push(chunk)
      }
      expect(chunks.at(-1)).toMatchObject({
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'AUTH' } },
      })
    } finally {
      await ctx.fiber.dispose()
    }

    vi.spyOn(session, 'resolveLiveSessionToken').mockRejectedValueOnce(new Error('boom'))
    const other = new Context()
    other.provide('credentials', {
      resolve: () => Promise.resolve({ value: 'cred-jwt' }),
    } as never)
    await other.plugin(LlmRuntime)
    await other.plugin(LlmGeocrm, {})
    try {
      const chunks: unknown[] = []
      for await (const chunk of other.llm.stream({
        provider: 'geocrm',
        model: 'deepseek:deepseek-v4-flash',
        messages: [],
      })) {
        chunks.push(chunk)
      }
      expect(chunks.at(-1)).toMatchObject({
        type: 'finish',
        reason: { kind: 'error' },
      })
    } finally {
      await other.fiber.dispose()
    }
  })
})
