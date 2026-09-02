/**
 * `ElectronIpcHost` over a real socket: a plain `net.Socket` test client
 * plays the Electron main process's role, driving every frame kind against
 * fake `fetchHandler`/`clientModules`/`streamGateway` dependencies.
 */

import { createConnection, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ElectronIpcFrameReader,
  encodeFrame,
  parseHostFrame,
  type ElectronIpcHostFrame,
  type ElectronIpcMainFrame,
} from '@deepseek-ai/dsh-electron-ipc'
import { ElectronIpcHost, type ElectronIpcHostDeps, type ElectronStreamGateway } from '../src/ipc-host.ts'

/** A connected test client speaking the same protocol Electron's main process would. */
class FakeMainProcess {
  private readonly socket: Socket
  private readonly reader = new ElectronIpcFrameReader()
  private readonly inbox: ElectronIpcHostFrame[] = []
  private waiter: (() => void) | undefined

  private constructor(socket: Socket) {
    this.socket = socket
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      for (const value of this.reader.push(chunk)) {
        this.inbox.push(parseHostFrame(value))
        this.waiter?.()
        this.waiter = undefined
      }
    })
  }

  static connect(pipePath: string): Promise<FakeMainProcess> {
    return new Promise((resolveConnect, rejectConnect) => {
      const socket = createConnection(pipePath)
      socket.once('connect', () => { resolveConnect(new FakeMainProcess(socket)) })
      socket.once('error', rejectConnect)
    })
  }

  send(frame: ElectronIpcMainFrame): void {
    this.socket.write(encodeFrame(frame))
  }

  async receive(): Promise<ElectronIpcHostFrame> {
    while (this.inbox.length === 0) {
      await new Promise<void>((resolve) => { this.waiter = resolve })
    }
    const next = this.inbox.shift()
    if (next === undefined) throw new Error('fake main process: no frame received')
    return next
  }

  close(): void {
    this.socket.destroy()
  }
}

function fakeFetchHandler(handle: (request: Request) => Promise<Response>): ElectronIpcHostDeps['fetchHandler'] {
  return { fetch: handle }
}

function fakeClientModules(
  resources: Record<string, { body: Buffer; contentType: string }>,
): ElectronIpcHostDeps['clientModules'] {
  return { resolveResource: url => resources[url] }
}

const activeHosts: ElectronIpcHost[] = []
const activeClients: FakeMainProcess[] = []

afterEach(async () => {
  for (const client of activeClients.splice(0)) client.close()
  for (const host of activeHosts.splice(0)) await host.dispose()
})

async function mount(deps: Partial<ElectronIpcHostDeps> = {}): Promise<{ host: ElectronIpcHost; client: FakeMainProcess }> {
  const host = new ElectronIpcHost({
    fetchHandler: fakeFetchHandler(async () => new Response('not found', { status: 404 })),
    clientModules: fakeClientModules({}),
    collectIndexInjections: () => [],
    streamGateway: undefined,
    ...deps,
  })
  activeHosts.push(host)
  await host.listen()
  const client = await FakeMainProcess.connect(host.pipePath)
  activeClients.push(client)
  return { host, client }
}

