import { join } from 'path';
import { readdirSync, existsSync } from 'fs';
import { CalendarManager } from './calendar.js';
import { CalendarEvent, FeedsConfig } from './types.js';
import { LocalCalendarPush } from './local-push.js';

/**
 * Manages multiple calendar feeds — one combined feed with all agents,
 * plus individual per-agent feeds. Events are written to the relevant
 * feeds automatically based on the event's agent field.
 *
 * Directory structure:
 *   ~/.openclaw/clawcal/
 *   ├── all-agents.ics          ← combined feed
 *   ├── marketing-agent.ics     ← per-agent feed
 *   ├── dev-agent.ics           ← per-agent feed
 *   └── ...
 */
export class FeedManager {
  private combined: CalendarManager | null = null;
  private agentFeeds: Map<string, CalendarManager> = new Map();
  private directory: string;
  private feedsConfig: FeedsConfig;
  private localPush: LocalCalendarPush | null = null;

  constructor(directory: string, feedsConfig: FeedsConfig, localPush?: LocalCalendarPush) {
    this.directory = directory;
    this.feedsConfig = feedsConfig;
    this.localPush = localPush ?? null;

    if (feedsConfig.combined) {
      this.combined = new CalendarManager(
        join(directory, 'all-agents.ics'),
        'OpenClaw — All Agents'
      );
    }

    // Load existing per-agent feeds from disk
    if (feedsConfig.per_agent && existsSync(directory)) {
      for (const file of readdirSync(directory)) {
        if (!file.endsWith('.ics') || file === 'all-agents.ics' || file === 'agent-calendar.ics') continue;
        const agentId = file.replace(/\.ics$/, '');
        const feed = new CalendarManager(
          join(directory, file),
          `OpenClaw — ${agentId}`
        );
        if (feed.getAllEvents().length > 0) {
          this.agentFeeds.set(agentId, feed);
        }
      }
    }
  }

  addEvent(event: CalendarEvent): void {
    // Always write to combined feed
    if (this.combined) {
      this.combined.addEvent(event);
    }

    // Write to per-agent feed if enabled and agent is specified
    if (this.feedsConfig.per_agent && event.agent) {
      const agentCal = this.getOrCreateAgentFeed(event.agent);
      agentCal.addEvent(event);
    }

    // Push to local Apple Calendar
    if (this.localPush) {
      this.localPush.pushEvent(event);
    }
  }

  updateEvent(uid: string, updates: Partial<CalendarEvent>): void {
    if (this.combined) {
      this.combined.updateEvent(uid, updates);
    }

    // Update across all agent feeds (the event could be in any of them)
    for (const feed of this.agentFeeds.values()) {
      if (feed.getEvent(uid)) {
        feed.updateEvent(uid, updates);
      }
    }

    // Push updated event to local Apple Calendar
    if (this.localPush) {
      const updated = this.getEvent(uid);
      if (updated) {
        this.localPush.updateEvent(updated);
      }
    }
  }

  cancelEvent(uid: string): void {
    // Grab event before it's updated so we can remove from local calendar
    if (this.localPush) {
      const event = this.getEvent(uid);
      if (event?.agent) {
        this.localPush.removeEvent(event.agent, event.title);
      }
    }

    this.updateEvent(uid, { status: 'CANCELLED' });
  }

  removeEvent(uid: string): void {
    // Grab event before deletion so we can remove from local calendar
    if (this.localPush) {
      const event = this.getEvent(uid);
      if (event?.agent) {
        this.localPush.removeEvent(event.agent, event.title);
      }
    }

    if (this.combined) {
      this.combined.removeEvent(uid);
    }

    for (const feed of this.agentFeeds.values()) {
      if (feed.getEvent(uid)) {
        feed.removeEvent(uid);
      }
    }
  }

  getEvent(uid: string): CalendarEvent | undefined {
    // Check combined first, then agent feeds
    if (this.combined) {
      const event = this.combined.getEvent(uid);
      if (event) return event;
    }

    for (const feed of this.agentFeeds.values()) {
      const event = feed.getEvent(uid);
      if (event) return event;
    }

    return undefined;
  }

  getAllEvents(): CalendarEvent[] {
    if (this.combined) {
      return this.combined.getAllEvents();
    }

    // If no combined feed, merge all agent feeds
    const seen = new Set<string>();
    const events: CalendarEvent[] = [];

    for (const feed of this.agentFeeds.values()) {
      for (const event of feed.getAllEvents()) {
        if (!seen.has(event.uid)) {
          seen.add(event.uid);
          events.push(event);
        }
      }
    }

    return events;
  }

  /**
   * Get the combined calendar manager (for serving via HTTP).
   */
  getCombinedFeed(): CalendarManager | null {
    return this.combined;
  }

  /**
   * Get a specific agent's calendar manager (for serving via HTTP).
   */
  getAgentFeed(agentId: string): CalendarManager | undefined {
    return this.agentFeeds.get(agentId);
  }

  /**
   * Get all known agent IDs that have feeds.
   */
  getAgentIds(): string[] {
    return Array.from(this.agentFeeds.keys());
  }

  /**
   * Run cleanup across all feeds.
   */
  cleanup(retentionDays: number, maxEvents: number): number {
    let removed = 0;

    if (this.combined) {
      removed += this.combined.cleanup(retentionDays, maxEvents);
    }

    for (const feed of this.agentFeeds.values()) {
      removed += feed.cleanup(retentionDays, maxEvents);
    }

    return removed;
  }

  private getOrCreateAgentFeed(agentId: string): CalendarManager {
    let feed = this.agentFeeds.get(agentId);
    if (!feed) {
      const safeName = agentId.replace(/[^a-zA-Z0-9_-]/g, '-');
      feed = new CalendarManager(
        join(this.directory, `${safeName}.ics`),
        `OpenClaw — ${agentId}`
      );
      this.agentFeeds.set(agentId, feed);
    }
    return feed;
  }
}
