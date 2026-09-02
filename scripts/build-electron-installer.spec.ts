/**
 * Windows desktop installer CLI: host gate, dry-run commands, and help.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertWinX64Host } from './build-electron-installer.ts'

const root = resolve(import.meta.dirname, '..')
const script = resolve(root, 'scripts/build-electron-installer.ts')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function run(env: NodeJS.ProcessEnv, ...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx/esm', script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: isolatedPnpmEnvironment(env),
  })
}

function isolatedPnpmEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !['npm_execpath', 'pnpm_home'].includes(key.toLowerCase())),
  )
  return { ...environment, ...overrides }
}

describe('Windows desktop installer builder', () => {
  it('rejects a non-win-x64 host before any build step', () => {
    expect(() => { assertWinX64Host('linux', 'x64') }).toThrow('Windows x64 only')
    expect(() => { assertWinX64Host('win32', 'arm64') }).toThrow('Windows x64 only')
  })

  it('prints help and exits 0', () => {
    const result = run({ npm_execpath: 'C:\\tools\\pnpm.cjs' }, '--help')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: pnpm exec tsx scripts/build-electron-installer.ts')
    expect(result.stdout).toContain('--skip-pack')
  })

  it.runIf(process.platform === 'win32' && process.arch === 'x64')(
    'runs pnpm through its JavaScript entrypoint without a command shell',
    () => {
      const result = run(
        { npm_execpath: 'C:\\tools\\pnpm.cjs' },
        '--skip-build',
        '--skip-pack',
        '--dry-run',
      )
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('C:\\tools\\pnpm.cjs exec tsx scripts/verify-electron-runtime-closure.ts')
      expect(result.stdout).toContain('C:\\tools\\pnpm.cjs --filter dsh-electron-runtime-closure deploy')
      expect(result.stdout).toContain('skipping electron-builder (--skip-pack)')
      expect(result.stdout).not.toMatch(/pnpm\.cmd/i)
    },
  )

  it.runIf(process.platform === 'win32' && process.arch === 'x64')(
    'prints the electron-builder invocation when packing is not skipped',
    () => {
      const result = run(
        { npm_execpath: 'C:\\tools\\pnpm.cjs' },
        '--skip-build',
        '--dry-run',
      )
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('C:\\tools\\pnpm.cjs exec electron-builder')
      expect(result.stdout).toContain('--win')
      expect(result.stdout).toContain('--x64')
      expect(result.stdout).not.toContain('skipping electron-builder (--skip-pack)')
    },
  )

  it.runIf(process.platform === 'win32' && process.arch === 'x64')(
    'resolves the pnpm package behind a Windows command shim',
    () => {
      const setup = mkdtempSync(join(tmpdir(), 'dsh-electron-pnpm-home-'))
      temporaryDirectories.push(setup)
      const home = join(setup, 'node_modules', '.bin')
      const entrypoint = join(setup, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
      mkdirSync(home, { recursive: true })
      mkdirSync(dirname(entrypoint), { recursive: true })
      writeFileSync(entrypoint, '')
      const result = run(
        { npm_execpath: 'C:\\tools\\pnpm.cmd', PNPM_HOME: home },
        '--skip-build',
        '--skip-pack',
        '--dry-run',
      )
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`${entrypoint} exec tsx scripts/verify-electron-runtime-closure.ts`)
      expect(result.stdout).not.toMatch(/pnpm\.cmd/i)
    },
  )
})
