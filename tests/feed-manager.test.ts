import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { FeedManager } from '../src/feed-manager';

const TEST_DIR = '/tmp/clawcal-feed-test';

function cleanDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

describe('FeedManager', () => {
  beforeEach(cleanDir);
  afterEach(cleanDir);

  it('creates combined feed when enabled', () => {
    const feeds = new FeedManager(TEST_DIR, { combined: true, per_agent: false });

    feeds.addEvent({
      uid: 'test-1',
      title: 'Test Event',
      start: new Date('2025-02-25T09:00:00Z'),
      agent: 'marketing-agent',
    });

    expect(existsSync(join(TEST_DIR, 'all-agents.ics'))).toBe(true);
    const content = readFileSync(join(TEST_DIR, 'all-agents.ics'), 'utf-8');
    expect(content).toContain('Test Event');
  });

  it('creates per-agent feeds when enabled', () => {
    const feeds = new FeedManager(TEST_DIR, { combined: false, per_agent: true });

    feeds.addEvent({
      uid: 'test-1',
      title: 'Marketing Event',
      start: new Date('2025-02-25T09:00:00Z'),
      agent: 'marketing-agent',
    });

    feeds.addEvent({
      uid: 'test-2',
      title: 'Dev Event',
      start: new Date('2025-02-25T10:00:00Z'),
      agent: 'dev-agent',
    });

    expect(existsSync(join(TEST_DIR, 'marketing-agent.ics'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'dev-agent.ics'))).toBe(true);

    const marketing = readFileSync(join(TEST_DIR, 'marketing-agent.ics'), 'utf-8');
    expect(marketing).toContain('Marketing Event');
    expect(marketing).not.toContain('Dev Event');

    const dev = readFileSync(join(TEST_DIR, 'dev-agent.ics'), 'utf-8');
    expect(dev).toContain('Dev Event');
    expect(dev).not.toContain('Marketing Event');
  });

  it('writes to both combined and per-agent feeds', () => {
    const feeds = new FeedManager(TEST_DIR, { combined: true, per_agent: true });

    feeds.addEvent({
      uid: 'test-1',
      title: 'Dual Event',
      start: new Date('2025-02-25T09:00:00Z'),
      agent: 'marketing-agent',
    });

    // Combined feed has it
    const combined = readFileSync(join(TEST_DIR, 'all-agents.ics'), 'utf-8');
    expect(combined).toContain('Dual Event');

    // Per-agent feed has it
    const agent = readFileSync(join(TEST_DIR, 'marketing-agent.ics'), 'utf-8');
    expect(agent).toContain('Dual Event');
  });

  it('events without agent go to combined only', () => {
    const feeds = new FeedManager(TEST_DIR, { combined: true, per_agent: true });

    feeds.addEvent({
      uid: 'test-no-agent',
      title: 'Agentless Event',
      start: new Date('2025-02-25T09:00:00Z'),
    });

    const combined = readFileSync(join(TEST_DIR, 'all-agents.ics'), 'utf-8');
    expect(combined).toContain('Agentless Event');

    // No per-agent file should be created
    const files = readdirSync(TEST_DIR);
    expect(files).toEqual(['all-agents.ics']);
  });

  it('updates events across all feeds', () => {
    const feeds = new FeedManager(TEST_DIR, { combined: true, per_agent: true });

    feeds.addEvent({
      uid: 'test-update',
      title: 'Original',
      start: new Date('2025-02-25T09:00:00Z'),
      agent: 'marketing-agent',
      status: 'PLANNED',
    });

    feeds.updateEvent('test-update', { start: new Date('2025-02-26T10:00:00Z') });

    // Check combined
    const combinedEvent = feeds.getCombinedFeed()?.getEvent('test-update');
    expect(combinedEvent?.start.toISOString()).toBe('2025-02-26T10:00:00.000Z');
    expect(combinedEvent?.sequence).toBe(1);

    // Check per-agent
    const agentEvent = feeds.getAgentFeed('marketing-agent')?.getEvent('test-update');
    expect(agentEvent?.start.toISOString()).toBe('2025-02-26T10:00:00.000Z');
    expect(agentEvent?.sequence).toBe(1);
  });

  it('cancels events across all feeds', () => {
    const feeds = new FeedManager(TEST_DIR, { combined: true, per_agent: true });

    feeds.addEvent({
      uid: 'test-cancel',
      title: 'To Cancel',
      start: new Date('2025-02-25T09:00:00Z'),
      agent: 'dev-agent',
      status: 'PLANNED',
    });

    feeds.cancelEvent('test-cancel');

    const combinedEvent = feeds.getCombinedFeed()?.getEvent('test-cancel');
    expect(combinedEvent?.status).toBe('CANCELLED');

    const agentEvent = feeds.getAgentFeed('dev-agent')?.getEvent('test-cancel');
    expect(agentEvent?.status).toBe('CANCELLED');
  });

  it('returns agent IDs', () => {
    const feeds = new FeedManager(TEST_DIR, { combined: true, per_agent: true });

    feeds.addEvent({ uid: 'e1', title: 'E1', start: new Date(), agent: 'agent-a' });
    feeds.addEvent({ uid: 'e2', title: 'E2', start: new Date(), agent: 'agent-b' });
    feeds.addEvent({ uid: 'e3', title: 'E3', start: new Date(), agent: 'agent-a' });

    const ids = feeds.getAgentIds().sort();
    expect(ids).toEqual(['agent-a', 'agent-b']);
  });

  it('sanitizes agent IDs for filenames', () => {
    const feeds = new FeedManager(TEST_DIR, { combined: false, per_agent: true });

    feeds.addEvent({
      uid: 'test-sanitize',
      title: 'Sanitize Test',
      start: new Date(),
      agent: 'agent/with spaces!',
    });

    expect(existsSync(join(TEST_DIR, 'agent-with-spaces-.ics'))).toBe(true);
  });

  it('getAllEvents returns all events when combined enabled', () => {
    const feeds = new FeedManager(TEST_DIR, { combined: true, per_agent: true });

    feeds.addEvent({ uid: 'e1', title: 'E1', start: new Date(), agent: 'agent-a' });
    feeds.addEvent({ uid: 'e2', title: 'E2', start: new Date(), agent: 'agent-b' });

    expect(feeds.getAllEvents()).toHaveLength(2);
  });

  it('getAllEvents merges agent feeds when no combined', () => {
    const feeds = new FeedManager(TEST_DIR, { combined: false, per_agent: true });

    feeds.addEvent({ uid: 'e1', title: 'E1', start: new Date(), agent: 'agent-a' });
    feeds.addEvent({ uid: 'e2', title: 'E2', start: new Date(), agent: 'agent-b' });

    expect(feeds.getAllEvents()).toHaveLength(2);
  });

  it('per-agent calendar names include agent ID', () => {
    const feeds = new FeedManager(TEST_DIR, { combined: true, per_agent: true });

    feeds.addEvent({ uid: 'e1', title: 'E1', start: new Date(), agent: 'marketing-bot' });

    const agentContent = readFileSync(join(TEST_DIR, 'marketing-bot.ics'), 'utf-8');
    expect(agentContent).toContain('X-WR-CALNAME:OpenClaw — marketing-bot');

    const combinedContent = readFileSync(join(TEST_DIR, 'all-agents.ics'), 'utf-8');
    expect(combinedContent).toContain('X-WR-CALNAME:OpenClaw — All Agents');
  });
});