describe('ElectronIpcHost', () => {
  it('answers boot-request with the current index-injection rows', async () => {
    const rows = [{ kind: 'global', name: '__DSH_BOOT__', value: { rev: '1' } }]
    const { client } = await mount({ collectIndexInjections: () => rows })
    client.send({ t: 'boot-request' })
    await expect(client.receive()).resolves.toEqual({ t: 'boot', injections: rows })
  })

  it('relays a /api fetch frame to the Connection fetch handler, base64-decoding the request body', async () => {
    const seen: { method: string; url: string; body: string }[] = []
    const { client } = await mount({
      fetchHandler: fakeFetchHandler(async (request) => {
        seen.push({ method: request.method, url: request.url, body: await request.text() })
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
      }),
    })
    client.send({
      t: 'fetch', id: 'r1', method: 'POST', url: '/api/session.list',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"cursor":null}').toString('base64'),
    })
    const response = await client.receive()
    expect(response).toEqual({
      t: 'fetch-res', id: 'r1', status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({ ok: true })).toString('base64'),
    })
    expect(seen).toEqual([{ method: 'POST', url: 'http://dsh.internal/api/session.list', body: '{"cursor":null}' }])
  })

  it('answers a /plugins fetch frame directly from client-modules, with no Connection round trip', async () => {
    const called: string[] = []
    const { client } = await mount({
      fetchHandler: fakeFetchHandler(async () => { called.push('fetch'); return new Response(null, { status: 404 }) }),
      clientModules: fakeClientModules({
        '/plugins/??a/client.js&rev=1': { body: Buffer.from('module.exports={}'), contentType: 'text/javascript; charset=utf-8' },
      }),
    })
    client.send({ t: 'fetch', id: 'p1', method: 'GET', url: '/plugins/??a/client.js&rev=1', headers: {} })
    await expect(client.receive()).resolves.toEqual({
      t: 'fetch-res', id: 'p1', status: 200,
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
      body: Buffer.from('module.exports={}').toString('base64'),
    })
    expect(called).toEqual([])
  })

  it('answers an unknown /plugins resource with 404', async () => {
    const { client } = await mount()
    client.send({ t: 'fetch', id: 'p2', method: 'GET', url: '/plugins/missing', headers: {} })
    await expect(client.receive()).resolves.toEqual({ t: 'fetch-res', id: 'p2', status: 404, headers: {} })
  })

  it('answers a throwing fetch handler with a 500 carrying the error message', async () => {
    const { client } = await mount({
      fetchHandler: fakeFetchHandler(() => { throw new Error('boom') }),
    })
    client.send({ t: 'fetch', id: 'r2', method: 'GET', url: '/api/x', headers: {} })
    const response = await client.receive()
    expect(response).toMatchObject({ t: 'fetch-res', id: 'r2', status: 500 })
    if (response.t !== 'fetch-res' || response.body === undefined) throw new Error('expected a fetch-res body')
    expect(Buffer.from(response.body, 'base64').toString('utf8')).toBe('boom')
  })

  it('drives a stream-open frame to stream-item then stream-end', async () => {
    const gateway: ElectronStreamGateway = {
      wireStream: {
        open: async () => (async function *() { yield { rev: 1 }; yield { rev: 2 } })(),
        failure: error => ({ code: 'gateway/internal', message: String(error), details: {} }),
      },
    }
    const { client } = await mount({ streamGateway: gateway })
    client.send({ t: 'stream-open', id: 's1', endpoint: 'events.mux', payload: { since: 0 } })
    await expect(client.receive()).resolves.toEqual({ t: 'stream-item', id: 's1', value: { rev: 1 } })
    await expect(client.receive()).resolves.toEqual({ t: 'stream-item', id: 's1', value: { rev: 2 } })
    await expect(client.receive()).resolves.toEqual({ t: 'stream-end', id: 's1' })
  })

  it('converts a thrown stream failure into a stream-error frame', async () => {
    const gateway: ElectronStreamGateway = {
      wireStream: {
        // eslint-disable-next-line @typescript-eslint/require-await -- matches the real async generator open() contract.
        open: async function *() {
          throw new Error('should not run')
        } as unknown as ElectronStreamGateway['wireStream']['open'],
        failure: error => ({ code: 'gateway/bad-request', message: error instanceof Error ? error.message : String(error), details: { issues: [] } }),
      },
    }
    const { client } = await mount({ streamGateway: gateway })
    client.send({ t: 'stream-open', id: 's2', endpoint: 'goals/watch', payload: {} })
    await expect(client.receive()).resolves.toEqual({
      t: 'stream-error', id: 's2',
      failure: { kind: 'remote', code: 'gateway/bad-request', message: expect.any(String), details: { issues: [] } },
    })
  })

  it('answers stream-open with a carrier stream-error when no Gateway is mounted', async () => {
    const { client } = await mount({ streamGateway: undefined })
    client.send({ t: 'stream-open', id: 's3', endpoint: 'events.mux', payload: {} })
    await expect(client.receive()).resolves.toEqual({
      t: 'stream-error', id: 's3', failure: { kind: 'carrier', message: expect.stringContaining('no Typert Gateway') },
    })
  })

  it('stops sending items after an abort frame', async () => {
    let released!: () => void
    const gate = new Promise<void>((resolve) => { released = resolve })
    const gateway: ElectronStreamGateway = {
      wireStream: {
        open: async (_endpoint, _payload, signal) => (async function *() {
          yield { first: true }
          await gate
          if (signal.aborted) return
          yield { second: true }
        })(),
        failure: error => ({ code: 'gateway/internal', message: String(error), details: {} }),
      },
    }
    const { client } = await mount({ streamGateway: gateway })
    client.send({ t: 'stream-open', id: 's4', endpoint: 'events.mux', payload: {} })
    await expect(client.receive()).resolves.toEqual({ t: 'stream-item', id: 's4', value: { first: true } })
    client.send({ t: 'abort', id: 's4' })
    // The abort frame travels over the real socket; give it a turn to reach
    // and be processed by the Host before releasing the gated generator, so
    // the race is between "abort processed" and "generator resumes", not
    // between "bytes sent" and "generator resumes".
    await new Promise(resolve => setTimeout(resolve, 50))
    released()
    // No further frame for s4 arrives; a fresh unrelated exchange proves the
    // socket is still alive and simply has nothing more to say about s4.
    client.send({ t: 'boot-request' })
    await expect(client.receive()).resolves.toEqual({ t: 'boot', injections: [] })
  })

  it('refuses a second concurrent connection', async () => {
    const { host } = await mount()
    const rejected = await new Promise<boolean>((resolve) => {
      const socket = createConnection(host.pipePath)
      socket.once('close', () => { resolve(true) })
      socket.once('connect', () => {
        // A destroyed peer surfaces as a close event on this side too; give
        // it a turn before concluding the server accepted the connection.
        setTimeout(() => { resolve(false) }, 200)
      })
    })
    expect(rejected).toBe(true)
  })

  it('logs and skips a malformed frame instead of crashing the connection', async () => {
    const { client } = await mount()
    // Write an invalid frame directly, then a valid one, over the same socket.
    const rawSocket = Reflect.get(client, 'socket') as Socket
    rawSocket.write('{"t":"bogus"}\n')
    client.send({ t: 'boot-request' })
    await expect(client.receive()).resolves.toEqual({ t: 'boot', injections: [] })
  })
})
