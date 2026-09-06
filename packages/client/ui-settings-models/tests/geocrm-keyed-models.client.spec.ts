/** Vendor-prefix filtering for the GeoCRM Models card catalog. */
import { describe, expect, it } from 'vitest'
import {
  filterGeocrmModelsByVendors,
  geocrmModelId,
  geocrmVendorPrefix,
  geocrmVendorsFromIds,
  geocrmCatalogLabel,
  geocrmVendorDisplayName,
  isGeocrmCatalogNotConfigured,
  visibleGeocrmModels,
} from '../src/client/geocrm-keyed-models.ts'

describe('geocrm keyed catalog helpers', () => {
  it('reads a vendor slug from a composite or bare picker id', () => {
    expect(geocrmVendorPrefix('chatgpt:gpt-5.6-sol')).toBe('chatgpt')
    expect(geocrmVendorPrefix('DeepSeek:deepseek-v4-flash')).toBe('deepseek')
    expect(geocrmVendorPrefix('  grok  ')).toBe('grok')
    expect(geocrmVendorPrefix('   ')).toBe('')
  })

  it('reads a drafted id and ignores non-strings', () => {
    expect(geocrmModelId({ id: ' chatgpt:gpt-5.6-sol ' })).toBe('chatgpt:gpt-5.6-sol')
    expect(geocrmModelId({ id: 1 })).toBe('')
    expect(geocrmModelId({})).toBe('')
  })

  it('collects vendor slugs and drops empty ids', () => {
    expect([...geocrmVendorsFromIds([
      'chatgpt:gpt-5.6-sol',
      'chatgpt:gpt-5.4',
      '  ',
      'deepseek:deepseek-v4-flash',
    ])]).toEqual(['chatgpt', 'deepseek'])
  })

  it('keeps keyed vendors and blank draft rows', () => {
    const rows = [
      { id: 'chatgpt:gpt-5.6-sol' },
      { id: 'deepseek:deepseek-v4-flash' },
      { id: '' },
      { name: 'draft' },
    ]
    expect(filterGeocrmModelsByVendors(rows, new Set(['chatgpt']))).toEqual([
      { id: 'chatgpt:gpt-5.6-sol' },
      { id: '' },
      { name: 'draft' },
    ])
  })

  it('hides identified rows while presence is loading and keeps them when unknown', () => {
    const rows = [{ id: 'deepseek:deepseek-v4-flash' }, { id: '' }]
    expect(visibleGeocrmModels(rows, true, { status: 'loading' })).toEqual([{ id: '' }])
    expect(visibleGeocrmModels(rows, true, { status: 'unknown' })).toEqual(rows)
    expect(visibleGeocrmModels(rows, false, { status: 'known', vendors: new Set() })).toEqual(rows)
    expect(visibleGeocrmModels(rows, true, { status: 'known', vendors: new Set(['chatgpt']) }))
      .toEqual([{ id: '' }])
  })

  it('builds GeoCRM Electron combined labels', () => {
    expect(geocrmVendorDisplayName('chatgpt')).toBe('OpenAI')
    expect(geocrmVendorDisplayName('openai')).toBe('OpenAI')
    expect(geocrmVendorDisplayName('gemini')).toBe('Google')
    expect(geocrmVendorDisplayName('claude')).toBe('Anthropic')
    expect(geocrmVendorDisplayName('grok')).toBe('xAI')
    expect(geocrmVendorDisplayName('custom_vendor')).toBe('Custom Vendor')
    expect(geocrmCatalogLabel('chatgpt:gpt-6-astra', 'GPT-6 Astra')).toBe('OpenAI \u00b7 GPT-6 Astra')
    expect(geocrmCatalogLabel('bare', 'Bare')).toBe('Bare \u00b7 Bare')
    expect(geocrmCatalogLabel('', 'Bare')).toBe('Bare')
    expect(isGeocrmCatalogNotConfigured({ description: 'geocrm:not-configured' })).toBe(true)
    expect(isGeocrmCatalogNotConfigured({})).toBe(false)
  })
})
