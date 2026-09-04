/**
 * Translate harness messages and tools into GeoCRM Responses input, and
 * complete-turn SSE events into harness stream chunks.
 * @module dsh-llm-geocrm/translate
 */

import { EMPTY_RESPONSE_CODE, LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  Message,
  StreamChunk,
  TokenUsage,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'

/** One GeoCRM Responses `input` item. */
export type GeoCrmInputItem = Record<string, unknown>

/** One GeoCRM Responses `tools` item. */
export type GeoCrmToolItem = Record<string, unknown>

/** One parsed GeoCRM SSE JSON object. */
export type GeoCrmSseEvent = Record<string, unknown>

/**
 * Collect model-visible text from one message's content blocks.
 * Image, file, reasoning, and unknown blocks contribute nothing: GeoCRM's
 * harness route is a complete-turn text and tool-call gateway.
 * @param content - message blocks.
 * @returns concatenated text, or an empty string when none is present.
 */
export function textOf(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) parts.push(block.text)
        break
      case 'tool-result':
        parts.push(textOf(block.content))
        break
      case 'reasoning':
      case 'image':
      case 'file':
      case 'tool-call':
        break
      default:
        break
    }
  }
  return parts.join('')
}

/**
 * Map harness tools to GeoCRM `function` tool items.
 * @param tools - harness tool schemas, or `undefined`.
 * @returns GeoCRM tool list; empty when no tools are present.
 */
export function toGeoCrmTools(tools: readonly ToolSchema[] | undefined): GeoCrmToolItem[] {
  if (tools === undefined) return []
  return tools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

/**
 * Map harness history to GeoCRM Responses `input`.
 * System-role history is omitted here; callers fold it into `instructions`.
 * @param messages - conversation after the system slot.
 * @returns GeoCRM input items in order.
 */
export function toGeoCrmInput(messages: readonly Message[]): GeoCrmInputItem[] {
  const input: GeoCrmInputItem[] = []
  for (const message of messages) {
    if (message.role === 'system') continue
    if (message.source.kind === 'tool') {
      const output = textOf(message.content)
      input.push({
        type: 'function_call_output',
        call_id: message.source.callId,
        output,
      })
      continue
    }
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type !== 'tool-call') continue
        input.push({
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: block.arguments,
        })
      }
    }
    const text = textOf(
      message.content.filter(block => block.type !== 'tool-call' && block.type !== 'tool-result'),
    )
    if (text.length === 0) continue
    input.push({
      type: 'message',
      role: message.role,
      content: [{ type: 'input_text', text }],
    })
  }
  return input
}

/**
 * Fold extra system-role history into the request instructions.
 * @param system - loop system prompt, when present.
 * @param messages - conversation that may include further system-role rows.
 * @returns concatenated instructions, or an empty string.
 */
export function instructionsOf(system: string | undefined, messages: readonly Message[]): string {
  const extra = messages
    .filter(message => message.role === 'system')
    .map(message => textOf(message.content))
    .filter(text => text.length > 0)
  const parts = [system ?? '', ...extra].filter(part => part.length > 0)
  return parts.join('\n\n')
}

/**
 * Map a harness reasoning effort onto GeoCRM's `reasoning.effort` field.
 * `off` omits the field. `max` is sent as `high` because GeoCRM's catalog
 * efforts are vendor-native low/medium/high values.
 * @param effort - branded effort id, or `undefined`.
 * @returns GeoCRM effort, or `undefined` to omit the field.
 */
export function toGeoCrmReasoningEffort(effort: string | undefined): string | undefined {
  if (effort === undefined || effort === 'off') return undefined
  if (effort === 'max') return 'high'
  return effort
}

/**
 * Split an SSE byte stream into `data:` payloads. GeoCRM writes
 * `data: {json}\\n\\n` without `event:` lines, then `data: [DONE]`.
 * @param body - HTTP response body.
 * @param signal - caller or idle-watchdog cancellation. Node's fetch body
 * reader does not reject on abort after headers arrive, so this race is
 * what makes an idle timeout terminate a hung SSE read.
 * @returns decoded data payloads, excluding `[DONE]`.
 */
