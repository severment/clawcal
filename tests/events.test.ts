import { describe, it, expect } from 'vitest';
import { fromScheduleEvent, fromTaskCompleteEvent, fromCronEvent, fromToolCall, createCheckinEvents, cronToRRule, parseOffset, buildDailyTaskAggregate } from '../src/events';

const alertDefaults = {
  scheduled_posts: [15],
  launch_sequences: [15, 60],
  analytics_checkins: [0],
  cron_automations: [0],
  content_drafts: [0],
  reminders: [0],
  task_completions: [],
};

describe('fromScheduleEvent', () => {
  const defaults = { analytics_checkin_offsets: ['24h', '48h', '7d'], event_duration_minutes: 15 };

  it('maps a schedule event to a calendar event with emoji', () => {
    const event = fromScheduleEvent({
      id: 'sched-1',
      type: 'post',
      summary: 'Tweet: MyApp v2 launch',
      scheduledAt: new Date('2025-02-25T12:00:00Z'),
      agentId: 'agent-1',
      workspace: 'myproject',
    }, defaults);

    expect(event.uid).toBe('sched-1');
    expect(event.title).toBe('🐦 Tweet: MyApp v2 launch');
    expect(event.start).toEqual(new Date('2025-02-25T12:00:00Z'));
    expect(event.duration).toBe(15);
    expect(event.category).toBe('post');
    expect(event.agent).toBe('agent-1');
    expect(event.project).toBe('myproject');
    expect(event.status).toBe('PLANNED');
  });

  it('uses estimated duration when provided', () => {
    const event = fromScheduleEvent({
      id: 'sched-2',
      type: 'launch',
      summary: 'Product Hunt launch',
      scheduledAt: new Date('2025-02-25T09:00:00Z'),
      estimatedDuration: 60,
    }, defaults);

    expect(event.duration).toBe(60);
    expect(event.title).toBe('📣 Product Hunt launch');
  });
});

describe('fromTaskCompleteEvent', () => {
  it('maps a task completion to an all-day event', () => {
    const event = fromTaskCompleteEvent({
      id: 'task-1',
      summary: 'Landing page shipped',
      completedAt: new Date('2025-02-25T15:30:00Z'),
      agentId: 'agent-1',
      workspace: 'myproject',
    });

    expect(event.uid).toBe('task-1');
    expect(event.title).toBe('✅ Landing page shipped');
    expect(event.allDay).toBe(true);
    expect(event.status).toBe('COMPLETED');
  });
});

