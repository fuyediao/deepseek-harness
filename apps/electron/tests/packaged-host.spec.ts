/**
 * Packaged-desktop Host path resolution and IPC ready-line parsing.
 */
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  IPC_READY_PREFIX,
  PACKAGED_HOST_ARGS,
  parseIpcReadyLine,
  resolvePackagedLayout,
  waitForIpcReady,
} from '../src/packaged-host.ts'

describe('packaged Electron Host layout', () => {
  it('resolves Node, dsh bin, and frontend dist under extraResources', () => {
    const layout = resolvePackagedLayout('C:/App/resources', 'win32')
    expect(layout.nodePath).toBe('C:\\App\\resources\\host\\node.exe')
    expect(layout.dshBinPath).toBe('C:\\App\\resources\\host\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js')
    expect(layout.distRoot).toBe('C:\\App\\resources\\web')
  })

  it('uses an extensionless Node binary on POSIX extraResources', () => {
    expect(resolvePackagedLayout('/opt/app/resources', 'linux').nodePath).toBe('/opt/app/resources/host/node')
  })

  it('starts the bundled CLI as dsh --profile electron --no-window', () => {
    expect(PACKAGED_HOST_ARGS).toEqual(['--profile', 'electron', '--no-window'])
  })
})

describe('packaged Electron IPC ready line', () => {
  it('extracts the pipe path from Host stdout', () => {
    expect(parseIpcReadyLine(`${IPC_READY_PREFIX}\\\\.\\pipe\\dsh-electron-1\n`)).toBe('\\\\.\\pipe\\dsh-electron-1')
    expect(parseIpcReadyLine('other\n')).toBeUndefined()
  })

  it('resolves once the ready line arrives across chunks', async () => {
    const stdout = new PassThrough()
    const pending = waitForIpcReady(stdout, 1_000)
    stdout.write('boot noise\n')
    stdout.write(`${IPC_READY_PREFIX}`)
    stdout.write('\\\\.\\pipe\\ready\n')
    await expect(pending).resolves.toBe('\\\\.\\pipe\\ready')
  })

  it('rejects when stdout ends before the ready line', async () => {
    const stdout = new PassThrough()
    const pending = waitForIpcReady(stdout, 1_000)
    stdout.end()
    await expect(pending).rejects.toThrow('closed stdout before printing the ipc-ready line')
  })

  it('rejects when the ready line never arrives', async () => {
    const stdout = new PassThrough()
    await expect(waitForIpcReady(stdout, 20)).rejects.toThrow('did not print the ipc-ready line within 20ms')
  })

  it('rejects when stdout errors', async () => {
    const stdout = new PassThrough()
    const pending = waitForIpcReady(stdout, 1_000)
    stdout.destroy(new Error('broken pipe'))
    await expect(pending).rejects.toThrow('broken pipe')
  })
})
