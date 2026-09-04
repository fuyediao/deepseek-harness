# Agent Note: Desktop Models page uses GeoCRM as the LLM gateway

Status: implemented

English | [中文](2026-09-05-electron-geocrm-llm-gateway.zh.md)

## Problem

The shipped Electron Models page registered `llm-deepseek` (`deepseek-official`) and asked for a DeepSeek API key. The operator already runs a GeoCRM BYOK backend that stores vendor keys, issues a Supabase session JWT, and exposes `GET /ai/models?client=electron` plus `POST /ai/harness/responses`. Pointing `deepseek-official` at that origin fails: GeoCRM is not an OpenAI `/v1` API, its SSE is a Codex subset without official `event:` lines, and auth is a session token plus `x-geocrm-provider`, not a vendor key.

## Decision

`@deepseek-ai/dsh-llm-geocrm` owns the `geocrm` route. It speaks GeoCRM's existing harness contract and does not change any file under the GeoCRM repository.

The `electron` profile overlay disables `llm-deepseek` and `web-search-deepseek`, inserts `llm-geocrm`, and sets `agent-default-model` to `provider: geocrm` / `model: deepseek:deepseek-v4-flash`. `dsh web` and headless keep `deepseek-official`.

Picker ids are composite `provider:model` values because GeoCRM catalog ids can collide across slugs. The adapter sends the slug as `x-geocrm-provider` and the vendor id as `model`. The Models card (`llm-geocrm`) stores the session token under `GEOCRM_HARNESS_TOKEN` and the origin under `baseURL` (default `http://127.0.0.1:3001`).

`packages/client/ui-settings-models` maps `llm-geocrm` to a curated editor: GeoCRM employee-id or email sign-in (public `POST /auth/password` and `POST /auth/public/resolve-employee-id`), a write-only token paste fallback, customizable origin, and the shared model-list editor so Fetch can call registered discovery. After sign-in the card probes `POST /ai/harness/tools/list_my_access` and shows whether `desktop_agent` is granted.

`@deepseek-ai/dsh-tool-geocrm` registers first-party GeoCRM Harness tools on the electron host plane (`list_my_access`, `list_entities`, search/count/summarize, create/update/delete). Each call posts to `/ai/harness/tools/{name}` with the stored JWT. Upload tools stay in GeoCRM. `dsh web` and headless do not mount this row.

## Testing

- `packages/llm/llm-geocrm/tests` cover catalog ids, HTTP mapping, Responses translation, adapter fetch, and plugin `apply`.
- `packages/client/ui-settings-models/tests` cover the GeoCRM placeholders, sign-in HTTP, and `desktop_agent` probe.
- `packages/llm/tool-geocrm/tests` cover connection resolution, token resolution, and harness tool POST.

## Alternatives considered

**Point `deepseek-official` at the GeoCRM origin.** Rejected: the official adapter posts `/chat/completions` and parses OpenAI SSE. GeoCRM has neither path.

**Reuse `llm-pi-ai` with `openai-responses` and `baseURL: …/ai/harness`.** Rejected: pi-ai uses the official OpenAI Responses SDK, which expects `event:` lines and token deltas. GeoCRM writes `data:` JSON for a complete turn and at most one tool call.

**Add `/v1` to GeoCRM so an existing adapter works.** Rejected: the GeoCRM tree is out of scope; the working Electron Codex host already posts `{apiBase}/ai/harness/responses` with `GEOCRM_HARNESS_TOKEN` and `x-geocrm-provider`.

**Put the adapter inside `dsh-electron-app`.** Rejected: adapters belong in `packages/llm/*` so the Host LLM seam stays the registration point and the package keeps its own 100% `src` coverage.

## Consequences

- Desktop Settings → Models shows GeoCRM, not DeepSeek. The operator signs in with a GeoCRM employee ID or email (or pastes a session JWT); vendor keys stay in GeoCRM Settings; the user needs `desktop_agent`.
- Every electron session inherits GeoCRM CRM tools. GeoCRM ACL refuses reads and writes the signed-in user cannot perform. Isolation overlays disable `tool-geocrm` so e2e catalogs stay free of that origin.
- Web search on the desktop profile has no DeepSeek search provider. `web_fetch` still uses `http`.
- Composite model ids (`deepseek:deepseek-v4-flash`) are what the composer and `agent-default-model` store. A bare colliding id is refused.
- Expired JWTs fail the next request with `AUTH`. GeoCRM does not refresh tokens for this Host.
