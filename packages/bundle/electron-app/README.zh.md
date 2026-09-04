---
description: "DeepSeek Harness 桌面应用：以 Electron 窗口运行与 Web GUI 相同的对话界面，且不监听任何网络端口。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-electron-app

[English](README.md) | 中文

## 概述

运行 `dsh --profile electron` 会打开一个 Electron 窗口，随即可与 agent（智能体）进行交互式聊天——拥有与 `dsh web` 相同的会话视图、模型与设置管理、会话历史，背后是相同的模型访问、工具与安全默认值。与 Web 表层不同，本应用不开放任何网络端口：窗口通过 IPC socket 把 `/api` 请求与实时事件流传给启动它的 Host 进程，内置前端也经由特权自定义协议加载，而非 `http://`。当你需要一个无浏览器、无需管理 `dsh web` URL 的本地桌面应用时选择它；`dsh-web-app` 仍是可通过浏览器访问的姊妹表层。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 启动桌面应用

```sh
dsh --profile electron
dsh electron
dsh electron --no-window
```

`dsh electron` 是 `--profile electron` 的专用别名，与 `dsh web` 对应。启动后会打开一个 Electron 窗口并显示会话视图。`--no-window` 只启动 IPC 监听而不启动 Electron——适合无显示环境下的无密钥组合烟雾测试；该模式下没有任何客户端连接 socket，因此模型面不可达。

`pnpm run dist:electron` 会在 `dist-electron/` 下写出一份未签名的 win-x64 NSIS 安装程序。该 exe 就是 Electron 壳：它会启动捆绑的 Node `dsh --profile electron --no-window` 配置树并以窗口身份连接，因此 Host 不会再拉起第二个 Electron 进程。

### 每会话的 agent 组成

每个窗口会话都会从已发布的 preset（默认 `standard`）组成自己的 agent，与 `dsh web` 相同。可以更改默认 preset，或在 `$DSH_HOME/.agent-presets` 下添加自定义 preset。

### 模型页

桌面模型页显示来自 [`dsh-llm-geocrm`](../../llm/llm-geocrm/README.zh.md) 的 `geocrm` 卡片，并且不挂载 `llm-deepseek`。用 GeoCRM 工号或邮箱登录（或粘贴会话令牌），并把 `baseURL` 保持为 GeoCRM API 源站（本地 `geocrm-api` 为 `http://127.0.0.1:3001`）。供应商 API 密钥留在 GeoCRM 设置中。每个桌面会话还会获得 [`dsh-tool-geocrm`](../../llm/tool-geocrm/README.zh.md)，以便 agent 以该用户身份调用 GeoCRM Harness CRM 工具。见 [GeoCRM 网关说明](../../../.agents/notes/implemented/architecture/2026-09-05-electron-geocrm-llm-gateway.zh.md)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本 bundle 由一个 patch 与一个运行时 glue 插件组成。存储栈、投影缓存与浏览器 Client 名单都来自 `dsh-web-app` 挂载的同一批行；该 patch 只省略了 Web 专属的 host 行（`webserver`、`web-startup`、`frontend-static`、`client-hmr`），改为挂载 `electron-startup`／`electron-runtime`。

### 无监听 `webServer`

`ctx.connection` 与 `ctx.clientModules`（`packages/client/connection`、`packages/client/modules`）在没有 `webServer` 的情况下也能激活：`connection.createSharedFetchHandler('/api')` 与 `clientModules.resolveResource(url)` 可独立工作，`electron-runtime` 把两者都经由自身的 `ElectronIpcHost` socket 转发，而不是注册 HTTP route。`packages/host/webserver` 依设计只服务 Web。

### IPC 协议

`@deepseek-ai/dsh-electron-ipc` 是本 bundle 的 `ElectronIpcHost` 与 Electron 主进程（`@deepseek-ai/dsh-electron-shell`）之间零依赖、按行分隔 JSON 帧的协议：`fetch`／`fetch-res` 承载一元 `/api` 与 `/plugins` 请求，`stream-open`／`stream-item`／`stream-end`／`stream-error`／`abort` 承载实时事件流（经 `ctx.get('typertGateway')?.wireStream` 驱动），`boot-request`／`boot` 承载 Electron 壳渲染其 `index.html` 所需的 index 注入行。二进制字节以 base64 字符串形式置于帧内。

### Electron 壳

