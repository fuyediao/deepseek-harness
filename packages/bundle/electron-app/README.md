---
description: "The GeoCRM Harness desktop app: an Electron window running the same conversation interface as the Web GUI, with no listening network server."
kind: "package-bundle"
---

# @deepseek-ai/dsh-electron-app

English | [中文](README.zh.md)

## Summary

Run `dsh --profile electron` and an Electron window opens, ready for interactive chat with the agent — the same conversation view, model and settings management, and session history as `dsh web`, backed by the same model access, tools, and safety defaults. Unlike the Web surface, this app opens no network port: the window carries `/api` requests and the live event stream over an IPC socket to the Host process that spawned it, and the built frontend loads over a privileged custom protocol instead of `http://`. Choose it for a local desktop app with no browser and no `dsh web` URL to manage; `dsh-web-app` remains the browser-reachable sibling.

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

### Starting the desktop app

```sh
dsh --profile electron
dsh electron
dsh electron --no-window
```

`dsh electron` is the deliberate alias for `--profile electron`, matching `dsh web`. After startup an Electron window titled GeoCRM Harness opens on the sign-in panel, then the conversation view. With no saved workspace, **Choose workspace** opens the OS folder dialog (the same native picker the Host uses). `--no-window` starts the IPC listener without spawning Electron — useful for a keyless composition smoke that has no display; nothing model-facing is reachable in that mode, since nothing connects to the socket.

`pnpm run dist:electron` writes an unsigned win-x64 NSIS installer under `dist-electron/`. That exe is the Electron shell: it starts the bundled Node `dsh --profile electron --no-window` tree and connects as the window, so the Host does not spawn a second Electron process.

### Per-session agent setup

Each window session composes its own agent from the shipped presets (the `standard` preset by default), the same as `dsh web`. Change the default preset or add your own under `$DSH_HOME/.agent-presets`.

### Models page

The desktop window opens on a GeoCRM Harness sign-in panel (`shell.gate`) before the conversation shell. The Models page shows the `geocrm` card from [`dsh-llm-geocrm`](../../llm/llm-geocrm/README.md) and does not mount `llm-deepseek`. The page uses catalog copy and hides Add provider; the composer lists ChatGPT, Gemini, Claude, Grok, and the rest of `GET /ai/models?client=electron` in that vendor order. Set the GeoCRM API origin in the invoking directory `.env` (`GEOCRM_BASE_URL` or `GEOCRM_DEPLOYMENT_DOMAIN`); the default is a local `geocrm-api` at `http://127.0.0.1:3001`. Sign in with Google, a GeoCRM employee ID or email, or paste a session token. Vendor API keys stay in GeoCRM Settings. The composer and the Models card catalog list only vendors that have a key, including DeepSeek. A password or Google sign-in stays signed in through `POST /auth/refresh`. Every desktop session also receives [`dsh-tool-geocrm`](../../llm/tool-geocrm/README.md) so the agent can call GeoCRM Harness CRM tools as that signed-in user and follow that account's grants. See the [GeoCRM gateway note](../../../.agents/notes/implemented/architecture/2026-09-05-electron-geocrm-llm-gateway.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is one patch plus one runtime glue plugin. The storage stack, projection cache, and browser Client roster come from the same rows `dsh-web-app` mounts; the patch omits only the Web-specific host rows (`webserver`, `web-startup`, `frontend-static`, `client-hmr`) and mounts `electron-startup`/`electron-runtime` instead.

### No listening `webServer`

`ctx.connection` and `ctx.clientModules` activate with no `webServer` present (`packages/client/connection`, `packages/client/modules`): `connection.createSharedFetchHandler('/api')` and `clientModules.resolveResource(url)` work standalone, and `electron-runtime` relays both over its own `ElectronIpcHost` socket instead of an HTTP route. `packages/host/webserver` stays a Web-only carrier by design.

### The IPC protocol

`@deepseek-ai/dsh-electron-ipc` is the zero-dependency, newline-delimited JSON frame protocol between this bundle's `ElectronIpcHost` and the Electron main process (`@deepseek-ai/dsh-electron-shell`): `fetch`/`fetch-res` for unary `/api` and `/plugins` requests, `stream-open`/`stream-item`/`stream-end`/`stream-error`/`abort` for the live event stream (driven through `ctx.get('typertGateway')?.wireStream`), and `boot-request`/`boot` for the index-injection rows the Electron shell renders into its served `index.html`. Binary bytes travel as base64 strings inside each frame.

### The Electron shell

