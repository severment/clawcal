# Contributing to ClawCal

ClawCal is an OpenClaw extension plugin. Contributions should improve iCal compatibility, add missing event types, or fix bugs in the calendar generation.

## What to contribute

**High value:**

- iCal compatibility fixes — tested against Apple Calendar, Google Calendar, Fantastical, Outlook
- New gateway event type mappings
- Timezone edge case fixes
- Parser improvements for loading existing .ics files

**Welcome:**

- Typo and clarity fixes
- Test coverage improvements
- Documentation for new calendar app integrations

**Please don't:**

- Add runtime dependencies. iCal is a text format. Zero deps by design.
- Build a web UI. The whole point is that your existing calendar IS the UI.
- Add features that don't relate to calendar output.

## How to contribute

1. Fork the repo
2. Create a branch (`git checkout -b fix-allday-timezone`)
3. Make your changes
4. Run tests (`npm test`)
5. Test your .ics output by importing it into at least one calendar app
6. Open a PR

## PR format

```
## What
One sentence describing the change.

## Why
The problem this fixes or the gap this fills.

## Tested with
- Calendar app(s): Apple Calendar / Google Calendar / Fantastical / Outlook
- What you verified: events render correctly, times are right, etc.
```

## Code of conduct

Be useful. Be honest. Don't waste people's time.
