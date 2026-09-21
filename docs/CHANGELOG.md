# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- D1-backed sliding-window rate limiting: 20 inbox creations per session/hour,
  10 new sessions per IP/hour, `429` + `Retry-After` on excess.
- Daily cleanup cron: purges expired messages, empty inboxes, old sessions,
  and stale rate-limit rows. Retention via `RETENTION_DAYS` (default 7 days).
- Unit tests (`npm test`): 15 tests over address generation, rate limiting,
  queries, retention purge, and email parsing — no test dependencies, runs on
  Node's built-in runner with an in-memory SQLite D1 shim.

### Fixed

- Dependency vulnerabilities: bumped `hono`, `wrangler`,
  `@cloudflare/workers-types` — `npm audit` reports 0 vulnerabilities.

### Security

- Session minting gated per IP to block bulk inbox farming.

## [1.0.0] — 2026-09-21

### Added

- Self-hosted disposable inboxes on Cloudflare Workers (Hono + D1 + Email Routing).
- Session-scoped inbox management: create (random/custom), list, delete.
- Message reader with plain-text rendering, attachments quarantined.
- Editorial web UI: master-detail layout, dark mode, keyboard navigation.
- API reference (`API.md`), security policy, web manifest, robots.txt.

### Changed

- Rebranded Tempik → Disposable Temp Mail; default web host `tmail.*`.
- Rebuilt web frontend from scratch (minimal/pastel, Newsprint tokens).

### Security

- Message bodies render via `textContent` — no raw HTML injection.
