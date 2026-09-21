/**
 * Cloudflare Turnstile server-side verification.
 *
 * When TURNSTILE_SECRET_KEY is unset (local dev), verification is skipped
 * and every token passes — production MUST set the secret.
 *
 * Follows the canonical contract: browser → our backend → siteverify.
 * Requires success === true plus an exact hostname match so a token
 * minted for another site cannot be replayed here.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  success: boolean;
  hostname?: string;
  'error-codes'?: string[];
}

/**
 * Verify a Turnstile client token against Cloudflare.
 * Returns true when valid, or when no secret is configured (dev bypass).
 */
export async function verifyTurnstileToken(
  token: string,
  secret: string | undefined,
  expectedHostname?: string,
  remoteIp?: string
): Promise<boolean> {
  if (!secret) return true; // dev bypass: no secret configured
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;
  if (!expectedHostname) return false; // fail closed: no allowlist to check against
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp);
    const res = await fetch(VERIFY_URL, { method: 'POST', body: form });
    if (!res.ok) return false;
    const data = (await res.json()) as TurnstileResult;
    return data.success === true && data.hostname === expectedHostname;
  } catch {
    return false; // fail closed on network error
  }
}
