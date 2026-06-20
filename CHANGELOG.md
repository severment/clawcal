# Changelog

All notable changes to ClawCal are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## Compatibility Notes

### OpenClaw v2026.5.2 → v2026.6.6 (current)

Reviewed against every stable release from [v2026.3.13](https://github.com/openclaw/openclaw/releases/tag/v2026.3.13-1) through [v2026.6.6](https://github.com/openclaw/openclaw/releases/tag/v2026.6.6) (latest stable, 2026-06-12), **and verified end-to-end by installing ClawCal into a real v2026.6.6 gateway, booting it, and curling the feed** — not by reviewing release notes alone. The runtime check caught **three** breaks that paper review (and the prior v2026.3.11/3.12 "assessments") missed entirely. **The blunt finding: ClawCal was effectively non-functional on every previously-"assessed" version** — the feed was unreachable and event capture silently never ran. On v2026.6.6 the plugin failed to load at all.

**Breaking changes that required action (all found by running the gateway, none mentioned in release notes):**

- **`registerHook` requires a `name` — and now *throws* without one, aborting the whole plugin load.** `api.registerHook(events, handler, opts)` requires `opts.name`. In v2026.3.11 a missing name was a *warning* and the hook was silently **skipped** (so ClawCal's five event listeners never registered — passive event capture never worked). By v2026.6.6 this became a hard **throw** (`hook registration missing name`) that aborts `register()` before any route or tool is registered — so the entire plugin fails to load. ClawCal called `registerHook(event, handler)` with no opts on all five hooks. **Fixed:** each hook now passes a unique `{ name: 'clawcal:…' }`; the local `HookSource`/`PluginApi` type stubs now require it so `tsc` enforces it. **Verified:** plugin loads cleanly on v2026.6.6 (appears in the gateway's plugin list, no diagnostics).

- **HTTP route registration requires an explicit `auth` field — feed routes were silently rejected.** `api.registerHttpRoute(...)` requires `auth: "gateway" | "plugin"`; the gateway rejects any route without it (`http route registration missing or invalid auth`) and does **not** register it. All four ClawCal routes omitted `auth`, so **the calendar feed was never reachable** on any enforcing gateway (confirmed present in both v2026.3.11 and v2026.6.6 — predates the assessed range). ClawCal's local `PluginApi` type stub also wrongly declared `auth?` as optional, so `tsc` never flagged it. **Fixed:** all four routes now pass `auth: 'plugin'` (ClawCal owns auth via its own `checkAuth`); stub now typed as required `'gateway' | 'plugin'`. **Verified:** `GET /clawcal/feed.ics` → `200` with valid `text/calendar`; with `gateway.auth.mode: token` in config, no/wrong token → `401`, correct Bearer **and** calendar-app Basic auth → `200`.

- **Plugin tool registration now requires manifest ownership (v2026.5.2)** — OpenClaw enforces `contracts.tools` as the manifest ownership contract for `api.registerTool(...)` and **rejects undeclared runtime tool names**. ClawCal registers `clawcal_schedule`, which was not declared, so the tool would be rejected on v2026.5.2+. **Fixed:** `openclaw.plugin.json` now declares `"contracts": { "tools": ["clawcal_schedule"] }`. The passive event-listener/HTTP-feed path was unaffected — only the active `clawcal_schedule` tool.
- **Implicit plugin startup loading deprecated (v2026.4.27)** — Plugins that register startup-time runtime surfaces must declare `activation.onStartup`. Implicit startup loading now emits a compatibility warning and can be disabled via an opt-in future-mode gate. ClawCal registers its HTTP routes and event hooks at startup. **Fixed:** `openclaw.plugin.json` now declares `"activation": { "onStartup": true }`.

**Assessed and not affected:**

- **`api.resolvePath` resolves relative inputs against the plugin root (v2026.4.29)** — Absolute and `~`-home paths are unchanged. ClawCal's default `file_directory` is `~/.openclaw/clawcal/` (home path), so the default is unaffected. Only a user-supplied *relative* `file_directory` would now anchor to the plugin root instead of the host cwd. **Not a code break — documented edge case.**
- **Plugin HTTP route scopes tightened (v2026.3.31, v2026.4.5)** — Gateway-authenticated plugin routes default to read-only/write-only fallback scopes; plugin handlers no longer mint admin-level runtime scopes. ClawCal serves a read-only `.ics` feed and implements its own auth (`checkAuth`), so it never relied on elevated runtime scopes. **Not affected.**
- **Trusted-proxy / local-direct auth fail-closed tightening (v2026.3.31, v2026.5.12, v2026.5.19)** — Gateway core no longer implicitly trusts same-host callers. ClawCal's `checkAuth` requires explicit credentials/headers in every mode (token, password, trusted-proxy) and never assumed implicit local trust. **Not affected.**
- **Per-request bearer resolution on plugin HTTP routes (v2026.4.15)** — Rotated gateway secrets now invalidate promptly on plugin routes like ClawCal's feed. **Beneficial — no change required.**
- **HTTP-route registry pinned across plugin-registry churn (v2026.3.22)** — `registerHttpRoute` routes survive plugin reloads more reliably. **Beneficial.**
- **Plugin tool descriptor caching (v2026.5.2)** — Descriptors captured from `api.registerTool(...)` are cached for prompt-time planning; the live tool still loads on execution. Registration contract unchanged. **Beneficial (faster planning).**
- **SQLite-backed install/trust/auth-profile durability (v2026.6.1, v2026.6.5, v2026.6.6)** — Plugin install records and trusted pins persist across reloads. Protects a globally-installed ClawCal's trust state. **Beneficial.**
- **`registerEmbeddedExtensionFactory` removed (v2026.4.24)** — Pi-only tool-result middleware path. ClawCal does not use it. **Not affected.**
- **Event names unchanged** — None of the five events ClawCal hooks (`agent:schedule`, `agent:task:complete`, `cron:register`, `agent:schedule:update`, `agent:schedule:cancel`) were renamed or removed. (The `registerHook` *registration* contract did change — see the `name` requirement above.)

**End-to-end verification (real v2026.6.6 gateway):**

Installed the rebuilt ClawCal into a sandboxed gateway (`openclaw plugins install`, isolated `OPENCLAW_STATE_DIR`), booted `openclaw gateway run`, and exercised the live HTTP server:

- Plugin loads cleanly — listed among loaded plugins, **no** `failed during register` / `missing name` / `contracts` / `invalid auth` diagnostics.
- `GET /clawcal/feed.ics` → `200`, `Content-Type: text/calendar`, valid `BEGIN:VCALENDAR … END:VCALENDAR`.
- `GET /clawcal/feeds` → `200` JSON feed index.
- With `gateway.auth.mode: token` set **in the config file**: no token → `401`, wrong token → `401`, correct `Authorization: Bearer` → `200`, calendar-app `Basic` auth → `200`.

> **Auth caveat (worth documenting for users):** ClawCal's routes use `auth: 'plugin'`, so the gateway forwards every request and ClawCal's own `checkAuth` enforces credentials by reading `config.gateway.auth`. That reads the **config file**, not the gateway's `--auth` *CLI flag* — starting the gateway with `--auth token` but no `gateway.auth` in config leaves the feed open. Configure gateway auth in the config (e.g. via `openclaw configure`) for the feed to be protected. Also set `plugins.allow: ["clawcal"]` in production to explicitly trust the plugin (the gateway warns when `plugins.allow` is empty).

> **Minimum version note:** The `contracts.tools` and `activation.onStartup` manifest fields are ignored by older gateways, so the manifest stays backward-compatible to the v2026.3.2 floor. But the `registerHook` name and `registerHttpRoute` auth requirements mean **the previous "works on v2026.3.11/3.12" claims were wrong** — ClawCal needs the fixes in this release to actually function on any of those versions.

### OpenClaw v2026.3.12

Reviewed against the [v2026.3.12 release](https://github.com/openclaw/openclaw/releases/tag/v2026.3.12). No breaking changes affect ClawCal.

**Assessed areas:**

- **Security/plugins: implicit workspace auto-load disabled** — Workspace plugins now require an explicit trust decision before loading (GHSA-99qw-6mr3-36qr). ClawCal installed via `openclaw plugins install` (global) is unaffected. Workspace installs (`.openclaw/plugins/`) will prompt for trust on first load. **Not a code break — UX change only. Documented in README.**
- **Cron/proactive delivery fix** — Isolated direct cron sends no longer replay through the write-ahead resend queue after restart. ClawCal only listens to `cron:register` events, not delivery. **Not affected (may reduce duplicate entries from cron replay).**
- **Plugins/env-scoped roots** — Plugin discovery/load caches and provenance tracking fixed so HOME changes no longer reuse stale state. **Not affected (potentially beneficial).**
- **Hooks/agent deliveries** — Dedupe repeated hook requests by idempotency key. This applies to webhook-style hook deliveries, not the plugin event bus `registerHook` API that ClawCal uses. **Not affected.**
- **Context engine/session routing** — Optional `sessionKey` forwarded through plugin lifecycle calls. Additive change — ClawCal doesn't use lifecycle session metadata. **Not affected.**
- **Models/secrets SecretRef enforcement** — Runtime-resolved provider secrets no longer persisted when projection is skipped. ClawCal already detects unresolved SecretRef objects in auth config and fails closed. **Not affected.**
- **Agents/subagents sessions_yield** — New orchestrator capability for ending turns. ClawCal doesn't interact with subagent orchestration. **Not affected.**
- **Cron/doctor normalization** — Canonical payload kinds no longer flagged as legacy. Internal cron storage change, not the `cron:register` event interface. **Not affected.**

### OpenClaw v2026.3.11

Reviewed against the [v2026.3.11 release](https://github.com/openclaw/openclaw/releases/tag/v2026.3.11). No breaking changes affect ClawCal.

**Assessed areas:**

- **Cron/doctor breaking change** — Tightens isolated cron delivery so cron jobs can no longer notify through ad hoc agent sends. ClawCal only listens passively on `cron:register` to map cron expressions to iCal RRULEs — it does not send notifications. **Not affected.**
- **Gateway auth changes** — Device-token retry and fail-closed SecretRef behavior. ClawCal reads `api.config.gateway.auth` and does its own token/password validation. Already detects unresolved SecretRef objects (added in `5435955`). **Not affected.**
- **Plugin hook context parity** — `llm_input`, `agent_end`, `llm_output` hooks now receive extra fields. ClawCal does not use these hooks. **Not affected.**
- **Plugin global hook runner hardening** — Singleton state handling fix. May improve stability for ClawCal's event hooks. **Not affected (potentially beneficial).**
- **Security/plugin runtime** — Unauthenticated plugin HTTP routes no longer inherit admin scopes. ClawCal's HTTP routes implement their own auth checks. **Not affected, but worth a smoke test.**
- **Plugin context-engine model auth** — New `runtime.modelAuth` for plugins. ClawCal does not use model/LLM APIs. **Not affected.**
