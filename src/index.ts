import { IncomingMessage, ServerResponse } from 'http';
import { FeedManager } from './feed-manager';
import { LocalCalendarPush } from './local-push';
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
  registerHttpHandler(handler: (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>): void;
  registerTool(tool: any): void;
  registerHook(events: string | string[], handler: (data: any) => void): void;
  resolvePath(input: string): string;
}

const DEFAULT_CONFIG: CalendarConfig = {
  enabled: true,
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

/**
 * Plugin entry point. Called by OpenClaw when the extension loads.
 */
export function register(api: PluginApi, userConfig?: Partial<CalendarConfig>): FeedManager {
  const config: CalendarConfig = { ...DEFAULT_CONFIG, ...userConfig };
  const directory = api.resolvePath(config.file_directory);

  const localPush = new LocalCalendarPush(config.localPush.enabled);
  const feeds = new FeedManager(directory, config.feeds, localPush);

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

  // Per-agent feeds + feed listing via raw HTTP handler (no param routes)
  if (config.feeds.per_agent) {
    api.registerHttpHandler((req, res) => {
      const url = req.url || '';

      // /clawcal/feed/<agentId>.ics
      const agentMatch = url.match(/^\/clawcal\/feed\/([^/]+)\.ics$/);
      if (agentMatch) {
        if (!checkAuth(req, res, authConfig)) return true;

        const agentId = decodeURIComponent(agentMatch[1]);
        const agentFeed = feeds.getAgentFeed(agentId);
        if (!agentFeed) {
          res.statusCode = 404;
          res.end(`No feed found for agent "${agentId}"`);
          return true;
        }

        serveICS(res, agentFeed.toICS(), `${agentId}.ics`);
        return true;
      }

      // /clawcal/feeds
      if (url === '/clawcal/feeds') {
        if (!checkAuth(req, res, authConfig)) return true;

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
        return true;
      }

      return false; // not our route
    });
  }

  // Register the clawcal_schedule tool for agents
  api.registerTool({
    name: 'clawcal_schedule',
    label: 'Calendar Schedule',
    description: 'Add an event to the agent calendar',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        date: { type: 'string', description: 'ISO 8601 date/time' },
        duration: { type: 'number', description: 'Duration in minutes (default 15)' },
        category: { type: 'string', description: 'Event category: post, launch, review, task, automation, draft, reminder' },
        description: { type: 'string', description: 'Event description with context and links' },
        allDay: { type: 'boolean', description: 'Whether this is an all-day event' },
        agent: { type: 'string', description: 'Agent ID (e.g. "marketing-agent"). Required for per-agent feeds.' },
        project: { type: 'string', description: 'Project or workspace name' },
        alertMinutes: { type: 'number', description: 'Alert N minutes before event (overrides category default)' },
      },
      required: ['title', 'date', 'agent'],
    },
    async execute(_toolCallId: string, params: ScheduleToolParams) {
      const event = fromToolCall(params, config.defaults);
      feeds.addEvent(event);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: true, uid: event.uid, message: `Added "${event.title}" to calendar` }) }],
      };
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


export { CalendarManager } from './calendar';
export { FeedManager } from './feed-manager';
export * from './types';
export * from './events';