describe('fromCronEvent', () => {
  it('maps a cron registration to a recurring event', () => {
    const event = fromCronEvent({
      id: 'cron-1',
      name: 'Weekly digest',
      description: 'Send weekly project digest',
      schedule: '0 8 * * 1',
      agentId: 'agent-1',
    });

    expect(event.uid).toBe('cron-1');
    expect(event.title).toBe('🔄 Weekly digest');
    expect(event.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(event.category).toBe('automation');
  });
});

describe('fromToolCall', () => {
  it('creates a calendar event from tool params', () => {
    const event = fromToolCall({
      title: 'Show HN: utmgate',
      date: '2025-02-25T09:00:00-05:00',
      category: 'launch',
      description: 'Post Show HN at 9am ET',
      duration: 30,
    });

    expect(event.title).toBe('📣 Show HN: utmgate');
    expect(event.start).toEqual(new Date('2025-02-25T09:00:00-05:00'));
    expect(event.duration).toBe(30);
    expect(event.category).toBe('launch');
    expect(event.status).toBe('PLANNED');
    expect(event.uid).toBeTruthy();
  });

  it('creates an all-day event', () => {
    const event = fromToolCall({
      title: 'Launch day',
      date: '2025-02-25',
      allDay: true,
    });

    expect(event.allDay).toBe(true);
    expect(event.duration).toBeUndefined();
  });

  it('defaults to 15 minutes when no duration specified', () => {
    const event = fromToolCall({
      title: 'Quick check',
      date: '2025-02-25T14:00:00Z',
    });

    expect(event.duration).toBe(15);
  });

  it('passes through url to the calendar event', () => {
    const event = fromToolCall({
      title: 'Check PR',
      date: '2025-02-25T09:00:00Z',
      url: 'https://github.com/org/repo/pull/42',
    });

    expect(event.url).toBe('https://github.com/org/repo/pull/42');
  });

  it('omits url when not provided', () => {
    const event = fromToolCall({
      title: 'No URL',
      date: '2025-02-25T09:00:00Z',
    });

    expect(event.url).toBeUndefined();
  });
});

describe('buildDailyTaskAggregate', () => {
  it('creates aggregate with deterministic UID', () => {
    const date = new Date('2025-02-25T15:00:00Z');
    const event = buildDailyTaskAggregate('dev-agent', date, [
      { summary: 'Fix login bug' },
      { summary: 'Update docs' },
    ]);

    expect(event.uid).toBe('daily-tasks-dev-agent-2025-02-25');
  });

  it('generates title with correct count', () => {
    const date = new Date('2025-02-25T15:00:00Z');

    const single = buildDailyTaskAggregate('dev-agent', date, [
      { summary: 'Fix bug' },
    ]);
    expect(single.title).toBe('Shipped 1 task -- dev-agent');

    const multi = buildDailyTaskAggregate('dev-agent', date, [
      { summary: 'Fix bug' },
      { summary: 'Update docs' },
      { summary: 'Add tests' },
    ]);
    expect(multi.title).toBe('Shipped 3 tasks -- dev-agent');
  });

  it('formats description as bullet-point list', () => {
    const date = new Date('2025-02-25T15:00:00Z');
    const event = buildDailyTaskAggregate('dev-agent', date, [
      { summary: 'Fix login bug' },
      { summary: 'Update docs' },
    ]);

    expect(event.description).toBe('- Fix login bug\n- Update docs');
  });

  it('truncates description at 25 tasks with "+N more"', () => {
    const date = new Date('2025-02-25T15:00:00Z');
    const tasks = Array.from({ length: 30 }, (_, i) => ({ summary: `Task ${i + 1}` }));
    const event = buildDailyTaskAggregate('dev-agent', date, tasks);

    const lines = event.description!.split('\n');
    expect(lines).toHaveLength(26); // 25 shown + 1 "+N more"
    expect(lines[0]).toBe('- Task 1');
    expect(lines[24]).toBe('- Task 25');
    expect(lines[25]).toBe('+ 5 more');
    expect(event.title).toBe('Shipped 30 tasks -- dev-agent');
  });

  it('does not truncate at exactly 25 tasks', () => {
    const date = new Date('2025-02-25T15:00:00Z');
    const tasks = Array.from({ length: 25 }, (_, i) => ({ summary: `Task ${i + 1}` }));
    const event = buildDailyTaskAggregate('dev-agent', date, tasks);

    const lines = event.description!.split('\n');
    expect(lines).toHaveLength(25);
    expect(lines[24]).toBe('- Task 25');
  });

  it('sets all-day, completed status, and agent', () => {
    const date = new Date('2025-02-25T15:00:00Z');
    const event = buildDailyTaskAggregate('dev-agent', date, [
      { summary: 'Task' },
    ]);

    expect(event.allDay).toBe(true);
    expect(event.status).toBe('COMPLETED');
    expect(event.category).toBe('completed');
    expect(event.agent).toBe('dev-agent');
  });
});

describe('createCheckinEvents', () => {
  it('creates check-in events at specified offsets', () => {
    const launchTime = new Date('2025-02-25T09:00:00Z');
    const checkins = createCheckinEvents(
      'launch-1', 'MyApp launch', launchTime,
      ['24h', '48h', '7d'], 'myproject', 'agent-1'
    );

    expect(checkins).toHaveLength(3);

    // +24h
    expect(checkins[0].start).toEqual(new Date('2025-02-26T09:00:00Z'));
    expect(checkins[0].title).toContain('Check analytics');
    expect(checkins[0].uid).toBe('launch-1-checkin-0');
    expect(checkins[0].project).toBe('myproject');

    // +48h
    expect(checkins[1].start).toEqual(new Date('2025-02-27T09:00:00Z'));

    // +7d
    expect(checkins[2].start).toEqual(new Date('2025-03-04T09:00:00Z'));
  });
});

describe('cronToRRule', () => {
  it('converts daily cron to RRULE', () => {
    expect(cronToRRule('0 8 * * *')).toBe('FREQ=DAILY');
  });

  it('converts single day of week', () => {
    expect(cronToRRule('0 8 * * 1')).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(cronToRRule('0 8 * * 5')).toBe('FREQ=WEEKLY;BYDAY=FR');
  });

  it('converts multiple days of week', () => {
    expect(cronToRRule('0 8 * * 1,3,5')).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
  });

  it('converts weekday range', () => {
    expect(cronToRRule('0 8 * * 1-5')).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  });

  it('returns empty string for unsupported patterns', () => {
    expect(cronToRRule('*/5 * * * *')).toBe('');
  });
});

describe('parseOffset', () => {
  it('parses hour offsets', () => {
    expect(parseOffset('24h')).toBe(24 * 3600 * 1000);
    expect(parseOffset('48h')).toBe(48 * 3600 * 1000);
  });

  it('parses day offsets', () => {
    expect(parseOffset('7d')).toBe(7 * 86400 * 1000);
  });

  it('parses minute offsets', () => {
    expect(parseOffset('30m')).toBe(30 * 60 * 1000);
  });

  it('returns 0 for invalid offsets', () => {
    expect(parseOffset('invalid')).toBe(0);
    expect(parseOffset('')).toBe(0);
  });
});

describe('alert defaults', () => {
  const defaultsWithAlerts = {
    analytics_checkin_offsets: ['24h', '48h', '7d'],
    event_duration_minutes: 15,
    alerts: alertDefaults,
  };

  it('attaches alerts to scheduled posts', () => {
    const event = fromScheduleEvent({
      id: 'alert-post',
      type: 'post',
      summary: 'Tweet',
      scheduledAt: new Date('2025-02-25T12:00:00Z'),
    }, defaultsWithAlerts);

    expect(event.alerts).toHaveLength(1);
    expect(event.alerts![0].minutes).toBe(15);
  });

  it('attaches multiple alerts to launch events', () => {
    const event = fromScheduleEvent({
      id: 'alert-launch',
      type: 'launch',
      summary: 'Show HN',
      scheduledAt: new Date('2025-02-25T09:00:00Z'),
    }, defaultsWithAlerts);

    expect(event.alerts).toHaveLength(2);
    expect(event.alerts![0].minutes).toBe(15);
    expect(event.alerts![1].minutes).toBe(60);
  });

  it('skips alerts for task completions (empty array)', () => {
    const event = fromTaskCompleteEvent({
      id: 'alert-task',
      summary: 'Done',
      completedAt: new Date('2025-02-25T15:00:00Z'),
    }, defaultsWithAlerts);

    expect(event.alerts).toBeUndefined();
  });

  it('attaches alerts to checkin events when defaults provided', () => {
    const checkins = createCheckinEvents(
      'launch-1', 'MyApp', new Date('2025-02-25T09:00:00Z'),
      ['24h'], 'proj', 'agent', defaultsWithAlerts
    );

    expect(checkins[0].alerts).toHaveLength(1);
    expect(checkins[0].alerts![0].minutes).toBe(0);
  });

  it('skips alerts when no defaults provided', () => {
    const event = fromScheduleEvent({
      id: 'no-alerts',
      type: 'post',
      summary: 'Tweet',
      scheduledAt: new Date('2025-02-25T12:00:00Z'),
    }, { analytics_checkin_offsets: ['24h'], event_duration_minutes: 15 });

    expect(event.alerts).toBeUndefined();
  });

  it('attaches alerts to cron events when defaults provided', () => {
    const event = fromCronEvent({
      id: 'cron-alert',
      name: 'Weekly digest',
      schedule: '0 8 * * 1',
    }, defaultsWithAlerts);

    expect(event.alerts).toHaveLength(1);
    expect(event.alerts![0].minutes).toBe(0);
  });
});
