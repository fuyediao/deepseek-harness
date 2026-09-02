/**
 * Keyless Electron e2e scaffold: boots the shipped electron profile with
 * `--no-window`, then Playwright launches the built shell against the IPC
 * socket. Isolation patches match the Web lane so goldens stay hermetic.
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ElectronApplication, Page } from 'playwright'
import { _electron as electron } from 'playwright'
import { Context } from '@deepseek-ai/cordis'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { SessionId, SESSION_FORMAT_VERSION, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { bootProductionProfile } from '../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import {
  parseSeedFixture,
  realizeSeedFixture,
  WELCOME_NOTICE_ACK_FIELD,
  WELCOME_NOTICE_SETTINGS_NAMESPACE,
  WELCOME_NOTICE_VERSION,
  type WebScaffold,
} from '../../web/tests/scaffold.ts'
import { DIST_INDEX } from '../../web/tests/support.ts'

const require = createRequire(import.meta.url)
const overlayPath = fileURLToPath(new URL('./fixtures/electron-e2e.patch.yml', import.meta.url))

/** Host half of the scaffold, available before the window opens. */
export type ElectronHostScaffold = Pick<
  ElectronScaffold,
  'ctx' | 'workspaceCwd' | 'persistenceRoot' | 'harnessHome' | 'pipePath'
>

/** Options for {@link launchElectronScaffold}. */
export interface ElectronScaffoldOptions {
  /**
   * Runs after the Host is ready and before the window opens. Seed sessions
   * and register workspaces here so the first paint already has them.
   * @param host - the settled Host half.
   */
  afterHost?(host: ElectronHostScaffold): Promise<void>
}

/** Isolated electron Host plus the Playwright-driven window. */
export interface ElectronScaffold {
  /** Settled Host context. */
  ctx: Context
  /** Temp project directory sessions run in. */
  workspaceCwd: string
  /** Temp persistence root seeded sessions land in. */
  persistenceRoot: string
  /** Isolated harness home. */
  harnessHome: string
  /** Host IPC endpoint the shell connects to. */
  pipePath: string
  /** Playwright Electron application. */
  app: ElectronApplication
  /** First (only) desktop window. */
  page: Page
  /** Dispose the window, Host, and temp roots. */
  close(): Promise<void>
}

/**
 * Fail loud when the built frontend or Electron shell is missing.
 */
export function requireElectronArtifacts(): void {
  if (!existsSync(DIST_INDEX)) {
    throw new Error('web app dist not built — run `pnpm run build` from the repository root (`pnpm run test:web` does this first)')
  }
  try {
    require.resolve('@deepseek-ai/dsh-electron-shell')
  } catch {
    throw new Error('electron-shell is not resolvable — run `pnpm run build` from the repository root')
  }
}

/**
 * Seed a recorded session into the electron scaffold's persistence root.
 * @param scaffold - booted scaffold.
 * @param fixtureText - raw session.jsonl contents.
 * @param id - seeded session id.
 * @returns the seeded id.
 */
export async function seedElectronSession(
  scaffold: Pick<ElectronScaffold, 'workspaceCwd' | 'persistenceRoot'>,
  fixtureText: string,
  id: string,
): Promise<SessionId> {
  const decoded = parseSeedFixture(realizeSeedFixture(scaffold as WebScaffold, fixtureText, id))
  const events = decoded.events
  if (events.length === 0) throw new Error('seed fixture has no events')
  const last = events[events.length - 1]
  if (last === undefined || last.type !== 'turn/end') {
    throw new Error(`seed fixture must end in turn/end, got ${last?.type ?? 'empty'}`)
  }
  const meta: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: Date.now() - 60_000,
    isSeeded: false,
    cwd: scaffold.workspaceCwd,
    delegationDepth: 0,
  }
  const fixtureCreatedAt = decoded.header.createdAt
  if (typeof fixtureCreatedAt !== 'number') {
    throw new Error('seed fixture requires a numeric createdAt header')
  }
  const timeAnchor = fixtureCreatedAt === 0 ? meta.createdAt : fixtureCreatedAt
  const materializedEvents = events.map((event, index) => ({ ...event, time: timeAnchor + index }))
  const seeder = new Context()
  try {
    await seeder.plugin(JsonlSessionPersistence, { root: scaffold.persistenceRoot })
    const handle = await seeder.sessionPersistence.create(meta)
    await handle.append(materializedEvents as SessionEvent[])
    await handle.close()
  } finally {
    await seeder.fiber.dispose()
  }
  return meta.id
}

