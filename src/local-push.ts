import { execFile } from 'child_process';
import { CalendarEvent } from './types.js';

const OSASCRIPT_TIMEOUT = 10_000;

/**
 * Pushes events into local Apple Calendar via osascript.
 * This ensures VALARM alerts fire natively — subscribed ICS feeds
 * show events but silently drop alerts via calaccessd.
 *
 * No-ops on non-macOS platforms.
 */
export class LocalCalendarPush {
  private enabled: boolean;
  private isDarwin: boolean;
  private knownCalendars: Set<string> = new Set();

  constructor(enabled: boolean) {
    this.enabled = enabled;
    this.isDarwin = process.platform === 'darwin';
  }

  pushEvent(event: CalendarEvent): void {
    if (!this.shouldRun() || !event.agent) return;
    if (event.rrule) return; // RRULE format differs in AppleScript

    const calName = calendarName(event.agent);
    const script = [
      ...this.ensureCalendarScript(calName),
      ...createEventScript(calName, event),
    ].join('\n');

    this.run(script);
  }

  updateEvent(event: CalendarEvent): void {
    if (!this.shouldRun() || !event.agent) return;
    if (event.rrule) return;

    // AppleScript can't modify events — delete + recreate
    const calName = calendarName(event.agent);
    const script = [
      ...this.ensureCalendarScript(calName),
      ...deleteEventScript(calName, event.title),
      ...createEventScript(calName, event),
    ].join('\n');

    this.run(script);
  }

  removeEvent(agent: string, title: string): void {
    if (!this.shouldRun()) return;

    const calName = calendarName(agent);
    const script = deleteEventScript(calName, title).join('\n');

    this.run(script);
  }

  private shouldRun(): boolean {
    return this.enabled && this.isDarwin;
  }

  private ensureCalendarScript(calName: string): string[] {
    if (this.knownCalendars.has(calName)) return [];

    this.knownCalendars.add(calName);

    return [
      'tell application "Calendar"',
      `  if not (exists calendar ${esc(calName)}) then`,
      `    make new calendar with properties {name:${esc(calName)}}`,
      '  end if',
      'end tell',
    ];
  }

  private run(script: string): void {
    execFile('osascript', ['-e', script], { timeout: OSASCRIPT_TIMEOUT }, (err) => {
      if (err) {
        console.warn(`[clawcal] local-push osascript failed: ${err.message}`);
      }
    });
  }
}

function calendarName(agentId: string): string {
  return `OpenClaw — ${agentId}`;
}

/**
 * Escape a string for AppleScript — wrap in quotes, escape inner quotes and backslashes.
 */
function esc(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function createEventScript(calName: string, event: CalendarEvent): string[] {
  const lines: string[] = [
    'tell application "Calendar"',
    `  tell calendar ${esc(calName)}`,
    '    set startDate to current date',
    ...setDateComponents('startDate', event.start),
  ];

  const endDate = event.end ?? new Date(event.start.getTime() + (event.duration || 15) * 60_000);
  lines.push(
    '    set endDate to current date',
    ...setDateComponents('endDate', endDate),
  );

  if (event.allDay) {
    lines.push(
      `    set newEvent to make new event with properties {summary:${esc(event.title)}, start date:startDate, end date:endDate, allday event:true}`,
    );
  } else {
    lines.push(
      `    set newEvent to make new event with properties {summary:${esc(event.title)}, start date:startDate, end date:endDate}`,
    );
  }

  if (event.description) {
    lines.push(`    set description of newEvent to ${esc(event.description)}`);
  }

  // Add display alarms
  if (event.alerts && event.alerts.length > 0) {
    for (const alert of event.alerts) {
      lines.push(
        `    make new display alarm at end of display alarms of newEvent with properties {trigger interval:${-alert.minutes}}`,
      );
    }
  }

  lines.push('  end tell', 'end tell');
  return lines;
}

function deleteEventScript(calName: string, title: string): string[] {
  return [
    'tell application "Calendar"',
    `  tell calendar ${esc(calName)}`,
    `    set matchingEvents to (every event whose summary is ${esc(title)})`,
    '    repeat with evt in matchingEvents',
    '      delete evt',
    '    end repeat',
    '  end tell',
    'end tell',
  ];
}

/**
 * Set date components via AppleScript assignment — locale-safe.
 * AppleScript's `date "..."` parsing depends on system locale,
 * so we set year/month/day/hours/minutes/seconds individually.
 */
function setDateComponents(varName: string, date: Date): string[] {
  return [
    `    set year of ${varName} to ${date.getFullYear()}`,
    `    set month of ${varName} to ${date.getMonth() + 1}`,
    `    set day of ${varName} to ${date.getDate()}`,
    `    set hours of ${varName} to ${date.getHours()}`,
    `    set minutes of ${varName} to ${date.getMinutes()}`,
    `    set seconds of ${varName} to ${date.getSeconds()}`,
  ];
}
