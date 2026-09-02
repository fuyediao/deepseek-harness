/**
 * Keyless Electron window smoke: the shipped profile Host plus the built
 * shell render conversation chrome over IPC, with no listening webServer.
 */
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { saveFailureShot } from '../../web/tests/support.ts'
import { launchElectronScaffold, type ElectronScaffold } from './scaffold.ts'

describe('electron keyless window smoke', () => {
  let scaffold: ElectronScaffold

  beforeAll(async () => {
    scaffold = await launchElectronScaffold()
  }, 180_000)

  afterAll(async () => {
    await scaffold?.close()
  })

  it('opens conversation chrome without a listening webServer', async () => {
    onTestFailed(() => saveFailureShot(scaffold.page, 'electron-keyless-window'))
    expect(scaffold.ctx.get('webServer')).toBeUndefined()
    await scaffold.page.getByRole('textbox', { name: 'Choose workspace' }).waitFor({ timeout: 15_000 })
    expect(await scaffold.page.locator('[class*="frame"]').count()).toBeGreaterThan(0)
    const transport = await scaffold.page.evaluate(() => {
      const hooks = (globalThis as {
        __DSH_TRANSPORT__?: { ownsHost?: boolean; openStream?: unknown }
        __dshElectronBridge__?: unknown
      }).__DSH_TRANSPORT__
      const bridge = (globalThis as { __dshElectronBridge__?: unknown }).__dshElectronBridge__
      return {
        ownsHost: hooks?.ownsHost === true,
        hasOpenStream: typeof hooks?.openStream === 'function',
        hasBridge: typeof bridge === 'object' && bridge !== null,
      }
    })
    expect(transport, 'preload must install the desktop transport in the page').toEqual({
      ownsHost: true,
      hasOpenStream: true,
      hasBridge: true,
    })
    await expect.poll(() => scaffold.page.getByText(/Connecting/).count(), { timeout: 15_000 }).toBe(0)
  })
})
