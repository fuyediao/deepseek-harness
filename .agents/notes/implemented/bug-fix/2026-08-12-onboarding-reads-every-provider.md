# Agent Note: First-run readiness reads every provider, and the setup card closes

Status: implemented

English | [中文](2026-08-12-onboarding-reads-every-provider.zh.md)

## Problem

The Models page asked one question — is `deepseek-official`'s credential stored? — of a join that describes every provider.

That reading opened the DeepSeek setup card over a user who already had another provider, and that card could not be closed: it was rendered from row data with no local state a Cancel could flip, so its Cancel button did nothing visible. Worse, it shared the row-editor/add/declare close handler, which unconditionally clears all three of those states — so cancelling the card that owned none of them discarded the add card's draft while staying open itself.

## Decision

One predicate answers what the setup card actually needs. `providerUsable(row)` is true when the route is registered with the adapter registry (`entry.active`) and whatever credential its resolved profile names is stored; a profile naming no reference authenticates through the provider's own path, as does a live route with no settings address, so neither owes this page a key.

`needsSetup(row, anyUsable)` takes the same fact, so the setup card is the first-run posture alone. With another provider reachable, DeepSeek is an ordinary row carrying the missing-key dot, one Edit click from the same card. There is no official-DeepSeek credential onboarding step; [that dialog is removed](../simplification/2026-09-03-remove-deepseek-onboarding-credential-dialog.md).

Each card kind now owns its own close handler. `closeSetup` records the provider in a component-local `dismissedSetup` set and touches nothing else; `closeEditor` keeps clearing the three states its cards own. Both route the post-save reload through one `announceSaved` helper. Dismissal is viewing state, like the open editor and the add card: a reload restores the first-run posture for a user still in it.

## Alternatives considered

- **Deriving readiness from the model catalog (`session/modelCatalog`) instead of the join.** It answers "can the user talk to something" most directly, but it costs a per-provider listing round trip on a surface that already holds the join, and a provider whose listing fails transiently would re-open the setup card.
- **Requiring `row.configured` in `providerUsable`.** It reads as the stricter check, and would exclude exactly the routes a deployment mounts through `cordis.yml` without a configurable-provider declaration — live routes serving models that this page cannot configure. Registration, not configurability, is what makes a provider usable.
- **Only adding the dismissal, leaving the card auto-opening.** It fixes the Cancel button and nothing else: a user with a working provider would still be handed the DeepSeek form on every visit to Models, which is the same misreading in a quieter form.
- **Persisting the dismissal to settings.** A durable "do not ask about DeepSeek" flag is a second fact about first-run state that can disagree with the join. The credential itself already ends the posture permanently, and every other card on this page is session-local.

## Consequences

The setup card closes for reasons the DeepSeek route knows nothing about: any usable joined row ends the first-run posture. The Models page remains the diagnostic surface.

## Testing

Package tests pin `providerUsable` over the four join states; the section tests cover the first-run posture, the plain-row posture, and the cancel that collapses the setup card while the add card keeps its draft. The `onboarding-usable-provider` web e2e lane replays the whole scenario through the real wire: cancel with both cards open, configure `minimax-cn` instead, reload, and find no credential dialog — with one aria golden of the dismissed state.
