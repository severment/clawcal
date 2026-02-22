import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { LocalCalendarPush } from '../src/local-push';
import { CalendarEvent, LocalPushConfig } from '../src/types';

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => cb?.(null)),
}));

const mockedExecFile = vi.mocked(execFile);

/** Flush the internal promise queue so execFile mock is called. */
const flush = () => new Promise(r => setTimeout(r, 0));

function makeConfig(overrides: Partial<LocalPushConfig> = {}): LocalPushConfig {
  return {
    enabled: true,
    calendarSource: 'iCloud',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: 'test-uid-1',
    title: 'Test Event',
    start: new Date(2025, 2, 15, 14, 30, 0), // Mar 15 2025, 2:30 PM local
    agent: 'marketing-agent',
    ...overrides,
  };
}

function lastScript(): string {
  const calls = mockedExecFile.mock.calls;
  const lastCall = calls[calls.length - 1];
  return (lastCall[1] as string[])[1]; // args[1] is the -e script
}

describe('LocalCalendarPush', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  describe('platform guard', () => {
    it('no-ops on non-macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent());
      expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it('no-ops when disabled', () => {
      const push = new LocalCalendarPush(makeConfig({ enabled: false }));
      push.pushEvent(makeEvent());
      expect(mockedExecFile).not.toHaveBeenCalled();
    });
  });

  describe('pushEvent', () => {
    it('generates calendar creation + event creation AppleScript', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent());
      await flush();

      expect(mockedExecFile).toHaveBeenCalledOnce();
      expect(mockedExecFile.mock.calls[0][0]).toBe('osascript');

      const script = lastScript();
      expect(script).toContain('tell application "Calendar"');
      expect(script).toContain('"OpenClaw - marketing-agent"');
      expect(script).toContain('make new calendar');
      expect(script).toContain('make new event');
      expect(script).toContain('summary:"Test Event"');
    });

    it('skips events without agent', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ agent: undefined }));
      expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it('skips recurring events with rrule', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }));
      expect(mockedExecFile).not.toHaveBeenCalled();
    });

    it('includes display alarms for alerts', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({
        alerts: [{ minutes: 15 }, { minutes: 60 }],
      }));
      await flush();

      const script = lastScript();
      expect(script).toContain('trigger interval:-15');
      expect(script).toContain('trigger interval:-60');
      expect(script).toContain('display alarm');
    });

    it('sets allday event property when allDay is true', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ allDay: true }));
      await flush();

      const script = lastScript();
      expect(script).toContain('allday event:true');
    });

    it('sets description when present', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ description: 'Launch the v2 campaign' }));
      await flush();

      const script = lastScript();
      expect(script).toContain('set description of newEvent to "Launch the v2 campaign"');
    });

    it('uses duration to compute end date', async () => {
      const push = new LocalCalendarPush(makeConfig());
      const start = new Date(2025, 2, 15, 14, 0, 0);
      push.pushEvent(makeEvent({ start, duration: 30 }));
      await flush();

      const script = lastScript();
      // End date should be 14:30
      expect(script).toContain('set minutes of endDate to 30');
    });

    it('defaults to 15 minutes duration when no end or duration', async () => {
      const push = new LocalCalendarPush(makeConfig());
      const start = new Date(2025, 2, 15, 14, 0, 0);
      push.pushEvent(makeEvent({ start, end: undefined, duration: undefined }));
      await flush();

      const script = lastScript();
      // End date should be 14:15
      expect(script).toContain('set minutes of endDate to 15');
    });
  });

  describe('date formatting', () => {
    it('uses component assignment for locale-safe dates', async () => {
      const push = new LocalCalendarPush(makeConfig());
      const date = new Date(2025, 11, 25, 9, 5, 30); // Dec 25 2025, 9:05:30 AM
      push.pushEvent(makeEvent({ start: date }));
      await flush();

      const script = lastScript();
      expect(script).toContain('set year of startDate to 2025');
      expect(script).toContain('set month of startDate to 12');
      expect(script).toContain('set day of startDate to 25');
      expect(script).toContain('set hours of startDate to 9');
      expect(script).toContain('set minutes of startDate to 5');
      expect(script).toContain('set seconds of startDate to 30');
    });
  });

  describe('escaping', () => {
    it('escapes double quotes in event titles', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ title: 'Launch "Beta" v2' }));
      await flush();

      const script = lastScript();
      expect(script).toContain('summary:"Launch \\"Beta\\" v2"');
    });

    it('escapes backslashes in event titles', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ title: 'Path C:\\Users' }));
      await flush();

      const script = lastScript();
      expect(script).toContain('summary:"Path C:\\\\Users"');
    });

    it('escapes quotes in calendar names', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ agent: 'agent "special"' }));
      await flush();

      const script = lastScript();
      expect(script).toContain('"OpenClaw - agent \\"special\\""');
    });

    it('strips control characters to prevent AppleScript injection', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ title: 'Evil\ndo shell script "rm -rf /"\n--' }));
      await flush();

      const script = lastScript();
      // Newlines stripped — the injected command is collapsed into the quoted string, not on its own line
      expect(script).toContain('summary:"Evildo shell script \\"rm -rf /\\"--"');
      // No bare line that could execute as a separate AppleScript statement
      for (const line of script.split('\n')) {
        expect(line.trimStart()).not.toMatch(/^do shell script/);
      }
    });
  });

  describe('serialized queue', () => {
    it('processes events sequentially to prevent duplicate calendars', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent());
      push.pushEvent(makeEvent({ uid: 'test-uid-2', title: 'Second Event' }));
      await flush();

      // Both should have been called (sequentially, not concurrently)
      expect(mockedExecFile).toHaveBeenCalledTimes(2);

      const firstScript = (mockedExecFile.mock.calls[0][1] as string[])[1];
      const secondScript = (mockedExecFile.mock.calls[1][1] as string[])[1];

      // Both include the calendar existence check (no caching)
      expect(firstScript).toContain('does not contain');
      expect(secondScript).toContain('does not contain');
    });

    it('creates separate calendars for different agents', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ agent: 'agent-a' }));
      push.pushEvent(makeEvent({ uid: 'test-uid-2', agent: 'agent-b' }));
      await flush();

      const scriptA = (mockedExecFile.mock.calls[0][1] as string[])[1];
      const scriptB = (mockedExecFile.mock.calls[1][1] as string[])[1];

      expect(scriptA).toContain('"OpenClaw - agent-a"');
      expect(scriptB).toContain('"OpenClaw - agent-b"');
    });
  });

  describe('updateEvent', () => {
    it('deletes then recreates the event', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.updateEvent(makeEvent());
      await flush();

      const script = lastScript();
      // Should contain delete (matching by summary) and create
      expect(script).toContain('delete evt');
      expect(script).toContain('every event whose summary is "Test Event"');
      expect(script).toContain('make new event');
    });
  });

  describe('removeEvent', () => {
    it('deletes events by summary match', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.removeEvent('marketing-agent', 'Test Event');
      await flush();

      const script = lastScript();
      expect(script).toContain('tell calendar "OpenClaw - marketing-agent"');
      expect(script).toContain('every event whose summary is "Test Event"');
      expect(script).toContain('delete evt');
    });
  });

  describe('error handling', () => {
    it('warns but does not throw on osascript failure', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockedExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
        cb(new Error('osascript crashed'));
      });

      const push = new LocalCalendarPush(makeConfig());
      // Should not throw
      expect(() => push.pushEvent(makeEvent())).not.toThrow();
      await flush();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('osascript crashed'),
      );
      warnSpy.mockRestore();
      mockedExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => cb?.(null));
    });

    it('passes 10s timeout to execFile', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent());
      await flush();

      const opts = mockedExecFile.mock.calls[0][2] as { timeout: number };
      expect(opts.timeout).toBe(10_000);
    });
  });

  describe('calendar references', () => {
    it('does not use source keyword (removed in modern macOS)', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent());
      await flush();

      const script = lastScript();
      expect(script).not.toContain('of source');
      expect(script).not.toContain('targetSource');
    });

    it('uses name list check for calendar existence', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent());
      await flush();

      const script = lastScript();
      expect(script).toContain('set calNames to name of every calendar');
      expect(script).toContain('calNames does not contain "OpenClaw - marketing-agent"');
    });

    it('references calendars directly by name', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent());
      await flush();

      const script = lastScript();
      expect(script).toContain('tell calendar "OpenClaw - marketing-agent"');
    });

    it('delete script references calendar directly', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.removeEvent('marketing-agent', 'Test Event');
      await flush();

      const script = lastScript();
      expect(script).toContain('tell calendar "OpenClaw - marketing-agent"');
      expect(script).not.toContain('of source');
    });

    it('update script references calendar directly', async () => {
      const push = new LocalCalendarPush(makeConfig());
      push.updateEvent(makeEvent());
      await flush();

      const script = lastScript();
      expect(script).toContain('tell calendar "OpenClaw - marketing-agent"');
      expect(script).not.toContain('of source');
    });
  });
});
