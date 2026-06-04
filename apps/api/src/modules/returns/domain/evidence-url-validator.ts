// Phase 93 (2026-05-23) — Customer Return Request audit Gap #5 / #24.
//
// Pre-Phase-93 `evidenceFileUrls` was `IsString({ each: true })` with
// no URL validation. A hostile client could substitute media's
// returned URL with any third-party URL — QC would open it and hit
// SSRF / phishing / cross-tenant leak vectors. This validator does
// two things:
//
//   1. Format check — must be `https://` (no `http://`, no
//      `javascript:`, no `data:`, no `file:` etc).
//   2. Host allowlist — origin must be in the platform's known set.
//      Media lives at the Cloudflare R2 public delivery base
//      (R2_PUBLIC_BASE_URL); callers derive the trusted host from it via
//      resolveTrustedMediaHosts(). The default below is only the dev-stub
//      host used when R2 isn't configured (local/dev).
//
// Returns `{ valid, reason }` so the caller can include the rejection
// reason in the BadRequest response.

import { DEV_STUB_MEDIA_HOST } from '../../../core/util/trusted-media-hosts';

export const DEFAULT_ALLOWED_HOSTS = [DEV_STUB_MEDIA_HOST] as const;

export interface EvidenceUrlValidationOptions {
  allowedHosts?: ReadonlyArray<string>;
  requireHttps?: boolean;
  maxUrlLength?: number;
}

export function isValidEvidenceUrl(
  url: string,
  options: EvidenceUrlValidationOptions = {},
): { valid: true } | { valid: false; reason: string } {
  const allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  const requireHttps = options.requireHttps ?? true;
  const maxUrlLength = options.maxUrlLength ?? 2048;

  if (typeof url !== 'string') {
    return { valid: false, reason: 'URL must be a string' };
  }
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'URL is empty' };
  }
  if (trimmed.length > maxUrlLength) {
    return {
      valid: false,
      reason: `URL exceeds max length of ${maxUrlLength} chars`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Malformed URL' };
  }

  if (requireHttps && parsed.protocol !== 'https:') {
    return {
      valid: false,
      reason: `Only https:// URLs accepted (got ${parsed.protocol})`,
    };
  }
  // Block control-plane / metadata pseudo-hosts.
  if (
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '0.0.0.0' ||
    parsed.hostname === '::1' ||
    parsed.hostname.endsWith('.local')
  ) {
    return {
      valid: false,
      reason: 'Localhost / link-local URLs are not allowed',
    };
  }
  // Cloud-metadata SSRF guard.
  if (
    parsed.hostname === '169.254.169.254' ||
    parsed.hostname === 'metadata.google.internal'
  ) {
    return {
      valid: false,
      reason: 'Cloud metadata endpoints are not allowed',
    };
  }

  // Host allowlist — exact match OR subdomain of an allowed host.
  const hostMatch = allowedHosts.some((allowed) => {
    if (parsed.hostname === allowed) return true;
    if (parsed.hostname.endsWith(`.${allowed}`)) return true;
    return false;
  });
  if (!hostMatch) {
    return {
      valid: false,
      reason: `Host ${parsed.hostname} not in evidence allowlist`,
    };
  }

  return { valid: true };
}

/**
 * Validate an array. Returns the index of the first offending URL +
 * the reason; null when all pass.
 */
export function validateEvidenceUrls(
  urls: ReadonlyArray<string>,
  options?: EvidenceUrlValidationOptions,
): { index: number; reason: string } | null {
  for (let i = 0; i < urls.length; i += 1) {
    const result = isValidEvidenceUrl(urls[i] ?? '', options);
    if (!result.valid) {
      return { index: i, reason: result.reason };
    }
  }
  return null;
}
