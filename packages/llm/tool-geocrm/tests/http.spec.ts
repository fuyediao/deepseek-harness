import { afterEach, describe, expect, it, vi } from 'vitest'
import { callHarnessTool, parseToolError } from '../src/http.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseToolError', () => {
  it('reads a string error and an object message', () => {
    expect(parseToolError(JSON.stringify({ error: 'forbidden' }))).toBe('forbidden')
    expect(parseToolError(JSON.stringify({ error: { message: 'nope' } }))).toBe('nope')
    expect(parseToolError('<html>')).toBeUndefined()
    expect(parseToolError(JSON.stringify({ error: { message: 1 } }))).toBeUndefined()
    expect(parseToolError(JSON.stringify({ error: '' }))).toBeUndefined()
  })
})

describe('callHarnessTool', () => {
  it('returns a string result and stringifies a non-string result', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ result: '{"ok":true}', isError: false })),
    })))
    await expect(callHarnessTool('http://127.0.0.1:3001/', 'jwt', 'list_my_access', {}, new AbortController().signal))
      .resolves.toBe('{"ok":true}')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ result: { count: 1 } })),
    })))
    await expect(callHarnessTool('http://127.0.0.1:3001', 'jwt', 'count_records', { entity: 'orders' }))
      .resolves.toBe('{"count":1}')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({})),
    })))
    await expect(callHarnessTool('http://127.0.0.1:3001', 'jwt', 'list_entities', {}))
      .resolves.toBe('{}')
  })

  it('throws tool-level and HTTP failures', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ isError: true, result: 'not allowed' })),
    })))
    await expect(callHarnessTool('http://127.0.0.1:3001', 'jwt', 'delete_record', {}))
      .rejects.toThrow('not allowed')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 403,
      text: () => Promise.resolve(JSON.stringify({ error: 'Harness is not enabled for this account.' })),
    })))
    await expect(callHarnessTool('http://127.0.0.1:3001', 'jwt', 'list_my_access', {}))
      .rejects.toThrow('Harness is not enabled for this account.')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ error: { message: 'Invalid tool arguments.' } })),
    })))
    await expect(callHarnessTool('http://127.0.0.1:3001', 'jwt', 'search_records', {}))
      .rejects.toThrow('Invalid tool arguments.')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 502,
      text: () => Promise.resolve('upstream'),
    })))
    await expect(callHarnessTool('http://127.0.0.1:3001', 'jwt', 'search_records', {}))
      .rejects.toThrow(/HTTP 502/)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('not-json'),
    })))
    await expect(callHarnessTool('http://127.0.0.1:3001', 'jwt', 'list_my_access', {}))
      .rejects.toThrow(/non-JSON/)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ isError: true, result: { code: 'denied' } })),
    })))
    await expect(callHarnessTool('http://127.0.0.1:3001', 'jwt', 'delete_record', {}))
      .rejects.toThrow('{"code":"denied"}')
  })
})
