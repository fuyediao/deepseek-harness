# Agent Note: Electron 桌面 profile 经 IPC 承载 Web Client，且无监听 webServer

Status: implemented

[English](2026-09-02-electron-desktop-profile.md) | 中文

## Problem

已归档的[GUI 分层笔记](../../archived/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)把 Electron 桌面应用留作设计目标：「在 Electron 中使用与 `dsh web` 相同的 Web 技术启动」，并点明了预期形态——将来的 Electron 壳经由 IPC fetch 载体复用同一套 Web Client 包，`dsh-host-webserver` 只服务浏览器。要落地这一形态，代码库还缺两件东西：一种能让 `ctx.connection` 与 `ctx.clientModules` 在完全没有监听 `webServer` 的情况下激活的 Host 组合，以及一条具体的 IPC 传输，承载浏览器经 HTTP 与 WebSocket 获得的同一份 `/api` fetch、`/plugins` bundle 字节与实时事件流。

## Decision

### Connection 与 client-modules 不再要求 webServer

`packages/client/connection` 与 `packages/client/modules` 把 `webServer` 从各自的激活 `inject` 中移除。`HostConnectionService` 与 `ClientModuleRegistry` 无条件构造并回答 `createSharedFetchHandler`／`resolveResource`／`indexInjections`；两个包各自只在 `ctx.get('webServer')` 有定义时才注册自己的 HTTP route（`/api`、`/plugins`），该判断在 apply 时同步完成——两者都存在时，Loader 总会先激活 `webServer` 再激活这两个包，因此这与把激活门槛设在它之上等价，却省去了额外 fiber。`ClientModuleRegistry.resolveResource(resourceUrl)` 就是 `serveBundle` 早已具备的同一套 combo/map 查找；现在它同时也是一个直接的、非 HTTP 的入口。`indexInjections()` 直接返回 `bootInjections(this.composed)`。`webserver/index-inject` 监听器保持无条件注册：它是一个普通 Context 事件，不是 `webServer` 能力，非 HTTP 渲染方（Electron）通过自行触发该事件即可拿到同一张表。

### `@deepseek-ai/dsh-electron-app`：桌面 bundle，不监听端口

一个新 bundle 复刻 `dsh-web-app` 的浏览器 Client 名单（`dsh-client-connection`、`dsh-client-modules`、`dsh-client-file-upload`、每个 `ui-*` 包、各 API controller、`agent-presets`），但省去 Web 专属的 host 行（`webserver`、`web-startup`、`frontend-static`、`client-hmr`），改为挂载 `electron-startup`／`electron-runtime`。`electron-runtime` 启动 `ElectronIpcHost`——一个只接受一个连接的 `net` socket 监听器——把帧分发给 `connection.createSharedFetchHandler('/api')`、`clientModules.resolveResource(url)` 与 `ctx.get('typertGateway')?.wireStream`（与 WebSocket mux、已归档的 WebWorker 预览早已共用的同一套载体无关流驱动器）。除非带 `--no-window`（`electron-startup` 唯一的 flag），随后会拉起构建好的 `@deepseek-ai/dsh-electron-shell`（Electron 主进程），在其环境变量中传入 IPC 路径与解析出的 `@deepseek-ai/dsh-web-frontend` dist 根目录，并把子进程的退出码转发给 `ctx.appExit`。

### `@deepseek-ai/dsh-electron-ipc`：wire 协议

一个零依赖的 `packages/util/*` 库定义了该 socket 承载的两个互不相交的帧联合类型——`ElectronIpcMainFrame`（`fetch`、`stream-open`、`abort`、`boot-request`，由 mint 每个 `id` 的 Electron 主进程发出）与 `ElectronIpcHostFrame`（`fetch-res`、`stream-item`、`stream-end`、`stream-error`、`boot`，由只回显 `id` 的 Host 发出）——以及 `ElectronIpcFrameReader`（字节到行到 JSON 的缓冲）与 `encodeFrame`／`parseMainFrame`／`parseHostFrame`（序列化与形状校验）。二进制字节以 base64 字符串形式置于帧内；socket 本身只承载 UTF-8 文本，每行一帧，以 `\n` 结尾。`dsh-electron-app`（Host 侧）与 `dsh-electron-shell`（Electron 主进程侧）都依赖它获得共享词汇，双方都不拥有传输层。

### `apps/electron`（`@deepseek-ai/dsh-electron-shell`）：窗口

