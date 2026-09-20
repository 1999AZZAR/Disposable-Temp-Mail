import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import {
  getInbox,
  createInbox,
  inboxExists,
  getSessionInboxes,
  getMessages,
  ensureSession,
  linkInboxToSession,
  unlinkInboxFromSession,
  isInboxInSession,
} from '../db/queries';
import { generateUniqueAddress } from '../utils/random-address';
import { checkRateLimit, rateLimitHeaders } from '../utils/rate-limit';

export interface ApiEnv {
  DB: D1Database;
  APP_NAME: string;
  MAIL_DOMAIN: string;
  WEB_HOST: string;
  RETENTION_DAYS?: string;
  RATE_LIMIT_INBOXES_PER_HOUR?: string;
  RATE_LIMIT_SESSIONS_PER_HOUR?: string;
}

function numVar(value: string | undefined, fallback: number): number {
  const n = parseInt(value || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clientIp(c: any): string {
  return (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown').trim();
}

function tooMany(c: any, limit: number, retryAfter: number) {
  c.header('Retry-After', String(retryAfter));
  c.header('X-RateLimit-Limit', String(limit));
  c.header('X-RateLimit-Remaining', '0');
  return c.json({ error: 'Rate limit exceeded, try again later' }, 429);
}

function getDomains(env: ApiEnv): string[] {
  return env.MAIL_DOMAIN.split(',').map(d => d.trim()).filter(Boolean);
}

function defaultDomain(env: ApiEnv): string {
  return getDomains(env)[0] || 'example.com';
}

function sessionId(c: any): string | null {
  return (c.req.header('x-session-id') || '').trim() || null;
}

function requireSession(c: any): string {
  const sid = sessionId(c);
  if (!sid) {
    c.status(400);
    return '';
  }
  return sid;
}

const api = new Hono<{ Bindings: ApiEnv }>();

// ---- GET /api/config ----
api.get('/config', (c) => {
  const domains = getDomains(c.env);
  return c.json({
    appName: c.env.APP_NAME || 'Disposable Temp Mail',
    mailDomain: domains[0] || 'example.com',
    mailDomains: domains,
    webHost: c.env.WEB_HOST || 'tmail.example.com',
  });
});

// ---- GET /api/session ----
api.get('/session', async (c) => {
  let sid = sessionId(c);
  if (!sid) {
    const limit = numVar(c.env.RATE_LIMIT_SESSIONS_PER_HOUR, 10);
    const rl = await checkRateLimit(c.env.DB, `session:${clientIp(c)}`, limit, 3600);
    if (!rl.allowed) return tooMany(c, limit, rl.retryAfter);
    sid = crypto.randomUUID();
  }
  await ensureSession(c.env.DB, sid);
  return c.json({ sessionId: sid });
});

// ---- GET /api/inboxes ----
api.get('/inboxes', async (c) => {
  const sid = requireSession(c);
  if (!sid) return c.json({ error: 'Missing x-session-id' }, 400);

  const inboxes = await getSessionInboxes(c.env.DB, sid);
  return c.json(inboxes);
});

// ---- POST /api/inboxes ----
api.post('/inboxes', async (c) => {
  const sid = requireSession(c);
  if (!sid) return c.json({ error: 'Missing x-session-id' }, 400);

  const inboxLimit = numVar(c.env.RATE_LIMIT_INBOXES_PER_HOUR, 20);
  const rl = await checkRateLimit(c.env.DB, `inbox:${sid}`, inboxLimit, 3600);
  if (!rl.allowed) return tooMany(c, inboxLimit, rl.retryAfter);
  for (const [k, v] of Object.entries(rateLimitHeaders(rl, inboxLimit))) c.header(k, v);

  const body = await c.req.json().catch(() => ({}));
  const domains = getDomains(c.env);
  const requestedDomain: string = (body.domain || '').trim().toLowerCase();
  const domain = requestedDomain && domains.includes(requestedDomain)
    ? requestedDomain
    : defaultDomain(c.env);

  // Validate: reject unknown domains
  if (requestedDomain && !domains.includes(requestedDomain)) {
    return c.json({ error: `Invalid domain: ${requestedDomain}. Allowed: ${domains.join(', ')}` }, 400);
  }

  const requested: string = (body.localPart || '').trim().toLowerCase();

  let address: string;
  if (requested) {
    address = `${requested}@${domain}`;
  } else {
    address = await generateUniqueAddress(
      (addr) => inboxExists(c.env.DB, addr),
      domain
    );
  }

  // Ensure inbox record exists
  await createInbox(c.env.DB, address);

  // Link to session
  await linkInboxToSession(c.env.DB, sid, address);

  const inbox = await getInbox(c.env.DB, address);
  return c.json(inbox!, 201);
});

// ---- DELETE /api/inboxes/:address ----
api.delete('/inboxes/:address', async (c) => {
  const sid = requireSession(c);
  if (!sid) return c.json({ error: 'Missing x-session-id' }, 400);

  const address = decodeURIComponent(c.req.param('address'));
  await unlinkInboxFromSession(c.env.DB, sid, address);
  return c.json({ ok: true });
});

// ---- GET /api/inboxes/:address/messages ----
api.get('/inboxes/:address/messages', async (c) => {
  const sid = requireSession(c);
  if (!sid) return c.json({ error: 'Missing x-session-id' }, 400);

  const address = decodeURIComponent(c.req.param('address'));

  // Must have inbox in session to read messages
  if (!(await isInboxInSession(c.env.DB, sid, address))) {
    return c.json({ error: 'Inbox not in this session' }, 403);
  }

  const messages = await getMessages(c.env.DB, address);
  return c.json(messages);
});

export default api;
