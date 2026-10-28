// Developer-mode gate. This is the ONLY place in the repo that decides who may
// reach the editor surface, and the only credential check of its kind.
//
// Threat model (deliberately narrow, do not oversell it later): the gate keeps
// the passphrase out of sight — not in source, not in the shipped single-file
// bundle, not in generated reports — and stops casual or accidental entry.
// It does NOT resist someone who edits the local build: an offline single-file
// app cannot be protected against its own user, and pretending otherwise would
// add a second, unverifiable security claim.
// Rotated 2026-10-28 by the owner's word; the digest set at v2.8.1 is retired for good.
export const DEV_MODE_DIGEST =
  '4024a6389e20ff8b2968183d07fa5a45b5408a71b0c64dcbc5155fd817c2bdda';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/** False outside a secure context (or in a runtime without WebCrypto). */
export function isSecureDigestAvailable(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}

/** SHA-256 hex of `raw`. Throws when the platform offers no WebCrypto digest. */
export async function digestOfSecret(raw: string): Promise<string> {
  const buffer = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** `null` means "the caller could not compute a digest" = no match, never a plaintext fallback. */
export function matchesDeveloperModeDigest(digest: string | null): boolean {
  if (digest === null) return false;
  const normalized = digest.toLowerCase();
  return DIGEST_PATTERN.test(normalized) && normalized === DEV_MODE_DIGEST;
}
