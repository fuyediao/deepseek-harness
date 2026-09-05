# Agent Note: Desktop Models page uses GeoCRM as the LLM gateway

Status: implemented

English | [中文](2026-09-05-electron-geocrm-llm-gateway.zh.md)

## Problem

The shipped Electron Models page registered `llm-deepseek` (`deepseek-official`) and asked for a DeepSeek API key. The operator already runs a GeoCRM BYOK backend that stores vendor keys, issues a Supabase session JWT, and exposes `GET /ai/models?client=electron` plus `POST /ai/harness/responses`. Pointing `deepseek-official` at that origin fails: GeoCRM is not an OpenAI `/v1` API, its SSE is a Codex subset without official `event:` lines, and auth is a session token plus `x-geocrm-provider`, not a vendor key.

## Decision

`@deepseek-ai/dsh-llm-geocrm` owns the `geocrm` route. It speaks GeoCRM's existing harness contract. Password sign-in stores `GEOCRM_HARNESS_TOKEN` and `GEOCRM_HARNESS_REFRESH`. Before a request whose access JWT is within five minutes of `exp`, the Host calls GeoCRM `POST /auth/refresh` and writes the rotated pair. That public route is the one GeoCRM addition this Host needs: GoTrue refresh requires the server-side anon key, which this repository does not ship.

The `electron` profile overlay disables `llm-deepseek` and `web-search-deepseek`, inserts `llm-geocrm`, and sets `agent-default-model` to `provider: geocrm` / `model: deepseek:deepseek-v4-flash`. `dsh web` and headless keep `deepseek-official`.

Picker ids are composite `provider:model` values because GeoCRM catalog ids can collide across slugs. The adapter sends the slug as `x-geocrm-provider` and the vendor id as `model`. The Models card (`llm-geocrm`) stores the session token under `GEOCRM_HARNESS_TOKEN`. The API origin comes from the launch environment (`GEOCRM_BASE_URL`, or `GEOCRM_DEPLOYMENT_DOMAIN` as `https://api.{domain}`), then an explicit settings `baseURL`, then `http://127.0.0.1:3001`.

`packages/client/ui-settings-models` maps `llm-geocrm` to a curated editor: GeoCRM employee-id or email sign-in (public `POST /auth/password` and `POST /auth/public/resolve-employee-id`), desktop Google sign-in (`GET /auth/google` in the system browser, tokens returned on a short-lived `127.0.0.1` loopback), a write-only token paste fallback, customizable origin, and the shared model-list editor so Fetch can call registered discovery. After sign-in the card probes `POST /ai/harness/tools/list_my_access` and shows whether `desktop_agent` is granted. `dsh web` has no Electron preload, so that page hides the Google button.

The Electron window occupies `shell.gate` before the conversation shell is usable. The browser Loader creates client entries without yml config, so the cover keys off the `dsh-app:` renderer protocol (tests pass `requireSignIn`). A stored `GEOCRM_HARNESS_TOKEN` skips the panel. A fresh sign-in without `desktop_agent` clears the tokens and stays on the panel. Sign-out from the Models card returns to the panel. `dsh web` leaves `shell.gate` empty. `shell.gate` and `shell.overlay` span the full AppFrame grid so the cover can center a product card over the window; without that span an absolutely positioned occupant only fills the sidebar column.

The desktop product name is GeoCRM Harness: native window title, NSIS `productName`, sidebar brand occupants (priority `-10`, so they shadow the official DeepSeek mark), the GeoCRM map-pin mark, sign-in cover, desktop welcome notice, `dsh electron` help text, and the `app:electron-surface` prompt. Package names, the `dsh` CLI verb, and `dsh web` keep DeepSeek Harness.

`@deepseek-ai/dsh-tool-geocrm` registers first-party GeoCRM Harness tools on the electron host plane (`list_my_access`, `list_entities`, search/count/summarize, create/update/delete). Each call posts to `/ai/harness/tools/{name}` with the stored JWT. Upload tools stay in GeoCRM. `dsh web` and headless do not mount this row.

## Testing

- `packages/llm/llm-geocrm/tests` cover catalog ids, HTTP mapping, Responses translation, adapter fetch, plugin `apply`, and session refresh.
- `packages/client/ui-settings-models/tests` cover the GeoCRM placeholders, sign-in HTTP, Google desktop invoke, refresh-token persist, `desktop_agent` probe, the `shell.gate` cover, and desktop brand occupancy.
- `apps/electron/tests/window-chrome.spec.ts` rewrites the official frontend title suffix and the local-build fallbacks (`DSH Local Build`, `DSH 本地构建`) to GeoCRM Harness. `apps/electron/tests/google-sign-in.spec.ts` covers the loopback authorize URL, CSRF state, and token POST.
- `packages/llm/tool-geocrm/tests` cover connection resolution, token resolution, and harness tool POST.

## Alternatives considered

**Point `deepseek-official` at the GeoCRM origin.** Rejected: the official adapter posts `/chat/completions` and parses OpenAI SSE. GeoCRM has neither path.

**Reuse `llm-pi-ai` with `openai-responses` and `baseURL: …/ai/harness`.** Rejected: pi-ai uses the official OpenAI Responses SDK, which expects `event:` lines and token deltas. GeoCRM writes `data:` JSON for a complete turn and at most one tool call.

**Add `/v1` to GeoCRM so an existing adapter works.** Rejected: the working Electron Codex host already posts `{apiBase}/ai/harness/responses` with `GEOCRM_HARNESS_TOKEN` and `x-geocrm-provider`.

**Refresh GoTrue from this Host with a copied anon key.** Rejected: extra operator config. `POST /auth/refresh` already holds the anon key.

**Refresh only while the access JWT is still valid, using it as the GoTrue `apikey`.** Rejected: overnight idle still forces sign-in.

**Put the adapter inside `dsh-electron-app`.** Rejected: adapters belong in `packages/llm/*` so the Host LLM seam stays the registration point and the package keeps its own 100% `src` coverage.

**Keep sign-in only on Settings → Models.** Rejected: the desktop window must not open the conversation shell before a GeoCRM session exists.

**Reuse `com.geocrm.electron://login-callback`.** Rejected: that scheme belongs to GeoCRM Electron. Registering it here would steal the other app's OAuth return.

**Run Google OAuth inside an Electron `BrowserWindow`.** Rejected: Google refuses OAuth in embedded browsers. The system browser plus a loopback `next` matches RFC 8252 and needs no GoTrue redirect allow-list change (`redirect_to` stays `{api}/auth/callback`).

## Consequences

- The desktop window shows a GeoCRM Harness sign-in panel before the conversation shell. Continue with Google opens the system browser; employee ID / email stay on the card. The taskbar, title bar, and sidebar show GeoCRM Harness. Settings → Models still shows GeoCRM, not DeepSeek, for sign-out and token paste. Vendor keys stay in GeoCRM Settings; the user needs `desktop_agent`.
- Every electron session inherits GeoCRM CRM tools. GeoCRM ACL refuses reads and writes the signed-in user cannot perform. Isolation overlays disable `tool-geocrm` so e2e catalogs stay free of that origin.
- Web search on the desktop profile has no DeepSeek search provider. `web_fetch` still uses `http`.
- Composite model ids (`deepseek:deepseek-v4-flash`) are what the composer and `agent-default-model` store. A bare colliding id is refused.
- The Host keeps a password or Google sign-in alive through `POST /auth/refresh`. A pasted access JWT without a refresh token still expires. A revoked refresh token fails the next request with `AUTH`.
