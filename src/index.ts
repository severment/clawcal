import { IncomingMessage, ServerResponse } from 'http';
import { FeedManager } from './feed-manager';
import { registerListeners } from './listener';
import { fromToolCall } from './events';
import { CalendarConfig, ScheduleToolParams } from './types';

/**
 * Minimal plugin API interface — matches OpenClawPluginApi from plugin-sdk.
 * We only declare what ClawCal actually uses.
 */
interface PluginApi {
  config: {
    gateway?: {
      auth?: {
        mode?: string;
        token?: string;
        password?: string;
        allowTailscale?: boolean;
        trustedProxy?: {
          userHeader: string;
          requiredHeaders?: string[];
          allowUsers?: string[];
        };
      };
    };
  };
  registerHttpRoute(params: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }): void;
  registerTool(tool: any): void;
  registerHook(events: string | string[], handler: (data: any) => void): void;
}

const DEFAULT_CONFIG: CalendarConfig = {
  enabled: true,
  file: '~/.openclaw/clawcal/agent-calendar.ics',
  file_directory: '~/.openclaw/clawcal/',
  feeds: {
    combined: true,
    per_agent: true,
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

/**
 * Plugin entry point. Called by OpenClaw when the extension loads.
 */
export function register(api: PluginApi, userConfig?: Partial<CalendarConfig>): FeedManager {
  const config: CalendarConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const directory = resolvePath(config.file_directory);

  const feeds = new FeedManager(directory, config.feeds);

  if (!config.enabled) {
    return feeds;
  }

  const authConfig = api.config.gateway?.auth;

  // Register gateway event listeners
  registerListeners(api, feeds, config);

  // --- HTTP routes (all protected by gateway auth) ---

  // Combined feed: /clawcal/feed.ics
  if (config.feeds.combined) {
    api.registerHttpRoute({
      path: '/clawcal/feed.ics',
      handler: (req, res) => {
        if (!checkAuth(req, res, authConfig)) return;

        const combined = feeds.getCombinedFeed();
        if (!combined) {
          res.statusCode = 404;
          res.end('Combined feed not enabled');
          return;
        }
        serveICS(res, combined.toICS(), 'all-agents.ics');
      },
    });
  }

  // Per-agent feeds: /clawcal/feed/:agentId.ics
  if (config.feeds.per_agent) {
    api.registerHttpRoute({
      path: '/clawcal/feed/:agentId.ics',
      handler: (req, res) => {
        if (!checkAuth(req, res, authConfig)) return;

        const agentId = (req as any).params?.agentId;
        if (!agentId) {
          res.statusCode = 400;
          res.end('Missing agent ID');
          return;
        }

        const agentFeed = feeds.getAgentFeed(agentId);
        if (!agentFeed) {
          res.statusCode = 404;
          res.end(`No feed found for agent "${agentId}"`);
          return;
        }

        serveICS(res, agentFeed.toICS(), `${agentId}.ics`);
      },
    });

    // List available agent feeds: /clawcal/feeds
    api.registerHttpRoute({
      path: '/clawcal/feeds',
      handler: (req, res) => {
        if (!checkAuth(req, res, authConfig)) return;

        const agents = feeds.getAgentIds();
        const response = {
          combined: config.feeds.combined ? '/clawcal/feed.ics' : null,
          agents: agents.map(id => ({
            id,
            url: `/clawcal/feed/${id}.ics`,
          })),
        };
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(response, null, 2));
      },
    });
  }

  // Register the clawcal_schedule tool for agents
  api.registerTool({
    name: 'clawcal_schedule',
    description: 'Add an event to the marketing calendar',
    parameters: {
      title: { type: 'string', required: true, description: 'Event title' },
      date: { type: 'string', required: true, description: 'ISO 8601 date/time' },
      duration: { type: 'number', description: 'Duration in minutes (default 15)' },
      category: { type: 'string', description: 'Event category: post, launch, review, task, automation, draft, reminder' },
      description: { type: 'string', description: 'Event description with context and links' },
      allDay: { type: 'boolean', description: 'Whether this is an all-day event' },
    },
    handler: (params: ScheduleToolParams) => {
      const event = fromToolCall(params);
      feeds.addEvent(event);
      return { success: true, uid: event.uid, message: `Added "${event.title}" to calendar` };
    },
  });

  // Run cleanup periodically (every hour)
  setInterval(() => {
    feeds.cleanup(config.cleanup.retention_days, config.cleanup.max_past_events);
  }, 3600000);

  return feeds;
}

/**
 * Check the incoming request against the gateway's auth config.
 * Supports token mode (Bearer or Basic), password mode (Basic auth),
 * and trusted-proxy mode (required headers + user header).
 * Returns true if authorized, false if rejected (response already sent).
 */
export function checkAuth(
  req: IncomingMessage,
  res: ServerResponse,
  authConfig?: PluginApi['config']['gateway']['auth'],
): boolean {
  // No auth configured — allow (user chose this deliberately)
  if (!authConfig || !authConfig.mode || authConfig.mode === 'none') {
    return true;
  }

  if (authConfig.mode === 'token') {
    const token = authConfig.token?.trim();
    if (!token) return true; // no token set, nothing to check

    // Accept Bearer token or Basic auth with token as password
    const authHeader = req.headers.authorization || '';

    if (authHeader.startsWith('Bearer ')) {
      if (authHeader.slice(7).trim() === token) return true;
    }

    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const password = decoded.split(':').slice(1).join(':');
      if (password === token) return true;
    }

    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Basic realm="ClawCal"');
    res.end('Unauthorized');
    return false;
  }

  if (authConfig.mode === 'password') {
    const password = authConfig.password?.trim();
    if (!password) return true;

    const authHeader = req.headers.authorization || '';

    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const reqPassword = decoded.split(':').slice(1).join(':');
      if (reqPassword === password) return true;
    }

    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Basic realm="ClawCal"');
    res.end('Unauthorized');
    return false;
  }

  if (authConfig.mode === 'trusted-proxy') {
    const proxy = authConfig.trustedProxy;
    if (!proxy) return true;

    // Check required headers are present
    if (proxy.requiredHeaders) {
      for (const header of proxy.requiredHeaders) {
        if (!req.headers[header.toLowerCase()]) {
          res.statusCode = 403;
          res.end('Forbidden');
          return false;
        }
      }
    }

    // Check user header
    const user = req.headers[proxy.userHeader.toLowerCase()] as string | undefined;
    if (!user) {
      res.statusCode = 403;
      res.end('Forbidden');
      return false;
    }

    // Check allowlist if configured
    if (proxy.allowUsers && proxy.allowUsers.length > 0) {
      if (!proxy.allowUsers.includes(user)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return false;
      }
    }

    return true;
  }

  return true;
}

function serveICS(res: ServerResponse, ics: string, filename: string): void {
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.end(ics);
}

function resolvePath(filepath: string): string {
  if (filepath.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return filepath.replace('~', home);
  }
  return filepath;
}

export { CalendarManager } from './calendar';
export { FeedManager } from './feed-manager';
export * from './types';
export * from './events';
