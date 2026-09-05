# Agent Note: Desktop Models page uses GeoCRM as the LLM gateway

Status: implemented

[English](2026-09-05-electron-geocrm-llm-gateway.md) | 中文

## Problem

已交付的 Electron 模型页注册了 `llm-deepseek`（`deepseek-official`）并要求填写 DeepSeek API 密钥。操作者已经运行 GeoCRM BYOK 后端：它保存供应商密钥、签发 Supabase 会话 JWT，并提供 `GET /ai/models?client=electron` 与 `POST /ai/harness/responses`。把 `deepseek-official` 指向该源站会失败：GeoCRM 不是 OpenAI `/v1` API，其 SSE 是不含官方 `event:` 行的 Codex 子集，鉴权是会话令牌加 `x-geocrm-provider`，而不是供应商密钥。

## Decision

`@deepseek-ai/dsh-llm-geocrm` 拥有 `geocrm` 路由。它使用 GeoCRM 已有的 harness 约定。密码登录会同时写入 `GEOCRM_HARNESS_TOKEN` 与 `GEOCRM_HARNESS_REFRESH`。在访问 JWT 距离 `exp` 不足五分钟时，Host 会调用 GeoCRM `POST /auth/refresh` 并写回轮换后的一对令牌。这是本 Host 需要的唯一 GeoCRM 增补：GoTrue 刷新必须使用服务端 anon key，而本仓库不携带该密钥。

`electron` profile 覆盖层禁用 `llm-deepseek` 与 `web-search-deepseek`，插入 `llm-geocrm`，并把 `agent-default-model` 设为 `provider: geocrm` / `model: deepseek:deepseek-v4-flash`。`dsh web` 与 headless 仍使用 `deepseek-official`。

选择器 id 是复合的 `provider:model` 值，因为 GeoCRM 目录 id 可能在不同 slug 之间碰撞。适配器把 slug 作为 `x-geocrm-provider` 发送，并把供应商 id 作为 `model` 发送。模型卡片（`llm-geocrm`）把会话令牌存在 `GEOCRM_HARNESS_TOKEN` 下。API 源站来自启动环境（`GEOCRM_BASE_URL`，或把 `GEOCRM_DEPLOYMENT_DOMAIN` 写成 `https://api.{domain}`），然后是显式的设置 `baseURL`，最后是 `http://127.0.0.1:3001`。

`packages/client/ui-settings-models` 把 `llm-geocrm` 映射到策划过的编辑器：会话条（退出登录回到窗口登录页）、共享的模型列表编辑器以便“获取”调用已注册的发现，以及自定义设置里的源站和只写令牌粘贴回退。工号或邮箱登录（公开的 `POST /auth/password` 与 `POST /auth/public/resolve-employee-id`）和桌面 Google 登录（系统浏览器打开 `GET /auth/google`，令牌经短时 `127.0.0.1` 回环返回）留在窗口登录页。登录页在登录后探测 `POST /ai/harness/tools/list_my_access`，没有 `desktop_agent` 则窗口保持锁定。`dsh web` 不挂载这张卡片。

Electron 窗口在会话界面可用之前占据 `shell.gate`。浏览器 Loader 创建 client 条目时不转发 yml 配置，因此该覆盖层依据 `dsh-app:` 渲染协议判断（测试传入 `requireSignIn`）。已存储的 `GEOCRM_HARNESS_TOKEN` 会跳过该页。新登录若没有 `desktop_agent` 会清除令牌并留在该页。从模型卡片退出登录会回到该页。`dsh web` 让 `shell.gate` 保持空。`shell.gate` 与 `shell.overlay` 横跨整个 AppFrame 网格，因此登录卡片可以在窗口正中铺开；若不横跨，绝对定位的占位只会填满侧栏那一列。

桌面产品名是 GeoCRM Harness：原生窗口标题、NSIS `productName`、侧栏品牌占位（优先级 `-10`，从而盖过官方 DeepSeek 标记）、GeoCRM 地图针标记、空白会话首屏（透明地图针，无 DeepSeek 标题或预览徽标）、登录页、桌面欢迎声明、`dsh electron` 帮助文本，以及 `app:electron-surface` 提示。包名、`dsh` CLI 动词和 `dsh web` 仍使用 DeepSeek Harness。

