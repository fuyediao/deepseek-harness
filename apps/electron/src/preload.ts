/**
 * Electron preload script: the isolated-world half of the desktop shell's
 * transport. It exposes narrow, JSON-only primitives
 * (`window.__dshElectronBridge__`) through `contextBridge.exposeInMainWorld`,
 * then installs `window.__DSH_TRANSPORT__.openStream` natively in the main
 * world through `contextBridge.executeInMainWorld` so the caller's real
 * `AbortSignal` and the returned async iterator are same-realm objects —
 * neither survives a `contextBridge` clone with live semantics. `fetch` and
 * `loadBundle` are deliberately left unset: the page's ordinary `fetch()` and
 * classic-script bundle loading already resolve through the privileged
 * `dsh-app://` protocol the main process registers, so overriding them here
 * would only add a redundant round trip. The published artifact is
 * `preload.cjs`: a sandboxed renderer does not execute an ESM preload.
 * @module @deepseek-ai/dsh-electron-shell/preload
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronIpcStreamErrorFrame, ElectronIpcStreamItemFrame } from '@deepseek-ai/dsh-electron-ipc'
import { GOOGLE_SIGN_IN_CHANNEL, type GoogleSignInOutcome } from './google-sign-in-ipc.ts'

/** One decoded stream push the main process relays to this window. */
type StreamPushFrame = ElectronIpcStreamItemFrame | { readonly t: 'stream-end'; readonly id: string } | ElectronIpcStreamErrorFrame

/** Bridge primitives reachable from the main world as `window.__dshElectronBridge__`. */
interface DshElectronBridge {
  streamOpen(id: string, endpoint: string, payload: unknown): void
  streamAbort(id: string): void
  onStreamFrame(listener: (frame: StreamPushFrame) => void): () => void
  signInWithGoogle(origin: string): Promise<GoogleSignInOutcome>
}

const STREAM_FRAME_CHANNEL = 'dsh:stream-frame'
const STREAM_OPEN_CHANNEL = 'dsh:stream-open'
const STREAM_ABORT_CHANNEL = 'dsh:stream-abort'

const bridge: DshElectronBridge = {
  streamOpen(id, endpoint, payload) {
    ipcRenderer.send(STREAM_OPEN_CHANNEL, { id, endpoint, payload })
  },
  streamAbort(id) {
    ipcRenderer.send(STREAM_ABORT_CHANNEL, { id })
  },
  onStreamFrame(listener) {
    const wrapped = (_event: unknown, frame: StreamPushFrame): void => { listener(frame) }
    ipcRenderer.on(STREAM_FRAME_CHANNEL, wrapped)
    return () => { ipcRenderer.removeListener(STREAM_FRAME_CHANNEL, wrapped) }
  },
  signInWithGoogle(origin) {
    return ipcRenderer.invoke(GOOGLE_SIGN_IN_CHANNEL, { origin }) as Promise<GoogleSignInOutcome>
  },
}

contextBridge.exposeInMainWorld('__dshElectronBridge__', bridge)

/**
 * Runs inside the main world (the untrusted page), with no closure over this
 * preload script's isolated-world scope — only `window.__dshElectronBridge__`,
 * already installed there by the expose call above, and the primitive args
 * `executeInMainWorld` clones in.
 */
function installTransport(): void {
  interface QueueItem { readonly kind: 'item'; readonly value: unknown }
  interface MainWorldWindow {
    __dshElectronBridge__: DshElectronBridge
    __DSH_TRANSPORT__?: {
      ownsHost: boolean
      openStream(endpoint: string, payload: unknown, signal: AbortSignal): AsyncIterable<unknown>
    }
  }
  const win = window as unknown as MainWorldWindow
  let nextStreamId = 0
  win.__DSH_TRANSPORT__ = {
    ownsHost: true,
    openStream(endpoint, payload, signal) {
      const id = String(nextStreamId++)
      const queue: QueueItem[] = []
      let wake: (() => void) | undefined
      let done = false
      let failure: { kind: 'remote'; code: string; message: string; details: object } | { kind: 'carrier'; message: string } | undefined
      const stop = win.__dshElectronBridge__.onStreamFrame((frame) => {
        if (frame.id !== id) return
        if (frame.t === 'stream-item') queue.push({ kind: 'item', value: frame.value })
        else if (frame.t === 'stream-end') done = true
        else { done = true; failure = frame.failure }
        wake?.()
        wake = undefined
      })
      const onAbort = (): void => {
        win.__dshElectronBridge__.streamAbort(id)
        stop()
      }
      signal.addEventListener('abort', onAbort, { once: true })
      win.__dshElectronBridge__.streamOpen(id, endpoint, payload)
      const iterator: AsyncIterableIterator<unknown> = {
        [Symbol.asyncIterator](): AsyncIterableIterator<unknown> { return iterator },
        async next(): Promise<IteratorResult<unknown>> {
          while (queue.length === 0 && !done) {
            await new Promise<void>((resolve) => { wake = resolve })
          }
          const next = queue.shift()
          if (next !== undefined) return { done: false, value: next.value }
          signal.removeEventListener('abort', onAbort)
          stop()
          if (failure !== undefined) {
            const error = new Error(failure.message) as Error & {
              dshRemoteStreamFailure: { kind: 'remote'; code: string; details: object } | { kind: 'carrier' }
            }
            error.dshRemoteStreamFailure = failure.kind === 'remote'
              ? { kind: 'remote', code: failure.code, details: failure.details }
              : { kind: 'carrier' }
            throw error
          }
          return { done: true, value: undefined }
        },
      }
      return iterator
    },
  }
}

contextBridge.executeInMainWorld({ func: installTransport })
