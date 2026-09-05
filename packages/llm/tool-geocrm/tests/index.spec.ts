import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolGeocrm from '../src/index.ts'
import { GEOCRM_TOOLS } from '../src/catalog.ts'
import { GEOCRM_TOOL_GUIDANCE } from '../src/guidance.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const signal = new AbortController().signal

describe('resolveConnection', () => {
  it('uses defaults, then the llm-geocrm settings section', () => {
    const ctx = new Context()
    expect(ToolGeocrm.resolveConnection(ctx, {})).toEqual({
      baseURL: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
    })
    ctx.provide('settings', {
      describe: () => [{
        ns: 'llm-geocrm',
        value: { baseURL: 'http://127.0.0.1:4000/', apiKeyEnv: 'CUSTOM_TOKEN' },
      }],
    } as never)
    expect(ToolGeocrm.resolveConnection(ctx, { baseURL: 'http://ignored', apiKeyEnv: 'IGNORED' }))
      .toEqual({ baseURL: 'http://127.0.0.1:4000', apiKeyEnv: 'CUSTOM_TOKEN' })
  })

  it('ignores a non-object settings value and empty overrides', () => {
    const ignored = new Context()
    ignored.provide('settings', {
      describe: () => [
        { ns: 'other', value: { baseURL: 'http://nope' } },
        { ns: 'llm-geocrm', value: [] },
      ],
    } as never)
    expect(ToolGeocrm.resolveConnection(ignored, { baseURL: 'http://127.0.0.1:9', apiKeyEnv: 'ALT' }))
      .toEqual({ baseURL: 'http://127.0.0.1:9', apiKeyEnv: 'ALT' })
    const empty = new Context()
    empty.provide('settings', {
      describe: () => [{ ns: 'llm-geocrm', value: { baseURL: '', apiKeyEnv: '' } }],
    } as never)
    expect(ToolGeocrm.resolveConnection(empty, {})).toEqual({
      baseURL: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
    })
  })

  it('treats an empty origin as the local default', () => {
    const ctx = new Context()
    expect(ToolGeocrm.resolveConnection(ctx, { baseURL: '' })).toEqual({
      baseURL: 'http://127.0.0.1:3001',
      apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
    })
  })

  it('prefers GEOCRM_BASE_URL from the launch environment', () => {
    vi.stubEnv('GEOCRM_BASE_URL', 'https://api.vps.example/')
    const ctx = new Context()
    expect(ToolGeocrm.resolveConnection(ctx, { baseURL: 'http://127.0.0.1:3001' }))
      .toEqual({
        baseURL: 'https://api.vps.example',
        apiKeyEnv: 'GEOCRM_HARNESS_TOKEN',
      })
  })
})

const connection = { baseURL: 'http://127.0.0.1:3001', apiKeyEnv: 'GEOCRM_HARNESS_TOKEN' }

describe('resolveToken', () => {
  it('reads the credentials seam, then the launch environment', async () => {
    const creds = new Context()
    creds.provide('credentials', {
      resolve: () => Promise.resolve({ value: 'cred-jwt' }),
    } as never)
    await expect(ToolGeocrm.resolveToken(creds, connection)).resolves.toBe('cred-jwt')

    const empty = new Context()
    empty.provide('credentials', {
      resolve: () => Promise.resolve({ value: '' }),
    } as never)
    await expect(ToolGeocrm.resolveToken(empty, connection)).rejects.toThrow(/no GeoCRM session token/)

    const absent = new Context()
    absent.provide('credentials', {
      resolve: () => Promise.resolve(undefined),
    } as never)
    await expect(ToolGeocrm.resolveToken(absent, connection)).rejects.toThrow(/no GeoCRM session token/)

    vi.stubEnv('GEOCRM_HARNESS_TOKEN', 'env-jwt')
    const ambient = new Context()
    await expect(ToolGeocrm.resolveToken(ambient, connection)).resolves.toBe('env-jwt')

    vi.stubEnv('GEOCRM_HARNESS_TOKEN', '')
    const missing = new Context()
    await expect(ToolGeocrm.resolveToken(missing, connection)).rejects.toThrow(/no GeoCRM session token/)
  })
})

describe('apply', () => {
  it('registers every first-party tool and executes through the harness door', async () => {
    vi.stubEnv('GEOCRM_HARNESS_TOKEN', 'env-jwt')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ result: '{"role":"member"}' })),
    })))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolGeocrm, {})
    try {
      const names = ctx.tools.schemas().map(tool => tool.name)
      expect(names).toEqual(GEOCRM_TOOLS.map(tool => tool.name))
      const result = await ctx.tools.execute({
        signal,
        callId: ToolCallId('call-1'),
        name: 'list_my_access',
        arguments: {},
      })
      expect(result.isError).toBe(false)
      expect(result.value).toBe('{"role":"member"}')
      expect(ctx.tools.get('list_my_access')?.presentCall?.({})).toEqual({
        card: 'generic',
        title: 'list_my_access',
        kind: 'search',
        rawInput: {},
      })
      expect(ctx.tools.get('list_my_access')?.isConcurrencySafe?.({})).toBe(true)
      expect(ctx.tools.get('create_record')?.isConcurrencySafe?.({})).toBe(false)
      expect(ctx.tools.get('create_record')?.presentCall?.({ entity: 'customers', values: {} })).toMatchObject({
        kind: 'other',
        title: 'create_record',
      })
      const assembly = await ctx.systemPrompt.assemble()
      const section = assembly.sections.find(entry => entry.name === 'tool:geocrm')
      expect(section?.text).toBe(GEOCRM_TOOL_GUIDANCE)
      expect(section?.text).toContain('Call list_my_access, then list_entities')
      expect(ctx.systemPrompt.getSectionOrder('TOOL_GEOCRM'))
        .toBeLessThan(ctx.systemPrompt.getSectionOrder('TOOL_WEB_SEARCH'))
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
