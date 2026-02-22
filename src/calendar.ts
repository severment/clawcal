import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { CalendarEvent, EventAlert, EventStatus } from './types.js';

/**
 * Manages the .ics file. Handles iCal formatting, UID management,
 * deduplication, and atomic file writes.
 */
export class CalendarManager {
  private events: Map<string, CalendarEvent> = new Map();
  private filePath: string;
  private calendarName: string;

  constructor(filePath: string, calendarName = 'OpenClaw Agent Activity') {
    this.filePath = filePath;
    this.calendarName = calendarName;
    this.ensureDirectory();
    this.loadExisting();
  }

  addEvent(event: CalendarEvent): void {
    this.events.set(event.uid, sanitizeEvent(event));
    this.write();
  }

  updateEvent(uid: string, updates: Partial<CalendarEvent>): void {
    const existing = this.events.get(uid);
    if (!existing) return;

    this.events.set(uid, sanitizeEvent({
      ...existing,
      ...updates,
      sequence: (existing.sequence || 0) + 1,
    }));
    this.write();
  }

  cancelEvent(uid: string): void {
    this.updateEvent(uid, { status: 'CANCELLED' });
  }

  removeEvent(uid: string): void {
    this.events.delete(uid);
    this.write();
  }

  getEvent(uid: string): CalendarEvent | undefined {
    return this.events.get(uid);
  }

  getAllEvents(): CalendarEvent[] {
    return Array.from(this.events.values());
  }

  /**
   * Remove events older than retentionDays, keeping at most maxEvents.
   */
  cleanup(retentionDays: number, maxEvents: number): number {
    const cutoff = new Date(Date.now() - retentionDays * 86400000);
    let removed = 0;

    for (const [uid, event] of this.events) {
      if (event.start < cutoff && event.status === 'COMPLETED') {
        this.events.delete(uid);
        removed++;
      }
    }

    // If still over max, remove oldest completed events
    if (this.events.size > maxEvents) {
      const completed = Array.from(this.events.entries())
        .filter(([, e]) => e.status === 'COMPLETED')
        .sort(([, a], [, b]) => a.start.getTime() - b.start.getTime());

      const toRemove = this.events.size - maxEvents;
      for (let i = 0; i < Math.min(toRemove, completed.length); i++) {
        this.events.delete(completed[i][0]);
        removed++;
      }
    }

    if (removed > 0) this.write();
    return removed;
  }

  /**
   * Generate the full .ics file content.
   */
  toICS(): string {
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ClawCal//OpenClaw//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${this.calendarName}`,
      'X-WR-TIMEZONE:UTC',
    ];

    for (const event of this.events.values()) {
      lines.push(...this.eventToVEvent(event));
    }

    lines.push('END:VCALENDAR');

