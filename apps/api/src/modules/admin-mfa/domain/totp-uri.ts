/**
 * Phase 10 (PR 10.1) — otpauth:// URI builder.
 *
 * Spec: https://github.com/google/google-authenticator/wiki/Key-Uri-Format
 *
 * Shape (TOTP):
 *
 *   otpauth://totp/Issuer:account-label?secret=BASE32&issuer=Issuer
 *                  &algorithm=SHA1&digits=6&period=30
 *
 * Every parameter except `secret` has a well-known default, but we
 * emit them all explicitly so:
 *   - The QR-code payload is self-documenting (an auditor can confirm
 *     SHA1 / 30s without inferring from the spec defaults).
 *   - A future tightening (SHA256, 8-digit codes) is a single
 *     parameter change, not a behavioural drift across clients that
 *     interpret the omitted defaults differently.
 *
 * Issuer and account-label are URL-encoded; the colon between them
 * is NOT (it's a structural separator in the path). RFC 3986
 * percent-encoding via encodeURIComponent handles the rest.
 */

export interface BuildOtpAuthUriArgs {
  /**
   * Display name for the issuing service (shown above the code in the
   * authenticator app). Typically the product name; e.g. "SportsMart".
   */
  issuer: string;
  /**
   * Unique account identifier — typically the admin's email or
   * username. The authenticator app shows this so an admin who
   * manages multiple SportsMart accounts can pick the right one.
   */
  account: string;
  /**
   * Base32-encoded TOTP secret (from generateTotpSecret()). NOT
   * percent-encoded by this function — base32 is URL-safe by
   * construction.
   */
  secret: string;
  /**
   * HMAC algorithm. Default SHA1 — RFC 6238 default and the only
   * algorithm universally supported by authenticator apps in 2026.
   * Tightening to SHA256 is a future PR; do it across all admins
   * in one wave rather than mixing per-admin.
   */
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
  /**
   * Code length in digits. Default 6 — the universal default.
   */
  digits?: 6 | 8;
  /**
   * Code rotation period in seconds. Default 30 — universal default.
   */
  period?: number;
}

export function buildOtpAuthUri(args: BuildOtpAuthUriArgs): string {
  const {
    issuer,
    account,
    secret,
    algorithm = 'SHA1',
    digits = 6,
    period = 30,
  } = args;

  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('issuer', issuer);
  params.set('algorithm', algorithm);
  params.set('digits', String(digits));
  params.set('period', String(period));

  // URLSearchParams percent-encodes per RFC 3986 (using +) which is
  // wrong for the otpauth scheme — authenticator apps expect %20 for
  // spaces in the issuer name, not +. Replace explicitly.
  const query = params.toString().replace(/\+/g, '%20');

  return `otpauth://totp/${label}?${query}`;
}
