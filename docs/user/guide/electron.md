# Use the desktop app

English | [中文](electron.zh.md)

Start the desktop app through the [root README](../../../README.md#run) with `dsh electron` (or `dsh --profile electron`), or by opening the installed Windows app. This guide begins after the window is open. The Host uses its invoking directory as the default filesystem location, but a fresh window has no selected workspace until you add one. The installed exe starts that Host itself; `dsh electron` remains the source-tree launcher.

The desktop app uses the same conversation view, model settings, and session history as the [Web UI](./index.md). It opens no network port: the window talks to the Host over a local IPC socket, so there is no URL to copy or share.

## Configure a model

Open **Settings → Models**, enter a [DeepSeek API key](https://platform.deepseek.com/), and save it. The model route becomes usable immediately without restarting the app.

The [model configuration guide](./providers.md) covers other providers and custom OpenAI-compatible endpoints.

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
