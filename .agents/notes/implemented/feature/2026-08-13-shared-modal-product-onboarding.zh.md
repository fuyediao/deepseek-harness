# Agent Note: 共用弹窗的产品引导

Status: implemented

[English](2026-08-13-shared-modal-product-onboarding.md) | 中文

## Problem

首次使用的产品说明曾经占满整个视口。产品仍需要版本化的测试阶段声明，但恢复它不能增加第二个独立浮层，也不能改变 Host 的设置与凭据边界。API 密钥配置不属于这份声明；[凭据弹窗的移除](../simplification/2026-09-03-remove-deepseek-onboarding-credential-dialog.zh.md)持有该项缺失。

## Decision

**由同一个既有 client Cordis 插件持有已发布的欢迎步骤。** `ui-settings-models` 在 `settings.onboarding` 中以顺序 `-100` 注册 `welcome-notice`。外壳只挂载第一个未完成条目。不新增 client 包或插件配置行。

**欢迎步骤使用共用弹窗。** `OnboardingModal` 包装既有 ui-primitives `Modal`，提供统一的标题和内容布局，并只在可见期间持有 `#root` 的 inert 状态。Escape 和遮罩点击不会静默完成声明；只有「继续」才会确认。步骤仍在加载私有事实时返回 `null`，因此不会绘制或阻塞界面。

**欢迎声明复用既有持久化字段。** 完整文案与版本由 `onboarding-copy.ts` 持有。回环客户端通过既有 settings API 比较和写入 `ui-onboarding.welcomeNoticeVersion`，且只有点击「继续」才确认当前版本。非 loopback 页面继续使用既有的进程内回退，因为 Client 在那里禁用 Host settings 持久化。不改变 Host schema、API Proxy 允许列表或持久化实现。

## Alternatives considered

**让声明单独成为 client 插件。** 不采用：产品要求只使用一个 client Cordis 插件，且声明与 Models 设置包共享文案、弹窗框架与失效刷新归属。

**把确认逻辑移入新的 Host API。** 不采用：既有 settings 契约已经能表达所需状态与写入；新增 endpoint 只会扩大范围，不会增加用户能力。

**保留此前占满视口的展示层。** 不采用：本次需要的是叠加在当前应用上的声明弹窗，既有 ui-primitives modal 已提供合适的 portal、遮罩与无障碍契约。

## Consequences

新的回环 profile 会看到指定的内测声明。确认仍按版本写入 `settings.yaml`。已确认或无法修复的部署在声明加载期间不会渲染任何引导框架。Models 包同时持有这份声明与提供方配置；README 和浏览器覆盖明确记录了这项职责。本决策在历史上的[全屏内测声明移除](../../archived/simplification/2026-08-13-remove-first-run-beta-notice.md)之后恢复简洁的测试阶段声明，但不会恢复那份声明中的遥测文案或接管式布局。