    // iCal requires CRLF line endings
    return lines.join('\r\n') + '\r\n';
  }

  private eventToVEvent(event: CalendarEvent): string[] {
    const lines: string[] = ['BEGIN:VEVENT'];

    lines.push(`UID:${event.uid}@clawcal`);
    lines.push(`DTSTAMP:${formatICSDate(new Date())}`);

    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatICSDateOnly(event.start)}`);
      if (event.end) {
        lines.push(`DTEND;VALUE=DATE:${formatICSDateOnly(event.end)}`);
      }
    } else {
      lines.push(`DTSTART:${formatICSDate(event.start)}`);
      if (event.end) {
        lines.push(`DTEND:${formatICSDate(event.end)}`);
      } else if (event.duration) {
        lines.push(`DURATION:PT${event.duration}M`);
      } else {
        // Default to 15 minutes
        lines.push(`DTEND:${formatICSDate(new Date(event.start.getTime() + 15 * 60000))}`);
      }
    }

    lines.push(`SUMMARY:${foldLine('SUMMARY:',escapeICS(event.title))}`);

    if (event.description) {
      lines.push(`DESCRIPTION:${foldLine('DESCRIPTION:', escapeICS(event.description))}`);
    }

    if (event.category) {
      lines.push(`CATEGORIES:${escapeICS(event.category)}`);
    }

    if (event.status) {
      lines.push(`STATUS:${mapStatus(event.status)}`);
    }

    if (event.sequence != null) {
      lines.push(`SEQUENCE:${event.sequence}`);
    }

    if (event.rrule) {
      lines.push(`RRULE:${event.rrule}`);
    }

    if (event.agent) {
      lines.push(`X-OPENCLAW-AGENT:${escapeICS(event.agent)}`);
    }

    if (event.project) {
      lines.push(`X-OPENCLAW-PROJECT:${escapeICS(event.project)}`);
    }

    if (event.url) {
      lines.push(`URL:${event.url}`);
    }

    // Source ID for debugging — visible in raw .ics even if calendar apps ignore it
    lines.push(`X-CLAWCAL-SOURCE-ID:${event.uid}`);

    if (event.alerts && event.alerts.length > 0) {
      for (const alert of event.alerts) {
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push(`DESCRIPTION:${escapeICS(alert.description || event.title)}`);
        lines.push(`TRIGGER:-PT${alert.minutes}M`);
        lines.push('END:VALARM');
      }
    }

    lines.push('END:VEVENT');
    return lines;
  }

  private write(): void {
    const ics = this.toICS();
    writeFileSync(this.filePath, ics, 'utf-8');
  }

  private ensureDirectory(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Parse an existing .ics file to restore state across restarts.
   * Simple line-by-line parser — no external ical library needed.
   */
  private loadExisting(): void {
    if (!existsSync(this.filePath)) return;

    let content: string;
    try {
      content = readFileSync(this.filePath, 'utf-8');
    } catch {
      return;
    }

    // Unfold continuation lines (lines starting with space or tab)
    content = content.replace(/\r\n[ \t]/g, '');

    const lines = content.split(/\r?\n/);
    let current: Partial<CalendarEvent> | null = null;
    let inAlarm = false;
    let currentAlert: Partial<EventAlert> | null = null;

    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') {
        current = {};
        continue;
      }

      if (line === 'END:VEVENT' && current) {
        if (current.uid && current.start) {
          this.events.set(current.uid, current as CalendarEvent);
        }
        current = null;
        continue;
      }

      if (!current) continue;

      if (line === 'BEGIN:VALARM') {
        inAlarm = true;
        currentAlert = {};
        continue;
      }

      if (line === 'END:VALARM') {
        if (currentAlert && currentAlert.minutes != null) {
          if (!current.alerts) current.alerts = [];
          current.alerts.push(currentAlert as EventAlert);
        }
        inAlarm = false;
        currentAlert = null;
        continue;
      }

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const key = line.substring(0, colonIdx);
      const value = line.substring(colonIdx + 1);

      if (inAlarm && currentAlert) {
        switch (key) {
          case 'TRIGGER': {
            const match = value.match(/-PT(\d+)M/);
            if (match) currentAlert.minutes = parseInt(match[1], 10);
            break;
          }
          case 'DESCRIPTION':
            currentAlert.description = unescapeICS(value);
            break;
        }
        continue;
      }

      switch (key) {
        case 'UID':
          current.uid = value.replace(/@clawcal$/, '');
          break;
        case 'SUMMARY':
          current.title = unescapeICS(value);
          break;
        case 'DESCRIPTION':
          current.description = unescapeICS(value);
          break;
        case 'DTSTART':
          current.start = parseICSDate(value);
          break;
        case 'DTSTART;VALUE=DATE':
          current.start = parseICSDateOnly(value);
          current.allDay = true;
          break;
        case 'DTEND':
          current.end = parseICSDate(value);
          break;
        case 'DTEND;VALUE=DATE':
          current.end = parseICSDateOnly(value);
          break;
        case 'DURATION': {
          const match = value.match(/PT(\d+)M/);
          if (match) current.duration = parseInt(match[1], 10);
          break;
        }
        case 'CATEGORIES':
          current.category = value;
          break;
        case 'STATUS':
          current.status = reverseMapStatus(value);
          break;
        case 'SEQUENCE':
          current.sequence = parseInt(value, 10);
          break;
        case 'RRULE':
          current.rrule = value;
          break;
        case 'X-OPENCLAW-AGENT':
          current.agent = unescapeICS(value);
          break;
        case 'X-OPENCLAW-PROJECT':
          current.project = unescapeICS(value);
          break;
        case 'URL':
          current.url = value;
          break;
      }
    }
  }
}

// --- Input sanitization ---

/**
 * Strip control characters from a structural field (title, agent, category, etc.).
 * No control chars at all — these influence parsers, scripts, routing, and file naming.
 */
export function stripControl(value: string): string {
  return value.replace(/[\x00-\x1f\x7f\u2028\u2029]/g, '').trim();
}

/**
 * Sanitize a content field (description). Preserves newlines since they're
 * semantically meaningful (bullet lists, structured context). Normalizes
 * Unicode line separators (U+2028, U+2029) to \n.
 */
export function sanitizeContent(value: string): string {
  return value
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim();
}

/**
 * Sanitize all string fields of a CalendarEvent at the model boundary.
 * Structural fields get strict stripping; descriptions preserve newlines.
 */
function sanitizeEvent(event: CalendarEvent): CalendarEvent {
  return {
    ...event,
    title: stripControl(event.title),
    description: event.description ? sanitizeContent(event.description) : undefined,
    agent: event.agent ? stripControl(event.agent) : undefined,
    project: event.project ? stripControl(event.project) : undefined,
    category: event.category ? stripControl(event.category) : undefined,
    url: event.url ? stripControl(event.url) : undefined,
  };
}

// --- iCal formatting utilities ---

export function formatICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  // → 20250225T090000Z
}

export function formatICSDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
  // → 20250225
}

export function parseICSDate(str: string): Date {
  // 20250225T090000Z → Date
  const match = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return new Date(str);
  return new Date(Date.UTC(
    parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]),
    parseInt(match[4]), parseInt(match[5]), parseInt(match[6])
  ));
}

export function parseICSDateOnly(str: string): Date {
  const match = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return new Date(str);
  return new Date(Date.UTC(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3])));
}

export function escapeICS(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export function unescapeICS(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Fold a line at 75 octets per RFC 5545.
 * Continuation lines start with a single space.
 */
export function foldLine(prefix: string, value: string): string {
  const full = value;
  const maxFirst = 75 - new TextEncoder().encode(prefix).length;
  const maxContinuation = 74; // 75 minus the leading space

  const bytes = new TextEncoder().encode(full);
  if (bytes.length <= maxFirst) return full;

  const result: string[] = [];
  let pos = 0;

  // First line
  let chunk = cutAtOctetBoundary(full, pos, maxFirst);
  result.push(chunk);
  pos += chunk.length;

  // Continuation lines
  while (pos < full.length) {
    chunk = cutAtOctetBoundary(full, pos, maxContinuation);
    result.push(' ' + chunk);
    pos += chunk.length;
  }

  return result.join('\r\n');
}

function cutAtOctetBoundary(str: string, start: number, maxOctets: number): string {
  const encoder = new TextEncoder();
  let end = start;
  let octets = 0;

  while (end < str.length) {
    const charBytes = encoder.encode(str[end]).length;
    if (octets + charBytes > maxOctets) break;
    octets += charBytes;
    end++;
  }

  return str.slice(start, end);
}

function mapStatus(status: EventStatus): string {
  switch (status) {
    case 'COMPLETED': return 'CONFIRMED';
    case 'CANCELLED': return 'CANCELLED';
    case 'IN_PROGRESS': return 'CONFIRMED';
    case 'PLANNED': return 'TENTATIVE';
    default: return 'TENTATIVE';
  }
}

function reverseMapStatus(icsStatus: string): EventStatus {
  switch (icsStatus) {
    case 'CONFIRMED': return 'COMPLETED';
    case 'CANCELLED': return 'CANCELLED';
    case 'TENTATIVE': return 'PLANNED';
    default: return 'PLANNED';
  }
}
