# Disposable Temp Mail on Cloudflare Workers

A **self-hosted disposable email** service that runs entirely on **Cloudflare Workers** — no VPS required. It receives inbound mail through Cloudflare Email Workers, stores messages in D1, and serves a clean web UI from the edge.

---

## How it works

```
Sender → Cloudflare MX → Email Worker (email handler)
                                  │
                                  ▼
                          D1 Database (SQLite)
                                  │
                                  ▼
                   Worker HTTP handler → Web UI + API
```

- **No VPS** — everything runs on Cloudflare's edge
- **No Postfix** — Cloudflare Email Workers handle SMTP ingestion natively
- **No Docker** — just `wrangler deploy`
- **Zero cost** — fits within Cloudflare's free tier

---

## Prerequisites

Before you start, you need:

| Requirement | Details |
|---|---|
| **Cloudflare account** | [Sign up here](https://dash.cloudflare.com/sign-up) (free) |
| **A domain** | Must be added to Cloudflare (nameservers pointed to Cloudflare) |
| **Node.js** | v18 or later ([download](https://nodejs.org/)) |
| **npm** | Comes with Node.js |

---

## Step 1 — Clone & install dependencies

```bash
git clone <your-repo-url>
cd Disposable-Temp-Mail
npm install
```

---

## Step 2 — Login to Cloudflare

```bash
npx wrangler login
```

This opens a browser window. Log in with your Cloudflare account and approve the OAuth scopes.

> **What scopes are needed?**
> Wrangler will request permissions for Workers, D1, Email Routing, Pages, and more. You must approve all of them so the CLI can create the database and deploy the worker.

Verify you're logged in:

```bash
npx wrangler whoami
```

---

## Step 3 — Configure wrangler.toml

Open `wrangler.toml` and replace the placeholder values with your own:

```toml
name = "disposable-temp-mail"
main = "src/index.ts"
compatibility_date = "2025-06-01"

# Set to false when using your own domain (skip workers.dev)
workers_dev = false

# D1 Database — leave database_id empty for now, we'll fill it in Step 4
[[d1_databases]]
binding = "DB"
database_name = "disposable-temp-mail-db"
database_id = ""

# Email Worker
[email]
action = "process"

# Custom domain — CHANGE THIS to your own domain
[[routes]]
pattern = "tmail.YOURDOMAIN.com"
custom_domain = true

# Environment — CHANGE THESE
[vars]
APP_NAME = "Disposable Temp Mail"
MAIL_DOMAIN = "YOURDOMAIN.com"
WEB_HOST = "tmail.YOURDOMAIN.com"

# Static assets (don't change)
[assets]
directory = "./src/web"

[observability]
enabled = true
```

**All three `vars` + the routes `pattern` must be updated:**
- `YOURDOMAIN.com` → your actual domain (e.g. `example.com`)
- `tmail.YOURDOMAIN.com` → the subdomain for the web UI

---

## Step 4 — Create the D1 database

```bash
npx wrangler d1 create disposable-temp-mail-db
```

You'll see output like:

```
✅ Successfully created DB 'disposable-temp-mail-db'

[[d1_databases]]
binding = "DB"
database_name = "disposable-temp-mail-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` into your `wrangler.toml`.

---

## Step 5 — Apply the database schema

Push the schema to your **remote** D1 database on Cloudflare:

```bash
npx wrangler d1 execute disposable-temp-mail-db --remote --file=src/db/schema.sql
```

This creates five tables:
- `inboxes` — email addresses
- `messages` — received emails
- `sessions` — browser session tokens
- `session_inboxes` — which inboxes belong to which session
- `rate_hits` — rate-limit counters (pruned daily)

> **Existing deployments:** re-run the command after pulling updates — the
> schema uses `CREATE TABLE IF NOT EXISTS`, so it safely adds missing tables.

> **Note:** The `--remote` flag is important — without it, the schema only applies locally. You want it on Cloudflare's servers.

---

## Step 6 — Deploy the Worker

```bash
npx wrangler deploy
```

This does three things:
1. Uploads the TypeScript Worker code
2. Uploads the static frontend files (HTML/CSS/JS) to Cloudflare Assets (edge CDN)
3. Registers the custom domain route

After a successful deploy, you'll see:

```
Deployed disposable-temp-mail triggers
  tmail.YOURDOMAIN.com (custom domain)
```

---

## Step 7 — Setup DNS on Cloudflare

### 7a. Web UI (automatic)

Cloudflare automatically creates the DNS record for your Worker's custom domain. If it doesn't:

- Go to **Cloudflare Dashboard → Workers & Pages → disposable-temp-mail → Settings → Domains**
- The custom domain `tmail.YOURDOMAIN.com` should already be listed

### 7b. MX Records (automatic with Email Routing)

Email Routing should already be enabled on your domain. Verify:

```bash
npx wrangler email routing settings YOURDOMAIN.com
```

It should show `Enabled: true`. The catch-all rule is also automatically set up — every `*@YOURDOMAIN.com` is routed to the `disposable-temp-mail` Worker:

```bash
npx wrangler email routing rules list YOURDOMAIN.com
```

Expected output:
```
Catch-all rule: enabled, action: worker:disposable-temp-mail
```

### 7c. SPF Record (optional but recommended)

If you don't already have an SPF record, add one so emails don't get flagged as spam:

| Type | Name | Content |
|---|---|---|
| TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |

---

## Step 8 — Test it

1. Open `https://tmail.YOURDOMAIN.com` in your browser
2. Click **New** → **Random** to create a disposable address
3. Send an email from Gmail/any provider to that address
4. Click **Refresh** — the email appears in your inbox

---

## Commands cheat sheet

| Command | What it does |
|---|---|
| `npm run deploy` | Deploy Worker + static assets |
| `npm run db:migrate` | Apply schema to production D1 |
| `npm run db:local` | Apply schema to local D1 (for dev) |
| `npx wrangler dev` | Run Worker locally |
| `npx wrangler tail` | Stream live logs from production |
| `npx wrangler d1 execute disposable-temp-mail-db --remote --command="SELECT * FROM messages LIMIT 10"` | Query the database |

### Check if emails are being received

```bash
npx wrangler d1 execute disposable-temp-mail-db --remote --command="SELECT * FROM messages ORDER BY received_at DESC LIMIT 5;"
```

### Watch live logs

```bash
npx wrangler tail --format pretty
```

Then send a test email — you'll see the Worker processing it in real time.

---

## Project structure

```
disposable-temp-mail/
├── wrangler.toml              # Worker config, D1 binding, routes, env vars
├── package.json
├── tsconfig.json
├── .gitignore
└── src/
    ├── index.ts               # Entry point: fetch() + email() + scheduled() handlers
    ├── cleanup.ts             # Daily retention purge (messages, inboxes, sessions)
    ├── email-handler.ts       # Parses inbound email via PostalMime → D1
    ├── api/
    │   └── routes.ts          # Hono router: /api/config, /api/session, /api/inboxes, /api/messages
    ├── db/
    │   ├── schema.sql         # D1 tables (inboxes, messages, sessions, session_inboxes, rate_hits)
    │   └── queries.ts         # Typed query functions
    ├── utils/
    │   ├── random-address.ts  # Human-like random email generator
    │   └── rate-limit.ts      # D1-backed sliding-window rate limiter
    └── web/
        ├── index.html         # Frontend UI
        ├── app.js             # Frontend logic (vanilla JS)
        └── styles.css         # Dark theme styles
```

---

## Tech stack

| Layer | Tech |
|---|---|
| **Runtime** | Cloudflare Workers |
| **Router** | Hono |
| **Email parsing** | PostalMime |
| **Database** | Cloudflare D1 (SQLite) |
| **Static hosting** | Cloudflare Workers Assets (edge CDN) |
| **Language** | TypeScript |
| **CLI** | Wrangler v4 |

---

## Abuse controls & retention

- **Rate limits** (per hour, tunable in `wrangler.toml`): 20 inbox creations
  per session, 10 new sessions per IP. Exceeded requests get `429` with
  `Retry-After` and `X-RateLimit-*` headers.
- **Retention:** a daily cron (`0 3 * * *`) deletes messages and empty inboxes
  older than `RETENTION_DAYS` (default 7), sessions older than 30 days, and
  stale rate-limit rows. Tune via `RETENTION_DAYS` in `[vars]`.

---

## Tests

Zero-dependency suite on Node's built-in runner with an in-memory SQLite
D1 shim (`src/test-helpers.ts`) — covers address generation, rate limiting,
queries, retention purge, and email parsing:

```bash
npm test
```

---

## Troubleshooting

### "This site can't be reached / DNS_PROBE_FINISHED_NXDOMAIN"

Your domain's nameservers are not pointed to Cloudflare, or the DNS record hasn't propagated yet. Check:

```bash
dig +short YOURDOMAIN.com NS
```

Should show `*.ns.cloudflare.com`. Propagation can take up to 24 hours after changing nameservers.

### Emails not appearing in the web UI

1. The email was received but the inbox hasn't been linked to your browser session. Click **New** → type the exact local-part → click **Create** to claim it.
2. Check the database:
   ```bash
   npx wrangler d1 execute disposable-temp-mail-db --remote --command="SELECT * FROM messages ORDER BY received_at DESC LIMIT 5;"
   ```
3. Check live logs:
   ```bash
   npx wrangler tail --format pretty
   ```

### "Unexpected fields found in top-level field: email"

This is a known wrangler warning — it's cosmetic. The `[email]` config works fine. Cloudflare is still stabilizing the Email Worker integration.

### Wrangler version mismatch

This project uses **Wrangler v4**. If you're on v3:

```bash
npm install --save-dev wrangler@4
```

---

## License

MIT — see [LICENSE](./LICENSE).
