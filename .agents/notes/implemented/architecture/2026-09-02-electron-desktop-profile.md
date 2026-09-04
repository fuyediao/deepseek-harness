# Agent Note: The Electron desktop profile carries the Web Client over IPC, with no listening webServer

Status: implemented

English | [中文](2026-09-02-electron-desktop-profile.zh.md)

## Problem

The archived [GUI layering note](../../archived/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) reserved an Electron desktop application as a design goal: "launching inside Electron with the same Web technologies as `dsh web`", and named the intended shape — a future Electron shell reuses the same Web Client packages over an IPC fetch carrier, and `dsh-host-webserver` serves browsers only. Delivering that shape needed two things the codebase did not yet have: a Host composition that activates `ctx.connection` and `ctx.clientModules` with no listening `webServer` at all, and a concrete IPC transport carrying the same `/api` fetch, `/plugins` bundle bytes, and live event stream the browser gets over HTTP and WebSocket.

## Decision

### Connection and client-modules stop requiring webServer

`packages/client/connection` and `packages/client/modules` drop `webServer` from their activation `inject`. `HostConnectionService` and `ClientModuleRegistry` construct and answer `createSharedFetchHandler`/`resolveResource`/`indexInjections` unconditionally; each package registers its HTTP route (`/api`, `/plugins`) only when `ctx.get('webServer')` is defined, checked synchronously at apply time — the Loader always activates `webServer` before these packages when both are present, so this is equivalent to gating activation on it without the extra fiber. `ClientModuleRegistry.resolveResource(resourceUrl)` is the same combo/map lookup `serveBundle` already had; it is now also a direct, non-HTTP entry point. `indexInjections()` returns `bootInjections(this.composed)` directly. The `webserver/index-inject` listener stays unconditional: it is an ordinary Context event, not a `webServer` capability, and a non-HTTP renderer (Electron) gathers the same table by emitting the event itself.

### `@deepseek-ai/dsh-electron-app`: the desktop bundle, no listening port