/**
 * Boot the shipped electron profile with `--no-window` and launch the shell.
 * @param options - optional Host-side setup before the window opens.
 * @returns the running scaffold.
 */
export async function launchElectronScaffold(
  options: ElectronScaffoldOptions = {},
): Promise<ElectronScaffold> {
  requireElectronArtifacts()
  const workspaceCwd = (await mkdtemp(join(tmpdir(), 'dsh-electron-e2e-ws-'))).replaceAll('\\', '/')
  const harnessHome = join(workspaceCwd, '.dsh-home').replaceAll('\\', '/')
  const persistenceRoot = (await mkdtemp(join(tmpdir(), 'dsh-electron-e2e-sessions-'))).replaceAll('\\', '/')
  const previousCwd = process.cwd()
  const previousHome = process.env.DSH_HOME
  const previousAgentsHome = process.env.DSH_AGENTS_HOME
  const skillRootEnvironment = {
    DSH_HOME: harnessHome,
    DSH_AGENTS_HOME: join(workspaceCwd, '.agents-home'),
    DSH_BUNDLED_SKILL_DIR: join(workspaceCwd, '.bundled-skills'),
  }
  const originalSkillRootEnvironment = Object.fromEntries(
    Object.keys(skillRootEnvironment).map(key => [key, process.env[key]]),
  )
  const restoreEnvironment = (): void => {
    process.chdir(previousCwd)
    if (previousHome === undefined) Reflect.deleteProperty(process.env, 'DSH_HOME')
    else process.env.DSH_HOME = previousHome
    if (previousAgentsHome === undefined) Reflect.deleteProperty(process.env, 'DSH_AGENTS_HOME')
    else process.env.DSH_AGENTS_HOME = previousAgentsHome
    for (const [key, value] of Object.entries(originalSkillRootEnvironment)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  }

  await mkdir(harnessHome, { recursive: true })
  const generatedOverlay = join(workspaceCwd, 'electron-e2e.generated.patch.yml')
  const template = await readFile(overlayPath, 'utf8')
  await writeFile(generatedOverlay, template
    .replaceAll('{{persistenceRoot}}', persistenceRoot.replaceAll('\\', '/'))
    .replaceAll('{{harnessHome}}', harnessHome.replaceAll('\\', '/'))
    .replaceAll('{{workspaceCwd}}', workspaceCwd.replaceAll('\\', '/')))

  Object.assign(process.env, skillRootEnvironment)
  process.chdir(workspaceCwd)

  const readyPrefix = 'dsh electron: ipc ready at '
  const ipcLogs: string[] = []
  const originalLog = console.log
  const originalWrite = process.stdout.write.bind(process.stdout)
  const capture = (text: string): void => {
    if (text.length > 0) ipcLogs.push(text)
  }
  console.log = (...args: unknown[]) => {
    capture(args.map(String).join(' '))
    originalLog(...args)
  }
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    capture(String(chunk))
    return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest)
  }) as typeof process.stdout.write
  const findReadyLine = (): string | undefined => {
    for (const line of ipcLogs) {
      const match = line.split(/\r?\n/).find(part => part.startsWith(readyPrefix))
      if (match !== undefined) return match
    }
    return undefined
  }
  const restoreOutput = (): void => {
    console.log = originalLog
    process.stdout.write = originalWrite
  }

  let ctx: Context
  try {
    ctx = await bootProductionProfile({
      binName: 'electron-e2e-scaffold',
      profile: 'electron',
      overlayPaths: [generatedOverlay],
      prepare: (host) => {
        provideCmdline(host, {
          args: ['--no-window'],
          exit: (code) => {
            throw new Error(`electron-e2e-scaffold: the desktop app requested exit ${String(code)}`)
          },
        })
      },
    })
    const deadline = Date.now() + 15_000
    while (findReadyLine() === undefined && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  } catch (error) {
    restoreOutput()
    restoreEnvironment()
    await rm(workspaceCwd, { recursive: true, force: true }).catch(() => undefined)
    await rm(persistenceRoot, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  restoreOutput()

  try {
    await ctx.settings.mutate(WELCOME_NOTICE_SETTINGS_NAMESPACE, [{
      op: 'set', path: [WELCOME_NOTICE_ACK_FIELD], value: WELCOME_NOTICE_VERSION,
    }])
  } catch (error) {
    await ctx.fiber.dispose().catch(() => undefined)
    restoreEnvironment()
    await rm(workspaceCwd, { recursive: true, force: true }).catch(() => undefined)
    await rm(persistenceRoot, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }

  const readyLine = findReadyLine()
  if (readyLine === undefined) {
    await ctx.fiber.dispose().catch(() => undefined)
    restoreEnvironment()
    await rm(workspaceCwd, { recursive: true, force: true }).catch(() => undefined)
    await rm(persistenceRoot, { recursive: true, force: true }).catch(() => undefined)
    throw new Error('electron-e2e-scaffold: Host did not print the ipc-ready line')
  }
  const pipePath = readyLine.replace(readyPrefix, '').trim()

  try {
    await options.afterHost?.({ ctx, workspaceCwd, persistenceRoot, harnessHome, pipePath })
  } catch (error) {
    await ctx.fiber.dispose().catch(() => undefined)
    restoreEnvironment()
    await rm(workspaceCwd, { recursive: true, force: true }).catch(() => undefined)
    await rm(persistenceRoot, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }

  const electronBin = require('electron') as unknown as string
  if (typeof electronBin !== 'string' || electronBin === '') {
    await ctx.fiber.dispose().catch(() => undefined)
    restoreEnvironment()
    throw new Error('electron-e2e-scaffold: the installed electron package did not resolve to a binary path')
  }
  const shellMain = require.resolve('@deepseek-ai/dsh-electron-shell')
  const distRoot = join(dirname(require.resolve('@deepseek-ai/dsh-web-frontend/package.json')), 'dist')
  const headless = process.env.CI === 'true' && process.platform === 'linux'
  let app: ElectronApplication
  try {
    app = await electron.launch({
      executablePath: electronBin,
      args: [
        shellMain,
        '--lang=en-US',
        ...headless ? ['--headless'] : [],
      ],
      env: {
        ...process.env,
        DSH_ELECTRON_IPC_PIPE: pipePath,
        DSH_ELECTRON_DIST: distRoot,
        LANG: 'en-US',
        LANGUAGE: 'en-US',
        LC_ALL: 'en-US',
      },
      timeout: 60_000,
    })
  } catch (error) {
    await ctx.fiber.dispose().catch(() => undefined)
    restoreEnvironment()
    throw error
  }
  const page = await app.firstWindow()
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

  return {
    ctx,
    workspaceCwd,
    persistenceRoot,
    harnessHome,
    pipePath,
    app,
    page,
    async close(): Promise<void> {
      const failures: unknown[] = []
      await app.close().catch((error: unknown) => failures.push(error))
      await ctx.fiber.dispose().catch((error: unknown) => failures.push(error))
      restoreEnvironment()
      await rm(workspaceCwd, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
      await rm(persistenceRoot, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'electron scaffold teardown failed')
    },
  }
}
