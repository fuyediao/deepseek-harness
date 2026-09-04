import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'

/** One recorded request the mock GeoCRM origin observed. */
export interface RecordedRequest {
  /** Request method. */
  readonly method: string
  /** Request URL including query. */
  readonly url: string
  /** Lowercase header map. */
  readonly headers: Record<string, string>
  /** Raw body text. */
  readonly body: string
}

/** Behavior for one mock GeoCRM origin. */
export interface MockGeoCrm {
  /** Absolute origin (`http://127.0.0.1:<port>`). */
  readonly origin: string
  /** Requests observed in arrival order. */
  readonly requests: RecordedRequest[]
  /**
   * Close the listener.
   * @returns once the server has closed.
   */
  close(): Promise<void>
}

/** Handler for one mock request. */
export type MockHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  recorded: RecordedRequest,
) => void | Promise<void>

/**
 * Start a one-origin mock GeoCRM API.
 * @param handler - request handler.
 * @returns the listening origin and the recorded requests.
 */
export async function mockGeoCrm(handler: MockHandler): Promise<MockGeoCrm> {
  const requests: RecordedRequest[] = []
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const recorded: RecordedRequest = {
        method: request.method ?? '',
        url: request.url ?? '',
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [
            key.toLowerCase(),
            Array.isArray(value) ? value.join(', ') : value ?? '',
          ]),
        ),
        body: Buffer.concat(chunks).toString('utf8'),
      }
      requests.push(recorded)
      void Promise.resolve(handler(request, response, recorded)).catch((error: unknown) => {
        response.statusCode = 500
        response.end(error instanceof Error ? error.message : 'mock handler failed')
      })
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('mock GeoCRM did not bind a TCP port')
  }
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.closeAllConnections()
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    }),
  }
}

/**
 * Write one `data:` SSE frame. The caller owns status and content-type.
 * @param response - HTTP response that already has SSE headers.
 * @param payload - JSON text or a non-JSON probe string.
 */
export function writeSse(response: ServerResponse, payload: string): void {
  response.write(`data: ${payload}\n\n`)
}

/**
 * Write one GeoCRM complete-turn SSE body.
 * @param response - HTTP response.
 * @param item - `response.output_item.done` item.
 */
export function writeTurn(response: ServerResponse, item: Record<string, unknown>): void {
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  writeSse(response, JSON.stringify({ type: 'response.created', response: { id: 'resp_1' } }))
  writeSse(response, JSON.stringify({ type: 'response.output_item.done', item }))
  writeSse(response, JSON.stringify({
    type: 'response.completed',
    response: { id: 'resp_1', usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
  }))
  response.end('data: [DONE]\n\n')
}
