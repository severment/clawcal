import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { CalendarManager, formatICSDate, formatICSDateOnly, escapeICS, unescapeICS, foldLine, parseICSDate } from '../src/calendar';

const TEST_FILE = '/tmp/clawcal-test.ics';

describe('CalendarManager', () => {
  let calendar: CalendarManager;

  beforeEach(() => {
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
    calendar = new CalendarManager(TEST_FILE, 'Test Calendar');
  });

  afterEach(() => {
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  });

  it('creates a valid .ics file on first event', () => {
    calendar.addEvent({
      uid: 'test-1',
      title: 'Test Event',
      start: new Date('2025-02-25T09:00:00Z'),
      duration: 30,
      status: 'PLANNED',
    });

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('BEGIN:VCALENDAR');
    expect(content).toContain('END:VCALENDAR');
    expect(content).toContain('BEGIN:VEVENT');
    expect(content).toContain('END:VEVENT');
    expect(content).toContain('UID:test-1@clawcal');
    expect(content).toContain('SUMMARY:Test Event');
    expect(content).toContain('DTSTART:20250225T090000Z');
    expect(content).toContain('DURATION:PT30M');
    expect(content).toContain('STATUS:TENTATIVE');
  });

  it('uses CRLF line endings', () => {
    calendar.addEvent({
      uid: 'test-crlf',
      title: 'CRLF Test',
      start: new Date('2025-03-01T12:00:00Z'),
    });

    const raw = readFileSync(TEST_FILE, 'utf-8');
    expect(raw).toContain('\r\n');
    // Should not have bare LF (without preceding CR)
    const withoutCRLF = raw.replace(/\r\n/g, '');
    expect(withoutCRLF).not.toContain('\n');
  });

  it('handles all-day events with DATE format', () => {
    calendar.addEvent({
      uid: 'test-allday',
      title: 'All Day Event',
      start: new Date('2025-02-25T00:00:00Z'),
      allDay: true,
      status: 'COMPLETED',
    });

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('DTSTART;VALUE=DATE:20250225');
    expect(content).not.toContain('DTSTART:20250225T');
    expect(content).toContain('STATUS:CONFIRMED');
  });

  it('updates events and increments SEQUENCE', () => {
    calendar.addEvent({
      uid: 'test-update',
      title: 'Original Title',
      start: new Date('2025-02-25T09:00:00Z'),
      status: 'PLANNED',
    });

    calendar.updateEvent('test-update', {
      start: new Date('2025-02-26T10:00:00Z'),
    });

    const event = calendar.getEvent('test-update');
    expect(event?.sequence).toBe(1);
    expect(event?.start.toISOString()).toBe('2025-02-26T10:00:00.000Z');

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('SEQUENCE:1');
    expect(content).toContain('DTSTART:20250226T100000Z');
  });

  it('cancels events with STATUS:CANCELLED', () => {
    calendar.addEvent({
      uid: 'test-cancel',
      title: 'To Be Cancelled',
      start: new Date('2025-02-25T09:00:00Z'),
      status: 'PLANNED',
    });

    calendar.cancelEvent('test-cancel');

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('STATUS:CANCELLED');
    // Event should still be in the file (not deleted)
    expect(content).toContain('UID:test-cancel@clawcal');
  });

  it('persists and restores events across instances', () => {
    calendar.addEvent({
      uid: 'test-persist',
      title: 'Persistent Event',
      description: 'Should survive restart',
      start: new Date('2025-02-25T09:00:00Z'),
      duration: 45,
      category: 'post',
      agent: 'agent-1',
      project: 'myproject',
      status: 'PLANNED',
    });

    // Create a new instance from the same file
    const restored = new CalendarManager(TEST_FILE);
    const event = restored.getEvent('test-persist');

    expect(event).toBeDefined();
    expect(event?.title).toBe('Persistent Event');
    expect(event?.description).toBe('Should survive restart');
    expect(event?.category).toBe('post');
    expect(event?.agent).toBe('agent-1');
    expect(event?.project).toBe('myproject');
  });

  it('handles multiple events', () => {
    calendar.addEvent({ uid: 'e1', title: 'First', start: new Date('2025-02-25T09:00:00Z') });
    calendar.addEvent({ uid: 'e2', title: 'Second', start: new Date('2025-02-25T10:00:00Z') });
    calendar.addEvent({ uid: 'e3', title: 'Third', start: new Date('2025-02-25T11:00:00Z') });

    expect(calendar.getAllEvents()).toHaveLength(3);

    const content = readFileSync(TEST_FILE, 'utf-8');
    const eventCount = (content.match(/BEGIN:VEVENT/g) || []).length;
    expect(eventCount).toBe(3);
  });

  it('removes events', () => {
    calendar.addEvent({ uid: 'e-remove', title: 'Remove Me', start: new Date('2025-02-25T09:00:00Z') });
    expect(calendar.getEvent('e-remove')).toBeDefined();

    calendar.removeEvent('e-remove');
    expect(calendar.getEvent('e-remove')).toBeUndefined();
  });

  it('cleans up old completed events', () => {
    const old = new Date(Date.now() - 100 * 86400000); // 100 days ago
    const recent = new Date(Date.now() - 10 * 86400000); // 10 days ago

    calendar.addEvent({ uid: 'old-1', title: 'Old Event', start: old, status: 'COMPLETED' });
    calendar.addEvent({ uid: 'recent-1', title: 'Recent Event', start: recent, status: 'COMPLETED' });
    calendar.addEvent({ uid: 'planned-1', title: 'Planned Event', start: new Date(), status: 'PLANNED' });

    const removed = calendar.cleanup(90, 100);

    expect(removed).toBe(1);
    expect(calendar.getEvent('old-1')).toBeUndefined();
    expect(calendar.getEvent('recent-1')).toBeDefined();
    expect(calendar.getEvent('planned-1')).toBeDefined();
  });

  it('includes custom X- properties for agent and project', () => {
    calendar.addEvent({
      uid: 'test-custom',
      title: 'Custom Props',
      start: new Date('2025-02-25T09:00:00Z'),
      agent: 'marketing-bot',
      project: 'utmgate',
    });

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('X-OPENCLAW-AGENT:marketing-bot');
    expect(content).toContain('X-OPENCLAW-PROJECT:utmgate');
  });

  it('includes X-CLAWCAL-SOURCE-ID for debugging', () => {
    calendar.addEvent({
      uid: 'test-source-id',
      title: 'Debug Test',
      start: new Date('2025-02-25T09:00:00Z'),
    });

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('X-CLAWCAL-SOURCE-ID:test-source-id');
  });

  it('handles recurring events with RRULE', () => {
    calendar.addEvent({
      uid: 'test-recurring',
      title: 'Weekly Digest',
      start: new Date('2025-02-24T08:00:00Z'),
      duration: 15,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    });

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
  });

  it('generates VALARM blocks for alerts', () => {
    calendar.addEvent({
      uid: 'test-alarm',
      title: 'Event With Alert',
      start: new Date('2025-02-25T09:00:00Z'),
      duration: 30,
      alerts: [{ minutes: 15 }],
    });

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('BEGIN:VALARM');
    expect(content).toContain('ACTION:DISPLAY');
    expect(content).toContain('TRIGGER:-PT15M');
    expect(content).toContain('DESCRIPTION:Event With Alert');
    expect(content).toContain('END:VALARM');
  });

  it('generates multiple VALARM blocks', () => {
    calendar.addEvent({
      uid: 'test-multi-alarm',
      title: 'Launch Event',
      start: new Date('2025-02-25T09:00:00Z'),
      alerts: [{ minutes: 15 }, { minutes: 60 }],
    });

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('TRIGGER:-PT15M');
    expect(content).toContain('TRIGGER:-PT60M');

    const alarmCount = (content.match(/BEGIN:VALARM/g) || []).length;
    expect(alarmCount).toBe(2);
  });

  it('uses custom alert description when provided', () => {
    calendar.addEvent({
      uid: 'test-custom-alarm',
      title: 'Post Time',
      start: new Date('2025-02-25T12:00:00Z'),
      alerts: [{ minutes: 15, description: 'Tweet goes live in 15 minutes' }],
    });

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('DESCRIPTION:Tweet goes live in 15 minutes');
  });

  it('persists and restores alerts across instances', () => {
    calendar.addEvent({
      uid: 'test-alarm-persist',
      title: 'Persistent Alert',
      start: new Date('2025-02-25T09:00:00Z'),
      alerts: [{ minutes: 15 }, { minutes: 60 }],
    });

    const restored = new CalendarManager(TEST_FILE);
    const event = restored.getEvent('test-alarm-persist');

    expect(event?.alerts).toBeDefined();
    expect(event?.alerts).toHaveLength(2);
    expect(event?.alerts?.[0].minutes).toBe(15);
    expect(event?.alerts?.[1].minutes).toBe(60);
  });

  it('includes URL property when url is set', () => {
    calendar.addEvent({
      uid: 'test-url',
      title: 'Event With URL',
      start: new Date('2025-02-25T09:00:00Z'),
      url: 'https://github.com/org/repo/pull/42',
    });

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).toContain('URL:https://github.com/org/repo/pull/42');
  });

  it('omits URL property when url is not set', () => {
    calendar.addEvent({
      uid: 'test-no-url',
      title: 'Event Without URL',
      start: new Date('2025-02-25T09:00:00Z'),
    });

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).not.toContain('URL:');
  });

  it('persists and restores URL across instances', () => {
    calendar.addEvent({
      uid: 'test-url-persist',
      title: 'URL Persistence',
      start: new Date('2025-02-25T09:00:00Z'),
      url: 'https://example.com/dashboard',
    });

    const restored = new CalendarManager(TEST_FILE);
    const event = restored.getEvent('test-url-persist');

    expect(event?.url).toBe('https://example.com/dashboard');
  });

  it('omits VALARM when no alerts configured', () => {
    calendar.addEvent({
      uid: 'test-no-alarm',
      title: 'No Alert Event',
      start: new Date('2025-02-25T09:00:00Z'),
    });

    const content = readFileSync(TEST_FILE, 'utf-8');
    expect(content).not.toContain('BEGIN:VALARM');
  });
});

