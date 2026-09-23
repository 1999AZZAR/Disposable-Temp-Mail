/**
 * Minimal string-based HTML sanitizer for inbound email HTML.
 *
 * Runs in the Worker at store time; the reader additionally renders the
 * result only inside a sandboxed iframe (no allow-scripts), so this is
 * defense in depth, not the sole barrier.
 *
 * Strategy is deny-by-default: drop whole dangerous elements (with their
 * content for script/style), strip event-handler attributes, and neutralize
 * dangerous URL schemes. `cid:` is preserved so the reader can resolve
 * inline images to session-scoped attachment URLs.
 */

const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|form|noscript|template|frame|frameset)[\s>][\s\S]*?<\/\1\s*>/gi;
const DROP_TAG_OPEN = /<\/?(script|style|iframe|object|embed|form|input|button|select|textarea|link|meta|base|frame|frameset|noscript|template|applet|bgsound|marquee|dialog)\b[^>]*>/gi;
const EVENT_ATTR = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
// javascript:/vbscript:/data:(non-image) in href/src/action/background/cite attrs
const DANGEROUS_URL = /\s+(href|src|action|background|cite|data|poster|xlink:href)\s*=\s*("\s*(javascript|vbscript|data(?!\s*:\s*image\/)):[^"]*"|'\s*(javascript|vbscript|data(?!\s*:\s*image\/)):[^']*'|[^\s>]*(javascript|vbscript):[^\s>]*)/gi;
const MAX_HTML_CHARS = 200_000;

export function sanitizeHtml(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  let html = raw.length > MAX_HTML_CHARS ? raw.slice(0, MAX_HTML_CHARS) : raw;
  html = html.replace(DROP_WITH_CONTENT, '');
  html = html.replace(DROP_TAG_OPEN, '');
  html = html.replace(EVENT_ATTR, '');
  html = html.replace(DANGEROUS_URL, '');
  return html.trim();
}
