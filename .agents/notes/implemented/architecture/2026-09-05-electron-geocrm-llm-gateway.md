# Agent Note: Desktop Models page uses GeoCRM as the LLM gateway

Status: implemented

English | [中文](2026-09-05-electron-geocrm-llm-gateway.zh.md)

## Problem

The shipped Electron Models page registered `llm-deepseek` (`deepseek-official`) and asked for a DeepSeek API key. The operator already runs a GeoCRM BYOK backend that stores vendor keys, issues a Supabase session JWT, and exposes `GET /ai/models?client=electron` plus `POST /ai/harness/responses`. Pointing `deepseek-official` at that origin fails: GeoCRM is not an OpenAI `/v1` API, its SSE is a Codex subset without official `event:` lines, and auth is a session token plus `x-geocrm-provider`, not a vendor key.

## Decision

`@deepseek-ai/dsh-llm-geocrm` owns the `geocrm` route. It speaks GeoCRM's existing harness contract. Password sign-in stores `GEOCRM_HARNESS_TOKEN` and `GEOCRM_HARNESS_REFRESH`. Before a request whose access JWT is within five minutes of `exp`, the Host calls GeoCRM `POST /auth/refresh` and writes the rotated pair. That public route is the one GeoCRM addition this Host needs: GoTrue refresh requires the server-side anon key, which this repository does not ship.

The `electron` profile overlay disables `llm-deepseek` and `web-search-deepseek`, inserts `llm-geocrm`, and sets `agent-default-model` to `provider: geocrm` / `model: deepseek:deepseek-v4-flash`. `dsh web` and headless keep `deepseek-official`.

Picker ids are composite `provider:model` values because GeoCRM catalog ids can collide across slugs. The adapter sends the slug as `x-geocrm-provider` and the vendor id as `model`. The Models card (`llm-geocrm`) stores the session token under `GEOCRM_HARNESS_TOKEN`. The API origin comes from the launch environment (`GEOCRM_BASE_URL`, or `GEOCRM_DEPLOYMENT_DOMAIN` as `https://api.{domain}`), then an explicit settings `baseURL`, then `http://127.0.0.1:3001`.

`packages/client/ui-settings-models` maps `llm-geocrm` to a curated editor: a session bar (Sign out returns to the window cover), a live catalog (search, refresh, `Vendor · name` rows, Not Configured badges, enable toggles on keyed vendors) that writes `models[]` as the composer allowlist, and Customized settings for origin plus a write-only token paste fallback. On the desktop renderer the Models page uses catalog copy, hides Add provider / Add a custom provider, and opens the GeoCRM card so the allowlist is visible. The composer and `/model` popup split `geocrm` composite ids into vendor groups in GeoCRM Electron order (OpenAI, Google, Anthropic, xAI, then the rest) and show `Vendor · model` on the trigger; selection still stores `provider: geocrm`. `listModels` reads BYOK presence from `GET /ai/models` (`configured` ids or per-row flags) first, then `GET /ai/settings/configured`, then `POST /ai/settings/connectivity`, and keeps only vendors with a key. A customized `models[]` that is not the adapter default flagships further cuts that list. Discovery returns the full catalog and stamps `description: geocrm:not-configured` on vendors with no key. Discovery without a pasted key uses the stored session token; an expired access JWT with no refresh token is `AUTH`. A Responses POST is refused locally when presence says the vendor has no key. A failed or unrecognized presence body on an unstamped catalog leaves the catalog listed without the stamp. Employee-id or email sign-in (public `POST /auth/password` and `POST /auth/public/resolve-employee-id`) and desktop Google sign-in (`GET /auth/google` in the system browser, tokens returned on a short-lived `127.0.0.1` loopback) live on the window cover. After cover sign-in the cover probes `POST /ai/harness/tools/list_my_access` and keeps the window locked unless `desktop_agent` is granted. `dsh web` does not mount this card.

The Electron window occupies `shell.gate` before the conversation shell is usable. The browser Loader creates client entries without yml config, so the cover keys off the `dsh-app:` renderer protocol (tests pass `requireSignIn`). A stored `GEOCRM_HARNESS_TOKEN` skips the panel. A fresh sign-in without `desktop_agent` clears the tokens and stays on the panel. Sign-out from the Models card returns to the panel. `dsh web` leaves `shell.gate` empty. `shell.gate` and `shell.overlay` span the full AppFrame grid so the cover can center a product card over the window; without that span an absolutely positioned occupant only fills the sidebar column.

