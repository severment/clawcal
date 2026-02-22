import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { LocalCalendarPush } from '../src/local-push';
import { CalendarEvent, LocalPushConfig } from '../src/types';

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => cb?.(null)),
}));

const mockedExecFile = vi.mocked(execFile);

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
    it('generates calendar creation + event creation AppleScript', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent());

      expect(mockedExecFile).toHaveBeenCalledOnce();
      expect(mockedExecFile.mock.calls[0][0]).toBe('osascript');

      const script = lastScript();
      expect(script).toContain('tell application "Calendar"');
      expect(script).toContain('"OpenClaw — marketing-agent"');
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

    it('includes display alarms for alerts', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({
        alerts: [{ minutes: 15 }, { minutes: 60 }],
      }));

      const script = lastScript();
      expect(script).toContain('trigger interval:-15');
      expect(script).toContain('trigger interval:-60');
      expect(script).toContain('display alarm');
    });

    it('sets allday event property when allDay is true', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ allDay: true }));

      const script = lastScript();
      expect(script).toContain('allday event:true');
    });

    it('sets description when present', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ description: 'Launch the v2 campaign' }));

      const script = lastScript();
      expect(script).toContain('set description of newEvent to "Launch the v2 campaign"');
    });

    it('uses duration to compute end date', () => {
      const push = new LocalCalendarPush(makeConfig());
      const start = new Date(2025, 2, 15, 14, 0, 0);
      push.pushEvent(makeEvent({ start, duration: 30 }));

      const script = lastScript();
      // End date should be 14:30
      expect(script).toContain('set minutes of endDate to 30');
    });

    it('defaults to 15 minutes duration when no end or duration', () => {
      const push = new LocalCalendarPush(makeConfig());
      const start = new Date(2025, 2, 15, 14, 0, 0);
      push.pushEvent(makeEvent({ start, end: undefined, duration: undefined }));

      const script = lastScript();
      // End date should be 14:15
      expect(script).toContain('set minutes of endDate to 15');
    });
  });

  describe('date formatting', () => {
    it('uses component assignment for locale-safe dates', () => {
      const push = new LocalCalendarPush(makeConfig());
      const date = new Date(2025, 11, 25, 9, 5, 30); // Dec 25 2025, 9:05:30 AM
      push.pushEvent(makeEvent({ start: date }));

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
    it('escapes double quotes in event titles', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ title: 'Launch "Beta" v2' }));

      const script = lastScript();
      expect(script).toContain('summary:"Launch \\"Beta\\" v2"');
    });

    it('escapes backslashes in event titles', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ title: 'Path C:\\Users' }));

      const script = lastScript();
      expect(script).toContain('summary:"Path C:\\\\Users"');
    });

    it('escapes quotes in calendar names', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ agent: 'agent "special"' }));

      const script = lastScript();
      expect(script).toContain('"OpenClaw — agent \\"special\\""');
    });
  });

  describe('calendar caching', () => {
    it('creates calendar only on first push for an agent', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent());
      push.pushEvent(makeEvent({ uid: 'test-uid-2', title: 'Second Event' }));

      expect(mockedExecFile).toHaveBeenCalledTimes(2);

      const firstScript = (mockedExecFile.mock.calls[0][1] as string[])[1];
      const secondScript = (mockedExecFile.mock.calls[1][1] as string[])[1];

      expect(firstScript).toContain('make new calendar');
      expect(secondScript).not.toContain('make new calendar');
    });

    it('creates separate calendars for different agents', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent({ agent: 'agent-a' }));
      push.pushEvent(makeEvent({ uid: 'test-uid-2', agent: 'agent-b' }));

      const scriptA = (mockedExecFile.mock.calls[0][1] as string[])[1];
      const scriptB = (mockedExecFile.mock.calls[1][1] as string[])[1];

      expect(scriptA).toContain('"OpenClaw — agent-a"');
      expect(scriptB).toContain('"OpenClaw — agent-b"');
      expect(scriptA).toContain('make new calendar');
      expect(scriptB).toContain('make new calendar');
    });
  });

  describe('updateEvent', () => {
    it('deletes then recreates the event', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.updateEvent(makeEvent());

      const script = lastScript();
      // Should contain delete (matching by summary) and create
      expect(script).toContain('delete evt');
      expect(script).toContain('every event whose summary is "Test Event"');
      expect(script).toContain('make new event');
    });
  });

  describe('removeEvent', () => {
    it('deletes events by summary match', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.removeEvent('marketing-agent', 'Test Event');

      const script = lastScript();
      expect(script).toContain('tell calendar "OpenClaw — marketing-agent" of source "iCloud"');
      expect(script).toContain('every event whose summary is "Test Event"');
      expect(script).toContain('delete evt');
    });
  });

  describe('error handling', () => {
    it('warns but does not throw on osascript failure', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockedExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
        cb(new Error('osascript crashed'));
      });

      const push = new LocalCalendarPush(makeConfig());
      // Should not throw
      expect(() => push.pushEvent(makeEvent())).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('osascript crashed'),
      );
      warnSpy.mockRestore();
      mockedExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => cb?.(null));
    });

    it('passes 10s timeout to execFile', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent());

      const opts = mockedExecFile.mock.calls[0][2] as { timeout: number };
      expect(opts.timeout).toBe(10_000);
    });
  });

  describe('calendarSource', () => {
    it('default iCloud source targets iCloud in AppleScript', () => {
      const push = new LocalCalendarPush(makeConfig());
      push.pushEvent(makeEvent());

      const script = lastScript();
      expect(script).toContain('first source whose name is "iCloud"');
      expect(script).toContain('make new calendar at targetSource');
      expect(script).toContain('calendar "OpenClaw — marketing-agent" of source "iCloud"');
    });

    it('custom calendarSource targets that account', () => {
      const push = new LocalCalendarPush(makeConfig({ calendarSource: 'Gmail' }));
      push.pushEvent(makeEvent());

      const script = lastScript();
      expect(script).toContain('first source whose name is "Gmail"');
      expect(script).toContain('calendar "OpenClaw — marketing-agent" of source "Gmail"');
    });

    it('Exchange source targets Exchange account', () => {
      const push = new LocalCalendarPush(makeConfig({ calendarSource: 'Exchange' }));
      push.pushEvent(makeEvent());

      const script = lastScript();
      expect(script).toContain('first source whose name is "Exchange"');
      expect(script).toContain('calendar "OpenClaw — marketing-agent" of source "Exchange"');
    });

    it('delete script references the correct source', () => {
      const push = new LocalCalendarPush(makeConfig({ calendarSource: 'Gmail' }));
      push.removeEvent('marketing-agent', 'Test Event');

      const script = lastScript();
      expect(script).toContain('calendar "OpenClaw — marketing-agent" of source "Gmail"');
    });

    it('update script references the correct source', () => {
      const push = new LocalCalendarPush(makeConfig({ calendarSource: 'Exchange' }));
      push.updateEvent(makeEvent());

      const script = lastScript();
      expect(script).toContain('calendar "OpenClaw — marketing-agent" of source "Exchange"');
    });
  });
});
