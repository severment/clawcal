import { CalendarEvent, EventAlert, GatewayScheduleEvent, GatewayTaskCompleteEvent, GatewayCronEvent, DefaultsConfig } from './types.js';

const EMOJI: Record<string, string> = {
  post: '🐦',
  launch: '📣',
  task: '✅',
  review: '📊',
  automation: '🔄',
  draft: '📝',
  reminder: '💬',
};

/**
 * Map a gateway schedule event to a calendar event.
 */
export function fromScheduleEvent(event: GatewayScheduleEvent, defaults: DefaultsConfig): CalendarEvent {
  const emoji = EMOJI[event.type] || EMOJI.post;

  return {
    uid: event.id,
    title: `${emoji} ${event.summary}`,
    description: formatDescription(event),
    start: event.scheduledAt,
    duration: event.estimatedDuration || defaults.event_duration_minutes,
    category: event.type,
    agent: event.agentId,
    project: event.workspace,
    status: 'PLANNED',
    alerts: alertsForCategory(event.type, defaults),
  };
}

/**
 * Map a gateway task completion event to an all-day calendar event.
 */
export function fromTaskCompleteEvent(event: GatewayTaskCompleteEvent, defaults?: DefaultsConfig): CalendarEvent {
  return {
    uid: event.id,
    title: `✅ ${event.summary}`,
    description: formatDescription(event),
    start: event.completedAt,
    allDay: true,
    category: 'completed',
    agent: event.agentId,
    project: event.workspace,
    status: 'COMPLETED',
    alerts: defaults ? alertsForCategory('completed', defaults) : undefined,
  };
}

/**
 * Map a gateway cron registration to a recurring calendar event.
 */
export function fromCronEvent(event: GatewayCronEvent, defaults?: DefaultsConfig): CalendarEvent {
  return {
    uid: event.id,
    title: `🔄 ${event.name}`,
    description: event.description,
    start: new Date(), // starts now
    duration: 15,
    category: 'automation',
    agent: event.agentId,
    rrule: cronToRRule(event.schedule),
    status: 'PLANNED',
    alerts: defaults ? alertsForCategory('automation', defaults) : undefined,
  };
}

/**
 * Generate analytics check-in events after a launch.
 */
export function createCheckinEvents(
  launchId: string,
  launchTitle: string,
  launchTime: Date,
  offsets: string[],
  project?: string,
  agent?: string,
  defaults?: DefaultsConfig,
): CalendarEvent[] {
  return offsets.map((offset, i) => {
    const ms = parseOffset(offset);
    const checkinTime = new Date(launchTime.getTime() + ms);

    return {
      uid: `${launchId}-checkin-${i}`,
      title: `📊 Check analytics — ${launchTitle}`,
      description: `Review metrics ${offset} after launch.\nLook at traffic sources, attribution data, and engagement.`,
      start: checkinTime,
      duration: 15,
      category: 'review',
      project,
      agent,
      status: 'PLANNED',
      alerts: defaults ? alertsForCategory('review', defaults) : undefined,
    };
  });
}

/**
 * Create a calendar event from the clawcal_schedule tool params.
 */
export function fromToolCall(params: {
  title: string;
  date: string;
  duration?: number;
  category?: string;
  description?: string;
  allDay?: boolean;
  agent?: string;
  project?: string;
  url?: string;
  alertMinutes?: number;
}, defaults?: DefaultsConfig): CalendarEvent {
  const emoji = params.category ? (EMOJI[params.category] || '') : '';
  const title = emoji ? `${emoji} ${params.title}` : params.title;

  // Explicit alertMinutes overrides category defaults
  const alerts = params.alertMinutes !== undefined
    ? [{ minutes: params.alertMinutes }]
    : (params.category && defaults ? alertsForCategory(params.category, defaults) : undefined);

  return {
    uid: generateUID(),
    title,
    description: params.description,
    start: new Date(params.date),
    duration: params.allDay ? undefined : (params.duration || 15),
    allDay: params.allDay || false,
    category: params.category,
    agent: params.agent,
    project: params.project,
    url: params.url,
    status: 'PLANNED',
    alerts,
  };
}

