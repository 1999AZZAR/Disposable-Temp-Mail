import api from './api/routes.ts';
import { handleEmail } from './email-handler.ts';
import { purgeExpired } from './cleanup.ts';
import type { EmailHandlerEnv } from './email-handler.ts';
import type { ApiEnv } from './api/routes.ts';

/**
 * Disposable Temp Mail on Cloudflare Workers
 *
 * Handles:
 * - fetch()  → API routes (static files served via Cloudflare Assets)
 * - email()  → inbound email processing via Cloudflare Email Worker
 */

// Combined env bindings
export interface Env extends ApiEnv, EmailHandlerEnv {}

export default {
  /**
   * HTTP fetch handler - serves API routes.
   * Static files (src/web/) are served via Cloudflare [assets].
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Route /api/* to Hono router (strip /api prefix)
    if (url.pathname.startsWith('/api/')) {
      const apiUrl = new URL(request.url);
      apiUrl.pathname = url.pathname.slice(4); // strip '/api'
      const apiRequest = new Request(apiUrl, request);
      return api.fetch(apiRequest, env, ctx);
    }

    // Fallback: should not happen when [assets] is configured properly
    return new Response('Not found', { status: 404 });
  },

  /**
   * Email handler - called by Cloudflare for every inbound email
   * at any @<MAIL_DOMAIN> address.
   */
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    await handleEmail(message, env);
  },

  /**
   * Scheduled handler - daily retention purge (see [triggers] in wrangler.toml).
   * Deletes expired messages, empty inboxes, old sessions, and stale rate-limit rows.
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const retention = parseInt(env.RETENTION_DAYS || '7', 10);
    const result = await purgeExpired(env.DB, Number.isFinite(retention) && retention > 0 ? retention : 7);
    console.log(`cleanup: ${result.messages} messages, ${result.inboxes} inboxes, ${result.sessions} sessions, ${result.rateHits} rate rows purged`);
  },
};
