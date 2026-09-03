# Agent Note: Official DeepSeek first-run credential dialog is removed

Status: implemented

English | [中文](2026-09-03-remove-deepseek-onboarding-credential-dialog.zh.md)

## Problem

A first-run modal asked for the official DeepSeek API key before the empty conversation Hero became usable. The Models page already stores that key write-only under the profile credential reference. The extra `settings.onboarding` step blocked the product, required its own readiness projection beside the Models join, and taught a second path for the same write.

The original motivation for that step was a first-time user who landed on the empty Hero with no explanation when `deepseek-official` had no credential. That intercept is no longer wanted: Settings → Models is the configuration path, and a missing key is a Models-page fact, not a takeover.

## Decision

`ui-settings-models` registers only `welcome-notice` in `settings.onboarding`. `DeepSeekOnboardingDialog`, `onboardingReadiness`, ProviderEditor credential-only mode, and the onboarding locale keys are deleted. Users enter keys on Settings → Models. The Models first-run setup card still opens when no joined provider is usable, and `providerUsable` still decides that posture.

This note consolidates the former official-DeepSeek first-run credential-setup feature note. Unique rationale kept here: one Models join owns provider identity, settings paths, and credential descriptors; a standalone key form or a settings-document secret was rejected because credential storage is already the write seam; an absent `llm-deepseek` adapter stays unrepairable from the browser. Those facts still apply to the Models page. The given-up capability is an inline first-run key write that never opened Settings.

## Alternatives considered

**Keep the dialog behind a Config flag.** Rejected. The product does not want the flow, and a dormant flag would keep the readiness projection, locale keys, and e2e coordinator path alive for no occupant.

**Open Settings automatically after the welcome notice.** Rejected. That is still a first-run intercept. The user opens Models when they want to configure a key.

**Keep `onboardingReadiness` for a future step.** Rejected. It has no consumer. `providerUsable` already answers the Models page, and a later onboarding step would project from that join rather than revive a deleted discriminant union.

## Consequences

A keyless first boot shows the versioned welcome notice, then the empty Hero. The user must open Settings → Models to store a key. Reintroduction belongs in a new `settings.onboarding` registrant that reuses the Models join and `ProviderEditor`, not a parallel store or a settings-document secret.

## Testing

`apply.client.spec.ts` pins a single `welcome-notice` occupant. `onboarding-deepseek-config` acknowledges the notice, asserts the credential dialog is absent, and stores a key through Models. `onboarding-usable-provider` opens Models without dismissing a credential dialog. `preview-boot` reaches the composer after Continue.

## Related

Updates [Shared-modal product onboarding](../feature/2026-08-13-shared-modal-product-onboarding.md) and [first-run readiness reads every provider](../bug-fix/2026-08-12-onboarding-reads-every-provider.md). The Models join still derives its settings half from the [settings describe mirror](../architecture/2026-08-17-settings-describe-mirror.md).
