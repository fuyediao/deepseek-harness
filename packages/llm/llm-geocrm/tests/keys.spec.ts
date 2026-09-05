import { describe, expect, it } from 'vitest'
import {
  applyKeyPresence,
  parseConfiguredProviders,
  providerKeyAliases,
  vendorHasConfiguredKey,
} from '../src/keys.ts'

describe('providerKeyAliases', () => {
  it('maps chat slugs onto the GeoCRM BYOK bag ids', () => {
    expect(providerKeyAliases('chatgpt')).toEqual(['chatgpt', 'openai'])
    expect(providerKeyAliases('OpenAI')).toEqual(['chatgpt', 'openai'])
    expect(providerKeyAliases('claude')).toEqual(['claude', 'anthropic'])
    expect(providerKeyAliases('ANTHROPIC')).toEqual(['claude', 'anthropic'])
    expect(providerKeyAliases('gemini')).toEqual(['gemini'])
    expect(providerKeyAliases('  ')).toEqual([])
  })
})

describe('vendorHasConfiguredKey', () => {
  it('treats openai as the ChatGPT key and ignores unknown slugs', () => {
    const configured = new Set(['openai', 'gemini'])
    expect(vendorHasConfiguredKey('chatgpt', configured)).toBe(true)
    expect(vendorHasConfiguredKey('gemini', configured)).toBe(true)
    expect(vendorHasConfiguredKey('claude', configured)).toBe(false)
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

describe('applyKeyPresence', () => {
  it('stamps configured when presence is known and leaves catalog flags otherwise', () => {
    const rows = [
      { id: 'sol', provider: 'chatgpt' },
      { id: 'opus', provider: 'claude', configured: true },
    ]
    expect(applyKeyPresence(rows, null)).toEqual(rows)
    expect(applyKeyPresence(rows, new Set(['openai']))).toEqual([
      { id: 'sol', provider: 'chatgpt', configured: true },
      { id: 'opus', provider: 'claude', configured: false },
    ])
  })
})
