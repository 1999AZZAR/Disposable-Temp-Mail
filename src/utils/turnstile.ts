/**
 * Cloudflare Turnstile server-side verification.
 *
 * When TURNSTILE_SECRET_KEY is unset (local dev), verification is skipped
 * and every token passes — production MUST set the secret.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Verify a Turnstile client token against Cloudflare.
 * Returns true when valid, or when no secret is configured (dev bypass).
 */
export async function verifyTurnstileToken(
  token: string,
  secret: string | undefined,
  remoteIp?: string
): Promise<boolean> {
  if (!secret) return true; // dev bypass: no secret configured
  if (!token) return false;
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp);
    const res = await fetch(VERIFY_URL, { method: 'POST', body: form });
    if (!res.ok) return false;
    const data = (await res.json()) as TurnstileResult;
    return data.success === true;
  } catch {
    return false; // fail closed on network error
  }
}
