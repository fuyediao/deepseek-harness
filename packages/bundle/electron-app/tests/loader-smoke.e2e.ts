/**
 * Shipped `electron` profile Loader smoke: the real bundle tree settles with
 * `--no-window`, binds no TCP port, and answers one unary Connection call
 * through `createSharedFetchHandler` — the Host half the desktop window uses.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { API_PATH, RpcId, type ClientRequest, type ServerResponse } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { bootProductionProfile } from '../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const overlayPath = fileURLToPath(new URL('./fixtures/loader-smoke.patch.yml', import.meta.url))
const LOADER_SMOKE_TIMEOUT_MS = 90_000

/** TCP listen addresses on this process, excluding Unix/pipe sockets. */
function listeningTcpAddresses(): string[] {
  const getHandles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles
  if (getHandles === undefined) return []
  const found: string[] = []
  for (const handle of getHandles()) {
    if (handle === null || typeof handle !== 'object') continue
    const server = handle as { listening?: boolean; address?: () => unknown }
    if (server.listening !== true || typeof server.address !== 'function') continue
    const address = server.address()
    if (address === null || typeof address !== 'object' || !('port' in address)) continue
    const port = address.port
    if (typeof port !== 'number' || port <= 0) continue
    const host = 'address' in address && typeof address.address === 'string' ? address.address : ''
    found.push(`${host}:${String(port)}`)
  }
  return found
}

describe('electron profile loader smoke', () => {
  let ctx: Context | undefined
  let workspace: string | undefined
  const previousCwd = process.cwd()
  const previousHome = process.env.DSH_HOME
  const previousAgentsHome = process.env.DSH_AGENTS_HOME

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'dsh-electron-loader-smoke-'))
    process.env.DSH_HOME = join(workspace, '.dsh-home')
    process.env.DSH_AGENTS_HOME = join(workspace, '.agents-home')
    process.chdir(workspace)
    ctx = await bootProductionProfile({
      binName: 'electron-loader-smoke',
      profile: 'electron',
      overlayPaths: [overlayPath],
      prepare: (host) => {
        provideCmdline(host, {
          args: ['--no-window'],
          exit: (code) => {
            throw new Error(`electron-loader-smoke: the desktop app requested exit ${String(code)}`)
          },
        })
      },
    })
  }, LOADER_SMOKE_TIMEOUT_MS)

  afterAll(async () => {
    process.chdir(previousCwd)
    if (previousHome === undefined) Reflect.deleteProperty(process.env, 'DSH_HOME')
    else process.env.DSH_HOME = previousHome
    if (previousAgentsHome === undefined) Reflect.deleteProperty(process.env, 'DSH_AGENTS_HOME')
    else process.env.DSH_AGENTS_HOME = previousAgentsHome
    await ctx?.fiber.dispose()
    if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
  })

  it('settles without a webServer or TCP listen, and answers one unary Connection call', async () => {
    if (ctx === undefined) throw new Error('electron-loader-smoke: the profile tree did not boot')
    expect(ctx.get('webServer')).toBeUndefined()
    expect(listeningTcpAddresses()).toEqual([])

    const handler = ctx.connection.createSharedFetchHandler(API_PATH)
    const message: ClientRequest = {
      type: 'client-request',
      rpcId: RpcId('electron-loader-smoke'),
      method: 'session/list',
      payload: { args: { _request: {} } },
    }
    const response = await handler.fetch(new Request('http://dsh.internal/api/session/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
    }))
    expect(response.status).toBe(200)
    const body = await response.json() as ServerResponse
    expect(body).toMatchObject({
      type: 'server-response',
      rpcId: 'electron-loader-smoke',
      result: { ok: true, value: { items: [] } },
    })
  })
})