The Electron main process (`apps/electron`) connects the socket, registers a privileged `dsh-app://` custom protocol serving the built `@deepseek-ai/dsh-web-frontend` dist from disk (`index.html` rendered with the Host's current injection rows; every other asset read as-is), and loads that protocol in a sandboxed `BrowserWindow` (`contextIsolation`, `sandbox: true`, no `nodeIntegration`, no native menu bar). The Host drops `ELECTRON_RUN_AS_NODE`, `ELECTRON_NO_ASAR`, and `CHROME_CRASHPAD_PIPE_NAME` before the spawn so a Cursor or VS Code terminal cannot make `electron.exe` run as Node or hang on the parent's crashpad pipe. The preload script (`preload.cjs`, because a sandboxed renderer does not execute an ESM preload) installs `window.__DSH_TRANSPORT__.openStream` natively in the main world through `contextBridge.executeInMainWorld`, because neither `AbortSignal` nor an async iterator survives a `contextBridge` clone with live semantics; `fetch` and `loadBundle` stay unset, so the page's ordinary `fetch()` and classic-script bundle loading resolve through the custom protocol directly.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `electron-runtime` glue plugin: starts `ElectronIpcHost`, registers the desktop-surface prompt section, resolves the frontend dist and Electron shell entry, spawns Electron unless `--no-window`, and forwards process exit to `ctx.appExit` |
| [`src/ipc-host.ts`](src/ipc-host.ts) | `ElectronIpcHost`: the socket listener and per-frame dispatch against `ctx.connection`, `ctx.clientModules`, and `ctx.get('typertGateway')` |
| [`src/startup.ts`](src/startup.ts) | The `electron-startup` provider: `--no-window`, `--help` |
| [`cordis.patch.yml`](cordis.patch.yml) | The desktop patch: the same browser roster as `dsh-web-app`, minus the Web-only host rows, plus `electron-startup`/`electron-runtime` |
| — | No runtime invariant companion is published; every contribution is registry-disposed with the fiber, and the IPC socket and spawned process are owned by one `ctx.effect` disposer. |
| [`tests/electron-app.spec.ts`](tests/electron-app.spec.ts) | Runtime glue: IPC listener with no webServer, prompt section, spawn args and env, appExit forwarding |
| [`tests/ipc-host.spec.ts`](tests/ipc-host.spec.ts) | The socket protocol end to end: fetch, plugin resources, streams, abort, malformed frames, a second connection refused |
| [`tests/startup.spec.ts`](tests/startup.spec.ts) | Command-line parsing over a real Loader tree |
| [`tests/loader-smoke.e2e.ts`](tests/loader-smoke.e2e.ts) | Shipped profile tree: no listen port, one unary `session/list` through `createSharedFetchHandler` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Bundle package map](../README.md) — the surfaces built on the same core.
- [dsh-base](../base/README.md) — the shared core the desktop app runs on.
- [dsh-web-app](../web-app/README.md) — the browser-reachable sibling surface.
- [dsh-electron-ipc](../../util/electron-ipc/README.md) — the IPC frame protocol.
- [Generated configuration catalog](../../../docs/config-catalog.md) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Desktop-surface context

#### What the model sees

The `app:electron-surface` global section orients the model to the desktop window: there is exactly one session per window, no address bar, no separate tab context, and no URL to share since the app has no listening network server. The deployment persona names the GeoCRM Harness work agent. The host-plane [`tool:geocrm` section](../../llm/tool-geocrm/README.md#model-experience) tells the model to follow the signed-in user's GeoCRM grants. The `harness:source` section identifies the on-disk Harness implementation, matching every other surface.

#### Token effect

One source line and one prompt paragraph per session; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process, so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No client-plugin HMR** — `dsh-client-hmr` is a Web-only row; a packaged desktop session needs a fresh Electron relaunch to pick up a rebuilt client bundle. `pnpm run dev:web` remains the Web-profile development loop.
- **No LAN or remote access** — the IPC socket accepts exactly one local connection from the process this bundle spawned; there is no authority to reach the app from another machine, and none is planned.
- **One window per process** — closing the last window ends the `dsh` process (`ctx.appExit`); a multi-window desktop session is not supported.
- **Unsigned first ship** — `pnpm run dist:electron` writes an NSIS installer that is not code-signed; expect an OS security prompt on first run. The payload includes Chromium, a Node Host closure, and the harness.
- **No auto-update** — the installed Windows app does not check for or apply updates; install a newer NSIS artifact to replace it.
- **Desktop chat uses GeoCRM, not DeepSeek official** — the Models page stores a GeoCRM session token; `dsh web` and headless still use `deepseek-official`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
