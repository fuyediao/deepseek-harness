# Use the desktop app

English | [中文](electron.zh.md)

Start the GeoCRM Harness desktop app through the [root README](../../../README.md#run) with `dsh electron` (or `dsh --profile electron`), or by opening the installed Windows app. This guide begins after the window is open. The Host uses its invoking directory as the default filesystem location, but a fresh window has no selected workspace until you add one. The installed exe starts that Host itself; `dsh electron` remains the source-tree launcher.

The desktop app uses the same conversation view, model settings, and session history as the [Web UI](./index.md). It has no Host listening port: the window talks to the Host over a local IPC socket, so there is no URL to copy or share.

## Sign in

The window opens on a GeoCRM Harness sign-in panel. The title bar, sidebar, and a new session show GeoCRM Harness. Sign in with Google, or with your employee ID or email, before the conversation shell is usable. Put the GeoCRM API origin in the invoking directory `.env` as `GEOCRM_BASE_URL=https://api.example.com` or `GEOCRM_DEPLOYMENT_DOMAIN=example.com` (the same host GeoCRM Electron uses as `VITE_DEPLOYMENT_DOMAIN`). A missing file keeps `http://127.0.0.1:3001`. A stored `GEOCRM_HARNESS_TOKEN` skips the panel. The account needs `desktop_agent`. Sign out from **Settings → Models** returns you to the panel. Vendor API keys stay in GeoCRM Settings. A password or Google sign-in stays signed in; the Host refreshes the session before the access JWT expires. The `geocrm` route and GeoCRM CRM tools become usable immediately without restarting the app. With no saved workspace, **Choose workspace** opens the OS folder dialog.

Settings → Models lists every GeoCRM model (OpenAI, Google, Anthropic, xAI, DeepSeek, and the rest). Vendors without a key show Not Configured. Enable the models you want in the composer menu; that menu still lists only enabled models whose vendor has a key. Settings → Models does not add a second LLM provider. The [model configuration guide](./providers.md) covers the Web UI DeepSeek card and custom OpenAI-compatible endpoints.

## Choose a workspace

Click **Choose workspace**, add the project directory where you started `dsh`, and select it. The session composer remains unavailable until a workspace is selected.

## Run a task

Start a session and send a CRM question or a coding task:

> Summarize this month's orders for my groups.

The agent calls GeoCRM tools as the signed-in user. GeoCRM refuses entities and writes that account cannot perform. The agent can also read and edit workspace files, run commands, delegate work, and maintain a plan. The desktop app asks before operations that require approval under the active permission policy.

## Continue

- [Configure models](./providers.md)
- [Use the Web UI](./index.md)
- [Use other CLI modes](../../../apps/cli/README.md)
- [Develop a plugin](../develop/basic/index.md)