`@deepseek-ai/dsh-tool-geocrm` 在 electron 宿主平面注册 GeoCRM Harness 的一等工具（`list_my_access`、`list_entities`、检索/计数/汇总、创建/更新/删除）。每次调用都用已存储的 JWT POST 到 `/ai/harness/tools/{name}`。上传工具仍留在 GeoCRM。`dsh web` 与 headless 不挂载这一行。

## Testing

- `packages/llm/llm-geocrm/tests` 覆盖目录 id、HTTP 映射、Responses 翻译、适配器 fetch、插件 `apply` 以及会话刷新。
- `packages/client/ui-settings-models/tests` 覆盖 GeoCRM 会话条与模型列表、登录页 HTTP、Google 桌面调用、refresh 令牌持久化、`desktop_agent` 探测、`shell.gate` 覆盖层以及桌面品牌占位（含空白会话首屏）。
- `apps/electron/tests/window-chrome.spec.ts` 会把官方前端标题后缀以及本地构建回退（`DSH Local Build`、`DSH 本地构建`）改写为 GeoCRM Harness。`apps/electron/tests/google-sign-in.spec.ts` 覆盖回环授权 URL、CSRF state、令牌 POST，以及监听关闭后的迟到请求。
- `packages/llm/tool-geocrm/tests` 覆盖连接解析、令牌解析与 harness 工具 POST。

## Alternatives considered

**把 `deepseek-official` 指向 GeoCRM 源站。** 否决：官方适配器 POST `/chat/completions` 并解析 OpenAI SSE。GeoCRM 两者都没有。

**复用 `llm-pi-ai`，配置 `openai-responses` 且 `baseURL: …/ai/harness`。** 否决：pi-ai 使用官方 OpenAI Responses SDK，它期望 `event:` 行与 token 增量。GeoCRM 为完整回合写入 `data:` JSON，并且每回合最多一次工具调用。

**在 GeoCRM 上增加 `/v1` 以便现有适配器可用。** 否决：已有的 Electron Codex 宿主已经用 `GEOCRM_HARNESS_TOKEN` 与 `x-geocrm-provider` POST `{apiBase}/ai/harness/responses`。

**让本 Host 带着复制的 anon key 直接刷新 GoTrue。** 否决：额外的操作者配置。`POST /auth/refresh` 已经持有 anon key。

**只在访问 JWT 仍有效时用它当作 GoTrue `apikey` 刷新。** 否决：隔夜空闲仍会强制重新登录。

**把适配器放进 `dsh-electron-app`。** 否决：适配器属于 `packages/llm/*`，这样 Host LLM 缝仍是注册点，并且该包保持自己的 100% `src` 覆盖。

**只在设置 → 模型里登录。** 否决：桌面窗口在 GeoCRM 会话存在之前不得打开会话界面。

**复用 `com.geocrm.electron://login-callback`。** 否决：该 scheme 属于 GeoCRM Electron。在这里注册会抢走另一个应用的 OAuth 返回。

**在 Electron `BrowserWindow` 内跑 Google OAuth。** 否决：Google 拒绝嵌入式浏览器中的 OAuth。系统浏览器加回环 `next` 符合 RFC 8252，并且不需要改 GoTrue 重定向允许列表（`redirect_to` 仍是 `{api}/auth/callback`）。

## Consequences

- 桌面窗口在会话界面之前显示 GeoCRM Harness 登录页。使用 Google 登录会打开系统浏览器；工号 / 邮箱仍留在该页。任务栏、标题栏、侧栏和空白会话首屏显示 GeoCRM Harness。设置 → 模型 仍显示 GeoCRM（而非 DeepSeek）：模型目录、退出登录，以及自定义设置里的令牌粘贴回退。供应商密钥留在 GeoCRM 设置中；用户需要 `desktop_agent`。
- 每个 electron 会话都会继承 GeoCRM CRM 工具。GeoCRM ACL 会拒绝已登录用户不能执行的读与写。隔离覆盖层禁用 `tool-geocrm`，使 e2e 目录不依赖该源站。
- 桌面 profile 上的网页搜索没有 DeepSeek 搜索提供方。`web_fetch` 仍使用 `http`。
- 复合模型 id（`deepseek:deepseek-v4-flash`）是模型选择器与 `agent-default-model` 存储的值。裸的碰撞 id 会被拒绝。
- Host 通过 `POST /auth/refresh` 保持密码或 Google 登录会话。没有 refresh 令牌的粘贴访问 JWT 仍会过期。被撤销的 refresh 令牌会在下一次请求以 `AUTH` 失败。
