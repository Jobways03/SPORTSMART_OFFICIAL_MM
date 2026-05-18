import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '../../bootstrap/env/env.service';

/**
 * Phase 11 (2026-05-16) — External-dependency health probes.
 *
 * The readiness check (`GET /health`) used to verify DB + Redis only,
 * which meant a degraded payments processor or storage provider sat
 * silently in rotation — every checkout failed at the gateway call
 * with no early signal at the load balancer.
 *
 * This service runs cheap, idempotent checks against the three
 * external dependencies the platform calls on hot paths:
 *
 *   • Razorpay — `GET /v1/payments?count=1` with HTTP basic auth.
 *     Any 2xx confirms credentials + connectivity. 401/403 means
 *     misconfigured keys (we want that to fail the probe).
 *   • S3 — HEAD-equivalent via a low-byte GET on the bucket. No
 *     SDK dependency to keep the probe lean — we use raw fetch with
 *     SigV4 would need additional crypto, so we instead probe the
 *     public REST endpoint with `region.amazonaws.com` and only
 *     check that the request reaches the bucket (HTTP 403 from S3 =
 *     reachable; HTTP 0/network errors = unreachable).
 *   • Cloudinary — `GET /v1_1/<cloud>/ping` (their documented
 *     health endpoint). Returns `{ status: 'ok' }` on healthy.
 *
 * Each probe has its own per-call timeout (default 3s) so a slow
 * external can't stall the whole /health response. Failures are
 * counted into the result but never throw — operators check the
 * status code (200 vs 503) and the body for which dep is degraded.
 *
 * `skipped` is returned when the dep isn't configured (e.g. dev box
 * without S3 keys). Skipped deps don't count as failures.
 */
export type ProbeStatus = 'ok' | 'degraded' | 'skipped';

export interface ProbeResult {
  status: ProbeStatus;
  /** Wall-clock duration in ms; useful for spotting slow probes in logs. */
  durationMs: number;
  /** Free-text detail surfaced in the /health response. */
  detail?: string;
}

@Injectable()
export class ExternalDepsProbeService {
  private readonly logger = new Logger(ExternalDepsProbeService.name);

  constructor(private readonly env: EnvService) {}

  async probeAll(): Promise<Record<string, ProbeResult>> {
    const timeoutMs = this.env.getNumber('HEALTH_PROBE_TIMEOUT_MS', 3_000);
    // Run probes in parallel — one slow dep doesn't drag the others.
    const [razorpay, s3, cloudinary] = await Promise.all([
      this.probeRazorpay(timeoutMs),
      this.probeS3(timeoutMs),
      this.probeCloudinary(timeoutMs),
    ]);
    return { razorpay, s3, cloudinary };
  }

  // ── Razorpay ────────────────────────────────────────────────────

  private async probeRazorpay(timeoutMs: number): Promise<ProbeResult> {
    const keyId = this.env.getString('RAZORPAY_KEY_ID', '');
    const keySecret = this.env.getString('RAZORPAY_KEY_SECRET', '');
    if (!keyId || !keySecret) {
      return { status: 'skipped', durationMs: 0, detail: 'credentials not configured' };
    }
    const started = Date.now();
    try {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const res = await fetch('https://api.razorpay.com/v1/payments?count=1', {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const durationMs = Date.now() - started;
      if (res.ok) return { status: 'ok', durationMs };
      // 401/403/5xx all surface as degraded with the code in the detail.
      return {
        status: 'degraded',
        durationMs,
        detail: `Razorpay returned HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        status: 'degraded',
        durationMs: Date.now() - started,
        detail: `Razorpay probe error: ${(err as Error).message}`,
      };
    }
  }

  // ── S3 ──────────────────────────────────────────────────────────

  private async probeS3(timeoutMs: number): Promise<ProbeResult> {
    const bucket = this.env.getString('S3_BUCKET', '');
    const region = this.env.getString('S3_REGION', '');
    if (!bucket || !region) {
      return { status: 'skipped', durationMs: 0, detail: 'bucket/region not configured' };
    }
    const started = Date.now();
    try {
      // Anonymous HEAD on the bucket's virtual-hosted URL. We don't
      // care about the auth result — 403 (Forbidden) is fine; it
      // means the bucket is reachable and rejecting anonymous, which
      // is the expected production posture. The point is to detect
      // DNS / network unreachability, not credential validity.
      const url = `https://${bucket}.s3.${region}.amazonaws.com/`;
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const durationMs = Date.now() - started;
      // 200, 403 (auth-required), 404 (key-missing on the empty key)
      // are all "we reached S3" outcomes.
      if (res.status >= 200 && res.status < 500) {
        return { status: 'ok', durationMs };
      }
      return {
        status: 'degraded',
        durationMs,
        detail: `S3 returned HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        status: 'degraded',
        durationMs: Date.now() - started,
        detail: `S3 probe error: ${(err as Error).message}`,
      };
    }
  }

  // ── Cloudinary ─────────────────────────────────────────────────

  private async probeCloudinary(timeoutMs: number): Promise<ProbeResult> {
    const cloudName = this.env.getString('CLOUDINARY_CLOUD_NAME', '');
    const apiKey = this.env.getString('CLOUDINARY_API_KEY', '');
    const apiSecret = this.env.getString('CLOUDINARY_API_SECRET', '');
    if (!cloudName || !apiKey || !apiSecret) {
      return { status: 'skipped', durationMs: 0, detail: 'credentials not configured' };
    }
    const started = Date.now();
    try {
      const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
      // Cloudinary's documented health endpoint:
      // https://cloudinary.com/documentation/admin_api#ping
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/ping`, {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const durationMs = Date.now() - started;
      if (res.ok) return { status: 'ok', durationMs };
      return {
        status: 'degraded',
        durationMs,
        detail: `Cloudinary returned HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        status: 'degraded',
        durationMs: Date.now() - started,
        detail: `Cloudinary probe error: ${(err as Error).message}`,
      };
    }
  }
}
