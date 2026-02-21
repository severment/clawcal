export interface EventAlert {
  minutes: number;      // minutes before event (e.g. 15 = 15min before)
  description?: string; // custom alert message (defaults to event title)
}

export interface CalendarEvent {
  uid: string;
  title: string;
  description?: string;
  start: Date;
  end?: Date;
  duration?: number; // minutes
  allDay?: boolean;
  category?: string;
  agent?: string;
  project?: string;
  status?: EventStatus;
  sequence?: number;
  rrule?: string;
  alerts?: EventAlert[]; // one or more alerts before the event
}

export type EventStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface FeedsConfig {
  combined: boolean;   // one feed with all agents
  per_agent: boolean;  // separate feed per agent
}

export interface LocalPushConfig {
  enabled: boolean;
}

export interface CalendarConfig {
  enabled: boolean;
  file: string;             // legacy single-file path (used when feeds not configured)
  file_directory: string;   // directory for multi-feed output
  feeds: FeedsConfig;
  localPush: LocalPushConfig;
  events: EventTypeConfig;
  defaults: DefaultsConfig;
  cleanup: CleanupConfig;
}

export interface EventTypeConfig {
  scheduled_posts: boolean;
  launch_sequences: boolean;
  task_completions: boolean;
  analytics_checkins: boolean;
  cron_automations: boolean;
  content_drafts: boolean;
  reminders: boolean;
}

export interface AlertDefaults {
  scheduled_posts: number[];     // e.g. [15] = 15min before
  launch_sequences: number[];    // e.g. [15, 60] = 15min and 1hr before
  analytics_checkins: number[];  // e.g. [0] = at event time
  cron_automations: number[];
  content_drafts: number[];      // e.g. [0] = immediate
  reminders: number[];           // e.g. [0] = at event time
  task_completions: number[];    // e.g. [] = no alert (already done)
}

export interface DefaultsConfig {
  analytics_checkin_offsets: string[]; // e.g. ['24h', '48h', '7d']
  event_duration_minutes: number;
  alerts: AlertDefaults;
}

export interface CleanupConfig {
  max_past_events: number;
  retention_days: number;
}

export interface ScheduleToolParams {
  title: string;
  date: string; // ISO 8601
  duration?: number; // minutes
  category?: string;
  description?: string;
  allDay?: boolean;
  agent?: string;
  project?: string;
  alertMinutes?: number;
}

// Gateway event types — matches OpenClaw plugin-sdk
export interface GatewayScheduleEvent {
  id: string;
  type: string;
  scheduledAt: Date;
  estimatedDuration?: number;
  summary: string;
  description?: string;
  agentId?: string;
  workspace?: string;
}

export interface GatewayTaskCompleteEvent {
  id: string;
  summary: string;
  description?: string;
  completedAt: Date;
  agentId?: string;
  workspace?: string;
}

export interface GatewayCronEvent {
  id: string;
  name: string;
  description?: string;
  schedule: string; // cron expression
  agentId?: string;
}

export interface GatewayScheduleUpdateEvent {
  id: string;
  newTime?: Date;
  status?: EventStatus;
}

export interface GatewayScheduleCancelEvent {
  id: string;
}
