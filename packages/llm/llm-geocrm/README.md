---
description: "The GeoCRM BYOK Responses adapter for users and maintainers configuring the desktop geocrm route."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-geocrm

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-llm-geocrm` is the GeoCRM adapter for the harness LLM service: it owns the `geocrm` provider route and translates GeoCRM's Codex-subset Responses SSE into the harness stream-chunk protocol. The desktop profile mounts it so the Models page can sign in to GeoCRM (or store a session token) and talk to a local or deployed `geocrm-api` origin. Vendor API keys stay in GeoCRM Settings; this adapter never sends them. Connection facts — origin, advisory catalog, token — resolve per request, so editing the user settings document changes the next request without a restart.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when a composition streams models through GeoCRM's BYOK gateway instead of a vendor origin. It registers the single `geocrm` route and resolves connection facts per request.

### When to choose it

Choose this adapter when the Host should call `GET /ai/models?client=electron` and `POST /ai/harness/responses` on a GeoCRM API origin, authenticated with a Supabase session JWT (`GEOCRM_HARNESS_TOKEN`). Choose `dsh-llm-deepseek` when the composition talks to DeepSeek's official chat-completions API. Registering any other adapter for `geocrm` fails with `DUPLICATE_ADAPTER`.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-llm-geocrm'
  config:
    apiKeyEnv: GEOCRM_HARNESS_TOKEN
    baseURL: http://127.0.0.1:3001
```

A request selects the route with `provider: geocrm`. Model ids are composite `provider:model` values (for example `deepseek:deepseek-v4-flash`) so catalog ids that collide across GeoCRM providers stay distinct. The adapter sends the slug as `x-geocrm-provider` and the vendor id as `model`. Omitted `models` advertises the static flagships (ChatGPT, Gemini, Claude, Grok, DeepSeek). A live catalog fetch replaces that list when a token is present.

| Field | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | `GEOCRM_HARNESS_TOKEN` | Credential reference resolved per request through the credentials seam, then the environment |
| `baseURL` | `http://127.0.0.1:3001` | GeoCRM API origin; no `/ai` suffix. `$GEOCRM_BASE_URL` or `$GEOCRM_DEPLOYMENT_DOMAIN` in `.env` win over this field |
| `models` | static flagships | Advisory catalog shown when a live fetch is unavailable |
| `defaultContextWindow` | `200,000` | Capacity fallback for models without an exact value |
| `streamIdleTimeoutMs` | `300,000` | Maximum provider idle time per outstanding stream read |
| `retryPolicy` | normal, 5 retries | Provider-owned retry policy executed by `dsh-llm-retry` |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-llm-geocrm) is the exhaustive source for every accepted field and its JSDoc.

The token must belong to a GeoCRM user who has `desktop_agent` and BYOK keys stored in GeoCRM Settings. Put the VPS origin in the invoking directory `.env` as `GEOCRM_BASE_URL=https://api.example.com` or `GEOCRM_DEPLOYMENT_DOMAIN=example.com` (same host GeoCRM Electron stores as `VITE_DEPLOYMENT_DOMAIN`). The window cover stores a refresh token from GeoCRM `POST /auth/password` (employee ID resolves first) or from desktop Google sign-in. Before a request whose access JWT is within five minutes of `exp`, this plugin calls `POST /auth/refresh`. A 401/403 is `AUTH`; a 422 `missing_api_key` is `INVALID_REQUEST` (add the vendor key in GeoCRM, not here). `listModels` asks `GET /ai/settings/configured` for which vendors have a key (DeepSeek included). If that route is absent it reads `POST /ai/settings/connectivity` the same way. Vendors without a key are omitted from the composer. Discovery returns the full catalog and stamps `geocrm:not-configured` on those rows so Settings can show Not Configured. An expired access JWT with no refresh token is `AUTH`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is a direct-fetch adapter. `apply` registers the `geocrm` route, the `llm-geocrm` settings section, and model discovery. Each request resolves the origin and JWT, maps harness messages onto GeoCRM Responses `input` / `tools` / `instructions`, and parses complete-turn `data:` SSE (`response.output_item.done`, then `response.completed`) into one text block or one tool-call block.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin `apply`, `Config`, and per-request option resolution |
| [`src/origin.ts`](src/origin.ts) | `$GEOCRM_BASE_URL` / `$GEOCRM_DEPLOYMENT_DOMAIN` origin resolution |
| [`src/session.ts`](src/session.ts) | Access/refresh rotation through `POST /auth/refresh` |
| [`src/adapter.ts`](src/adapter.ts) | `GeoCrmAdapter`: catalog fetch, Responses POST, idle watchdog |
| [`src/catalog.ts`](src/catalog.ts) | Composite ids, static flagships, catalog JSON |
| [`src/keys.ts`](src/keys.ts) | BYOK key presence from `GET /ai/settings/configured` and connectivity |
| [`src/translate.ts`](src/translate.ts) | Harness messages to Responses body; SSE to stream chunks |
| [`src/http.ts`](src/http.ts) | Origin normalization and HTTP error codes |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) — the harness stream-chunk protocol this adapter emits.
- [dsh-llm-deepseek](../llm-deepseek/README.md) — the official DeepSeek chat-completions adapter used by `dsh web`.
- [dsh-electron-app](../../bundle/electron-app/README.md) — the desktop profile that mounts this plugin and hides `llm-deepseek`.
- [Twin LLM adapters](../../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md) — why official DeepSeek and library-backed routes stay separate.
- [Electron GeoCRM gateway](../../../.agents/notes/implemented/architecture/2026-09-05-electron-geocrm-llm-gateway.md) — why the desktop Models page stores a session token instead of a vendor key.

-----

<a id="model-experience"></a>
## Model Experience

### Responses request body

#### What the model sees

GeoCRM receives `instructions` (the loop system prompt plus any extra system-role history), `input` (user and assistant text as `input_text` messages, assistant tool calls as `function_call`, and tool results as `function_call_output`), and `tools` as `function` items. Image, file, and reasoning blocks are dropped. A `sessionId` becomes `prompt_cache_key`. Reasoning effort `off` is omitted; `max` is sent as `high`.

#### Token effect

Output tokens follow the selected GeoCRM catalog model and that vendor's completion. This adapter does not add prompt sections of its own.

#### KV Cache effect

`prompt_cache_key` is stable for the life of a session when the loop supplies `sessionId`. Changing the composite model id or `x-geocrm-provider` selects a different vendor cache domain. GeoCRM itself does not stream token deltas; one complete turn arrives as a single text or tool-call block.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Complete-turn SSE, not token deltas** — GeoCRM writes `data:` JSON without official `event:` lines and emits at most one tool call per turn.
- **Images and files are not sent** — durable image and file blocks stay in the session log and become empty text on the wire.
- **JWT and BYOK are separate** — this card stores the GeoCRM session pair; a pasted access JWT without a refresh token still expires, and a missing vendor key in GeoCRM Settings fails with `INVALID_REQUEST`.
- **Requests use raw `fetch`** — no shared proxy or interception configuration.
- **Plugin-added content block types are skipped** — only core text, tool-call, and tool-result blocks are serialized.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context. Shipped behavior lives in the sections above and the linked Agent Note.

- Do not point `deepseek-official` at a GeoCRM origin. GeoCRM is not an OpenAI `/v1` API.
- Do not add `/v1` compatibility to GeoCRM; this adapter speaks `/ai/harness/responses`. Session rotation uses `POST /auth/refresh`.

</details>

**Runtime invariant:** No companion is published. This package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam.
