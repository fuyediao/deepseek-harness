/**
 * The Electron command-line provider over a real Loader tree: its ordinary
 * service releases a consumer whose config reads `ctx.electronStartup`
 * directly.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, ELECTRON_STARTUP_SERVICE, type ElectronStartupValues } from '../src/startup.ts'

interface Observed {
  exits: number[]
  out: string
  readerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

async function bootProvider(args: string[]): Promise<{
  values: ElectronStartupValues | undefined
  observed: Observed
}> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-electron-startup-'))
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'reader.mjs'), `
export function apply(_ctx, config) { globalThis.__electronStartupObserved.readerConfig = config }
`)
  writeFileSync(join(dir, 'provider.mjs'), `
export const name = 'electron-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__electronStartupApply(ctx)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: reader',
    `  name: ${pathToFileURL(join(dir, 'reader.mjs')).href}`,
    `  inject: [${ELECTRON_STARTUP_SERVICE}]`,
    '  config:',
    '    openWindow: !!js ctx.electronStartup.openWindow',
    '- id: provider',
    `  name: ${pathToFileURL(join(dir, 'provider.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __electronStartupApply: typeof apply
    __electronStartupObserved: Observed
  }
  globals.__electronStartupApply = apply
  globals.__electronStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    values: ctx.get(ELECTRON_STARTUP_SERVICE) as ElectronStartupValues | undefined,
    observed,
  }
}

describe('electron command-line provider', () => {
  it('defaults to opening the window and releases direct service expressions', async () => {
    const { values, observed } = await bootProvider([])
    expect(values).toEqual({ openWindow: true })
    expect(observed.readerConfig).toEqual({ openWindow: true })
    expect(observed.exits).toEqual([])
  })

  it('publishes --no-window', async () => {
    const { values, observed } = await bootProvider(['--no-window'])
    expect(values).toEqual({ openWindow: false })
    expect(observed.readerConfig).toEqual({ openWindow: false })
  })

  it('prints its own help and leaves the consumer pending', async () => {
    const { values, observed } = await bootProvider(['--help'])
    expect(observed.out).toContain('dsh --profile electron')
    expect(observed.out).toContain('--no-window')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })
})
