import { fromScheduleEvent, fromTaskCompleteEvent, fromCronEvent, createCheckinEvents, buildDailyTaskAggregate } from './events.js';
import { CalendarConfig, CalendarEvent, GatewayScheduleEvent, GatewayTaskCompleteEvent, GatewayCronEvent, GatewayScheduleUpdateEvent, GatewayScheduleCancelEvent } from './types.js';

/**
 * Minimal plugin API interface for hook registration.
 */
interface HookSource {
  registerHook(events: string | string[], handler: (data: any) => void): void;
}

/**
 * Interface for anything that can receive calendar events.
 * Both CalendarManager and FeedManager implement this.
 */
export interface EventSink {
  addEvent(event: CalendarEvent): void;
  updateEvent(uid: string, updates: Partial<CalendarEvent>): void;
  cancelEvent(uid: string): void;
  getEvent(uid: string): CalendarEvent | undefined;
}

/**
 * Register all event listeners on the gateway.
 * Each listener maps gateway events to calendar events.
 */
export function registerListeners(api: HookSource, sink: EventSink, config: CalendarConfig): void {
  // Agent scheduled a future action
  if (config.events.scheduled_posts) {
    api.registerHook('agent:schedule', (event: GatewayScheduleEvent) => {
      const calEvent = fromScheduleEvent(event, config.defaults);
      sink.addEvent(calEvent);

      // If this is a launch, schedule analytics check-ins
      if (config.events.analytics_checkins && event.type === 'launch') {
        const checkins = createCheckinEvents(
          event.id,
          event.summary,
          event.scheduledAt,
          config.defaults.analytics_checkin_offsets,
          event.workspace,
          event.agentId,
          config.defaults,
        );
        for (const checkin of checkins) {
          sink.addEvent(checkin);
        }
      }
    });
  }

  // Agent completed a task
  if (config.events.task_completions) {
    const tcConfig = config.taskCompletions;

    api.registerHook('agent:task:complete', (event: GatewayTaskCompleteEvent) => {
      // Individual event based on mode
      if (tcConfig.mode !== 'off') {
        const calEvent = fromTaskCompleteEvent(event, config.defaults);
        if (tcConfig.mode === 'timed') {
          calEvent.allDay = false;
          calEvent.duration = 15;
        }
        sink.addEvent(calEvent);
      }

      // Daily aggregate
      if (tcConfig.aggregate === 'daily') {
        const agentId = event.agentId || 'unknown';
        const dateStr = event.completedAt.toISOString().slice(0, 10);
        const aggUid = `daily-tasks-${agentId}-${dateStr}`;
        const existing = sink.getEvent(aggUid);

        if (existing) {
          // Parse existing tasks from description and append new one
          const existingTasks = (existing.description || '')
            .split('\n')
            .filter(l => l.startsWith('- '))
            .map(l => ({ summary: l.slice(2) }));
          existingTasks.push({ summary: event.summary });
          const updated = buildDailyTaskAggregate(agentId, event.completedAt, existingTasks);
          sink.updateEvent(aggUid, {
            title: updated.title,
            description: updated.description,
          });
        } else {
          const aggEvent = buildDailyTaskAggregate(agentId, event.completedAt, [{ summary: event.summary }]);
          sink.addEvent(aggEvent);
        }
      }
    });
  }

  // Cron/scheduled automation registered
  if (config.events.cron_automations) {
    api.registerHook('cron:register', (event: GatewayCronEvent) => {
      const calEvent = fromCronEvent(event, config.defaults);
      sink.addEvent(calEvent);
    });
  }

  // Agent updated a previously scheduled event
  api.registerHook('agent:schedule:update', (event: GatewayScheduleUpdateEvent) => {
    const updates: Record<string, any> = {};
    if (event.newTime) updates.start = event.newTime;
    if (event.status) updates.status = event.status;
    sink.updateEvent(event.id, updates);
  });

  // Agent cancelled a scheduled event
  api.registerHook('agent:schedule:cancel', (event: GatewayScheduleCancelEvent) => {
    sink.cancelEvent(event.id);
  });
}
