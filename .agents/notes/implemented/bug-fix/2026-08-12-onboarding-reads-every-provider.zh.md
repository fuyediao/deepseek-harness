# Agent Note: First-run readiness reads every provider, and the setup card closes

Status: implemented

[English](2026-08-12-onboarding-reads-every-provider.md) | 中文

## Problem

Models 页只向一个描述全部提供方的联接快照提出了同一个问题——`deepseek-official` 的凭据存了吗？

那次读取会把 DeepSeek 设置卡片展开在已经另有提供方的用户面前，而这张卡片关不掉：它由行数据渲染而来，没有任何本地状态可供「取消」翻转，因此那颗取消按钮不产生任何可见效果。更糟的是，它与行内编辑卡／新增卡／自定义声明卡共用同一个关闭回调，而该回调会无条件清空那三个状态——于是取消一张它们一个都不拥有的卡片，反而丢弃了新增卡里的草稿，自己却仍然开着。

## Decision

一个谓词回答设置卡片真正需要的事实。`providerUsable(row)` 在路由已注册进适配器注册表（`entry.active`）、且其解析后 profile 所指名的凭据已存储时为真；不指名任何引用的 profile 走提供方自己的认证路径，没有 settings 地址的存活路由亦然，因此二者都不欠这个页面一把密钥。

`needsSetup(row, anyUsable)` 接受同一个事实，因此设置卡片仅代表首次运行姿态。当另有可触达的提供方时，DeepSeek 就是一行带缺失密钥点的普通行，距离同一张卡片只有一次「编辑」点击。没有官方 DeepSeek 凭据引导步骤；[该弹窗已移除](../simplification/2026-09-03-remove-deepseek-onboarding-credential-dialog.zh.md)。

现在每一类卡片各自拥有自己的关闭回调。`closeSetup` 把该提供方记入组件本地的 `dismissedSetup` 集合，别的一概不碰；`closeEditor` 继续清空它那些卡片所拥有的三个状态。两者都经由同一个 `announceSaved` 助手完成保存后的重载。关闭状态属于查看态，与展开的编辑卡和新增卡一样：对仍处于首次运行姿态的用户，重载会恢复该姿态。

## Alternatives considered

- **从模型目录（`session/modelCatalog`）而非联接推导就绪状态。** 它最直接地回答「用户有没有能对话的东西」，但会在一个已经持有联接的界面上多花每提供方一次列举往返，而且某个提供方列举的瞬时失败会让设置卡片重新展开。
- **在 `providerUsable` 中要求 `row.configured`。** 它读起来更严格，却会恰好排除部署通过 `cordis.yml` 挂载、没有可配置提供方声明的那些路由——它们是正在提供模型、只是这个页面配置不了的存活路由。使一个提供方可用的是注册，不是可配置性。
- **只加关闭状态，保留卡片自动展开。** 那只修好取消按钮，别的什么都没修：已有可用提供方的用户每次进入 Models 仍会被塞一张 DeepSeek 表单，那是同一个误读的安静版本。
- **把关闭状态持久化到 settings。** 一个「别再问 DeepSeek」的持久标志，是关于首次运行状态的第二个事实，可能与联接互相矛盾。凭据本身已经永久结束该姿态，而这个页面上其他每一张卡片都是会话内的。

## Consequences

设置卡片会因为 DeepSeek 路由一无所知的理由而关闭：联接中任意一行可用即结束首次运行姿态。Models 页仍是诊断界面。

## Testing

包内测试针对四种联接状态钉住 `providerUsable`；分区测试覆盖首次运行姿态、普通行姿态，以及在新增卡保住草稿的同时折叠设置卡片的那次取消。`onboarding-usable-provider` web e2e 泳道通过真实协议重放整个场景：两张卡片都开着时取消、改配 `minimax-cn`、重载，然后不再出现凭据弹窗——并附一份关闭后状态的 aria golden。
