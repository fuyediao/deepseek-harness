/**
 * Electron recorded-session snapshot: the Web seeded-history fixture renders
 * through the desktop window over IPC. The scenario borrows the Web session
 * and owns only the desktop ARIA golden.
 */
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria,
  compareOrRefreshGolden,
  fixtureUserPrompts,
  webSnapshotMode,
} from '../../web/tests/scaffold.ts'
import { saveFailureShot } from '../../web/tests/support.ts'
import { launchElectronScaffold, seedElectronSession, type ElectronScaffold } from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/electron/seeded-history', import.meta.url))
const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.jsonl', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const SEED_ID = 'seeded-history-electron-e2e'
const MODE = webSnapshotMode()
const PROMPT = 'Use the read tool twice in one assistant message: read a.txt and b.txt. Then reply with the single word DONE and stop.'

describe('electron e2e: seeded history renders through the desktop window', () => {
  let scaffold: ElectronScaffold

  beforeAll(async () => {
    if (MODE === 'record') {
      throw new Error('electron seeded-history borrows the Web session; record that scenario on the web profile')
    }
    scaffold = await launchElectronScaffold({
      async afterHost(host) {
        await mkdir(join(host.workspaceCwd, 'workspace'), { recursive: true })
        const raw = await readFile(SEED, 'utf8')
        expect(fixtureUserPrompts(raw), 'borrowed seed must carry exactly the drive prompt').toEqual([PROMPT])
        await seedElectronSession(host, raw, SEED_ID)
        const persisted = await host.ctx.sessionPersistence.list()
        expect(persisted.map(item => item.header.id), 'Host persistence must see the seeded session').toContain(SEED_ID)
      },
    })
  }, 180_000)

  afterAll(async () => {
    await scaffold?.close()
  })

  it('lists the seeded session and renders its history from the log', async () => {
    onTestFailed(() => saveFailureShot(scaffold.page, 'electron-seeded-history'))
    const listed = await scaffold.page.evaluate(async () => {
      const response = await fetch('/api/session/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'electron-seeded-list',
          method: 'session/list',
          payload: { args: { _request: {} } },
        }),
      })
      return await response.json() as unknown
    })
    expect(listed, `renderer session/list:\n${JSON.stringify(listed)}`).toMatchObject({
      type: 'server-response',
      result: {
        ok: true,
        value: { items: [{ sessionId: SEED_ID }] },
      },
    })
    const sessionsTree = scaffold.page.locator('[role="tree"][aria-label="Sessions"]')
    await sessionsTree.waitFor({ timeout: 15_000 })
    const ungrouped = sessionsTree.getByText('Ungrouped', { exact: true })
    await ungrouped.waitFor({ timeout: 15_000 })
    const groupRow = ungrouped.locator('xpath=ancestor::*[@role="treeitem"][1]')
    await expect.poll(async () => {
      if (await groupRow.getAttribute('aria-expanded') !== 'true') {
        await ungrouped.click()
      }
      return await groupRow.getAttribute('aria-expanded')
    }, { timeout: 10_000 }).toBe('true')
    const sessionRow = sessionsTree.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => scaffold.page.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBe(1)
    const snapshot = await captureStableAria(scaffold.page, '[class*="frame"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect((await readdir(SNAPSHOT_DIR)).sort()).toEqual(['snapshot.yml', 'ui.expected.md'])
  })
})
