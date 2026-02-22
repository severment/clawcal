# 🤖 CLAUDE.md — ClawCal

## What This Project Is

ClawCal is an OpenClaw extension plugin that exposes agent activity as a subscribable iCal feed. Every time an agent schedules a post, completes a task, or plans a launch, it appears as a calendar event. You subscribe once from Apple Calendar, Google Calendar, or any calendar app — new events appear automatically.

Not a dashboard. Not a web app. Your calendar — the one you already have open.

## How It Connects to OpenClaw

ClawCal is a **plugin** (extends the gateway), not a **skill** (teaches the agent). It follows the same pattern as existing OpenClaw extensions like msteams, matrix, zalo, and voice-call. It lives in `extensions/clawcal/` and hooks into the gateway's event system.

## Architecture

### Dual Input Model

1. **Passive** — The plugin listens to gateway events (`agent:schedule`, `agent:task:complete`, `cron:register`, etc.) and auto-creates calendar entries.
2. **Active** — The plugin registers a `clawcal_schedule` tool so agents can explicitly add events to the calendar.

### Data Flow

```
Gateway event bus → listener.ts → events.ts (maps to calendar format) → calendar.ts (writes .ics)
                                                                              ↓
Agent calls clawcal_schedule tool → events.ts → calendar.ts → .ics file → HTTP route serves it
                                                                              ↓
                                                                     Calendar app polls URL
```

### Key Design Decisions

- **Zero runtime dependencies.** iCal is a text format. Generating it requires no libraries.
- **CalendarManager is the single source of truth.** All events go through it. It handles UIDs, SEQUENCE numbers, deduplication, and file writes.
- **HTTP route on the gateway.** Subscribe from any device via `http://your-host:3001/clawcal/feed.ics`. Calendar apps poll periodically.
- **iCal compliance matters.** Line folding at 75 chars, CRLF line endings, UTC date formatting, proper escaping. Calendar apps are unforgiving with malformed .ics files.
- **Companion skill is optional.** Without it, the plugin passively listens. With it, the agent proactively plans and populates the calendar.

## Repo Structure

```
clawcal/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          ← plugin entry point, registers with gateway
│   ├── listener.ts       ← hooks into gateway events
│   ├── calendar.ts       ← iCal generation and file management
│   ├── feed-manager.ts   ← multi-feed management (combined + per-agent)
│   ├── events.ts         ← maps OpenClaw events to calendar events
│   ├── local-push.ts     ← macOS Apple Calendar push via osascript (configurable calendar source)
│   └── types.ts          ← type definitions
├── README.md
├── CONTRIBUTING.md
├── LICENSE               ← MIT
└── tests/
    ├── calendar.test.ts  ← iCal output correctness
    ├── events.test.ts    ← event mapping logic
    ├── feed-manager.test.ts ← multi-feed routing
    ├── local-push.test.ts   ← local push, AppleScript generation
    └── auth.test.ts         ← gateway auth integration
```

## Event Types

| Gateway Event | Calendar Entry | Example |
|---|---|---|
| `agent:schedule` | Timed event | "🐦 Tweet: MyApp v2 launch" at Tue 12pm |
| `agent:task:complete` | All-day event | "✅ Landing page shipped" |
| `cron:register` | Recurring event | "🔄 Weekly digest" every Monday 8am |
| `agent:schedule:update` | Updated event (SEQUENCE incremented) | Time change on existing event |
| `agent:schedule:cancel` | Cancelled event (STATUS:CANCELLED) | Cancelled post |

## iCal Quirks to Know

- Lines must be folded at 75 octets (not chars — UTF-8 multi-byte matters)
- Line endings are CRLF (`\r\n`)
- Dates are formatted as `YYYYMMDDTHHMMSSZ` (UTC) or `YYYYMMDD` (all-day)
- Text fields must escape `\`, `;`, `,`, and newlines
- Each event needs a globally unique UID (we use `{event.id}@clawcal`)
- Updates to existing events increment the SEQUENCE property
- CANCELLED events stay in the file with STATUS:CANCELLED (don't delete them — calendar apps need the cancellation)

## Commit Rules

- **Never** append `Co-Authored-By` lines to commit messages.
- Write concise, imperative commit messages.

## Testing

- Test iCal output by importing generated .ics files into Apple Calendar, Google Calendar, and Fantastical.
- Run unit tests with `npm test`.
- Calendar apps are the real test — if they choke, the output is wrong.