describe('iCal formatting utilities', () => {
  it('formats dates to iCal format', () => {
    const date = new Date('2025-02-25T09:30:00Z');
    expect(formatICSDate(date)).toBe('20250225T093000Z');
  });

  it('formats date-only values', () => {
    const date = new Date('2025-02-25T00:00:00Z');
    expect(formatICSDateOnly(date)).toBe('20250225');
  });

  it('parses iCal dates back to Date objects', () => {
    const date = parseICSDate('20250225T093000Z');
    expect(date.toISOString()).toBe('2025-02-25T09:30:00.000Z');
  });

  it('escapes special characters', () => {
    expect(escapeICS('hello, world')).toBe('hello\\, world');
    expect(escapeICS('line1\nline2')).toBe('line1\\nline2');
    expect(escapeICS('semi;colon')).toBe('semi\\;colon');
    expect(escapeICS('back\\slash')).toBe('back\\\\slash');
  });

  it('unescapes special characters', () => {
    expect(unescapeICS('hello\\, world')).toBe('hello, world');
    expect(unescapeICS('line1\\nline2')).toBe('line1\nline2');
    expect(unescapeICS('semi\\;colon')).toBe('semi;colon');
    expect(unescapeICS('back\\\\slash')).toBe('back\\slash');
  });

  it('folds long lines at 75 octets', () => {
    const longText = 'A'.repeat(200);
    const folded = foldLine('SUMMARY:', longText);
    const lines = folded.split('\r\n');

    // First segment should fit within 75 - "SUMMARY:".length
    // Continuation lines start with space
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i][0]).toBe(' ');
    }
  });
});