Electron 主进程连接该 socket，注册一个特权 `dsh-app://` 自定义协议（`standard`、`secure`、`supportFetchAPI`、`corsEnabled`），并经它从磁盘服务构建好的 `dsh-web-frontend` dist：`index.html` 会以 Host 当前的 `webserver/index-inject` 行渲染（经 `boot-request`／`boot` 逐请求取一次，使用与已服务 Web 表层相同的 `renderIndexInjections`），其余资源原样读取。窗口（`BrowserWindow`，`contextIsolation`、`sandbox: true`、禁用 `nodeIntegration`）隐藏原生 File/Edit/View/Window 菜单栏并加载该协议。发布的 preload 是 `preload.cjs`，因为沙箱渲染进程不会执行 ESM preload。preload 脚本只安装 `window.__DSH_TRANSPORT__.openStream` 与 `ownsHost: true`；`fetch` 与 `loadBundle` 保持未设置，让页面自身的 `fetch()` 与经典脚本 bundle 加载直接经自定义协议解析，不必再经 IPC 承载的请求/响应编码多绕一圈。`openStream` 不能是 `contextBridge.exposeInMainWorld` 普通函数代理的返回值，因为调用方那个存活的 `AbortSignal` 与返回的异步迭代器都无法带着可用语义穿过该桥的克隆（`AbortSignal` 与异步迭代器都不在 Electron 文档列出的可克隆值清单中，且 `contextBridge` 代理函数的返回值是在跨界时被捕获的快照，而非保持存活的引用）。preload 脚本改为只经 `exposeInMainWorld` 暴露纯 JSON 原语式的桥调用（`streamOpen`／`streamAbort`／`onStreamFrame`），再用 `contextBridge.executeInMainWorld` 把 `openStream` 作为原生主世界代码安装，该代码闭包引用那些已暴露的原语——`AbortSignal` 与返回的 `AsyncIterableIterator` 在整次调用中都停留在同一个 realm。

包命名：`apps/electron` 下的 `@deepseek-ai/dsh-electron-shell`，与 `apps/web` 下的 `@deepseek-ai/dsh-web-frontend` 对应——一个不带 `bin` 的已发布应用包，由 Host bundle 经 `require.resolve` 解析，而非被直接启动（`docs/architecture.md#application-launch` 仍称 `dsh` 为唯一受支持的启动器；Electron 进程运行在真正的 `electron` 可执行文件之下，由拉起的 `dsh electron` 进程去拉起它，而不是反过来）。

### Profile 与 launcher 接线

`packages/boot/app-boot/src/profile.ts` 中的 `PROFILE_TEMPLATES.electron` 命名 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-electron-app']`，`patchReload: 'startup'`（与除实时重载的 `web` 之外的每个基于 base 的模板一致）。`apps/cli/src/args.ts` 在 `dsh web` 旁新增 `dsh electron` 子命令，两者都是各自 `--profile` 形式的专用别名。

### 打包的 Windows 安装程序

`pnpm run dist:electron`（`scripts/build-electron-installer.ts`）从私有的 `dsh-electron-runtime-closure` 部署根暂存一份提升式 Node 配置树，把构建机上的 `node.exe` 与构建好的 `dsh-web-frontend` dist 复制进 Electron 的 `extraResources`，并调用 electron-builder 生成未签名的 NSIS win-x64 安装程序。安装后的 exe 就是 `@deepseek-ai/dsh-electron-shell`。因为该进程本身已是 Electron，它会执行捆绑的 `dsh --profile electron --no-window` 并从该子进程读取 IPC 就绪行——Host 既不会 `require` `electron`，也不会再拉起第二个窗口。暂存的 Host 树会删除 `electron` 与 `dsh-electron-shell`，因此 Chromium 只打包一次。

## Testing

- `packages/bundle/electron-app/tests/loader-smoke.e2e.ts` 以 `--no-window` 启动随附的 `electron` profile，断言没有监听中的 `webServer` 也没有 TCP 监听，并通过 `createSharedFetchHandler` 发出一次 `session/list` 调用。
- `apps/electron/tests/keyless-window.e2e.ts` 通过 Playwright 的 Electron 驱动，针对该 Host 启动已构建的壳，并断言会话界面（工作区选择器）。
- `snapshots/electron/seeded-history` 借用 Web 的 seeded-history 会话；`apps/electron/tests/seeded-history.e2e.ts` 通过桌面窗口渲染它，并拥有 ARIA golden。
- `apps/electron/tests/packaged-host.spec.ts` 覆盖 extraResources 路径解析，以及已安装 exe 所使用的 IPC 就绪行等待。
- `apps/electron/tests/window-chrome.spec.ts` 覆盖被隐藏的原生菜单栏。
- `scripts/build-electron-installer.spec.ts` 覆盖 win-x64 主机门禁与 dry-run 部署命令。
- `scripts/electron-runtime-closure.spec.ts` 与 `verify-electron-runtime-closure` 保证 Host 部署根闭合，且不含 Electron asar 包。

## Alternatives considered

**在 Electron 主进程内运行完整 Host。** 否决：本仓库交付的每个原生插件（`node-pty`、Windows 目录选择器的 koffi 绑定、Landlock）都是针对普通 Node 的 ABI 构建的，而 Electron 每个版本都自带一份带有自己 ABI 版本的 Node。让 Host 跑在 Electron 之下，就需要每次 Electron 升级都为每个原生插件跑一遍 `@electron/rebuild`——这是一项没有对等收益的维护负担；两个进程经本机 socket 通信，并不比一个进程明显更复杂，还能让每个原生插件继续构建、测试在产品其余部分早已使用的同一个 Node 之上。