The desktop product name is GeoCRM Harness: native window title, NSIS `productName`, sidebar brand occupants (priority `-10`, so they shadow the official DeepSeek mark), the GeoCRM map-pin mark (transparent pin, no tile), the blank-session hero (transparent pin, no DeepSeek headline or preview pill), sign-in cover, desktop welcome notice, `dsh electron` help text, and the `app:electron-surface` prompt. Package names, the `dsh` CLI verb, and `dsh web` keep DeepSeek Harness.

`@deepseek-ai/dsh-tool-geocrm` registers first-party GeoCRM Harness tools on the electron host plane (`list_my_access`, `list_entities`, search/count/summarize, create/update/delete) and the `tool:geocrm` prompt section. Each call posts to `/ai/harness/tools/{name}` with the stored JWT. The section tells the model to call `list_my_access` then `list_entities` before any CRM read or write, prefer `summarize_records` for period reports, and write only when `list_entities` lists the grant. GeoCRM ACL remains the authority; entity enums stay open. Upload tools stay in GeoCRM. `dsh web` and headless do not mount this row. The electron deployment persona names the GeoCRM Harness work agent. The shipped `standard` preset still shadows that persona with a coding-agent line; the host-plane section is what default desktop sessions keep.

## Testing

- `packages/llm/llm-geocrm/tests` cover catalog ids, HTTP mapping, Responses translation, adapter fetch, plugin `apply`, session refresh, and BYOK presence from `GET /ai/models` and `GET /ai/settings/configured`.
- `packages/client/ui-settings-models/tests` cover the GeoCRM session bar, the live catalog (search, refresh, toggles, Not Configured, AUTH), cover sign-in HTTP, Google desktop invoke, refresh-token persist, `desktop_agent` probe, the `shell.gate` cover, and desktop brand occupancy including the blank-session hero.
- `apps/electron/tests/window-chrome.spec.ts` rewrites the official frontend title suffix and the local-build fallbacks (`DSH Local Build`, `DSH 本地构建`) to GeoCRM Harness. `apps/electron/tests/google-sign-in.spec.ts` covers the loopback authorize URL, CSRF state, token POST, and a late request after the listener closes.
- `packages/llm/tool-geocrm/tests` cover connection resolution, token resolution, harness tool POST, and the `tool:geocrm` prompt section.

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

**Filter the Host tool schema from `list_my_access`.** Rejected: GeoCRM Electron advertises the full first-party set. GeoCRM refuses unauthorized entities and writes.

**Change the shared `standard` preset persona.** Rejected: `dsh web` uses the same preset and is not a GeoCRM work agent.

**Ship a duplicate electron-only `geocrm` preset as the default.** Rejected: it would copy the entire `standard` composition. The host-plane `tool:geocrm` section is the work-agent block default sessions keep.

**Put vendor key fields on the desktop Models card.** Rejected: GeoCRM Settings remains the BYOK bag. Harness only shows whether a key is present.

**Reuse the id/name model-list editor for GeoCRM.** Rejected: that editor shows adapter-default rows, not the live allowlist.

**Hide unkeyed vendors from the Settings catalog.** Rejected: the catalog still lists them as Not Configured. They have no enable toggle and cannot be used. The composer omits them.

**Add `GET /ai/settings/configured` to GeoCRM.** Accepted: it returns provider ids that have a key and never the secret. Connectivity remains the fallback when that route is absent.

## Consequences

- The desktop window shows a GeoCRM Harness sign-in panel before the conversation shell. Continue with Google opens the system browser; employee ID / email stay on that panel. The taskbar, title bar, sidebar, and blank-session hero show GeoCRM Harness. Settings → Models still shows GeoCRM, not DeepSeek: catalog copy, the opened GeoCRM card with the live catalog, Sign out, and a token-paste fallback under Customized. It does not offer Add provider. The Settings catalog lists every GeoCRM model; vendors without a key show Not Configured and cannot be enabled. The composer lists only enabled models whose vendor has a GeoCRM key, including DeepSeek. Vendor keys stay in GeoCRM Settings; the user needs `desktop_agent`.
- Every electron session inherits GeoCRM CRM tools and the `tool:geocrm` section. GeoCRM ACL refuses reads and writes the signed-in user cannot perform. Isolation overlays disable `tool-geocrm` so e2e catalogs stay free of that origin.
- Web search on the desktop profile has no DeepSeek search provider. `web_fetch` still uses `http`.
- Composite model ids (`deepseek:deepseek-v4-flash`) are what the composer and `agent-default-model` store. A bare colliding id is refused.
- The Host keeps a password or Google sign-in alive through `POST /auth/refresh`. A pasted access JWT without a refresh token still expires. An expired access JWT with no refresh token is `AUTH` on the next discovery or request. A revoked refresh token fails the next request with `AUTH`.
