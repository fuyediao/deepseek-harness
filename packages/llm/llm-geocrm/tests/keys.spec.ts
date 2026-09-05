import { describe, expect, it } from 'vitest'
import {
  filterByKeyPresence,
  parseConfiguredList,
  parseConfiguredProviders,
  parseKeyPresence,
  providerKeyAliases,
  vendorHasConfiguredKey,
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
  it('prefers the configured-id list over connectivity rows', () => {
    expect(parseKeyPresence({ configured: ['deepseek'] })).toEqual(new Set(['deepseek']))
    expect(parseKeyPresence({ models: [{ model: 'openai' }] })).toEqual(new Set(['openai']))
    expect(parseKeyPresence({ models: [{ id: 'x', provider: 'y' }] })).toBeNull()
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
