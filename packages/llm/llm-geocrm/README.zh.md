---
description: "面向用户与维护者的 GeoCRM BYOK Responses 适配器，用于配置桌面 geocrm 路由。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-geocrm

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-llm-geocrm` 是 harness LLM 服务的 GeoCRM 适配器：它拥有 `geocrm` 提供方路由，并把 GeoCRM 的 Codex 子集 Responses SSE 翻译成 harness 的 stream-chunk 协议。桌面 profile 挂载它，使模型页可以登录 GeoCRM（或保存会话令牌）并访问本地或已部署的 `geocrm-api` 源站。供应商 API 密钥留在 GeoCRM 设置中；本适配器从不发送它们。连接事实——源站、建议目录、令牌——按请求解析，因此编辑用户设置文档会在下一次请求生效，无需重启。

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

当组合要通过 GeoCRM 的 BYOK 网关而不是供应商源站流式调用模型时，挂载本插件。它注册唯一的 `geocrm` 路由，并按请求解析连接事实。

### 何时选择它

当 Host 应在 GeoCRM API 源站上调用 `GET /ai/models?client=electron` 与 `POST /ai/harness/responses`，并用 Supabase 会话 JWT（`GEOCRM_HARNESS_TOKEN`）鉴权时，选择本适配器。当组合直接访问 DeepSeek 官方 chat-completions API 时，选择 `dsh-llm-deepseek`。为 `geocrm` 再注册任何其他适配器会以 `DUPLICATE_ADAPTER` 失败。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-llm-geocrm'
  config:
    apiKeyEnv: GEOCRM_HARNESS_TOKEN
    baseURL: http://127.0.0.1:3001
```

请求以 `provider: geocrm` 选择该路由。模型 id 是复合的 `provider:model` 值（例如 `deepseek:deepseek-v4-flash`），这样跨 GeoCRM 提供方碰撞的目录 id 仍保持可区分。适配器把 slug 作为 `x-geocrm-provider` 发送，并把供应商 id 作为 `model` 发送。省略 `models` 时公布静态旗舰（ChatGPT、Gemini、Claude、Grok、DeepSeek）。存在令牌时，实时目录拉取会替换该列表。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKeyEnv` | `GEOCRM_HARNESS_TOKEN` | 每请求通过凭据缝再回落到环境解析的凭据引用 |
| `baseURL` | `http://127.0.0.1:3001` | GeoCRM API 源站；不要带 `/ai` 后缀。`.env` 中的 `$GEOCRM_BASE_URL` 或 `$GEOCRM_DEPLOYMENT_DOMAIN` 优先于该字段 |
| `models` | 静态旗舰 | 实时拉取不可用时展示的建议目录 |
| `defaultContextWindow` | `200,000` | 所选模型没有精确值时的容量回退 |
| `streamIdleTimeoutMs` | `300,000` | 一次未完成的流读取允许的最长提供方空闲时间 |
| `retryPolicy` | normal，5 次重试 | 由 `dsh-llm-retry` 执行的提供方重试策略 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-llm-geocrm)是每个已接受字段及其 JSDoc 的完整来源。

令牌必须属于拥有 `desktop_agent` 且已在 GeoCRM 设置中保存 BYOK 密钥的 GeoCRM 用户。把 VPS 源站写进调用目录的 `.env`：`GEOCRM_BASE_URL=https://api.example.com` 或 `GEOCRM_DEPLOYMENT_DOMAIN=example.com`（与 GeoCRM Electron 的 `VITE_DEPLOYMENT_DOMAIN` 使用同一主机名）。窗口登录页会保存来自 GeoCRM `POST /auth/password`（工号会先解析）或桌面 Google 登录的 refresh 令牌。在访问 JWT 距离 `exp` 不足五分钟时，本插件会调用 `POST /auth/refresh`。401/403 为 `AUTH`；422 `missing_api_key` 为 `INVALID_REQUEST`（在 GeoCRM 中添加供应商密钥，而不是在这里）。`listModels` 先读 `GET /ai/models` 上的 BYOK 有无（`configured` id 或逐行标志），再读 `GET /ai/settings/configured`，再读 `POST /ai/settings/connectivity`。没有密钥的供应商不会出现在 composer 中。发现返回完整目录，并给这些行盖上 `geocrm:not-configured`，以便设置页显示未设定。密钥有无表明该供应商没有密钥时，Responses POST 会在本地拒绝。没有 refresh 令牌的过期访问 JWT 为 `AUTH`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本插件是直接 fetch 适配器。`apply` 注册 `geocrm` 路由、`llm-geocrm` 设置段以及模型发现。每次请求解析源站与 JWT，把 harness 消息映射到 GeoCRM Responses 的 `input` / `tools` / `instructions`，并把完整回合的 `data:` SSE（`response.output_item.done`，然后 `response.completed`）解析成一个文本块或一个工具调用块。

