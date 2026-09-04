import { describe, expect, it } from 'vitest'
import {
  EMPTY_RESPONSE_CODE,
  LlmError,
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import {
  chunksFromGeoCrmEvents,
  instructionsOf,
  parseGeoCrmSseEvent,
  readSseData,
  sseDataOf,
  takeLastFrame,
  textOf,
  toGeoCrmInput,
  toGeoCrmReasoningEffort,
  toGeoCrmRequest,
  toGeoCrmTools,
} from '../src/translate.ts'

function user(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('textOf', () => {
  it('joins text and tool-result text and skips other blocks', () => {
    expect(textOf([
      { type: 'text', text: 'a' },
      { type: 'reasoning', text: 'hidden' },
      { type: 'image', attachment: {} as never },
      { type: 'file', attachment: {} as never },
      { type: 'tool-call', id: ToolCallId('c'), name: 'n', arguments: '{}' },
      { type: 'tool-result', toolCallId: ToolCallId('c'), content: [{ type: 'text', text: 'b' }] },
      { type: 'unknown-plugin-block' } as never,
    ])).toBe('ab')
  })
})

describe('toGeoCrmInput and tools', () => {
  it('maps user, assistant, tool-call, and tool-result turns', () => {
    const callId = ToolCallId('call-1')
    const messages = [
      user('hello'),
      createAssistantMessage({
        content: [
          { type: 'text', text: 'calling' },
          { type: 'tool-call', id: callId, name: 'bash', arguments: '{"c":1}' },
        ],
        source: { provider: 'geocrm', model: 'deepseek:deepseek-v4-flash' },
      }),
      createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
    ]
    expect(toGeoCrmInput(messages)).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      { type: 'function_call', call_id: callId, name: 'bash', arguments: '{"c":1}' },
      { type: 'message', role: 'assistant', content: [{ type: 'input_text', text: 'calling' }] },
      { type: 'function_call_output', call_id: callId, output: 'ok' },
    ])
  })

  it('skips system-role history and empty text', () => {
    expect(toGeoCrmInput([
      { ...user(''), role: 'system' },
      user(''),
    ])).toEqual([])
  })

  it('maps tool schemas and folds extra system text into instructions', () => {
    expect(toGeoCrmTools([{ name: 'bash', description: 'run', parameters: { type: 'object' } }])).toEqual([
      { type: 'function', name: 'bash', description: 'run', parameters: { type: 'object' } },
    ])
    expect(toGeoCrmTools(undefined)).toEqual([])
    expect(instructionsOf('loop', [
      { ...user('extra system'), role: 'system' },
      user('hi'),
    ])).toBe('loop\n\nextra system')
    expect(instructionsOf(undefined, [])).toBe('')
  })

  it('maps reasoning effort and builds the request body', () => {
    expect(toGeoCrmReasoningEffort(undefined)).toBeUndefined()
    expect(toGeoCrmReasoningEffort('off')).toBeUndefined()
    expect(toGeoCrmReasoningEffort('max')).toBe('high')
    expect(toGeoCrmReasoningEffort('medium')).toBe('medium')
    const request = toGeoCrmRequest({
      provider: 'geocrm',
      model: 'deepseek:deepseek-v4-flash',
      messages: [user('hi')],
      system: 'be brief',
      tools: [{ name: 'bash', description: 'run', parameters: {} }],
      reasoningEffort: 'low' as never,
      sessionId: 'sess-1' as never,
    }, 'deepseek-v4-flash')
    expect(request).toMatchObject({
      model: 'deepseek-v4-flash',
      instructions: 'be brief',
      prompt_cache_key: 'sess-1',
      reasoning: { effort: 'low' },
    })
  })
})

describe('SSE', () => {
  it('reads data lines and ignores [DONE] and event-only frames', () => {
    expect(sseDataOf('event: message\n')).toBeUndefined()
    expect(sseDataOf('data: one\ndata: two\r')).toBe('one\ntwo')
    expect(takeLastFrame([])).toBe('')
    expect(takeLastFrame(['a', 'b'])).toBe('b')
  })

  it('parses JSON objects and rejects other payloads', () => {
    expect(parseGeoCrmSseEvent('{"type":"response.created"}')).toEqual({ type: 'response.created' })
    expect(parseGeoCrmSseEvent('[1]')).toBeUndefined()
    expect(parseGeoCrmSseEvent('not-json')).toBeUndefined()
  })

  it('streams data frames from a byte body', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"a":1}\n\ndata: [DONE]\n\n'))
        controller.close()
      },
    })
    const payloads: string[] = []
    for await (const data of readSseData(body)) payloads.push(data)
    expect(payloads).toEqual(['{"a":1}'])
  })

  it('flushes a trailing frame without a blank-line delimiter', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"b":2}'))
        controller.close()
      },
    })
    const payloads: string[] = []
    for await (const data of readSseData(body)) payloads.push(data)
    expect(payloads).toEqual(['{"b":2}'])
  })

  it('ignores a trailing [DONE] frame without a delimiter', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]'))
        controller.close()
      },
    })
    const payloads: string[] = []
    for await (const data of readSseData(body)) payloads.push(data)
    expect(payloads).toEqual([])
  })

  it('rejects when the abort signal fires during a hung read', async () => {
    const abort = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      start() {
        // Leave the body open so reader.read() stays outstanding.
      },
    })
    const pending = (async () => {
      const payloads: string[] = []
      for await (const data of readSseData(body, abort.signal)) payloads.push(data)
      return payloads
    })()
    abort.abort()
    await expect(pending).rejects.toBeDefined()
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const abort = new AbortController()
    abort.abort(42)
    const body = new ReadableStream<Uint8Array>({
      start() {
        // Leave the body open; cancel is expected to reject after abort.
      },
      cancel() {
        throw new Error('already closed')
      },
    })
    await expect((async () => {
      for await (const _data of readSseData(body, abort.signal)) {
        // Should not yield; the signal is already aborted.
      }
    })()).rejects.toBeDefined()
  })

  it('propagates a body-reader failure', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('body failed'))
      },
    })
    await expect((async () => {
      for await (const _data of readSseData(body, new AbortController().signal)) {
        // The stream errors before any frame arrives.
      }
    })()).rejects.toThrow(/body failed/)

    const nonError = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error('body failed without Error')
      },
    })
    await expect((async () => {
      for await (const _data of readSseData(nonError, new AbortController().signal)) {
        // The stream rejects with a non-Error reason.
      }
    })()).rejects.toThrow(/body failed without Error/)
  })
})

