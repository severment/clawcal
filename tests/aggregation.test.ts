import { describe, it, expect, beforeEach } from 'vitest';
import { registerListeners, EventSink } from '../src/listener';
import { CalendarConfig, CalendarEvent, GatewayTaskCompleteEvent } from '../src/types';

/**
 * Mock HookSource that captures registered handlers so we can fire events manually.
 */
class MockHookSource {
  private handlers: Map<string, ((data: any) => void)[]> = new Map();

  registerHook(events: string | string[], handler: (data: any) => void): void {
    const eventList = Array.isArray(events) ? events : [events];
    for (const event of eventList) {
      const existing = this.handlers.get(event) || [];
      existing.push(handler);
      this.handlers.set(event, existing);
    }
  }

  fire(event: string, data: any): void {
    const handlers = this.handlers.get(event) || [];
    for (const handler of handlers) {
      handler(data);
    }
  }
}

/**
 * Mock EventSink backed by a simple Map, matching FeedManager/CalendarManager semantics.
 */
class MockEventSink implements EventSink {
  events: Map<string, CalendarEvent> = new Map();

  addEvent(event: CalendarEvent): void {
    this.events.set(event.uid, event);
  }

  updateEvent(uid: string, updates: Partial<CalendarEvent>): void {
    const existing = this.events.get(uid);
    if (!existing) return;
    this.events.set(uid, {
      ...existing,
      ...updates,
      sequence: (existing.sequence || 0) + 1,
    });
  }

  cancelEvent(uid: string): void {
    this.updateEvent(uid, { status: 'CANCELLED' });
  }

  getEvent(uid: string): CalendarEvent | undefined {
    return this.events.get(uid);
  }
}

function makeConfig(overrides: Partial<CalendarConfig> = {}): CalendarConfig {
  return {
    file: '/tmp/test.ics',
    file_directory: '/tmp/',
    feeds: { combined: true, per_agent: false },
    localPush: { enabled: false, calendarSource: 'iCloud' },
    events: {
      scheduled_posts: false,
      launch_sequences: false,
      task_completions: true,
      analytics_checkins: false,
      cron_automations: false,
      content_drafts: false,
      reminders: false,
    },
    taskCompletions: { mode: 'all_day', aggregate: 'none' },
    defaults: {
      analytics_checkin_offsets: ['24h'],
      event_duration_minutes: 15,
      alerts: {
        scheduled_posts: [],
        launch_sequences: [],
        analytics_checkins: [],
        cron_automations: [],
        content_drafts: [],
        reminders: [],
        task_completions: [],
      },
    },
    cleanup: { max_past_events: 100, retention_days: 90 },
    ...overrides,
  };
}

function makeTaskEvent(id: string, summary: string, agentId = 'dev-agent', date = '2025-02-25T15:00:00Z'): GatewayTaskCompleteEvent {
  return { id, summary, completedAt: new Date(date), agentId };
}

