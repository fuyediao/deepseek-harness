import { describe, expect, it } from 'vitest'
import {
  ElectronIpcFrameReader,
  encodeFrame,
  parseHostFrame,
  parseMainFrame,
  type ElectronIpcFetchRequestFrame,
  type ElectronIpcFetchResponseFrame,
} from '../src/index.ts'

describe('ElectronIpcFrameReader', () => {
  it('splits complete lines and buffers a partial tail across pushes', () => {
    const reader = new ElectronIpcFrameReader()
    expect(reader.push('{"t":"abort","id":"a"}\n{"t":"abort","id":"b"}\n')).toEqual([
      { t: 'abort', id: 'a' },
      { t: 'abort', id: 'b' },
    ])
    expect(reader.push('{"t":"ab')).toEqual([])
    expect(reader.push('ort","id":"c"}\n')).toEqual([{ t: 'abort', id: 'c' }])
  })

  it('skips a blank line and accepts Buffer chunks', () => {
    const reader = new ElectronIpcFrameReader()
    expect(reader.push(Buffer.from('\n{"t":"abort","id":"x"}\n'))).toEqual([{ t: 'abort', id: 'x' }])
  })

  it('throws SyntaxError for a malformed completed line', () => {
    const reader = new ElectronIpcFrameReader()
    expect(() => reader.push('not json\n')).toThrow(SyntaxError)
  })
})

describe('encodeFrame', () => {
  it('serializes one frame as a single newline-terminated JSON line', () => {
    const frame: ElectronIpcFetchRequestFrame = {
      t: 'fetch', id: 'r1', method: 'GET', url: 'http://dsh.internal/api/session.list', headers: {},
    }
    expect(encodeFrame(frame)).toBe(`${JSON.stringify(frame)}\n`)
  })
})

describe('parseMainFrame', () => {
  it('accepts a well-formed fetch, stream-open, and abort frame', () => {
    expect(parseMainFrame({
      t: 'fetch', id: 'r1', method: 'POST', url: '/api/x', headers: { 'Content-Type': 'application/json' }, body: 'e30=',
    })).toEqual({
      t: 'fetch', id: 'r1', method: 'POST', url: '/api/x', headers: { 'content-type': 'application/json' }, body: 'e30=',
    })
    expect(parseMainFrame({ t: 'fetch', id: 'r2', method: 'GET', url: '/api/x', headers: {} }))
      .toEqual({ t: 'fetch', id: 'r2', method: 'GET', url: '/api/x', headers: {} })
    expect(parseMainFrame({ t: 'stream-open', id: 's1', endpoint: 'events.mux', payload: { since: 0 } }))
      .toEqual({ t: 'stream-open', id: 's1', endpoint: 'events.mux', payload: { since: 0 } })
    expect(parseMainFrame({ t: 'abort', id: 'r1' })).toEqual({ t: 'abort', id: 'r1' })
    expect(parseMainFrame({ t: 'boot-request' })).toEqual({ t: 'boot-request' })
  })

  it('rejects a non-object value, a missing id, and an unknown type', () => {
    expect(() => parseMainFrame('nope')).toThrow(/not an object/)
    expect(() => parseMainFrame({ t: 'abort' })).toThrow(/non-empty string id/)
    expect(() => parseMainFrame({ t: 'abort', id: '' })).toThrow(/non-empty string id/)
    expect(() => parseMainFrame({ t: 'bogus', id: 'x' })).toThrow(/unknown frame type/)
  })

  it('rejects a malformed fetch and stream-open frame', () => {
    expect(() => parseMainFrame({ t: 'fetch', id: 'r1', method: 'GET' })).toThrow(/string method and url/)
    expect(() => parseMainFrame({ t: 'fetch', id: 'r1', method: 'GET', url: '/x' })).toThrow(/headers object/)
    expect(() => parseMainFrame({ t: 'fetch', id: 'r1', method: 'GET', url: '/x', headers: {}, body: 7 }))
      .toThrow(/body must be a base64 string/)
    expect(() => parseMainFrame({ t: 'stream-open', id: 's1', endpoint: '' })).toThrow(/non-empty endpoint/)
  })
})

describe('parseHostFrame', () => {
  it('accepts a well-formed fetch-res, stream-item, stream-end, and stream-error frame', () => {
    const response: ElectronIpcFetchResponseFrame = {
      t: 'fetch-res', id: 'r1', status: 200, headers: { 'content-type': 'application/json' }, body: 'e30=',
    }
    expect(parseHostFrame(response)).toEqual(response)
    expect(parseHostFrame({ t: 'fetch-res', id: 'r1', status: 404, headers: {} }))
      .toEqual({ t: 'fetch-res', id: 'r1', status: 404, headers: {} })
    expect(parseHostFrame({ t: 'stream-item', id: 's1', value: { rev: 1 } }))
      .toEqual({ t: 'stream-item', id: 's1', value: { rev: 1 } })
    expect(parseHostFrame({ t: 'stream-item', id: 's1' })).toEqual({ t: 'stream-item', id: 's1' })
    expect(parseHostFrame({ t: 'stream-end', id: 's1' })).toEqual({ t: 'stream-end', id: 's1' })
    expect(parseHostFrame({
      t: 'stream-error', id: 's1', failure: { kind: 'remote', code: 'gateway/bad-request', message: 'nope', details: {} },
    })).toEqual({
      t: 'stream-error', id: 's1', failure: { kind: 'remote', code: 'gateway/bad-request', message: 'nope', details: {} },
    })
    expect(parseHostFrame({ t: 'stream-error', id: 's1', failure: { kind: 'carrier', message: 'closed' } }))
      .toEqual({ t: 'stream-error', id: 's1', failure: { kind: 'carrier', message: 'closed' } })
    expect(parseHostFrame({ t: 'boot', injections: [{ kind: 'global', name: '__DSH_BOOT__', value: {} }] }))
      .toEqual({ t: 'boot', injections: [{ kind: 'global', name: '__DSH_BOOT__', value: {} }] })
  })

  it('rejects a boot frame without an injections array', () => {
    expect(() => parseHostFrame({ t: 'boot' })).toThrow(/injections array/)
  })

  it('rejects a non-object value, a missing id, and an unknown type', () => {
    expect(() => parseHostFrame(42)).toThrow(/not an object/)
    expect(() => parseHostFrame({ t: 'stream-end' })).toThrow(/non-empty string id/)
    expect(() => parseHostFrame({ t: 'bogus', id: 'x' })).toThrow(/unknown frame type/)
  })

  it('rejects a malformed fetch-res and stream-error frame', () => {
    expect(() => parseHostFrame({ t: 'fetch-res', id: 'r1', headers: {} })).toThrow(/numeric status/)
    expect(() => parseHostFrame({ t: 'fetch-res', id: 'r1', status: 200 })).toThrow(/headers object/)
    expect(() => parseHostFrame({ t: 'fetch-res', id: 'r1', status: 200, headers: {}, body: 7 }))
      .toThrow(/body must be a base64 string/)
    expect(() => parseHostFrame({ t: 'stream-error', id: 's1' })).toThrow(/failure object/)
    expect(() => parseHostFrame({ t: 'stream-error', id: 's1', failure: { kind: 'remote' } }))
      .toThrow(/code, message, and details/)
    expect(() => parseHostFrame({ t: 'stream-error', id: 's1', failure: { kind: 'carrier' } }))
      .toThrow(/needs a message/)
    expect(() => parseHostFrame({ t: 'stream-error', id: 's1', failure: { kind: 'bogus' } }))
      .toThrow(/unknown failure kind/)
  })
})
