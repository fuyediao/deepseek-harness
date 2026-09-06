import { describe, expect, it } from 'vitest'
import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  GEOCRM_NOT_CONFIGURED,
  geocrmCombinedLabel,
  isGeocrmNotConfigured,
  parseGeocrmCompositeId,
  lookupCatalogModel,
  presentGeocrmCatalog,
  vendorDisplayName,
} from '../src/client/geocrm-catalog.ts'

describe('vendorDisplayName', () => {
  it('uses brand names for known slugs and title-cases the rest', () => {
    expect(vendorDisplayName('chatgpt')).toBe('OpenAI')
    expect(vendorDisplayName('deepseek')).toBe('DeepSeek')
    expect(vendorDisplayName('custom_vendor')).toBe('Custom Vendor')
    expect(vendorDisplayName('')).toBe('')
  })
})

describe('parseGeocrmCompositeId', () => {
  it('splits provider:model and leaves bare ids intact', () => {
    expect(parseGeocrmCompositeId('chatgpt:gpt-5.6-sol')).toEqual({
      vendor: 'chatgpt',
      model: 'gpt-5.6-sol',
    })
    expect(parseGeocrmCompositeId('deepseek-v4-flash')).toEqual({ model: 'deepseek-v4-flash' })
    expect(parseGeocrmCompositeId(':missing')).toEqual({ model: ':missing' })
  })
})

describe('isGeocrmNotConfigured', () => {
  it('recognizes only the GeoCRM missing-key sentinel', () => {
    expect(isGeocrmNotConfigured({ description: GEOCRM_NOT_CONFIGURED })).toBe(true)
    expect(isGeocrmNotConfigured({ description: 'Flagship' })).toBe(false)
    expect(isGeocrmNotConfigured({})).toBe(false)
  })
})

describe('geocrmCombinedLabel', () => {
  it('prefixes GeoCRM composite ids and leaves other routes unchanged', () => {
    expect(geocrmCombinedLabel('chatgpt:gpt-5.6-sol', 'GPT-5.6 Sol', 'geocrm'))
      .toBe('OpenAI \u00b7 GPT-5.6 Sol')
    expect(geocrmCombinedLabel('bare', 'Bare', 'geocrm')).toBe('Bare')
    expect(geocrmCombinedLabel('chatgpt:gpt-5.6-sol', 'GPT-5.6 Sol', 'deepseek-official'))
      .toBe('GPT-5.6 Sol')
  })
})

describe('presentGeocrmCatalog', () => {
  it('passes non-geocrm groups through', () => {
    const groups: ModelProviderGroup[] = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'Flash' }],
    }]
    expect(presentGeocrmCatalog(groups)).toEqual([{
      key: 'deepseek-official',
      routeId: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'Flash' }],
    }])
  })

  it('splits a geocrm group into vendor headings in Electron order', () => {
    const groups: ModelProviderGroup[] = [{
      id: 'geocrm',
      name: 'GeoCRM',
      models: [
        { id: 'deepseek:deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        { id: 'grok:grok-4.5', name: 'Grok 4.5' },
        { id: 'chatgpt:gpt-5.6-sol', name: 'GPT-5.6 Sol' },
        { id: 'zhipu:glm-5.2', name: 'GLM' },
        { id: 'unlisted', name: 'Unlisted' },
        { id: 'gemini:gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
        { id: 'claude:claude-opus-5', name: 'Opus 5' },
      ],
    }]
    expect(presentGeocrmCatalog(groups).map(group => [group.key, group.routeId, group.name])).toEqual([
      ['geocrm:chatgpt', 'geocrm', 'OpenAI'],
      ['geocrm:gemini', 'geocrm', 'Google'],
      ['geocrm:claude', 'geocrm', 'Anthropic'],
      ['geocrm:grok', 'geocrm', 'xAI'],
      ['geocrm:deepseek', 'geocrm', 'DeepSeek'],
      ['geocrm:zhipu', 'geocrm', 'ZhiPu'],
      ['geocrm', 'geocrm', 'GeoCRM'],
    ])
    expect(presentGeocrmCatalog(groups).find(group => group.key === 'geocrm')?.models)
      .toEqual([{ id: 'unlisted', name: 'Unlisted' }])
  })

  it('omits GeoCRM vendors that have no key', () => {
    const groups: ModelProviderGroup[] = [{
      id: 'geocrm',
      name: 'GeoCRM',
      models: [
        { id: 'chatgpt:gpt-5.6-sol', name: 'GPT-5.6 Sol' },
        {
          id: 'gemini:gemini-3.8-flash',
          name: 'Gemini 3.8 Flash',
          description: GEOCRM_NOT_CONFIGURED,
        },
      ],
    }]
    expect(presentGeocrmCatalog(groups).map(group => group.key)).toEqual(['geocrm:chatgpt'])
  })
})

describe('lookupCatalogModel', () => {
  it('finds the raw Host row including an unconfigured vendor', () => {
    const groups: ModelProviderGroup[] = [{
      id: 'geocrm',
      name: 'GeoCRM',
      models: [{
        id: 'gemini:gemini-3.8-flash',
        name: 'Gemini 3.8 Flash',
        description: GEOCRM_NOT_CONFIGURED,
      }],
    }]
    expect(lookupCatalogModel(groups, {
      provider: 'geocrm',
      model: 'gemini:gemini-3.8-flash',
    })?.model.id).toBe('gemini:gemini-3.8-flash')
    expect(lookupCatalogModel(groups, null)).toBeUndefined()
    expect(lookupCatalogModel(groups, { provider: 'geocrm', model: 'missing' })).toBeUndefined()
  })
})
