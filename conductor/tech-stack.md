# Tech Stack — Disposable Temp Mail

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| Router | Hono v4 |
| Email parsing | PostalMime |
| Database | Cloudflare D1 (SQLite) |
| Static hosting | Cloudflare Workers Assets (edge) |
| Language | TypeScript (ES2022, strict) |
| Frontend | Vanilla JS + HTML + CSS, no framework |
| CLI | Wrangler v4 |
| Package manager | npm |

## Key bindings

- `DB` — D1 database (`disposable-temp-mail-db`).
- `[vars]` — `APP_NAME`, `MAIL_DOMAIN` (comma-separated), `WEB_HOST`.
- `[email] action = "process"` — inbound mail handler.
- `[assets] directory = "./src/web"` — static UI.
