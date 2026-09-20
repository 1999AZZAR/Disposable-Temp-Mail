# Product Definition — Disposable Temp Mail

Self-hosted disposable email service running entirely on Cloudflare Workers.

## Summary

Disposable Temp Mail receives inbound mail through Cloudflare Email Workers,
stores messages in D1 (SQLite), and serves a minimal web UI plus REST API from
the edge. No VPS, no mail server to operate, no containers. Anonymous
session-based inboxes: a browser claims addresses, reads messages, and unlinks
them when done.

## Goals

- Zero-ops deployment: `wrangler deploy` only.
- Privacy-friendly: no accounts, per-browser anonymous sessions.
- Fast edge UI with a documented REST API.
- Professional, neutral language across UI, docs, and generated addresses.

## Non-goals

- Sending outbound mail.
- Long-term archival or full mailbox hosting.
- User accounts, authentication, or billing.
