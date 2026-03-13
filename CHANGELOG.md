# Changelog

All notable changes to ClawCal are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## Compatibility Notes

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
