/**
 * Generate sample .ics files to test with your calendar app.
 * Run: npx tsx tests/generate-sample.ts
 * Then subscribe to the feeds in Apple Calendar.
 *
 * Output:
 *   ~/.openclaw/clawcal/all-agents.ics         ← combined feed
 *   ~/.openclaw/clawcal/marketing-agent.ics    ← marketing agent only
 *   ~/.openclaw/clawcal/dev-agent.ics          ← dev agent only
 */
import { FeedManager } from '../src/feed-manager';
import { fromScheduleEvent, fromTaskCompleteEvent, createCheckinEvents, fromCronEvent } from '../src/events';

const homedir = process.env.HOME || '';
const directory = `${homedir}/.openclaw/clawcal`;

const feeds = new FeedManager(directory, { combined: true, per_agent: true });
const defaults = {
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
};

// Simulate a launch sequence
const now = new Date();
const tomorrow = new Date(now.getTime() + 86400000);
const dayAfter = new Date(now.getTime() + 2 * 86400000);

// 1. Show HN post scheduled for tomorrow 9am
const hnTime = new Date(tomorrow);
hnTime.setHours(9, 0, 0, 0);
feeds.addEvent(fromScheduleEvent({
  id: 'sample-hn',
  type: 'launch',
  summary: 'Show HN: utmgate — one file that makes your agent marketing-aware',
  scheduledAt: hnTime,
  estimatedDuration: 30,
  agentId: 'marketing-agent',
  workspace: 'utmgate',
}, defaults));

// 2. Tweet scheduled for tomorrow noon
const tweetTime = new Date(tomorrow);
tweetTime.setHours(12, 0, 0, 0);
feeds.addEvent(fromScheduleEvent({
  id: 'sample-tweet',
  type: 'post',
  summary: 'Tweet: utmgate launch announcement',
  description: 'Your agent ships code but forgets to tell anyone. utmgate fixes that.',
  scheduledAt: tweetTime,
  agentId: 'marketing-agent',
  workspace: 'utmgate',
}, defaults));

// 3. Reddit post day after tomorrow
const redditTime = new Date(dayAfter);
redditTime.setHours(10, 0, 0, 0);
feeds.addEvent(fromScheduleEvent({
  id: 'sample-reddit',
  type: 'post',
  summary: 'Reddit: r/webdev — utmgate launch',
  scheduledAt: redditTime,
  agentId: 'marketing-agent',
  workspace: 'utmgate',
}, defaults));

// 4. Task completed today
feeds.addEvent(fromTaskCompleteEvent({
  id: 'sample-task',
  summary: 'Landing page shipped — utmgate.dev',
  completedAt: now,
  agentId: 'dev-agent',
  workspace: 'utmgate',
}));

// 5. Analytics check-ins after the HN launch
const checkins = createCheckinEvents(
  'sample-hn', 'utmgate Show HN', hnTime,
  ['24h', '48h', '7d'], 'utmgate', 'marketing-agent', defaults
);
for (const checkin of checkins) {
  feeds.addEvent(checkin);
}

// 6. Weekly digest cron
feeds.addEvent(fromCronEvent({
  id: 'sample-cron',
  name: 'Weekly project digest',
  description: 'Send a summary of all agent activity this week',
  schedule: '0 8 * * 1',
  agentId: 'marketing-agent',
}));

const allEvents = feeds.getAllEvents();
const agentIds = feeds.getAgentIds();

console.log(`Generated ${allEvents.length} events across ${agentIds.length + 1} feeds`);
console.log('');
console.log('Feeds:');
console.log(`  Combined:  ${directory}/all-agents.ics`);
for (const id of agentIds) {
  console.log(`  ${id}:  ${directory}/${id}.ics`);
}
console.log('');
console.log('To open all feeds in Apple Calendar:');
console.log(`  open "${directory}/all-agents.ics"`);
for (const id of agentIds) {
  console.log(`  open "${directory}/${id}.ics"`);
}
console.log('');
console.log('Or subscribe via File → New Calendar Subscription:');
console.log(`  file://${directory}/all-agents.ics          ← everything`);
for (const id of agentIds) {
  console.log(`  file://${directory}/${id}.ics   ← just ${id}`);
}