describe('chunksFromGeoCrmEvents', () => {
  it('emits a text turn with usage and stop', () => {
    const chunks = chunksFromGeoCrmEvents([
      { type: 'response.created' },
      {
        type: 'response.output_item.done',
        item: { type: 'message', content: [{ type: 'output_text', text: 'hello' }] },
      },
      {
        type: 'response.completed',
        response: { usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } },
      },
    ])
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hello' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const withoutTotal = chunksFromGeoCrmEvents([
      {
        type: 'response.output_item.done',
        item: { type: 'message', content: [{ type: 'output_text', text: 'x' }] },
      },
      {
        type: 'response.completed',
        response: { usage: { input_tokens: 1, output_tokens: 2 } },
      },
    ])
    expect(withoutTotal).toContainEqual({ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } })
    expect(chunksFromGeoCrmEvents([
      {
        type: 'response.output_item.done',
        item: { type: 'message', content: [{ type: 'output_text', text: 'x' }] },
      },
      { type: 'response.completed', response: [] },
    ]).some(chunk => chunk.type === 'usage')).toBe(false)
  })

  it('emits a function call and a custom tool call', () => {
    const fn = chunksFromGeoCrmEvents([{
      type: 'response.output_item.done',
      item: { type: 'function_call', call_id: 'c1', name: 'bash', arguments: '{}' },
    }])
    expect(fn.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
    expect(fn.some(chunk => chunk.type === 'tool-call-delta' && chunk.id === 'c1')).toBe(true)

    const custom = chunksFromGeoCrmEvents([{
      type: 'response.output_item.done',
      item: { type: 'custom_tool_call', name: 'custom', input: 'plain' },
    }])
    const delta = custom.find(chunk => chunk.type === 'tool-call-delta')
    expect(delta).toMatchObject({ name: 'custom', argumentsDelta: 'plain' })
  })

  it('skips malformed items and incomplete usage', () => {
    expect(() => chunksFromGeoCrmEvents([
      { type: 'response.output_item.done', item: 'nope' },
      { type: 'response.completed', response: { usage: { input_tokens: 'x' } } },
    ])).toThrow(LlmError)
    try {
      chunksFromGeoCrmEvents([])
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError)
      expect((error as LlmError).code).toBe(EMPTY_RESPONSE_CODE)
    }

    const incomplete = chunksFromGeoCrmEvents([{
      type: 'response.output_item.done',
      item: { type: 'function_call' },
    }, {
      type: 'response.output_item.done',
      item: { type: 'custom_tool_call' },
    }, {
      type: 'response.output_item.done',
      item: { type: 'message', content: 'nope' },
    }, {
      type: 'response.output_item.done',
      item: { type: 'message', content: [null, { text: '' }, { text: 'kept' }] },
    }, {
      type: 'response.completed',
      response: null,
    }])
    expect(incomplete.some(chunk => chunk.type === 'text-delta' && chunk.text === 'kept')).toBe(true)

    const incompleteArgs = chunksFromGeoCrmEvents([{
      type: 'response.output_item.done',
      item: { type: 'function_call', name: 'bash', arguments: { a: 1 } },
    }])
    expect(incompleteArgs.some(chunk => chunk.type === 'tool-call-delta' && chunk.argumentsDelta === '')).toBe(true)

    const customNoInput = chunksFromGeoCrmEvents([{
      type: 'response.output_item.done',
      item: { type: 'custom_tool_call', name: 'custom', input: 1 },
    }])
    expect(customNoInput.some(chunk => chunk.type === 'tool-call-delta' && chunk.argumentsDelta === '')).toBe(true)

    const skippedKind = chunksFromGeoCrmEvents([{
      type: 'response.output_item.done',
      item: { type: 'reasoning' },
    }, {
      type: 'response.output_item.done',
      item: { type: 'message', content: [{ type: 'output_text', text: 'kept' }] },
    }, {
      type: 'response.completed',
      response: { usage: null },
    }])
    expect(skippedKind.some(chunk => chunk.type === 'text-delta' && chunk.text === 'kept')).toBe(true)
    expect(skippedKind.some(chunk => chunk.type === 'usage')).toBe(false)
  })
})
