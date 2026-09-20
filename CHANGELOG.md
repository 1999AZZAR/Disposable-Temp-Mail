# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
