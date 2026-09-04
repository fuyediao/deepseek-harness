import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_RESPONSE_CODE,
  LlmError,
  attributionHeaders,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { GeoCrmAdapter } from '../src/adapter.ts'
import { DEFAULT_MODELS } from '../src/catalog.ts'
import { mockGeoCrm, writeSse, writeTurn } from './mock-server.ts'

const servers: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()))
})

function connection(baseURL: string) {
  return {
    apiKeyEnv: credentialRef('GEOCRM_HARNESS_TOKEN'),
    baseURL,
    models: [...DEFAULT_MODELS],
    defaultContextWindow: 200_000,
    streamIdleTimeoutMs: 5_000,
    retryPolicy: resolveRetryPolicy(undefined, 'test'),
  }
}

function adapterOf(baseURL: string, apiKey = 'jwt-token') {
  const options = connection(baseURL)
  return new GeoCrmAdapter({
    options: () => options,
    resolveApiKey: () => Promise.resolve(apiKey),
  })
}

function user(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

async function drain(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const chunks: unknown[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('GeoCrmAdapter', () => {
  it('lists the advisory catalog when the token cannot be resolved', async () => {
    const adapter = new GeoCrmAdapter({
      options: () => connection('http://127.0.0.1:9'),
      resolveApiKey: () => Promise.reject(new LlmError('missing', 'MISSING_CREDENTIAL')),
    })
    const models = await adapter.listModels('geocrm')
    expect(models.map(model => model.id)).toContain('deepseek:deepseek-v4-flash')
    expect(adapter.providerInfo('geocrm')).toEqual({ id: 'geocrm', name: 'GeoCRM' })
    expect(adapter.providerRetryPolicy('geocrm').mode).toBe('normal')
  })

  it('lists the live catalog and discovers models', async () => {
    const server = await mockGeoCrm((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        models: [
          { id: 'deepseek-v4-flash', provider: 'deepseek', labelEn: 'Flash' },
          { id: 'glm-5.2', provider: 'zhipu', labelEn: 'GLM' },
        ],
      }))
    })
    servers.push(server)
    const adapter = adapterOf(server.origin)
    const models = await adapter.listModels('geocrm')
    expect(models).toEqual([
      { provider: 'geocrm', id: 'deepseek:deepseek-v4-flash', name: 'Flash' },
      { provider: 'geocrm', id: 'zhipu:glm-5.2', name: 'GLM' },
    ])
    const discovered = await adapter.discover({
      baseURL: `${server.origin}/`,
      apiKey: 'typed-jwt',
    })
    expect(discovered.map(model => model.id)).toEqual([
      'deepseek:deepseek-v4-flash',
      'zhipu:glm-5.2',
    ])
    expect(server.requests[0]?.headers['user-agent']).toBe(attributionHeaders()['user-agent'])
  })

  it('returns static flagships when discovery has no token', async () => {
    const adapter = adapterOf('http://127.0.0.1:9')
    const discovered = await adapter.discover({})
    expect(discovered.map(model => model.id)).toContain('chatgpt:gpt-5.6-sol')
  })

  it('refuses a failed catalog fetch during discovery', async () => {
    const server = await mockGeoCrm((_request, response) => {
      response.statusCode = 401
      response.end(JSON.stringify({ error: { message: 'Sign in required.', type: 'unauthorized' } }))
    })
    servers.push(server)
    const adapter = adapterOf(server.origin)
    await expect(adapter.discover({ baseURL: server.origin, apiKey: 'bad' }))
      .rejects.toMatchObject({ code: 'AUTH', message: 'Sign in required.' })
  })

  it('resolves composite and advisory metadata', async () => {
    const adapter = adapterOf('http://127.0.0.1:9')
    const resolved = await adapter.resolveModel('geocrm', 'deepseek:deepseek-v4-flash')
    expect(resolved).toMatchObject({
      provider: 'geocrm',
      id: 'deepseek:deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      context: { contextWindow: 200_000 },
    })
  })

  it('streams a text turn through the Responses path', async () => {
    const server = await mockGeoCrm((request, response, recorded) => {
      if (request.url === '/ai/models?client=electron') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ models: [] }))
        return
      }
      expect(recorded.headers['x-geocrm-provider']).toBe('deepseek')
      expect(recorded.headers.authorization).toBe('Bearer jwt-token')
      expect(JSON.parse(recorded.body)).toMatchObject({
        model: 'deepseek-v4-flash',
        instructions: 'sys',
      })
      writeTurn(response, {
        type: 'message',
        content: [{ type: 'output_text', text: 'done' }],
      })
    })
    servers.push(server)
    const adapter = adapterOf(server.origin)
    const chunks = await drain(adapter.stream({
      provider: 'geocrm',
      model: 'deepseek:deepseek-v4-flash',
      system: 'sys',
      messages: [user('hi')],
    }))
    expect(chunks.some(chunk => (chunk as { type: string }).type === 'text-delta')).toBe(true)
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('streams a tool call and maps HTTP refusals', async () => {
    const server = await mockGeoCrm((request, response) => {
      if (request.url === '/ai/models?client=electron') {
        response.statusCode = 500
        response.end('no')
        return
      }
      writeTurn(response, {
        type: 'function_call',
        call_id: 'c1',
        name: 'bash',
        arguments: '{}',
      })
    })
    servers.push(server)
    const adapter = adapterOf(server.origin)
    const chunks = await drain(adapter.stream({
      provider: 'geocrm',
      model: 'deepseek-v4-flash',
      messages: [user('run')],
    }))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('throws TRANSPORT when the origin is unreachable', async () => {
    const adapter = adapterOf('http://127.0.0.1:1')
    await expect(drain(adapter.stream({
      provider: 'geocrm',
      model: 'deepseek:deepseek-v4-flash',
      messages: [user('hi')],
    }))).rejects.toMatchObject({ code: 'TRANSPORT' })
  })

  it('throws EMPTY_RESPONSE when the SSE turn has no output', async () => {
    const server = await mockGeoCrm((request, response) => {
      if (request.url === '/ai/models?client=electron') {
        response.end(JSON.stringify({ models: [] }))
        return
      }
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
      response.end('data: {"type":"response.created"}\n\ndata: [DONE]\n\n')
    })
    servers.push(server)
    const adapter = adapterOf(server.origin)
    await expect(drain(adapter.stream({
      provider: 'geocrm',
      model: 'deepseek:deepseek-v4-flash',
      messages: [user('hi')],
    }))).rejects.toMatchObject({ code: EMPTY_RESPONSE_CODE })
  })

  it('throws INVALID_REQUEST for a 422 missing vendor key', async () => {
    const server = await mockGeoCrm((request, response) => {
      if (request.url === '/ai/models?client=electron') {
        response.end(JSON.stringify({ models: [] }))
        return
      }
      response.statusCode = 422
      response.end(JSON.stringify({
        error: { message: 'The selected provider has no API key.', type: 'missing_api_key' },
      }))
    })
    servers.push(server)
    const adapter = adapterOf(server.origin)
    await expect(drain(adapter.stream({
      provider: 'geocrm',
      model: 'deepseek:deepseek-v4-flash',
      messages: [user('hi')],
    }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('honors caller abort on the Responses POST', async () => {
    const abort = new AbortController()
    const server = await mockGeoCrm(() => {
      abort.abort()
    })
    servers.push(server)
    const adapter = adapterOf(server.origin)
    abort.abort()
    await expect(drain(adapter.stream({
      provider: 'geocrm',
      model: 'deepseek:deepseek-v4-flash',
      messages: [user('hi')],
      signal: abort.signal,
    }))).rejects.toBeDefined()
  })

  it('lists advisory rows with optional description and a missing name', async () => {
    const adapter = new GeoCrmAdapter({
      options: () => ({
        ...connection('http://127.0.0.1:9'),
        models: [
          { id: 'bare-id', description: 'Bare' },
          { id: 'named', name: 'Named' },
        ],
      }),
      resolveApiKey: () => Promise.reject(new LlmError('missing', 'MISSING_CREDENTIAL')),
    })
    expect(await adapter.listModels('geocrm')).toEqual([
      { provider: 'geocrm', id: 'bare-id', name: 'bare-id', description: 'Bare' },
      { provider: 'geocrm', id: 'named', name: 'Named' },
    ])
    const resolved = await adapter.resolveModel('geocrm', 'named')
    expect(resolved.name).toBe('Named')
  })

  it('names a live catalog row with the picker id when no label exists', async () => {
    const server = await mockGeoCrm((_request, response) => {
      response.end(JSON.stringify({
        models: [{ id: 'bare', provider: 'deepseek' }],
      }))
    })
    servers.push(server)
    const adapter = new GeoCrmAdapter({
      options: () => ({
        ...connection(server.origin),
        models: [{ id: 'other' }],
      }),
      resolveApiKey: () => Promise.resolve('jwt-token'),
    })
    const resolved = await adapter.resolveModel('geocrm', 'deepseek:bare')
    expect(resolved.name).toBe('deepseek:bare')
  })

  it('projects a nameless composite advisory id when the live catalog is down', async () => {
    const adapter = new GeoCrmAdapter({
      options: () => ({
        ...connection('http://127.0.0.1:9'),
        models: [{ id: 'zhipu:glm-5.2' }],
      }),
      resolveApiKey: () => Promise.reject(new LlmError('missing', 'MISSING_CREDENTIAL')),
    })
    const resolved = await adapter.resolveModel('geocrm', 'zhipu:glm-5.2')
    expect(resolved.name).toBe('zhipu:glm-5.2')
  })

  it('resolves vision and advisory capacities from a live catalog', async () => {
    const server = await mockGeoCrm((_request, response) => {
      response.end(JSON.stringify({
        models: [{ id: 'gpt-5.6-sol', provider: 'chatgpt', labelEn: 'Sol', vision: true }],
      }))
    })
    servers.push(server)
    const adapter = new GeoCrmAdapter({
      options: () => ({
        ...connection(server.origin),
        models: [{
          id: 'chatgpt:gpt-5.6-sol',
          name: 'Sol',
          description: 'Flagship',
          contextWindow: 128_000,
          maxTokens: 4_096,
        }],
      }),
      resolveApiKey: () => Promise.resolve('jwt-token'),
    })
    const resolved = await adapter.resolveModel('geocrm', 'chatgpt:gpt-5.6-sol')
    expect(resolved).toMatchObject({
      description: 'Flagship',
      inputModalities: ['text', 'image'],
      context: { contextWindow: 128_000 },
      defaultMaxTokens: 4_096,
    })
  })

  it('throws TRANSPORT when the Responses body is missing', async () => {
    const adapter = adapterOf('http://127.0.0.1:9')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const href = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      if (href.includes('/ai/models')) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 })
      }
      return new Response(null, { status: 200 })
    })
    await expect(drain(adapter.stream({
      provider: 'geocrm',
      model: 'deepseek:deepseek-v4-flash',
      messages: [user('hi')],
    }))).rejects.toMatchObject({ code: 'TRANSPORT', message: /no body/ })
    fetchSpy.mockRestore()
  })

  it('times out an idle Responses stream', async () => {
    const server = await mockGeoCrm((request, response) => {
      if (request.url === '/ai/models?client=electron') {
        response.end(JSON.stringify({ models: [] }))
        return
      }
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
    })
    servers.push(server)
    const adapter = new GeoCrmAdapter({
      options: () => ({ ...connection(server.origin), streamIdleTimeoutMs: 20 }),
      resolveApiKey: () => Promise.resolve('jwt-token'),
    })
    await expect(drain(adapter.stream({
      provider: 'geocrm',
      model: 'deepseek:deepseek-v4-flash',
      messages: [user('hi')],
    }))).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('uses a generic message when the error body is empty', async () => {
    const server = await mockGeoCrm((request, response) => {
      if (request.url === '/ai/models?client=electron') {
        response.end(JSON.stringify({ models: [] }))
        return
      }
      response.statusCode = 418
      response.end()
    })
    servers.push(server)
    const adapter = adapterOf(server.origin)
    await expect(drain(adapter.stream({
      provider: 'geocrm',
      model: 'deepseek:deepseek-v4-flash',
      messages: [user('hi')],
    }))).rejects.toMatchObject({ code: 'HTTP_418' })
  })

  it('rethrows a dropped Responses connection after headers', async () => {
    const server = await mockGeoCrm((request, response) => {
      if (request.url === '/ai/models?client=electron') {
        response.end(JSON.stringify({ models: [] }))
        return
      }
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
      writeSse(response, JSON.stringify({ type: 'response.created' }))
      response.destroy()
    })
    servers.push(server)
    const adapter = adapterOf(server.origin)
    await expect(drain(adapter.stream({
      provider: 'geocrm',
      model: 'deepseek:deepseek-v4-flash',
      messages: [user('hi')],
    }))).rejects.toBeDefined()
  })

  it('skips malformed SSE payloads and still finishes a later text turn', async () => {
    const server = await mockGeoCrm((request, response) => {
      if (request.url === '/ai/models?client=electron') {
        response.end(JSON.stringify({ models: [] }))
        return
      }
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
      writeSse(response, 'not-json')
      writeSse(response, JSON.stringify({ type: 'response.created', response: { id: 'resp_1' } }))
      writeSse(response, JSON.stringify({
        type: 'response.output_item.done',
        item: { type: 'message', content: [{ type: 'output_text', text: 'ok' }] },
      }))
      writeSse(response, JSON.stringify({
        type: 'response.completed',
        response: { id: 'resp_1', usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
      }))
      response.end('data: [DONE]\n\n')
    })
    servers.push(server)
    const adapter = adapterOf(server.origin)
    const chunks = await drain(adapter.stream({
      provider: 'geocrm',
      model: 'bare-id',
      messages: [user('hi')],
    }))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('prepareCall snapshots the token for the later stream', async () => {
    const server = await mockGeoCrm((request, response) => {
      if (request.url === '/ai/models?client=electron') {
        response.end(JSON.stringify({ models: [] }))
        return
      }
      writeTurn(response, {
        type: 'message',
        content: [{ type: 'output_text', text: 'ok' }],
      })
    })
    servers.push(server)
    const adapter = adapterOf(server.origin, 'prepared-jwt')
    const prepared = await adapter.prepareCall('geocrm', 'deepseek:deepseek-v4-flash')
    expect(prepared.model.id).toBe('deepseek:deepseek-v4-flash')
    await drain(prepared.stream({
      provider: 'geocrm',
      model: 'deepseek:deepseek-v4-flash',
      messages: [user('hi')],
    }))
    const post = server.requests.find(request => request.url === '/ai/harness/responses')
    expect(post?.headers.authorization).toBe('Bearer prepared-jwt')
  })
})