A new bundle mirrors `dsh-web-app`'s browser Client roster (`dsh-client-connection`, `dsh-client-modules`, every `ui-*` package, the API controllers, `agent-presets`) but omits the Web-only host rows (`webserver`, `web-startup`, `frontend-static`, `client-hmr`) and mounts `electron-startup`/`electron-runtime` instead. `electron-runtime` starts `ElectronIpcHost` — a `net` socket listener accepting exactly one connection — dispatching frames against `connection.createSharedFetchHandler('/api')`, `clientModules.resolveResource(url)`, and `ctx.get('typertGateway')?.wireStream` (the same carrier-independent stream driver the WebSocket mux and the archived WebWorker preview already used). Unless `--no-window` (`electron-startup`'s one flag), it then spawns the built `@deepseek-ai/dsh-electron-shell` (Electron's main process) with the IPC path and the resolved `@deepseek-ai/dsh-web-frontend` dist root in its environment, and forwards the child's exit code to `ctx.appExit`.

### `@deepseek-ai/dsh-electron-ipc`: the wire protocol

A zero-dependency `packages/util/*` library defines the two disjoint frame unions the socket carries — `ElectronIpcMainFrame` (`fetch`, `stream-open`, `abort`, `boot-request`, sent by Electron's main process, which mints every `id`) and `ElectronIpcHostFrame` (`fetch-res`, `stream-item`, `stream-end`, `stream-error`, `boot`, sent by the Host, which only ever echoes an `id`) — plus `ElectronIpcFrameReader` (byte-to-line-to-JSON buffering) and `encodeFrame`/`parseMainFrame`/`parseHostFrame` (serialization and shape validation). Binary bytes travel as base64 strings inside a frame; the socket itself carries UTF-8 text, one frame per `\n`-terminated line. Both `dsh-electron-app` (Host) and `dsh-electron-shell` (Electron main) depend on it for the shared vocabulary, with no transport ownership on either side.

### `apps/electron` (`@deepseek-ai/dsh-electron-shell`): the window

Electron's main process connects the socket, registers a privileged `dsh-app://` custom protocol (`standard`, `secure`, `supportFetchAPI`, `corsEnabled`), and serves the built `dsh-web-frontend` dist from disk through it: `index.html` is rendered with the Host's current `webserver/index-inject` rows (fetched once per request through `boot-request`/`boot`, using the same `renderIndexInjections` the served Web surface uses), and every other asset is read as-is. The window (`BrowserWindow` with `contextIsolation`, `sandbox: true`, no `nodeIntegration`) hides the native File/Edit/View/Window menu bar and loads that protocol. The published preload is `preload.cjs` because a sandboxed renderer does not execute an ESM preload. The preload script installs only `window.__DSH_TRANSPORT__.openStream` and `ownsHost: true`; `fetch` and `loadBundle` stay unset, so the page's own `fetch()` and classic-script bundle loading resolve through the custom protocol directly, with no redundant round trip through IPC-carried request/response encoding. `openStream` cannot be `contextBridge.exposeInMainWorld`'s ordinary function-proxying return value, because neither a caller's live `AbortSignal` nor a returned async iterator survives that bridge's clone with working semantics (`AbortSignal` and async iterators are not in Electron's documented clonable-value list, and a `contextBridge`-proxied function's return value is captured, not referenced live). The preload script instead exposes only JSON-primitive bridge calls (`streamOpen`/`streamAbort`/`onStreamFrame`) through `exposeInMainWorld`, then uses `contextBridge.executeInMainWorld` to install `openStream` as native main-world code that closes over those exposed primitives — `AbortSignal` and the returned `AsyncIterableIterator` stay same-realm objects for the whole call.

Package naming: `@deepseek-ai/dsh-electron-shell` at `apps/electron`, matching `@deepseek-ai/dsh-web-frontend` at `apps/web` — a published app package with no `bin`, resolved by the Host bundle through `require.resolve`, not launched directly (`docs/architecture.md#application-launch` still names `dsh` the only supported launcher; the Electron process runs under the real `electron` executable, which the launched `dsh electron` process spawns, not the other way around).

### Profile and launcher wiring

`PROFILE_TEMPLATES.electron` in `packages/boot/app-boot/src/profile.ts` names `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-electron-app']` with `patchReload: 'startup'` (matching every base-backed template except live-reloaded `web`). `apps/cli/src/args.ts` adds a `dsh electron` subcommand alongside `dsh web`, both deliberate aliases for their `--profile` form.

### Packaged Windows installer

`pnpm run dist:electron` (`scripts/build-electron-installer.ts`) stages a hoisted Node closure from the private `dsh-electron-runtime-closure` deploy root, copies the build machine's `node.exe` and the built `dsh-web-frontend` dist into Electron `extraResources`, and invokes electron-builder for an unsigned NSIS win-x64 installer. The installed exe is `@deepseek-ai/dsh-electron-shell`. Because that process is already Electron, it execs the bundled `dsh --profile electron --no-window` and reads the IPC ready line from that child — the Host never `require`s `electron` and never spawns a second window. The staged Host tree deletes `electron` and `dsh-electron-shell` so Chromium is packed once.

## Testing

- `packages/bundle/electron-app/tests/loader-smoke.e2e.ts` boots the shipped `electron` profile with `--no-window`, asserts no listening `webServer` and no TCP listen, and drives one `session/list` call through `createSharedFetchHandler`.
- `apps/electron/tests/keyless-window.e2e.ts` launches the built shell against that Host through Playwright's Electron driver and asserts conversation chrome (the workspace picker).
- `snapshots/electron/seeded-history` borrows the Web seeded-history session; `apps/electron/tests/seeded-history.e2e.ts` renders it through the desktop window and owns the ARIA golden.
- `apps/electron/tests/packaged-host.spec.ts` covers extraResources path resolution and the IPC ready-line wait the installed exe uses.
- `apps/electron/tests/window-chrome.spec.ts` covers the hidden native menu bar.
- `scripts/build-electron-installer.spec.ts` covers the win-x64 host gate and dry-run deploy commands.
- `scripts/electron-runtime-closure.spec.ts` plus `verify-electron-runtime-closure` keep the Host deploy root closed and free of Electron-asar packages.

## Alternatives considered

**Run the full Host inside Electron's main process.** Rejected: every native addon this repository ships (`node-pty`, the Windows directory-picker's koffi binding, Landlock) is built against plain Node's ABI, and Electron ships its own Node build with its own ABI version per release. Running the Host under Electron would need `@electron/rebuild` for every native addon on every Electron upgrade, a maintenance burden with no offsetting benefit — the two processes talking over a local socket is not meaningfully more complex than one process, and it keeps every native addon on the same Node the rest of the product already builds and tests against.

**Load `http://127.0.0.1:<port>` in a BrowserWindow instead of a custom protocol plus IPC.** Rejected outright by the archived layering note's own decision ("Electron does not reuse [`dsh-host-webserver`]") and restated in that package's own module doc comment. A loopback HTTP server the desktop app does not need would also carry the browser-session cookie/token machinery `BrowserAuth` exists for — machinery whose whole job is authenticating an untrusted network origin, meaningless when the only client is the process that minted the socket path and handed it to its own child.

**Return the async-iterable `openStream` result directly from a `contextBridge.exposeInMainWorld` function.** Measured against Electron's documented context-bridge value support (primitives, plain objects/arrays of them, `Error`, `Promise`, `Function`, `RegExp`, `Date`, `ArrayBuffer`/typed arrays/`Buffer`) before writing the preload script: neither `AbortSignal` nor a `Symbol.asyncIterator`-bearing object appears there, and a proxied function's return value is captured at the crossing rather than kept live. `contextBridge.executeInMainWorld` installing `openStream` as real main-world code, closing over separately exposed JSON-primitive bridge calls, was adopted instead — used for exactly this "the caller needs real platform objects" situation.

**Fetch `/plugins` bundle bytes over the same IPC `fetch` frame from the renderer's `window.fetch`, instead of Electron main answering it itself from the custom protocol.** Rejected: the custom protocol already owns request handling for every path under its scheme, including `/plugins/*`; adding a second path (an explicit `__DSH_TRANSPORT__.fetch` override) for the same resource class would mean two carriers for one kind of request with no consumer needing the second one. Electron main relays `/plugins/*` and `/api/*` requests it receives at the protocol handler over the socket to the Host; the renderer's `fetch()` never has to know a socket exists.

## Consequences

- `packages/client/connection` and `packages/client/modules` gained a second, `webServer`-free composition that both the new Electron surface and any future non-HTTP shell can reuse without a repository change; `packages/host/webserver` remains a Web-only carrier with zero Electron-specific code.
- `@deepseek-ai/dsh-electron-ipc` is the one place the IPC wire format is defined; a change to the frame set updates one package instead of two independently-drifting copies inside the Host bundle and the Electron shell.
- The desktop surface carries no client-plugin HMR (`dsh-client-hmr` stays a Web-only row) and no LAN or remote reachability (the socket accepts exactly one local connection from the process that spawned it); a rebuilt client bundle needs an Electron relaunch. Both are accepted for the first ship and recorded on the bundle's README as known limits, not silently dropped.
- Windows packaging (`electron-builder`, an NSIS installer bundling a hoisted Node closure of `@deepseek-ai/dsh` plus the built frontend and Electron shell) ships unsigned and without auto-update in this first pass; expect an OS security prompt on first run until a future change adds code signing.
- Spawning the window from an Electron parent (Cursor, VS Code) must drop `ELECTRON_RUN_AS_NODE`, `ELECTRON_NO_ASAR`, and `CHROME_CRASHPAD_PIPE_NAME`. Those keys otherwise make `electron.exe` run as Node or hang on the parent's crashpad pipe, so the Host prints `ipc ready` and no window appears.
- `dsh-electron-app` must declare `@deepseek-ai/dsh-web-frontend` so `require.resolve` can see the built dist under pnpm isolation. Without that dependency the Host printed `ipc ready` and then the fiber died silently, which looked like a hang.
