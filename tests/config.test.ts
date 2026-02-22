import { describe, it, expect } from 'vitest';
import { deepMerge, mergeConfig } from '../src/config';
import { CalendarConfig } from '../src/types';

const DEFAULT_CONFIG: CalendarConfig = {
  file: '~/.openclaw/clawcal/agent-calendar.ics',
  file_directory: '~/.openclaw/clawcal/',
  feeds: {
    combined: true,
    per_agent: true,
  },
  localPush: {
    enabled: true,
  },
  events: {
    scheduled_posts: true,
    launch_sequences: true,
    task_completions: true,
    analytics_checkins: true,
    cron_automations: true,
    content_drafts: true,
    reminders: true,
  },
  defaults: {
    analytics_checkin_offsets: ['24h', '48h', '7d'],
    event_duration_minutes: 15,
    alerts: {
      scheduled_posts: [15],
      launch_sequences: [15, 60],
      analytics_checkins: [0],
      cron_automations: [0],
      content_drafts: [0],
      reminders: [0],
      task_completions: [],
    },
  },
  cleanup: {
    max_past_events: 100,
    retention_days: 90,
  },
};

describe('deepMerge', () => {
  it('returns defaults when no overrides', () => {
    const result = deepMerge(DEFAULT_CONFIG, {});
    expect(result).toEqual(DEFAULT_CONFIG);
  });

  it('overrides a top-level primitive', () => {
    const result = mergeConfig(DEFAULT_CONFIG, { file: '/tmp/test.ics' });
    expect(result.file).toBe('/tmp/test.ics');
    expect(result.feeds).toEqual(DEFAULT_CONFIG.feeds);
    expect(result.defaults).toEqual(DEFAULT_CONFIG.defaults);
  });

  it('partial level-1 override keeps sibling keys', () => {
    const result = mergeConfig(DEFAULT_CONFIG, { feeds: { combined: false } } as any);
    expect(result.feeds.combined).toBe(false);
    expect(result.feeds.per_agent).toBe(true);
  });

  it('partial level-2 override keeps sibling alert types', () => {
    const result = mergeConfig(DEFAULT_CONFIG, {
      defaults: { alerts: { scheduled_posts: [5] } },
    } as any);
    expect(result.defaults.alerts.scheduled_posts).toEqual([5]);
    expect(result.defaults.alerts.launch_sequences).toEqual([15, 60]);
    expect(result.defaults.alerts.analytics_checkins).toEqual([0]);
    expect(result.defaults.alerts.cron_automations).toEqual([0]);
    expect(result.defaults.alerts.content_drafts).toEqual([0]);
    expect(result.defaults.alerts.reminders).toEqual([0]);
    expect(result.defaults.alerts.task_completions).toEqual([]);
  });

  it('partial defaults override keeps alerts and other keys', () => {
    const result = mergeConfig(DEFAULT_CONFIG, {
      defaults: { event_duration_minutes: 30 },
    } as any);
    expect(result.defaults.event_duration_minutes).toBe(30);
    expect(result.defaults.alerts).toEqual(DEFAULT_CONFIG.defaults.alerts);
    expect(result.defaults.analytics_checkin_offsets).toEqual(['24h', '48h', '7d']);
  });

  it('replaces arrays entirely, does not concatenate', () => {
    const result = mergeConfig(DEFAULT_CONFIG, {
      defaults: { alerts: { launch_sequences: [5] } },
    } as any);
    expect(result.defaults.alerts.launch_sequences).toEqual([5]);
  });

  it('ignores undefined values', () => {
    const result = mergeConfig(DEFAULT_CONFIG, { file: undefined } as any);
    expect(result.file).toBe(DEFAULT_CONFIG.file);
  });

  it('does not mutate the base config', () => {
    const baseCopy = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    mergeConfig(DEFAULT_CONFIG, { file: '/tmp/test.ics' });
    expect(DEFAULT_CONFIG).toEqual(baseCopy);
  });
});
