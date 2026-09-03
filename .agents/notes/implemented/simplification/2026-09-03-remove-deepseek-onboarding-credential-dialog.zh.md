# Agent Note: 移除 DeepSeek 官方首次使用凭据弹窗

Status: implemented

[English](2026-09-03-remove-deepseek-onboarding-credential-dialog.md) | 中文

## Problem

首次使用弹窗会在空白会话 Hero 可用之前索要官方 DeepSeek API 密钥。Models 页已经能把该密钥以只写方式存入 profile 的凭据引用。多出来的 `settings.onboarding` 步骤挡住产品，还要在 Models 联接旁边再做一份就绪投影，并为同一次写入再教一条路径。

该步骤原先要解决的是：`deepseek-official` 没有凭据时，首次用户落到空白 Hero 上却得不到说明。产品不再需要这次拦截：配置路径是「设置 → 模型」，缺密钥是 Models 页上的事实，不是一次接管。

## Decision

`ui-settings-models` 在 `settings.onboarding` 中只注册 `welcome-notice`。`DeepSeekOnboardingDialog`、`onboardingReadiness`、ProviderEditor 的仅凭据模式以及引导文案键均已删除。用户在「设置 → 模型」中输入密钥。当联接中没有任何可用提供方时，Models 的首次运行设置卡片仍会展开，`providerUsable` 仍决定该姿态。

本 note 合并并取代原先的 DeepSeek 官方首次使用凭据配置 feature note。此处保留的独特依据：由同一份 Models 联接持有提供方身份、settings 路径与凭据描述符；独立的密钥表单或把 secret 写入 settings 文档已被否决，因为凭据存储已经是写入 seam；浏览器无法修复缺失的 `llm-deepseek` 适配器。这些事实对 Models 页仍然成立。放弃的能力是一次无需打开「设置」的行内首次写入。

## Alternatives considered

**用 Config 开关保留弹窗。** 否决。产品不需要这条流程；休眠开关只会让就绪投影、文案键和 e2e 协调路径继续活着，却没有占用方。

**欢迎声明结束后自动打开「设置」。** 否决。那仍是一次首次使用拦截。用户要配置密钥时自己打开 Models。

**为未来步骤保留 `onboardingReadiness`。** 否决。它没有消费者。`providerUsable` 已经回答 Models 页的问题；以后若再有引导步骤，应从这份联接投影，而不是复活已删除的判别联合。

## Consequences

无密钥的首次启动先看到版本化欢迎声明，然后是空白 Hero。用户必须打开「设置 → 模型」才能存入密钥。若要重新引入，应新增一个复用 Models 联接与 `ProviderEditor` 的 `settings.onboarding` 注册项，而不是并行 store，也不是把 secret 写入 settings 文档。

## Testing

`apply.client.spec.ts` 钉住唯一的 `welcome-notice` 占用方。`onboarding-deepseek-config` 确认声明、断言凭据弹窗不存在，并经由 Models 存入密钥。`onboarding-usable-provider` 在无需关闭凭据弹窗的情况下打开 Models。`preview-boot` 在点击「继续」后到达输入框。

## Related

更新 [共用弹窗的产品引导](../feature/2026-08-13-shared-modal-product-onboarding.zh.md) 与 [首次运行就绪状态读取每一个提供方](../bug-fix/2026-08-12-onboarding-reads-every-provider.zh.md)。Models 联接的 settings 一半仍从 [settings describe 镜像](../architecture/2026-08-17-settings-describe-mirror.zh.md) 派生。
