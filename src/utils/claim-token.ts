/**
 * Transfer codes let an inbox move across devices without accounts.
 * Each code carries 80 bits of entropy in Crockford base32 (0/1 kept —
 * unambiguous here because O/I/L are excluded), grouped as
 * XXXX-XXXX-XXXX-XXXX for easy typing. Codes are brute-force resistant
 * on their own; the claim endpoint additionally rate-limits attempts
 * per IP.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
if (ALPHABET.length !== 32) throw new Error('Transfer-code alphabet must hold 32 symbols');

const CODE_PATTERN = /^[0-9A-HJ-KM-NP-TV-Z]{16}$/;

export function generateTransferCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let bits = 0;
  let buffer = 0;
  let out = '';
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) >>> 0;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >>> bits) & 31];
    }
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

/** Normalize user input: uppercase, strip spaces/hyphens. Returns '' when invalid. */
export function normalizeTransferCode(input: string): string {
  const compact = (input || '').toUpperCase().replace(/[\s-]/g, '');
  if (!CODE_PATTERN.test(compact)) return '';
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}`;
}
