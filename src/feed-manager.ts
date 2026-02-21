import { join } from 'path';
import { CalendarManager } from './calendar';
import { CalendarEvent, FeedsConfig } from './types';

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

  constructor(directory: string, feedsConfig: FeedsConfig) {
    this.directory = directory;
    this.feedsConfig = feedsConfig;

    if (feedsConfig.combined) {
      this.combined = new CalendarManager(
        join(directory, 'all-agents.ics'),
        'OpenClaw — All Agents'
      );
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
  }

  cancelEvent(uid: string): void {
    this.updateEvent(uid, { status: 'CANCELLED' });
  }

  removeEvent(uid: string): void {
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
