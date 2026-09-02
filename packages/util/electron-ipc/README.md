---
description: "Zero-dependency line-delimited JSON frame protocol between the Electron desktop shell's Host process and its Electron main process."
kind: "package-library"
---

# @deepseek-ai/dsh-electron-ipc

English | [中文](README.zh.md)

## Summary

`dsh-electron-ipc` defines the wire protocol the Electron desktop shell carries over its IPC socket: `ElectronIpcMainFrame` (sent by the Electron main process — `fetch`, `stream-open`, `abort`, `boot-request`) and `ElectronIpcHostFrame` (sent by the Host — `fetch-res`, `stream-item`, `stream-end`, `stream-error`, `boot`). `ElectronIpcFrameReader` buffers raw socket chunks into complete `\n`-terminated lines; `encodeFrame`/`parseMainFrame`/`parseHostFrame` serialize and validate one frame each. Neither side owns transport (sockets, spawning); `@deepseek-ai/dsh-electron-app` (Host) and `@deepseek-ai/dsh-electron-shell` (Electron main) both depend on this package for the shared vocabulary.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Entry point

```ts
import type { Socket } from 'node:net'
import { ElectronIpcFrameReader, encodeFrame, parseMainFrame } from '@deepseek-ai/dsh-electron-ipc'

declare const socket: Socket

const reader = new ElectronIpcFrameReader()
socket.on('data', (chunk: string) => {
  for (const value of reader.push(chunk)) {
    const frame = parseMainFrame(value) // throws on a malformed frame
    // ...dispatch frame.t...
  }
})
socket.write(encodeFrame({ t: 'boot-request' }))
```

Binary bytes (fetch bodies, plugin bundle bytes) travel as base64 strings inside a frame; the socket itself carries UTF-8 text. See [`src/index.ts`](src/index.ts) for the exact TypeScript contract.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Whoever opens a request or stream mints its `id`; the other side only ever echoes it — the two directions carry disjoint frame unions (`ElectronIpcMainFrame`/`ElectronIpcHostFrame`) rather than one shared type with an implicit direction convention. `ElectronIpcFrameReader` owns only the byte-to-line-to-JSON split; `parseMainFrame`/`parseHostFrame` own shape validation, so a malformed line fails loudly at the one point where untrusted process-boundary bytes become a typed value.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Frame types, `encodeFrame`, `ElectronIpcFrameReader`, `parseMainFrame`, `parseHostFrame` |
| — | No runtime invariant companion is published because this library owns no event stream or shared mutable state; unit tests cover encode/decode and validation. |
| [`tests/electron-ipc.spec.ts`](tests/electron-ipc.spec.ts) | Line buffering across chunk boundaries, every frame kind's round trip, and malformed-frame rejection |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-electron-app](../../bundle/electron-app/README.md) — the Host-side consumer: `ElectronIpcHost` dispatches every frame.
- [Utility package map](../README.md) — the other zero-dependency primitives shared across package groups.

-----

<a id="model-experience"></a>
## Model Experience

None, as this transport protocol library registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No framing size limit** — a single line may grow unbounded (e.g. a large plugin bundle's base64 body); the two owning packages, not this protocol, decide overload behavior.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
