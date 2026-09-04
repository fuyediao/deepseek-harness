import { describe, expect, it } from 'vitest'
import { CONTEXT_WINDOW_EXCEEDED_CODE, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import { geocrmHttpErrorCode, normalizeGeoCrmOrigin, parseGeoCrmErrorBody } from '../src/http.ts'

describe('normalizeGeoCrmOrigin', () => {
  it('strips trailing slashes', () => {
    expect(normalizeGeoCrmOrigin('http://127.0.0.1:3001///')).toBe('http://127.0.0.1:3001')
    expect(normalizeGeoCrmOrigin('http://127.0.0.1:3001')).toBe('http://127.0.0.1:3001')
  })
})

describe('parseGeoCrmErrorBody', () => {
  it('reads the gateway error document', () => {
    expect(parseGeoCrmErrorBody(JSON.stringify({
      error: { message: 'Unknown AI provider.', type: 'invalid_provider' },
      code: 'invalid_provider',
    }))).toEqual({
      type: 'invalid_provider',
      message: 'Unknown AI provider.',
      code: 'invalid_provider',
    })
  })

  it('falls back to the root code when type is absent', () => {
    expect(parseGeoCrmErrorBody(JSON.stringify({ code: 'not_found' }))).toEqual({
      type: 'not_found',
      code: 'not_found',
    })
  })

  it('returns an empty object for non-JSON', () => {
    expect(parseGeoCrmErrorBody('<html>nope</html>')).toEqual({})
  })

  it('ignores a non-string type and an absent root code', () => {
    expect(parseGeoCrmErrorBody(JSON.stringify({
      error: { type: 1, message: 'bad' },
    }))).toEqual({ message: 'bad' })
    expect(parseGeoCrmErrorBody(JSON.stringify({
      error: { type: 'invalid_model', message: 'no' },
    }))).toEqual({ type: 'invalid_model', message: 'no' })
  })
})

describe('geocrmHttpErrorCode', () => {
  it('maps gateway statuses onto harness codes', () => {
    expect(geocrmHttpErrorCode(401)).toBe('AUTH')
    expect(geocrmHttpErrorCode(403)).toBe('AUTH')
    expect(geocrmHttpErrorCode(413)).toBe('INVALID_REQUEST')
    expect(geocrmHttpErrorCode(422)).toBe('INVALID_REQUEST')
    expect(geocrmHttpErrorCode(429)).toBe('RATE_LIMIT')
    expect(geocrmHttpErrorCode(400)).toBe('INVALID_REQUEST')
    expect(geocrmHttpErrorCode(400, { message: 'input too large for the model context window' }))
      .toBe(CONTEXT_WINDOW_EXCEEDED_CODE)
    expect(geocrmHttpErrorCode(402, { message: 'insufficient quota' })).toBe(QUOTA_EXCEEDED_CODE)
    expect(geocrmHttpErrorCode(502)).toBe('SERVER')
    expect(geocrmHttpErrorCode(418)).toBe('HTTP_418')
  })
})
