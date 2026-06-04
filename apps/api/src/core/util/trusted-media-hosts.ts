// Trusted media hosts for user-submitted media URLs (return evidence,
// affiliate KYC documents). These URLs must point at media WE generated
// (from our upload endpoint), not an arbitrary third party — otherwise a
// hostile client could submit an attacker-controlled URL that QC / admin
// review then opens (SSRF / phishing / cross-tenant leak).
//
// Our media lives at the Cloudflare R2 public delivery base
// (R2_PUBLIC_BASE_URL), so that host is always trusted. Extra hosts can be
// added via a comma-separated env list (e.g. RETURN_EVIDENCE_ALLOWED_HOSTS).
// The dev-stub host (`placehold.co`, returned by the media adapter when R2
// isn't configured) is always included so local/dev flows validate.

/** Host returned by the media adapter's dev-stub when R2 isn't configured. */
export const DEV_STUB_MEDIA_HOST = 'placehold.co';

export function resolveTrustedMediaHosts(
  r2PublicBaseUrl?: string | null,
  extraHostsCsv?: string | null,
): string[] {
  const hosts = new Set<string>([DEV_STUB_MEDIA_HOST]);
  if (r2PublicBaseUrl) {
    try {
      hosts.add(new URL(r2PublicBaseUrl).hostname);
    } catch {
      // ignore a malformed base URL — the dev-stub host still applies
    }
  }
  if (extraHostsCsv) {
    for (const h of extraHostsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      hosts.add(h);
    }
  }
  return [...hosts];
}
