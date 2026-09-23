import PostalMime from 'postal-mime';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { createInbox, ensureSchema, inboxExists, insertAttachment, insertMessage } from './db/queries.ts';
import { sanitizeHtml } from './utils/sanitize-html.ts';

export interface EmailHandlerEnv {
  DB: D1Database;
  MAIL_DOMAIN: string;
  /** Optional — mails without it simply store no attachment bytes. */
  ATTACHMENTS?: R2Bucket;
}

/** Abuse/size guards: temp mail is not a file host. */
export const MAX_ATTACHMENT_FILES = 5;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_TOTAL = 10 * 1024 * 1024;

function cleanFilename(name: unknown): string {
  const base = String(name || 'attachment').split(/[\\/]/).pop() || 'attachment';
  return base.replace(/[^\w.\-() ]/g, '_').slice(0, 120) || 'attachment';
}

/**
 * Handles inbound email via Cloudflare Email Worker.
 * Called for every email received at any @<MAIL_DOMAIN> address.
 */
export async function handleEmail(message: ForwardableEmailMessage, env: EmailHandlerEnv): Promise<void> {
  const to = message.to.toLowerCase();
  const from = message.from.toLowerCase();

  console.log(`[email] Received from=${from} to=${to}`);

  try {
    await ensureSchema(env.DB);

    // Read raw email stream
    const rawStream = message.raw;
    const parser = new PostalMime();
    const parsed = await parser.parse(rawStream);

    const subject = parsed.subject || '(no subject)';
    const body = parsed.text?.trim() || '';
    const bodyHtml = sanitizeHtml(parsed.html);

    const db = env.DB;

    // Auto-create inbox if doesn't exist
    if (!(await inboxExists(db, to))) {
      await createInbox(db, to);
      console.log(`[email] Created new inbox: ${to}`);
    }

    // Store the message (text fallback when there is HTML but no text part)
    const msgId = `msg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    await insertMessage(db, {
      id: msgId,
      inbox_address: to,
      from_address: from,
      subject,
      body: body || (bodyHtml ? '(rich HTML message — open Original view)' : ''),
      body_html: bodyHtml,
    });

    // Attachments: metadata in D1, bytes in R2. Skipped (with a log line)
    // when over caps or when no bucket is bound.
    const parts = parsed.attachments || [];
    let kept = 0;
    let totalBytes = 0;
    for (const part of parts) {
      if (kept >= MAX_ATTACHMENT_FILES) {
        console.log(`[email] ${msgId}: dropping extra attachments beyond ${MAX_ATTACHMENT_FILES}`);
        break;
      }
      const raw = part as { content?: unknown; filename?: unknown; mimeType?: unknown; contentId?: unknown };
      const content = raw.content as ArrayBuffer | Uint8Array | undefined;
      const size = content && typeof (content as Uint8Array).byteLength === 'number'
        ? (content as Uint8Array).byteLength : 0;
      if (!size || size > MAX_ATTACHMENT_BYTES || totalBytes + size > MAX_ATTACHMENTS_TOTAL) {
        console.log(`[email] ${msgId}: dropping oversized attachment ${part.filename} (${size}b)`);
        continue;
      }
      if (!env.ATTACHMENTS) {
        console.log(`[email] ${msgId}: no ATTACHMENTS bucket bound, skipping ${part.filename}`);
        continue;
      }
      const attId = `att_${crypto.randomUUID().slice(0, 8)}`;
      const r2Key = `att/${msgId}/${attId}`;
      await env.ATTACHMENTS.put(r2Key, content!, {
        httpMetadata: { contentType: typeof raw.mimeType === 'string' ? raw.mimeType : 'application/octet-stream' },
      });
      await insertAttachment(db, {
        id: attId,
        message_id: msgId,
        filename: cleanFilename(raw.filename),
        mime_type: typeof raw.mimeType === 'string' && raw.mimeType ? raw.mimeType : 'application/octet-stream',
        size,
        cid: typeof raw.contentId === 'string' ? raw.contentId.replace(/[<>]/g, '') : null,
        r2_key: r2Key,
      });
      kept++;
      totalBytes += size;
    }

    console.log(`[email] Stored message ${msgId} for ${to} (${kept} attachments)`);
  } catch (err) {
    console.error(`[email] Failed to process email for ${to}:`, err);
    // Don't throw — we don't want to bounce; just log
  }
}
