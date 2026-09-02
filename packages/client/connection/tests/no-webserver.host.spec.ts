/**
 * Host activation with no listening webServer — the Electron IPC shell
 * topology: `ctx.connection` still provides, and its shared fetch handler
 * still answers a unary call carried entirely in-process, with zero HTTP
 * routes registered.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { API_PATH, RpcId, apply, inject, type ClientRequest, type HostConnectionHandle } from '../src/index.ts'
import { provideBrowserCredentials } from './browser-credentials.ts'

describe('client-connection without a listening webServer', () => {
  it('activates ctx.connection and answers a shared fetch handler call with no webServer service', async () => {
    const ctx = new Context()
    provideBrowserCredentials(ctx)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.get('webServer')).toBeUndefined()

    const connection = ctx.get('connection') as HostConnectionHandle
    expect(connection).toBeDefined()

    const calls: unknown[] = []
    const remove = connection.rpc.intercept(
      API_PATH,
      endpoint => endpoint === 'goals/create',
      async (endpoint, payload) => {
        calls.push({ endpoint, payload })
        return { ok: true, value: { accepted: true } }
      },
    )

    const handler = connection.createSharedFetchHandler(API_PATH)
    const message: ClientRequest = {
      type: 'client-request',
      rpcId: RpcId('ipc-shared'),
      method: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }
    const response = await handler.fetch(new Request('http://dsh.internal/api/goals/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
    }))
    expect(await response.json()).toEqual({
      type: 'server-response',
      rpcId: 'ipc-shared',
      result: { ok: true, value: { accepted: true } },
    })
    expect(calls).toEqual([{ endpoint: 'goals/create', payload: { args: { agentId: 'agent-1' } } }])

    await remove()
    await fiber.dispose()
  })
})