### 源文件对照

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件 `apply`、`Config` 以及按请求的选项解析 |
| [`src/origin.ts`](src/origin.ts) | `$GEOCRM_BASE_URL` / `$GEOCRM_DEPLOYMENT_DOMAIN` 源站解析 |
| [`src/session.ts`](src/session.ts) | 通过 `POST /auth/refresh` 轮换 access/refresh |
| [`src/adapter.ts`](src/adapter.ts) | `GeoCrmAdapter`：目录拉取、Responses POST、空闲看门狗 |
| [`src/catalog.ts`](src/catalog.ts) | 复合 id、静态旗舰、目录 JSON |
| [`src/keys.ts`](src/keys.ts) | 由 `GET /ai/models`、`GET /ai/settings/configured` 与连通性得出的 BYOK 密钥有无 |
| [`src/translate.ts`](src/translate.ts) | harness 消息到 Responses 体；SSE 到 stream chunks |
| [`src/http.ts`](src/http.ts) | 源站规范化与 HTTP 错误码 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [LLM 流式子系统](../../../docs/subsystems/llm-streaming.zh.md) — 本适配器发出的 harness stream-chunk 协议。
- [dsh-llm-deepseek](../llm-deepseek/README.zh.md) — `dsh web` 使用的官方 DeepSeek chat-completions 适配器。
- [dsh-electron-app](../../bundle/electron-app/README.zh.md) — 挂载本插件并隐藏 `llm-deepseek` 的桌面 profile。
- [双 LLM 适配器](../../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.zh.md) — 为何官方 DeepSeek 与库封装路由保持分离。
- [Electron GeoCRM 网关](../../../.agents/notes/implemented/architecture/2026-09-05-electron-geocrm-llm-gateway.zh.md) — 为何桌面模型页保存会话令牌而不是供应商密钥。

-----

<a id="model-experience"></a>
## 模型体验

### Responses 请求体

#### 模型看到什么

GeoCRM 收到 `instructions`（循环系统提示加上任何额外的 system 角色历史）、`input`（用户与助手文本作为 `input_text` 消息，助手工具调用作为 `function_call`，工具结果作为 `function_call_output`），以及作为 `function` 项的 `tools`。图片、文件与推理块会被丢弃。`sessionId` 成为 `prompt_cache_key`。推理力度 `off` 会省略；`max` 作为 `high` 发送。

#### Token 影响

输出 token 取决于所选 GeoCRM 目录模型及该供应商的补全。本适配器不自行添加提示段。

#### KV Cache 影响

当循环提供 `sessionId` 时，`prompt_cache_key` 在会话生命周期内保持稳定。更改复合模型 id 或 `x-geocrm-provider` 会选择不同的供应商缓存域。GeoCRM 本身不流式发送 token 增量；一个完整回合作为单个文本块或工具调用块到达。

## 已知限制与延后事项

<a id="known-limitations-and-deferred-work"></a>

- **完整回合 SSE，而不是 token 增量** — GeoCRM 写入不含官方 `event:` 行的 `data:` JSON，并且每回合最多发出一次工具调用。
- **不发送图片与文件** — 持久图片与文件块留在会话日志中，在线路上变成空文本。
- **JWT 与 BYOK 分离** — 此卡片保存 GeoCRM 会话对；没有 refresh 令牌的粘贴访问 JWT 仍会过期，GeoCRM 设置中缺少供应商密钥以 `INVALID_REQUEST` 失败。
- **请求使用原始 `fetch`** — 没有共享代理或拦截配置。
- **跳过插件新增的内容块类型** — 只序列化核心 text、tool-call 与 tool-result 块。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本开发备注是非权威工作上下文。已交付行为见上方各节及所链 Agent Note。

- 不要把 `deepseek-official` 指向 GeoCRM 源站。GeoCRM 不是 OpenAI `/v1` API。
- 不要为了 `/v1` 兼容去改 GeoCRM；本适配器使用 `/ai/harness/responses`。会话轮换走 `POST /auth/refresh`。

</details>

**运行时不变量：** 不发布伴生包。本包在其所属缝上已强制执行的约定之外，不暴露独立事件序列或可变数据关系。
