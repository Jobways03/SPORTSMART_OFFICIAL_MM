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
 *   • R2 (Cloudflare) — anonymous HEAD on the bucket URL for
 *     reachability. Raw fetch (no SDK) to keep the probe lean; the
 *     request is unsigned, so 401/403 means the bucket is reachable and
 *     (correctly) rejecting anonymous access, while a network/DNS error
 *     means unreachable.
 *
 * Each probe has its own per-call timeout (default 3s) so a slow
 * external can't stall the whole /health response. Failures are
 * counted into the result but never throw — operators check the
 * status code (200 vs 503) and the body for which dep is degraded.
 *
 * `skipped` is returned when the dep isn't configured (e.g. dev box
 * without R2 keys). Skipped deps don't count as failures.
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
    const [razorpay, r2] = await Promise.all([
      this.probeRazorpay(timeoutMs),
      this.probeR2(timeoutMs),
    ]);
    return { razorpay, r2 };
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

  // ── Cloudflare R2 ───────────────────────────────────────────────

  private async probeR2(timeoutMs: number): Promise<ProbeResult> {
    const accountId = this.env.getString('R2_ACCOUNT_ID', '');
    const endpoint =
      this.env.getString('R2_ENDPOINT', '') ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
    const bucket = this.env.getString('R2_BUCKET', '');
    if (!endpoint || !bucket) {
      return { status: 'skipped', durationMs: 0, detail: 'endpoint/bucket not configured' };
    }
    const started = Date.now();
    try {
      // Anonymous HEAD on the bucket path. We don't care about the auth
      // result — 401/403 means the bucket is reachable and rejecting
      // anonymous (expected). The point is DNS/network reachability.
      const url = `${endpoint.replace(/\/+$/, '')}/${bucket}`;
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const durationMs = Date.now() - started;
      if (res.status >= 200 && res.status < 500) {
        return { status: 'ok', durationMs };
      }
      return {
        status: 'degraded',
        durationMs,
        detail: `R2 returned HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        status: 'degraded',
        durationMs: Date.now() - started,
        detail: `R2 probe error: ${(err as Error).message}`,
      };
    }
  }

}
