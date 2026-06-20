# TODO — OpenClaw v2026.6.6 Upgrade

Assessed every stable release from v2026.3.13 → v2026.6.6. See CHANGELOG.md for the full breakdown.

## Applied + verified end-to-end on a real v2026.6.6 gateway

- [x] Add unique `{ name: 'clawcal:…' }` to all 5 `registerHook` calls — without it v2026.6.6 throws `hook registration missing name` and the whole plugin fails to load (v2026.3.11 silently skipped the hooks). Verified: plugin now loads clean.
- [x] Add `auth: 'plugin'` to all 4 `registerHttpRoute` calls — without it the gateway rejects every feed route (`missing or invalid auth`). Verified: feed now serves.
- [x] Fix local type stubs (`registerHttpRoute` auth required; `registerHook` opts required) — wrong stubs are why `tsc` never caught any of this.
- [x] Declare `clawcal_schedule` under `contracts.tools` in `openclaw.plugin.json` (required v2026.5.2+).
- [x] Declare `activation.onStartup: true` in `openclaw.plugin.json` (implicit startup loading deprecated v2026.4.27).

## Smoke tests — DONE (real gateway, sandboxed state dir)

- [x] Boot `openclaw gateway run` on v2026.6.6 with ClawCal installed → loads among 9 plugins, no diagnostics
- [x] `GET /clawcal/feed.ics` → 200, valid `text/calendar` iCal
- [x] `GET /clawcal/feeds` → 200 JSON index
- [x] Config-file token auth: no/wrong token → 401; correct Bearer → 200; calendar-app Basic auth → 200
- [x] No "deprecated implicit startup loading" warning at boot

## Follow-ups

- [ ] Document the auth caveat: ClawCal reads `config.gateway.auth` from the **config file**, not the gateway `--auth` CLI flag. `--auth token` alone leaves the feed open. (Add to README auth section.)
- [ ] Recommend `plugins.allow: ["clawcal"]` in production (gateway warns when `plugins.allow` is empty).
- [ ] Trigger live `cron:register` / `agent:schedule` events end-to-end (the harness + load confirm the hooks register; firing real events is the last untested step).
- [ ] Document that a relative `file_directory` now resolves against the plugin root (v2026.4.29); default `~/.openclaw/clawcal/` is unaffected.

## Follow-ups

- [ ] Document that a user-supplied *relative* `file_directory` now resolves against the plugin root, not the host cwd (v2026.4.29 `resolvePath` change). The default `~/.openclaw/clawcal/` is unaffected.
- [ ] Verify `peerDependencies` still reads `openclaw@>=2026.3.2` — the new manifest fields are backward-compatible, so the floor does not need to move.
