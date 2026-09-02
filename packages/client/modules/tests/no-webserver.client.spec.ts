/**
 * Node-half composition with no listening webServer — the Electron IPC shell
 * topology: the graph composes and bundle bytes stay readable through
 * {@link ClientModuleRegistry.graph} / `clientPath()` with zero HTTP routes.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { ClientModuleRegistry } from '../src/index.ts'

const MODULES_ID = '@deepseek-ai/dsh-client-modules'

let root: string | undefined

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

/** Create a resolvable built package whose client export points at a real file. */
function writeBuiltPackage(packageName: string): string {
  root ??= realpathSync(mkdtempSync(join(tmpdir(), 'dsh-client-modules-no-webserver-')))
  const pkgRoot = join(root, 'node_modules', ...packageName.split('/'))
  const clientPath = join(pkgRoot, 'lib', 'client.js')
  mkdirSync(dirname(clientPath), { recursive: true })
  writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({
    name: packageName,
    exports: {
      './client': './lib/client.js',
      './package.json': './package.json',
    },
    dsh: { client: { platform: 'web' } },
  }))
  writeFileSync(clientPath, 'module.exports = {}\n')
  return clientPath
}

/** Construct the node-half service over the given package names, with no webServer provided. */
function constructWithoutWebServer(packageNames: string[]): { context: Context; service: ClientModuleRegistry } {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  ctx.provide('loader', {
    *entries() {
      for (const packageName of packageNames) {
        yield {
          options: { name: packageName },
          fiber: {},
          disabled: false,
          parent: { tree: { ctx: { baseUrl: ctx.baseUrl } } },
        }
      }
    },
  })
  const service = new ClientModuleRegistry(ctx)
  return { context: ctx, service }
}

describe('client-modules without a listening webServer', () => {
  it('activates, composes the graph, and serves bundle bytes with no webServer service', () => {
    const clientPath = writeBuiltPackage(MODULES_ID)
    const { context, service } = constructWithoutWebServer([MODULES_ID])

    expect(context.get('webServer')).toBeUndefined()
    const graph = service.graph()
    expect(graph.entries.map(entry => entry.id)).toEqual([MODULES_ID])
    expect(service.clientPath(MODULES_ID)).toBe(clientPath)
  })

  it('re-hashes a rebuilt bundle and notifies listeners with no webServer service', () => {
    const clientPath = writeBuiltPackage(MODULES_ID)
    const { service } = constructWithoutWebServer([MODULES_ID])
    const initialRev = service.graph().entries[0]?.rev

    writeFileSync(clientPath, 'module.exports = { changed: true }\n')
    const notified: string[] = []
    service.onRebuilt((id, rev) => { notified.push(`${id}:${rev}`) })
    const rev = service.rebuilt(MODULES_ID)

    expect(rev).toBeDefined()
    expect(rev).not.toBe(initialRev)
    expect(notified).toEqual([`${MODULES_ID}:${rev}`])
    expect(service.graph().entries[0]?.rev).toBe(rev)
  })

  it('resolves plugin resources and index injections directly, with no webServer/HTTP round trip', () => {
    writeBuiltPackage(MODULES_ID)
    const { service } = constructWithoutWebServer([MODULES_ID])
    const graph = service.graph()
    const entryUrl = graph.entries[0]?.url
    if (entryUrl === undefined) throw new Error('expected a composed entry')

    const resource = service.resolveResource(entryUrl)
    expect(resource?.contentType).toBe('text/javascript; charset=utf-8')
    expect(resource?.body.toString('utf8')).toContain('module.exports = {}')
    expect(service.resolveResource('/plugins/unknown')).toBeUndefined()

    const injections = service.indexInjections()
    expect(injections.some(row => row.kind === 'global' && row.name === '__DSH_BOOT__')).toBe(true)
  })
})
