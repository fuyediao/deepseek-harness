import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODELS,
  GEOCRM_NOT_CONFIGURED_DESCRIPTION,
  STATIC_FLAGSHIP_MODELS,
  catalogEntriesToDiscovered,
  catalogEntriesToModels,
  catalogEntryName,
  encodeCompositeModelId,
  parseCatalogPayload,
  parseCatalogResponse,
  parseCompositeModelId,
  resolveAdvisoryModels,
  resolveGeoCrmRoute,
  settingsModelAllowlist,
} from '../src/catalog.ts'

describe('composite model ids', () => {
  it('encodes and splits provider:model', () => {
    expect(encodeCompositeModelId('deepseek', 'deepseek-v4-flash')).toBe('deepseek:deepseek-v4-flash')
    expect(parseCompositeModelId('deepseek:deepseek-v4-flash')).toEqual({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    })
    expect(parseCompositeModelId('deepseek-v4-flash')).toEqual({ model: 'deepseek-v4-flash' })
    expect(parseCompositeModelId(':missing')).toEqual({ model: ':missing' })
  })

  it('resolves a composite id without consulting the catalog', () => {
    expect(resolveGeoCrmRoute('zhipu:glm-5.2', [])).toEqual({ provider: 'zhipu', model: 'glm-5.2' })
  })

  it('refuses a composite id that has no vendor model', () => {
    expect(() => resolveGeoCrmRoute('deepseek:', [])).toThrow(/missing the vendor model id/)
  })

  it('disambiguates a unique bare id from the catalog', () => {
    expect(resolveGeoCrmRoute('claude-opus-5', STATIC_FLAGSHIP_MODELS)).toEqual({
      provider: 'claude',
      model: 'claude-opus-5',
    })
  })

  it('refuses a bare id that more than one provider uses', () => {
    expect(() => resolveGeoCrmRoute('glm-5.2', [
      { id: 'glm-5.2', provider: 'zhipu' },
      { id: 'glm-5.2', provider: 'zai' },
    ])).toThrow(/more than one GeoCRM provider/)
  })

  it('defaults an unknown bare id to deepseek', () => {
    expect(resolveGeoCrmRoute('deepseek-v4-pro', [])).toEqual({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
    })
  })
})

