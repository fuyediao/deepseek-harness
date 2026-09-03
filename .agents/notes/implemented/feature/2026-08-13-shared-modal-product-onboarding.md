# Agent Note: Shared-modal product onboarding

Status: implemented

English | [中文](2026-08-13-shared-modal-product-onboarding.zh.md)

## Problem

First-run product context used to occupy the whole viewport. The product still needs a versioned testing-stage notice, but restoring it must not add a second independent overlay or change the Host settings and credential boundaries. API-key setup is not part of this notice; [the credential-dialog removal](../simplification/2026-09-03-remove-deepseek-onboarding-credential-dialog.md) owns that absence.

## Decision

**One existing client Cordis plugin owns the shipped welcome step.** `ui-settings-models` registers `welcome-notice` at order `-100` in `settings.onboarding`. The shell mounts only the first incomplete entry. No additional client package or plugin row is introduced.

**The welcome step uses the shared modal.** `OnboardingModal` wraps the existing ui-primitives `Modal`, supplies the common title and content geometry, and owns `#root` inert for exactly the visible lifetime. Escape and mask clicks do not silently complete the notice; only Continue acknowledges it. A step still loading private facts returns `null`, so it paints and blocks nothing.

**The welcome notice reuses the existing durable field.** Its exact copy and version live in `onboarding-copy.ts`. Loopback clients compare and write `ui-onboarding.welcomeNoticeVersion` through the existing settings API, and only Continue acknowledges the current version. Non-loopback pages retain the existing process-local fallback because the Client keeps Host settings persistence disabled there. No Host schema, API-proxy allowlist, or persistence implementation changes.

## Alternatives considered

**A separate client plugin for the notice.** Rejected because the product asks for one client Cordis plugin and the notice shares copy, modal chrome, and invalidation ownership with the Models settings package.

**Move acknowledgement into a new Host API.** Rejected because the existing settings contract already expresses the required state and write. A new endpoint would widen scope without changing user capability.

**Keep the former full-viewport stage.** Rejected because the requested notice is a dialog over the current app, and the common ui-primitives modal already provides the appropriate portal, mask, and accessibility contract.

## Consequences

A fresh loopback profile sees the specified internal-testing notice. Acknowledgement remains versioned in `settings.yaml`. Already-acknowledged or unsupported deployments render no onboarding chrome while the notice loads. The Models package owns this notice as well as provider configuration; its README and browser coverage make that responsibility explicit. This decision restores a concise testing-stage notice after the historical [full-viewport beta notice removal](../../archived/simplification/2026-08-13-remove-first-run-beta-notice.md) without restoring that notice's telemetry copy or takeover layout.