export async function* readSseData(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await readOrAbort(reader, signal)
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = takeLastFrame(frames)
      for (const frame of frames) {
        const data = sseDataOf(frame)
        if (data === undefined || data === '[DONE]') continue
        yield data
      }
    }
    buffer += decoder.decode()
    if (buffer.length > 0) {
      const data = sseDataOf(buffer)
      if (data !== undefined && data !== '[DONE]') yield data
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Recover a throwable from an aborted signal.
 * @param signal - aborted signal.
 * @returns the stored reason when it is an Error, otherwise a generic abort.
 */
function abortReasonOf(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError')
}

/**
 * Read the next SSE body chunk, or reject when `signal` aborts first.
 * @param reader - locked response-body reader.
 * @param signal - caller or idle-watchdog cancellation.
 * @returns the next read result.
 */
async function readOrAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal === undefined) return await reader.read()
  return await new Promise((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      void reader.cancel(abortReasonOf(signal)).catch((_alreadyClosed: unknown) => {
        // The body may already be closed by fetch abort; the race owns the outcome.
      })
      reject(abortReasonOf(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    void reader.read().then(
      (result) => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * Remove and return the incomplete trailing SSE frame.
 * `String.prototype.split` always yields at least one element; an empty
 * array is accepted so the helper stays total.
 * @param frames - split SSE frames; the last entry is the unread remainder.
 * @returns the remainder, or an empty string when `frames` is empty.
 */
export function takeLastFrame(frames: string[]): string {
  const remainder = frames.pop()
  return remainder === undefined ? '' : remainder
}

/**
 * Collect `data:` lines from one SSE frame.
 * @param frame - text between blank-line delimiters.
 * @returns joined data, or `undefined` when the frame has none.
 */
export function sseDataOf(frame: string): string | undefined {
  const lines: string[] = []
  for (const raw of frame.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('data:')) lines.push(line.slice(5).trimStart())
  }
  if (lines.length === 0) return undefined
  return lines.join('\n')
}

/**
 * Parse one GeoCRM SSE payload as JSON.
 * @param data - `data:` payload.
 * @returns the event object, or `undefined` when the payload is not an object.
 */
export function parseGeoCrmSseEvent(data: string): GeoCrmSseEvent | undefined {
  try {
    const parsed: unknown = JSON.parse(data)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed as GeoCrmSseEvent
  } catch {
    return undefined
  }
}

/**
 * Turn one complete GeoCRM turn into harness stream chunks.
 * GeoCRM emits at most one text message or one tool call, then usage zeros.
 * @param events - parsed SSE objects in arrival order.
 * @returns chunks through `finish`; throws {@link EMPTY_RESPONSE_CODE} when no output arrived.
 */
export function chunksFromGeoCrmEvents(events: readonly GeoCrmSseEvent[]): StreamChunk[] {
  let text: string | undefined
  let tool: { id: string; name: string; arguments: string } | undefined
  let usage: TokenUsage | undefined
  for (const event of events) {
    if (event.type === 'response.output_item.done') {
      const item = event.item
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
      const record = item as Record<string, unknown>
      if (record.type === 'function_call' || record.type === 'custom_tool_call') {
        const name = typeof record.name === 'string' ? record.name : ''
        if (name.length === 0) continue
        const id = typeof record.call_id === 'string' && record.call_id.length > 0
          ? record.call_id
          : 'geocrm-tool-call'
        const argumentsText = record.type === 'custom_tool_call'
          ? typeof record.input === 'string' ? record.input : ''
          : typeof record.arguments === 'string' ? record.arguments : ''
        tool = { id, name, arguments: argumentsText }
      } else if (record.type === 'message') {
        text = outputTextOf(record.content)
      }
    }
    if (event.type === 'response.completed') {
      usage = usageOf(event.response)
    }
  }
  if (tool === undefined && (text === undefined || text.length === 0)) {
    throw new LlmError('GeoCRM completed a turn with no text or tool call', EMPTY_RESPONSE_CODE)
  }
  const chunks: StreamChunk[] = []
  if (tool !== undefined) {
    const id = ToolCallId(tool.id)
    chunks.push({ type: 'block-start', index: 0, blockType: 'tool-call' })
    chunks.push({
      type: 'tool-call-delta',
      index: 0,
      id,
      name: tool.name,
      argumentsDelta: tool.arguments,
    })
    chunks.push({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id, name: tool.name, arguments: tool.arguments },
    })
  } else {
    const output = text as string
    chunks.push({ type: 'block-start', index: 0, blockType: 'text' })
    chunks.push({ type: 'text-delta', index: 0, text: output })
    chunks.push({ type: 'block-end', index: 0, block: { type: 'text', text: output } })
  }
  if (usage !== undefined) chunks.push({ type: 'usage', usage })
  chunks.push({
    type: 'finish',
    reason: tool === undefined ? { kind: 'stop' } : { kind: 'tool-calls' },
  })
  return chunks
}

/**
 * Build the GeoCRM Responses JSON body for one harness request.
 * @param options - assembled harness request.
 * @param model - vendor model id (not the composite picker id).
 * @returns JSON-serializable request body.
 */
export function toGeoCrmRequest(options: GenerateOptions, model: string): Record<string, unknown> {
  const effort = toGeoCrmReasoningEffort(
    options.reasoningEffort === undefined ? undefined : String(options.reasoningEffort),
  )
  return {
    model,
    instructions: instructionsOf(options.system, options.messages),
    input: toGeoCrmInput(options.messages),
    tools: toGeoCrmTools(options.tools),
    ...options.sessionId === undefined ? {} : { prompt_cache_key: String(options.sessionId) },
    ...effort === undefined ? {} : { reasoning: { effort } },
  }
}

/**
 * Read assistant output_text parts from a message item.
 * @param content - `item.content` array.
 * @returns concatenated output text.
 */
function outputTextOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) continue
    const record = part as Record<string, unknown>
    if (typeof record.text === 'string' && record.text.length > 0) parts.push(record.text)
  }
  return parts.join('')
}

/**
 * Read GeoCRM usage from `response.completed`.
 * @param response - `event.response` object.
 * @returns token usage when every required count is a finite number.
 */
function usageOf(response: unknown): TokenUsage | undefined {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return undefined
  const usage = (response as { usage?: unknown }).usage
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return undefined
  const record = usage as Record<string, unknown>
  const inputTokens = numberOf(record.input_tokens)
  const outputTokens = numberOf(record.output_tokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const totalTokens = numberOf(record.total_tokens)
  return {
    inputTokens,
    outputTokens,
    ...totalTokens === undefined ? {} : { totalTokens },
  }
}

/**
 * Accept a finite number field.
 * @param value - raw JSON value.
 * @returns the number, or `undefined` when it is not a finite number.
 */
function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
