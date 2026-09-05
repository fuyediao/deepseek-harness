# Use the desktop app

English | [中文](electron.zh.md)

Start the GeoCRM Harness desktop app through the [root README](../../../README.md#run) with `dsh electron` (or `dsh --profile electron`), or by opening the installed Windows app. This guide begins after the window is open. The Host uses its invoking directory as the default filesystem location, but a fresh window has no selected workspace until you add one. The installed exe starts that Host itself; `dsh electron` remains the source-tree launcher.

The desktop app uses the same conversation view, model settings, and session history as the [Web UI](./index.md). It has no Host listening port: the window talks to the Host over a local IPC socket, so there is no URL to copy or share.

## Sign in

The window opens on a GeoCRM Harness sign-in panel. The title bar and sidebar show GeoCRM Harness. Sign in with Google, or with your employee ID or email, before the conversation shell is usable. Put the GeoCRM API origin in the invoking directory `.env` as `GEOCRM_BASE_URL=https://api.example.com` or `GEOCRM_DEPLOYMENT_DOMAIN=example.com` (the same host GeoCRM Electron uses as `VITE_DEPLOYMENT_DOMAIN`). A missing file keeps `http://127.0.0.1:3001`. A stored `GEOCRM_HARNESS_TOKEN` skips the panel. The account needs `desktop_agent`. Sign out from **Settings → Models** returns you to the panel. Vendor API keys stay in GeoCRM Settings. A password or Google sign-in stays signed in; the Host refreshes the session before the access JWT expires. The `geocrm` route and GeoCRM CRM tools become usable immediately without restarting the app.

The [model configuration guide](./providers.md) covers the Web UI DeepSeek card and custom OpenAI-compatible endpoints.

## Choose a workspace

Click **Choose workspace**, add the project directory where you started `dsh`, and select it. The session composer remains unavailable until a workspace is selected.

## Run a task

Start a session and send:

> Summarize this repository and identify its main packages.

The agent can read and edit workspace files, run commands, delegate work, and maintain a plan. The desktop app asks before operations that require approval under the active permission policy.

## Continue

- [Configure models](./providers.md)
- [Use the Web UI](./index.md)
- [Use other CLI modes](../../../apps/cli/README.md)
- [Develop a plugin](../develop/basic/index.md)
