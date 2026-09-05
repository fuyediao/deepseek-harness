---
description: "Model-facing GeoCRM Harness CRM tools: the signed-in user's list_my_access, search, and record writes over POST /ai/harness/tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-geocrm

English | [中文](README.zh.md)

## Summary

With `dsh-tool-geocrm`, the desktop agent can read and write GeoCRM data as the signed-in user: list grants, list entities, search and count rows, summarize periods, and create, update, or delete records. GeoCRM enforces `desktop_agent` and per-entity write grants on every call. Choose it on the Electron profile when the window is signed in to GeoCRM; `dsh web` and headless do not mount it. Upload tools are omitted.

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

Mount this plugin on a Host that already stores a GeoCRM session pair (`GEOCRM_HARNESS_TOKEN` and `GEOCRM_HARNESS_REFRESH`) and can reach a `geocrm-api` origin. The Electron bundle does that: the window cover signs in, then these tools post to `/ai/harness/tools/{name}` with a live JWT.

### When to choose it

Choose it when a desktop session should use the same CRM ACL as GeoCRM Harness. Do not mount it on `dsh web` or headless: those profiles still use `deepseek-official` and have no GeoCRM login. Do not send vendor API keys through these tools; vendor keys stay in GeoCRM Settings.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-tool-geocrm'
```

Origin and token reference default to the same values as `dsh-llm-geocrm`, including `$GEOCRM_BASE_URL` / `$GEOCRM_DEPLOYMENT_DOMAIN`. When the `llm-geocrm` settings section is registered, its live `apiKeyEnv` still applies; a launch-environment origin wins over a stored `baseURL`.

| Field | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | `GEOCRM_HARNESS_TOKEN` | Credential reference resolved per call |
| `baseURL` | `http://127.0.0.1:3001` | GeoCRM API origin; no `/ai` suffix |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-geocrm) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each registered tool is a thin HTTP proxy. `execute` resolves the origin and a live JWT (refreshing through `POST /auth/refresh` when `exp` is near), posts `{ arguments }` to `/ai/harness/tools/{name}`, and returns GeoCRM's result text. Entity enums stay open: GeoCRM refuses an entity the caller cannot read or write. Upload tools (`upload_file`, `prepare_upload`, `finalize_upload`, `delete_file`, `list_upload_kinds`) are not registered.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin `apply`, connection resolution, token resolution |
| [`src/catalog.ts`](src/catalog.ts) | Tool names, descriptions, and parameter schemas |
| [`src/http.ts`](src/http.ts) | Harness tool POST and error text |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-llm-geocrm](../llm-geocrm/README.md) — the desktop `geocrm` model route that stores the same session token.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-geocrm) — the schemas the model receives.
- [Electron GeoCRM gateway](../../../.agents/notes/implemented/architecture/2026-09-05-electron-geocrm-llm-gateway.md) — why desktop chat signs in to GeoCRM.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [GeoCRM tool schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-geocrm): `list_my_access`, `list_entities`, `search_records`, `get_record`, `count_records`, `summarize_records`, `create_record`, `update_record`, and `delete_record`. Descriptions tell the model to call `list_my_access` then `list_entities` before reads or writes.

#### Token effect

Each successful call returns GeoCRM's result text as one model-facing text block. Failed calls surface GeoCRM's error text, including `harness_forbidden` when `desktop_agent` is missing.

#### KV Cache effect

Tool schemas are a stable prefix for the life of the mount. A changed origin or token does not change the schemas; only the next execute uses the new connection.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Upload tools are omitted** — file upload, prepare/finalize, and delete-file stay in GeoCRM Harness, not this Host.
- **Entity enums are open** — ACL is enforced by GeoCRM, not by a filtered schema enum.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context. Shipped behavior lives in the sections above and the linked Agent Note.

- Do not route these tools through public MCP or `gcrm_mcp_*` keys. The desktop Host uses `/ai/harness/tools` plus the user JWT.
- Do not add `/v1` or MCP keys to this path; this package speaks `/ai/harness/tools` plus the user JWT. Session rotation is owned by `dsh-llm-geocrm`.

</details>

**Runtime invariant:** No companion is published. This package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam.
