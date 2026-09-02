---
description: "Electron 桌面壳的 Host 进程与其 Electron 主进程之间零依赖、按行分隔 JSON 帧协议。"
kind: "package-library"
---

# @deepseek-ai/dsh-electron-ipc

[English](README.md) | 中文

## 概述

`dsh-electron-ipc` 定义了 Electron 桌面壳经其 IPC socket 承载的 wire 协议：`ElectronIpcMainFrame`（由 Electron 主进程发出——`fetch`、`stream-open`、`abort`、`boot-request`）与 `ElectronIpcHostFrame`（由 Host 发出——`fetch-res`、`stream-item`、`stream-end`、`stream-error`、`boot`）。`ElectronIpcFrameReader` 把原始 socket 数据块缓冲成完整的、以 `\n` 结尾的行；`encodeFrame`／`parseMainFrame`／`parseHostFrame` 分别序列化并校验单个帧。双方都不拥有传输层（socket、进程拉起）；`@deepseek-ai/dsh-electron-app`（Host 侧）与 `@deepseek-ai/dsh-electron-shell`（Electron 主进程侧）都依赖本包获得共享词汇。

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

### 入口

```ts
import type { Socket } from 'node:net'
import { ElectronIpcFrameReader, encodeFrame, parseMainFrame } from '@deepseek-ai/dsh-electron-ipc'

declare const socket: Socket

const reader = new ElectronIpcFrameReader()
socket.on('data', (chunk: string) => {
  for (const value of reader.push(chunk)) {
    const frame = parseMainFrame(value) // throws on a malformed frame
    // ...dispatch frame.t...
  }
})
socket.write(encodeFrame({ t: 'boot-request' }))
```

二进制字节（fetch 请求体、插件 bundle 字节）以 base64 字符串形式置于帧内；socket 本身只承载 UTF-8 文本。确切的 TypeScript 约定见 [`src/index.ts`](src/index.ts)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

谁发起请求或流，谁 mint 该次 `id`；对方只会回显它——两个方向承载互不相交的帧联合类型（`ElectronIpcMainFrame`／`ElectronIpcHostFrame`），而不是一个带隐含方向约定的共享类型。`ElectronIpcFrameReader` 只负责字节到行到 JSON 的拆分；`parseMainFrame`／`parseHostFrame` 负责形状校验，因此畸形行会在「不受信任的进程边界字节变为带类型值」这一唯一位置就明确失败。

### 源码索引

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 帧类型、`encodeFrame`、`ElectronIpcFrameReader`、`parseMainFrame`、`parseHostFrame` |
| — | 未发布运行时不变量伴生模块，因为本库不拥有任何事件流或共享可变状态；单元测试覆盖编解码与校验。 |
| [`tests/electron-ipc.spec.ts`](tests/electron-ipc.spec.ts) | 跨数据块边界的行缓冲、每种帧类型的往返、畸形帧的拒绝 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-electron-app](../../bundle/electron-app/README.zh.md)——Host 侧消费方：`ElectronIpcHost` 分发每一帧。
- [工具包地图](../README.zh.md)——跨包组共享的其他零依赖基础库。

-----

<a id="model-experience"></a>
## 模型体验

无，本传输协议库不注册任何模型面内容。

#### KV 缓存影响

本包不进入任何模型请求，因此提供方缓存复用不受影响。

## 已知限制与延后事项

<a id="known-limitations-and-deferred-work"></a>

- **无分帧大小限制**——单行可能无限增长（例如较大插件 bundle 的 base64 正文）；过载行为由两个所有方所在的包决定，而非本协议。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
