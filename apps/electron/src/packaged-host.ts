/**
 * Packaged-desktop Host launch: the installed Electron exe execs the bundled
 * Node `dsh --profile electron --no-window` tree and reads the IPC ready line
 * from its stdout. Source launches still receive the pipe and dist from the
 * parent Host and never call this module.
 * @module @deepseek-ai/dsh-electron-shell/packaged-host
 */

import { posix, win32 } from 'node:path'

/** Host stdout line that names the IPC endpoint the shell must connect. */
export const IPC_READY_PREFIX = 'dsh electron: ipc ready at '

/** Argv the packaged Electron exe appends to the bundled `dsh` bin. */
export const PACKAGED_HOST_ARGS = ['--profile', 'electron', '--no-window'] as const

/** On-disk layout under Electron's `process.resourcesPath`. */
export interface PackagedLayout {
  /** Bundled Node executable (not Electron's Node). */
  nodePath: string
  /** Bundled `@deepseek-ai/dsh` CLI entry. */
  dshBinPath: string
  /** Built `@deepseek-ai/dsh-web-frontend` dist the custom protocol serves. */
  distRoot: string
}

/**
 * Resolve the extraResources layout the installer stages beside the Electron asar.
 * @param resourcesPath - Electron `process.resourcesPath`.
 * @param platform - `process.platform` of the running Electron process.
 * @returns the Host binary, CLI entry, and frontend dist paths.
 */
export function resolvePackagedLayout(resourcesPath: string, platform: NodeJS.Platform = process.platform): PackagedLayout {
  const path = platform === 'win32' ? win32 : posix
  const hostRoot = path.join(resourcesPath, 'host')
  return {
    nodePath: path.join(hostRoot, platform === 'win32' ? 'node.exe' : 'node'),
    dshBinPath: path.join(hostRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    distRoot: path.join(resourcesPath, 'web'),
  }
}

/**
 * Return the IPC pipe path from Host stdout text, if the ready line is present.
 * @param text - accumulated stdout (may contain multiple lines).
 * @returns the pipe path, or `undefined` when the ready line has not appeared.
 */
export function parseIpcReadyLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(IPC_READY_PREFIX)) return line.slice(IPC_READY_PREFIX.length).trim()
  }
  return undefined
}

/**
 * Wait until the packaged Host prints its IPC ready line.
 * @param stdout - the Host process stdout stream.
 * @param timeoutMs - fail if the line does not arrive in time.
 * @returns the IPC pipe path.
 */
export async function waitForIpcReady(
  stdout: NodeJS.ReadableStream,
  timeoutMs: number,
): Promise<string> {
  return await new Promise((resolveReady, rejectReady) => {
    let buffer = ''
    const timer = setTimeout(() => {
      cleanup()
      rejectReady(new Error(
        `electron-shell: packaged Host did not print the ipc-ready line within ${String(timeoutMs)}ms`,
      ))
    }, timeoutMs)
    const onData = (chunk: string | Buffer): void => {
      buffer += String(chunk)
      const pipePath = parseIpcReadyLine(buffer)
      if (pipePath === undefined || pipePath === '') return
      cleanup()
      resolveReady(pipePath)
    }
    const onEnd = (): void => {
      cleanup()
      rejectReady(new Error('electron-shell: packaged Host closed stdout before printing the ipc-ready line'))
    }
    const onError = (error: Error): void => {
      cleanup()
      rejectReady(error)
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      stdout.off('data', onData)
      stdout.off('end', onEnd)
      stdout.off('error', onError)
    }
    if (typeof stdout.setEncoding === 'function') stdout.setEncoding('utf8')
    stdout.on('data', onData)
    stdout.on('end', onEnd)
    stdout.on('error', onError)
  })
}