/**
 * Build EventAlert[] from the alert defaults for a given category.
 */
function alertsForCategory(category: string, defaults: DefaultsConfig): EventAlert[] | undefined {
  if (!defaults.alerts) return undefined;

  const categoryMap: Record<string, keyof typeof defaults.alerts> = {
    post: 'scheduled_posts',
    launch: 'launch_sequences',
    review: 'analytics_checkins',
    automation: 'cron_automations',
    draft: 'content_drafts',
    reminder: 'reminders',
    completed: 'task_completions',
  };

  const key = categoryMap[category];
  if (!key) return undefined;

  const minutes = defaults.alerts[key];
  if (!minutes || minutes.length === 0) return undefined;

  return minutes.map(m => ({ minutes: m }));
}

/**
 * Build a single daily aggregate event rolling up task completions for one agent.
 * Deterministic UID means same-day updates increment SEQUENCE via updateEvent().
 */
export function buildDailyTaskAggregate(
  agentId: string,
  date: Date,
  tasks: Array<{ summary: string }>,
): CalendarEvent {
  const dateStr = date.toISOString().slice(0, 10);
  const count = tasks.length;
  const noun = count === 1 ? 'task' : 'tasks';
  return {
    uid: `daily-tasks-${agentId}-${dateStr}`,
    title: `Shipped ${count} ${noun} -- ${agentId}`,
    description: tasks.map(t => `- ${t.summary}`).join('\n'),
    start: date,
    allDay: true,
    category: 'completed',
    agent: agentId,
    status: 'COMPLETED',
  };
}

// --- Helpers ---

function formatDescription(event: { summary: string; description?: string; agentId?: string; workspace?: string }): string {
  const parts: string[] = [];

  if (event.description) {
    parts.push(event.description);
  }

  if (event.agentId) {
    parts.push(`Agent: ${event.agentId}`);
  }

  if (event.workspace) {
    parts.push(`Project: ${event.workspace}`);
  }

  return parts.join('\n');
}

/**
 * Convert common cron patterns to iCal RRULE.
 * Handles standard patterns; falls back to empty string for exotic schedules.
 */
export function cronToRRule(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return '';

  const [minute, hour, , , dayOfWeek] = parts;

  // Sub-hourly patterns (*/5 * * * *) can't be represented as RRULE
  if (minute.includes('/') || minute.includes(',') || hour.includes('/')) {
    return '';
  }

  // Every day
  if (dayOfWeek === '*') {
    return 'FREQ=DAILY';
  }

  // Specific day of week
  const dayMap: Record<string, string> = {
    '0': 'SU', '1': 'MO', '2': 'TU', '3': 'WE',
    '4': 'TH', '5': 'FR', '6': 'SA', '7': 'SU',
    'SUN': 'SU', 'MON': 'MO', 'TUE': 'TU', 'WED': 'WE',
    'THU': 'TH', 'FRI': 'FR', 'SAT': 'SA',
  };

  // Single day: "0 8 * * 1" → FREQ=WEEKLY;BYDAY=MO
  if (dayMap[dayOfWeek.toUpperCase()]) {
    return `FREQ=WEEKLY;BYDAY=${dayMap[dayOfWeek.toUpperCase()]}`;
  }

  // Multiple days: "0 8 * * 1,3,5" → FREQ=WEEKLY;BYDAY=MO,WE,FR
  if (dayOfWeek.includes(',')) {
    const days = dayOfWeek.split(',')
      .map(d => dayMap[d.trim().toUpperCase()])
      .filter(Boolean);
    if (days.length > 0) {
      return `FREQ=WEEKLY;BYDAY=${days.join(',')}`;
    }
  }

  // Weekdays: "0 8 * * 1-5"
  if (dayOfWeek === '1-5') {
    return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  }

  return '';
}

/**
 * Parse offset strings like '24h', '48h', '7d' to milliseconds.
 */
export function parseOffset(offset: string): number {
  const match = offset.match(/^(\d+)(h|d|m)$/);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 3600 * 1000;
    case 'd': return value * 86400 * 1000;
    default: return 0;
  }
}

function generateUID(): string {
  return `cc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