describe('catalog JSON', () => {
  it('keeps complete rows and drops incomplete or duplicate ones', () => {
    expect(parseCatalogResponse({
      models: [
        { id: 'a', provider: 'deepseek', labelEn: 'A', default: true, vision: true },
        { id: 'a', provider: 'deepseek' },
        { id: '', provider: 'deepseek' },
        { id: 'b', provider: '' },
        'skip',
        { id: 'c', provider: 'claude', configured: false },
        { id: 'd', provider: 'gemini', configured: true },
      ],
    })).toEqual([
      { id: 'a', provider: 'deepseek', labelEn: 'A', default: true, vision: true },
      { id: 'c', provider: 'claude', configured: false },
      { id: 'd', provider: 'gemini', configured: true },
    ])
  })

  it('returns an empty list for a non-object or missing models array', () => {
    expect(parseCatalogResponse(null)).toEqual([])
    expect(parseCatalogResponse([])).toEqual([])
    expect(parseCatalogResponse({})).toEqual([])
    expect(parseCatalogResponse({ models: {} })).toEqual([])
  })

  it('reads a top-level configured list and complete per-row flags', () => {
    expect(parseCatalogPayload({
      models: [
        { id: 'sol', provider: 'chatgpt', configured: true },
        { id: 'opus', provider: 'claude', configured: false },
      ],
      configured: ['OpenAI'],
    })).toEqual({
      entries: [
        { id: 'sol', provider: 'chatgpt', configured: true },
        { id: 'opus', provider: 'claude', configured: false },
      ],
      configured: new Set(['openai']),
    })
    expect(parseCatalogPayload({
      models: [
        { id: 'sol', provider: 'chatgpt', configured: true },
        { id: 'opus', provider: 'claude', configured: false },
      ],
    }).configured).toEqual(new Set(['chatgpt', 'openai']))
    expect(parseCatalogPayload({
      models: [{ id: 'sol', provider: 'chatgpt' }],
    }).configured).toBeNull()
  })

  it('projects catalog rows for the picker and for discovery', () => {
    const rows = [{ id: 'x', provider: 'grok', labelEn: 'X', vision: true as const }]
    expect(catalogEntriesToModels('geocrm', rows)).toEqual([
      { provider: 'geocrm', id: 'grok:x', name: 'X', inputModalities: ['text', 'image'] },
    ])
    expect(catalogEntriesToDiscovered(rows)).toEqual([{ id: 'grok:x', name: 'X' }])
    expect(catalogEntriesToDiscovered([{ id: 'opus', provider: 'claude', configured: false }])).toEqual([{
      id: 'claude:opus',
      description: GEOCRM_NOT_CONFIGURED_DESCRIPTION,
    }])
    expect(catalogEntriesToDiscovered([{ id: 'y', provider: 'deepseek' }])).toEqual([
      { id: 'deepseek:y' },
    ])
    expect(catalogEntriesToModels('geocrm', [{ id: 'y', provider: 'deepseek' }])).toEqual([
      { provider: 'geocrm', id: 'deepseek:y', name: 'y' },
    ])
    expect(catalogEntriesToModels('geocrm', [{
      id: 'opus',
      provider: 'claude',
      configured: false,
    }])).toEqual([{
      provider: 'geocrm',
      id: 'claude:opus',
      name: 'opus',
      description: GEOCRM_NOT_CONFIGURED_DESCRIPTION,
    }])
    expect(catalogEntryName({ id: 'y', provider: 'deepseek' })).toBe('y')
    expect(catalogEntryName({ id: 'y', provider: 'deepseek', labelEn: 'Why' })).toBe('Why')
  })
})

describe('settingsModelAllowlist', () => {
  it('ignores the adapter default flagships and keeps a customized set', () => {
    expect(settingsModelAllowlist([...DEFAULT_MODELS])).toBeNull()
    expect(settingsModelAllowlist([...DEFAULT_MODELS].reverse())).toBeNull()
    expect([...settingsModelAllowlist([{ id: 'chatgpt:gpt-5.6-sol' }]) ?? []]).toEqual([
      'chatgpt:gpt-5.6-sol',
    ])
  })
})

describe('advisory catalog', () => {
  it('defaults to the static flagships', () => {
    expect(resolveAdvisoryModels(undefined)).toEqual([...DEFAULT_MODELS])
  })

  it('accepts a bare id with no optional fields', () => {
    expect(resolveAdvisoryModels([{ id: 'only' }])).toEqual([{ id: 'only' }])
  })

  it('keeps optional capacities and description', () => {
    expect(resolveAdvisoryModels([{
      id: 'deepseek:deepseek-v4-pro',
      name: 'Pro',
      description: 'Stronger',
      contextWindow: 128_000,
      maxTokens: 8_192,
    }])).toEqual([{
      id: 'deepseek:deepseek-v4-pro',
      name: 'Pro',
      description: 'Stronger',
      contextWindow: 128_000,
      maxTokens: 8_192,
    }])
  })

  it('rejects empty ids, empty names, bad capacities, and duplicates', () => {
    expect(() => resolveAdvisoryModels([{ id: '' }])).toThrow(/non-empty/)
    expect(() => resolveAdvisoryModels([{ id: 'a', name: '' }])).toThrow(/empty name/)
    expect(() => resolveAdvisoryModels([{ id: 'a', contextWindow: 0 }])).toThrow(/contextWindow/)
    expect(() => resolveAdvisoryModels([{ id: 'a', maxTokens: 1.5 }])).toThrow(/maxTokens/)
    expect(() => resolveAdvisoryModels([{ id: 'a' }, { id: 'a' }])).toThrow(/duplicate/)
  })
})