describe('task completion aggregation', () => {
  let hooks: MockHookSource;
  let sink: MockEventSink;

  beforeEach(() => {
    hooks = new MockHookSource();
    sink = new MockEventSink();
  });

  describe('default mode (all_day, no aggregation)', () => {
    it('creates individual all-day events', () => {
      registerListeners(hooks, sink, makeConfig());

      hooks.fire('agent:task:complete', makeTaskEvent('t1', 'Fix login bug'));
      hooks.fire('agent:task:complete', makeTaskEvent('t2', 'Update docs'));

      expect(sink.events.size).toBe(2);
      const e1 = sink.getEvent('t1');
      expect(e1?.allDay).toBe(true);
      expect(e1?.title).toContain('Fix login bug');
    });
  });

  describe('mode: timed', () => {
    it('creates timed events instead of all-day', () => {
      registerListeners(hooks, sink, makeConfig({
        taskCompletions: { mode: 'timed', aggregate: 'none' },
      }));

      hooks.fire('agent:task:complete', makeTaskEvent('t1', 'Fix bug'));

      const event = sink.getEvent('t1');
      expect(event?.allDay).toBe(false);
      expect(event?.duration).toBe(15);
    });
  });

  describe('mode: off', () => {
    it('skips individual events', () => {
      registerListeners(hooks, sink, makeConfig({
        taskCompletions: { mode: 'off', aggregate: 'none' },
      }));

      hooks.fire('agent:task:complete', makeTaskEvent('t1', 'Fix bug'));

      // No individual event
      expect(sink.getEvent('t1')).toBeUndefined();
      expect(sink.events.size).toBe(0);
    });
  });

  describe('aggregate: daily', () => {
    it('creates daily aggregate on first task', () => {
      registerListeners(hooks, sink, makeConfig({
        taskCompletions: { mode: 'off', aggregate: 'daily' },
      }));

      hooks.fire('agent:task:complete', makeTaskEvent('t1', 'Fix login bug', 'dev-agent', '2025-02-25T15:00:00Z'));

      const agg = sink.getEvent('daily-tasks-dev-agent-2025-02-25');
      expect(agg).toBeDefined();
      expect(agg?.title).toBe('Shipped 1 task -- dev-agent');
      expect(agg?.description).toBe('- Fix login bug');
      expect(agg?.allDay).toBe(true);
    });

    it('updates existing aggregate with subsequent tasks', () => {
      registerListeners(hooks, sink, makeConfig({
        taskCompletions: { mode: 'off', aggregate: 'daily' },
      }));

      hooks.fire('agent:task:complete', makeTaskEvent('t1', 'Fix login bug', 'dev-agent', '2025-02-25T15:00:00Z'));
      hooks.fire('agent:task:complete', makeTaskEvent('t2', 'Update docs', 'dev-agent', '2025-02-25T16:00:00Z'));

      const agg = sink.getEvent('daily-tasks-dev-agent-2025-02-25');
      expect(agg?.title).toBe('Shipped 2 tasks -- dev-agent');
      expect(agg?.description).toBe('- Fix login bug\n- Update docs');
      expect(agg?.sequence).toBe(1); // incremented by updateEvent
    });

    it('creates separate aggregates per agent', () => {
      registerListeners(hooks, sink, makeConfig({
        taskCompletions: { mode: 'off', aggregate: 'daily' },
      }));

      hooks.fire('agent:task:complete', makeTaskEvent('t1', 'Fix bug', 'dev-agent', '2025-02-25T15:00:00Z'));
      hooks.fire('agent:task:complete', makeTaskEvent('t2', 'Write post', 'marketing-agent', '2025-02-25T16:00:00Z'));

      expect(sink.getEvent('daily-tasks-dev-agent-2025-02-25')).toBeDefined();
      expect(sink.getEvent('daily-tasks-marketing-agent-2025-02-25')).toBeDefined();
      expect(sink.getEvent('daily-tasks-dev-agent-2025-02-25')?.title).toBe('Shipped 1 task -- dev-agent');
      expect(sink.getEvent('daily-tasks-marketing-agent-2025-02-25')?.title).toBe('Shipped 1 task -- marketing-agent');
    });

    it('creates separate aggregates per day', () => {
      registerListeners(hooks, sink, makeConfig({
        taskCompletions: { mode: 'off', aggregate: 'daily' },
      }));

      hooks.fire('agent:task:complete', makeTaskEvent('t1', 'Day 1 task', 'dev-agent', '2025-02-25T15:00:00Z'));
      hooks.fire('agent:task:complete', makeTaskEvent('t2', 'Day 2 task', 'dev-agent', '2025-02-26T10:00:00Z'));

      expect(sink.getEvent('daily-tasks-dev-agent-2025-02-25')?.title).toBe('Shipped 1 task -- dev-agent');
      expect(sink.getEvent('daily-tasks-dev-agent-2025-02-26')?.title).toBe('Shipped 1 task -- dev-agent');
    });
  });

  describe('mode + aggregate combined', () => {
    it('creates both individual events and daily aggregate', () => {
      registerListeners(hooks, sink, makeConfig({
        taskCompletions: { mode: 'all_day', aggregate: 'daily' },
      }));

      hooks.fire('agent:task:complete', makeTaskEvent('t1', 'Fix bug', 'dev-agent', '2025-02-25T15:00:00Z'));
      hooks.fire('agent:task:complete', makeTaskEvent('t2', 'Update docs', 'dev-agent', '2025-02-25T16:00:00Z'));

      // Individual events
      expect(sink.getEvent('t1')).toBeDefined();
      expect(sink.getEvent('t2')).toBeDefined();

      // Aggregate event
      const agg = sink.getEvent('daily-tasks-dev-agent-2025-02-25');
      expect(agg).toBeDefined();
      expect(agg?.title).toBe('Shipped 2 tasks -- dev-agent');
    });
  });

  describe('events.task_completions: false', () => {
    it('does not register any handler', () => {
      registerListeners(hooks, sink, makeConfig({
        events: {
          scheduled_posts: false,
          launch_sequences: false,
          task_completions: false,
          analytics_checkins: false,
          cron_automations: false,
          content_drafts: false,
          reminders: false,
        },
      }));

      hooks.fire('agent:task:complete', makeTaskEvent('t1', 'Fix bug'));
      expect(sink.events.size).toBe(0);
    });
  });
});
