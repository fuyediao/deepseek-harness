import { describe, expect, it } from 'vitest'
import {
  configuredIdsFromEntries,
  filterByKeyPresence,
  markByKeyPresence,
  parseConfiguredList,
  parseConfiguredProviders,
  parseKeyPresence,
  providerKeyAliases,
  vendorHasConfiguredKey,
  vendorKeyMissing,
} from '../src/keys.ts'

describe('providerKeyAliases', () => {
  it('maps chat slugs onto the GeoCRM BYOK bag ids', () => {
    expect(providerKeyAliases('chatgpt')).toEqual(['chatgpt', 'openai'])
    expect(providerKeyAliases('OpenAI')).toEqual(['chatgpt', 'openai'])
    expect(providerKeyAliases('claude')).toEqual(['claude', 'anthropic'])
    expect(providerKeyAliases('ANTHROPIC')).toEqual(['claude', 'anthropic'])
    expect(providerKeyAliases('deepseek')).toEqual(['deepseek'])
    expect(providerKeyAliases('gemini')).toEqual(['gemini'])
    expect(providerKeyAliases('  ')).toEqual([])
  })
})

describe('vendorHasConfiguredKey', () => {
  it('treats openai as the ChatGPT key and ignores unknown slugs', () => {
    const configured = new Set(['openai', 'gemini', 'deepseek'])
    expect(vendorHasConfiguredKey('chatgpt', configured)).toBe(true)
    expect(vendorHasConfiguredKey('gemini', configured)).toBe(true)
    expect(vendorHasConfiguredKey('deepseek', configured)).toBe(true)
    expect(vendorHasConfiguredKey('claude', configured)).toBe(false)
  })
})

describe('parseConfiguredList', () => {
  it('keeps configured ids and rejects other JSON', () => {
    expect(parseConfiguredList({ configured: ['OpenAI', '  deepseek  '] }))
      .toEqual(new Set(['openai', 'deepseek']))
    expect(parseConfiguredList({ configured: [] })).toEqual(new Set())
    expect(parseConfiguredList(null)).toBeNull()
    expect(parseConfiguredList([])).toBeNull()
    expect(parseConfiguredList({})).toBeNull()
    expect(parseConfiguredList({ configured: {} })).toBeNull()
    expect(parseConfiguredList({ configured: [''] })).toBeNull()
    expect(parseConfiguredList({ configured: [1] })).toBeNull()
  })
})

describe('parseConfiguredProviders', () => {
  it('keeps connectivity rows and rejects catalog JSON', () => {
    expect(parseConfiguredProviders({
      models: [
        { model: 'OpenAI', ok: true },
        { model: '  gemini  ', ok: false },
      ],
    })).toEqual(new Set(['openai', 'gemini']))
    expect(parseConfiguredProviders({ models: [] })).toEqual(new Set())
    expect(parseConfiguredProviders(null)).toBeNull()
    expect(parseConfiguredProviders([])).toBeNull()
    expect(parseConfiguredProviders({})).toBeNull()
    expect(parseConfiguredProviders({ models: {} })).toBeNull()
    expect(parseConfiguredProviders({
      models: [{ id: 'gpt-5.6-sol', provider: 'chatgpt' }],
    })).toBeNull()
    expect(parseConfiguredProviders({ models: ['skip'] })).toBeNull()
    expect(parseConfiguredProviders({ models: [{ model: '' }] })).toBeNull()
    expect(parseConfiguredProviders({ models: [{ model: 1 }] })).toBeNull()
  })
})

describe('parseKeyPresence', () => {
  it('accepts either live payload and rejects other JSON', () => {
    expect(parseKeyPresence({ configured: ['OpenAI'] })).toEqual(new Set(['openai']))
    expect(parseKeyPresence({
      models: [{ model: 'gemini', ok: true }],
    })).toEqual(new Set(['gemini']))
    expect(parseKeyPresence({})).toBeNull()
  })
})

describe('configuredIdsFromEntries', () => {
  it('requires every row to carry a boolean', () => {
    expect(configuredIdsFromEntries([])).toBeNull()
    expect(configuredIdsFromEntries([{ id: 'sol', provider: 'chatgpt' }])).toBeNull()
    expect(configuredIdsFromEntries([
      { id: 'sol', provider: 'chatgpt', configured: true },
      { id: 'opus', provider: 'claude' },
    ])).toBeNull()
    expect(configuredIdsFromEntries([
      { id: 'sol', provider: 'chatgpt', configured: true },
      { id: 'astra', provider: 'chatgpt', configured: true },
      { id: 'opus', provider: 'claude', configured: false },
    ])).toEqual(new Set(['chatgpt', 'openai']))
    expect(configuredIdsFromEntries([
      { id: 'opus', provider: 'claude', configured: false },
    ])).toEqual(new Set())
  })
})

describe('vendorKeyMissing', () => {
  it('uses a keyed set when presence is known', () => {
    const rows = [{ id: 'flash', provider: 'gemini' }]
    expect(vendorKeyMissing('gemini', rows, new Set(['gemini']))).toBe(false)
    expect(vendorKeyMissing('gemini', rows, new Set())).toBe(true)
    expect(vendorKeyMissing('chatgpt', rows, new Set(['openai']))).toBe(false)
  })

  it('treats a fully unstamped catalog as callable', () => {
    expect(vendorKeyMissing('gemini', [{ id: 'flash', provider: 'gemini' }], null)).toBe(false)
  })

  it('refuses a vendor whose live rows are all configured:false', () => {
    expect(vendorKeyMissing('gemini', [
      { id: 'flash', provider: 'gemini', configured: false },
      { id: 'pro', provider: 'gemini', configured: false },
    ], null)).toBe(true)
    expect(vendorKeyMissing('chatgpt', [
      { id: 'sol', provider: 'chatgpt', configured: true },
    ], null)).toBe(false)
  })
})

describe('filterByKeyPresence', () => {
  it('drops vendors without a key and honors catalog configured:false', () => {
    const rows = [
      { id: 'sol', provider: 'chatgpt' },
      { id: 'flash', provider: 'deepseek' },
      { id: 'opus', provider: 'claude', configured: true },
      { id: 'hidden', provider: 'grok', configured: false },
    ]
    expect(filterByKeyPresence(rows, null)).toEqual([
      { id: 'sol', provider: 'chatgpt' },
      { id: 'flash', provider: 'deepseek' },
      { id: 'opus', provider: 'claude', configured: true },
    ])
    expect(filterByKeyPresence(rows, new Set(['openai', 'deepseek']))).toEqual([
      { id: 'sol', provider: 'chatgpt' },
      { id: 'flash', provider: 'deepseek' },
    ])
    expect(filterByKeyPresence(rows, new Set())).toEqual([])
  })
})

describe('markByKeyPresence', () => {
  it('stamps configured without dropping unkeyed vendors', () => {
    const rows = [
      { id: 'sol', provider: 'chatgpt' },
      { id: 'opus', provider: 'claude' },
    ]
    expect(markByKeyPresence(rows, null)).toEqual(rows)
    expect(markByKeyPresence(rows, new Set(['openai']))).toEqual([
      { id: 'sol', provider: 'chatgpt', configured: true },
      { id: 'opus', provider: 'claude', configured: false },
    ])
  })
})