Electron 主进程（`apps/electron`）连接该 socket，注册一个特权 `dsh-app://` 自定义协议，从磁盘直接服务内置的 `@deepseek-ai/dsh-web-frontend` dist（`index.html` 会以 Host 当前的注入行渲染；其余资源原样读取），并在一个受限的 `BrowserWindow`（`contextIsolation`、`sandbox: true`、禁用 `nodeIntegration`、无原生菜单栏）中加载该协议。Host 在 spawn 之前会去掉 `ELECTRON_RUN_AS_NODE`、`ELECTRON_NO_ASAR` 和 `CHROME_CRASHPAD_PIPE_NAME`，以免 Cursor 或 VS Code 终端让 `electron.exe` 按 Node 运行，或卡在父进程的 crashpad 管道上。preload 脚本（`preload.cjs`，因为沙箱渲染进程不会执行 ESM preload）通过 `contextBridge.executeInMainWorld` 把 `window.__DSH_TRANSPORT__.openStream` 原生安装进主世界，因为 `AbortSignal` 与异步迭代器都无法带着实时语义穿过 `contextBridge` 克隆；`fetch` 与 `loadBundle` 保持未设置，让页面自身的 `fetch()` 与经典脚本 bundle 加载直接经由自定义协议解析。

### 源码索引

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `electron-runtime` glue 插件：启动 `ElectronIpcHost`、注册桌面表层 prompt 段、解析前端 dist 与 Electron 壳入口、除非 `--no-window` 否则拉起 Electron，并把进程退出转发给 `ctx.appExit` |
| [`src/ipc-host.ts`](src/ipc-host.ts) | `ElectronIpcHost`：socket 监听与逐帧分发，对接 `ctx.connection`、`ctx.clientModules` 与 `ctx.get('typertGateway')` |
| [`src/startup.ts`](src/startup.ts) | `electron-startup` provider：`--no-window`、`--help` |
| [`cordis.patch.yml`](cordis.patch.yml) | 桌面 patch：与 `dsh-web-app` 相同的浏览器名单，去掉 Web 专属 host 行，改为 `electron-startup`／`electron-runtime` |
| — | 未发布运行时不变量伴生模块；每项贡献都随 fiber 经注册表销毁，IPC socket 与拉起的进程由一个 `ctx.effect` disposer 统一持有。 |
| [`tests/electron-app.spec.ts`](tests/electron-app.spec.ts) | 运行时 glue：无 webServer 下的 IPC 监听、prompt 段、spawn 参数与环境变量、appExit 转发 |
| [`tests/ipc-host.spec.ts`](tests/ipc-host.spec.ts) | 端到端 socket 协议：fetch、插件资源、流、abort、畸形帧、第二个连接被拒绝 |
| [`tests/startup.spec.ts`](tests/startup.spec.ts) | 在真实 Loader 树上解析命令行 |
| [`tests/loader-smoke.e2e.ts`](tests/loader-smoke.e2e.ts) | 随附 profile 树：无监听端口，经 `createSharedFetchHandler` 发出一次一元 `session/list` |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Bundle 包地图](../README.zh.md)——建立在同一核心之上的各表层。
- [dsh-base](../base/README.zh.md)——桌面应用运行所依赖的共享核心。
- [dsh-web-app](../web-app/README.zh.md)——可通过浏览器访问的姊妹表层。
- [dsh-electron-ipc](../../util/electron-ipc/README.zh.md)——IPC 帧协议。
- [生成的配置目录](../../../docs/config-catalog.zh.md)——每个可用配置字段及其来源声明。

-----

<a id="model-experience"></a>
## 模型体验

### 桌面表层上下文

#### 模型所见

`app:electron-surface` 全局段会为模型指明桌面窗口的方向：每个窗口恰好对应一个会话，没有地址栏，没有独立的标签页上下文，也没有可分享的 URL，因为本应用不监听任何网络端口。`harness:source` 段标识磁盘上的 Harness 实现位置，与其他表层一致。

#### Token 影响

每个会话一行来源信息、一段 prompt；进程存续期内保持不变。

#### KV 缓存影响

该 prompt 段位于系统提示词靠前位置，且在进程生命周期内保持稳定，因此不会跨轮次使缓存失效。

## 已知限制与延后事项

<a id="known-limitations-and-deferred-work"></a>

- **无客户端插件 HMR**——`dsh-client-hmr` 是仅供 Web 使用的行；已打包的桌面会话需要重新启动 Electron 才能加载重新构建的客户端 bundle。`pnpm run dev:web` 仍是 Web profile 的开发循环。
- **无 LAN 或远程访问**——IPC socket 只接受本 bundle 拉起进程发出的一个本地连接；没有从其他机器访问本应用的权限入口，也没有相关计划。
- **每进程一个窗口**——关闭最后一个窗口会结束 `dsh` 进程（`ctx.appExit`）；不支持多窗口桌面会话。
- **首个版本未签名**——`pnpm run dist:electron` 写出的 NSIS 安装程序尚未进行代码签名；首次运行可能出现操作系统安全提示。有效载荷包含 Chromium、一份 Node Host 配置树以及 Harness。
- **无自动更新**——已安装的 Windows 应用不会检查或应用更新；要用更新的 NSIS 安装包替换它。
- **桌面聊天使用 GeoCRM，而不是 DeepSeek 官方**——模型页保存 GeoCRM 会话令牌；`dsh web` 与 headless 仍使用 `deepseek-official`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
