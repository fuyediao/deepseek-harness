---
description: "面向模型的 GeoCRM Harness CRM 工具：以已登录用户身份通过 POST /ai/harness/tools 调用 list_my_access、检索与记录写入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-geocrm

[English](README.md) | 中文

## 概述

挂载 `dsh-tool-geocrm` 后，桌面 agent 可以按已登录用户读写 GeoCRM 数据：列出授权、列出实体、检索与计数、汇总周期，以及创建、更新或删除记录。每次调用都由 GeoCRM 执行 `desktop_agent` 与按实体写入授权。在 Electron profile 上、模型卡片已登录 GeoCRM 时选择它；`dsh web` 与 headless 不挂载它。上传类工具未包含。

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

在已经存有 GeoCRM 会话令牌（`GEOCRM_HARNESS_TOKEN`）并能访问 `geocrm-api` 源站的 Host 上挂载本插件。Electron 包会这样做：模型卡片完成登录后，这些工具用该 JWT POST 到 `/ai/harness/tools/{name}`。

### 何时选择它

当桌面会话应使用与 GeoCRM Harness 相同的 CRM ACL 时选择它。不要在 `dsh web` 或 headless 上挂载：那些 profile 仍使用 `deepseek-official`，也没有 GeoCRM 登录。不要通过这些工具发送供应商 API 密钥；供应商密钥留在 GeoCRM 设置中。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-tool-geocrm'
```

源站与令牌引用默认与 `dsh-llm-geocrm` 相同。当 `llm-geocrm` 设置段已注册时，其实时 `baseURL` 与 `apiKeyEnv` 优先，因此模型卡片上的源站也会作用到这里。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKeyEnv` | `GEOCRM_HARNESS_TOKEN` | 每次调用解析的凭据引用 |
| `baseURL` | `http://127.0.0.1:3001` | GeoCRM API 源站；不要带 `/ai` 后缀 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-geocrm)是每个已接受字段的完整来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

每个已注册工具都是薄的 HTTP 代理。`execute` 解析源站与 JWT，把 `{ arguments }` POST 到 `/ai/harness/tools/{name}`，并返回 GeoCRM 的结果文本。实体枚举保持开放：调用方不能读或写的实体由 GeoCRM 拒绝。上传类工具（`upload_file`、`prepare_upload`、`finalize_upload`、`delete_file`、`list_upload_kinds`）未注册。

### 源码对照

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件 `apply`、连接解析、令牌解析 |
| [`src/catalog.ts`](src/catalog.ts) | 工具名、描述与参数 schema |
| [`src/http.ts`](src/http.ts) | Harness 工具 POST 与错误文本 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-llm-geocrm](../llm-geocrm/README.zh.md) — 保存同一会话令牌的桌面 `geocrm` 模型路由。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-geocrm) — 模型收到的 schema。
- [Electron GeoCRM 网关](../../../.agents/notes/implemented/architecture/2026-09-05-electron-geocrm-llm-gateway.zh.md) — 桌面会话为何要登录 GeoCRM。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [GeoCRM 工具 schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-geocrm)：`list_my_access`、`list_entities`、`search_records`、`get_record`、`count_records`、`summarize_records`、`create_record`、`update_record` 与 `delete_record`。描述要求模型在读写之前先调用 `list_my_access`，再调用 `list_entities`。

#### Token 影响

每次成功调用把 GeoCRM 的结果文本作为一块面向模型的文本返回。失败调用展示 GeoCRM 的错误文本，包括缺少 `desktop_agent` 时的 `harness_forbidden`。

#### KV Cache 影响

工具 schema 在挂载期间是稳定前缀。更改源站或令牌不会改变 schema；只有下一次 execute 使用新连接。

## 已知限制与延后事项

<a id="known-limitations-and-deferred-work"></a>

- **未包含上传工具** — 文件上传、prepare/finalize 与删除文件仍留在 GeoCRM Harness，不在本 Host。
- **不刷新令牌** — 过期 JWT 会让下一次调用失败；操作者在模型卡片上重新登录。
- **实体枚举保持开放** — ACL 由 GeoCRM 执行，而不是由过滤后的 schema 枚举执行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本开发备注是非权威工作上下文。已交付行为见以上各节及所链 Agent Note。

- 不要把这些工具走公共 MCP 或 `gcrm_mcp_*` 密钥。桌面 Host 使用 `/ai/harness/tools` 加上用户 JWT。
- 不要修改 GeoCRM 仓库；本包使用已有的 harness 工具 POST。

</details>

**运行时不变量：** 不发布配套包。本包在其所属缝已执行的约定之外，不暴露独立事件序列或可变数据关系。