**在 BrowserWindow 中加载 `http://127.0.0.1:<port>`，而不是自定义协议加 IPC。** 已归档分层笔记自己的决策（「Electron 不复用[`dsh-host-webserver`]」）以及该包自己的模块文档注释中都已明确否决。桌面应用本不需要的 loopback HTTP server，还会附带 `BrowserAuth` 存在的整套浏览器会话 cookie／token 机制——那套机制唯一的职责是认证一个不受信任的网络来源，而当唯一的客户端就是 mint 出该 socket 路径并把它交给自己子进程的那个进程时，这套机制毫无意义。

**让 `openStream` 的异步迭代结果直接从 `contextBridge.exposeInMainWorld` 函数返回。** 在编写 preload 脚本之前，对照 Electron 文档列出的 context bridge 可承载值（原语、由它们组成的纯对象/数组、`Error`、`Promise`、`Function`、`RegExp`、`Date`、`ArrayBuffer`/typed array/`Buffer`）逐一核对：`AbortSignal` 与带 `Symbol.asyncIterator` 的对象都不在其中，且被代理函数的返回值是在跨界那一刻被捕获，而非保持存活。因此改用 `contextBridge.executeInMainWorld` 把 `openStream` 作为真正的主世界代码安装，闭包引用另行暴露的纯 JSON 原语式桥调用——这正是它被设计用来解决的「调用方需要真实平台对象」场景。

**让 `/plugins` bundle 字节经同一条 IPC `fetch` 帧从渲染进程的 `window.fetch` 取得，而不是由 Electron 主进程自己在自定义协议里回答。** 否决：自定义协议本就承担其协议方案下每条路径（包括 `/plugins/*`）的请求处理；为同一类资源再加一条路径（一个显式的 `__DSH_TRANSPORT__.fetch` 覆盖）会造成同一种请求有两条载体，却没有任何消费方需要第二条。Electron 主进程在协议 handler 收到 `/plugins/*` 与 `/api/*` 请求后，经 socket 转发给 Host；渲染进程的 `fetch()` 从不需要知道 socket 的存在。

## Consequences

- `packages/client/connection` 与 `packages/client/modules` 获得了第二种、不依赖 `webServer` 的组合方式，新的 Electron 表层以及未来任何非 HTTP 壳都能复用它，无需再改仓库；`packages/host/webserver` 仍是纯 Web 载体，不含任何 Electron 专属代码。
- `@deepseek-ai/dsh-electron-ipc` 是 IPC wire 格式的唯一定义处；帧集合的变更只需更新一个包，而不是让 Host bundle 与 Electron 壳内两份独立漂移的拷贝。
- 桌面表层不带客户端插件 HMR（`dsh-client-hmr` 仍是仅供 Web 使用的行），也没有 LAN 或远程可达性（该 socket 只接受拉起它的那个进程发出的一个本地连接）；重新构建的客户端 bundle 需要重启 Electron 才能生效。两者都在本次首发中被接受，并记录在该 bundle 的 README 已知限制里，而非被悄然丢弃。
- Windows 打包（`electron-builder`，一个把 `@deepseek-ai/dsh` 的提升式 Node 配置树与构建好的前端、Electron 壳一并打入的 NSIS 安装程序）在本次首发中未签名且无自动更新；首次运行预期会出现操作系统安全提示，直到后续变更加入代码签名为止。
- 从 Electron 父进程（Cursor、VS Code）拉起窗口时，必须去掉 `ELECTRON_RUN_AS_NODE`、`ELECTRON_NO_ASAR` 和 `CHROME_CRASHPAD_PIPE_NAME`。否则 `electron.exe` 会按 Node 运行，或卡在父进程的 crashpad 管道上，于是 Host 只打印 `ipc ready` 却不出现窗口。
- `dsh-electron-app` 必须声明 `@deepseek-ai/dsh-web-frontend`，否则在 pnpm 隔离下 `require.resolve` 看不到构建好的 dist。缺这个依赖时 Host 会打出 `ipc ready`，随后 fiber 静默失败，看起来像卡住。
- 桌面 patch 与 `connection` 一起挂载 `file-upload`。`session-controller` 注入 `fileUploads`；缺少该行时 Host 会打印 `ipc ready`，然后以 `waiting for service: fileUploads` 退出。
- 桌面 patch 固定挂载 `@deepseek-ai/dsh-host-directory-picker-native`，因为 `directory-picker-auto` 会注入 `webServer`。该宿主行并不占据 `conversation.hero.workspace.directoryFlow`。配套的客户端表面 `@deepseek-ai/dsh-client-ui-directory-picker-native` 是名册中的一行，这样在列表为空时「选择工作区」才能打开操作系统文件夹对话框。
