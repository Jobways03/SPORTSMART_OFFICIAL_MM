import { Injectable } from '@nestjs/common';

import { EnvService } from '../../../bootstrap/env/env.service';
import type { IThinkForwardLogistics } from '../ithink.constants';

/**
 * Central resolver for iThink runtime config. Everything that touches
 * the network reads from here so the rest of the integration never
 * sees `process.env` and credentials live in exactly one place.
 */
@Injectable()
export class IThinkConfig {
  constructor(private readonly env: EnvService) {}

  /** Base host for every endpoint except Track Order. */
  get baseUrl(): string {
    return this.env.getString('ITHINK_BASE_URL');
  }

  /**
   * Track Order uses `api.ithinklogistics.com` in production; sandbox
   * collapses both onto `pre-alpha.ithinklogistics.com`. Keeping them
   * as separate env vars means the client doesn't have to know which
   * environment it's in.
   */
  get trackUrl(): string {
    return this.env.getString('ITHINK_TRACK_URL');
  }

  /**
   * iThink's auth model: two equally sensitive strings sent inside the
   * request body of every call. Both must be treated as bearer secrets
   * and never logged.
   */
  get accessToken(): string {
    return this.env.getString('ITHINK_ACCESS_TOKEN');
  }

  get secretKey(): string {
    return this.env.getString('ITHINK_SECRET_KEY');
  }

  /**
   * Default carrier when an Add Order request doesn't pin one. Allowed
   * set: delhivery | bluedart | xpressbees | ecom | ekart | fedex.
   * If left blank in the request, iThink decides — we prefer to be
   * explicit so seller-side cost estimates match what we actually book.
   */
  get defaultLogistics(): IThinkForwardLogistics {
    // env.schema.ts already z.enums this to the forward set, so the
    // cast is type-safe at runtime — adding the assertion just lifts
    // the value into the literal-union slot consumers expect.
    return this.env.getString(
      'ITHINK_DEFAULT_LOGISTICS',
      'delhivery',
    ) as IThinkForwardLogistics;
  }

  get httpTimeoutMs(): number {
    return this.env.getNumber('ITHINK_HTTP_TIMEOUT_MS', 15000);
  }

  get httpMaxRetries(): number {
    return this.env.getNumber('ITHINK_HTTP_MAX_RETRIES', 2);
  }

  /**
   * Cadence of the Get Airwaybill poller. iThink caps the per-call
   * window at 30 min — leaving ≥1 min slack here avoids losing events
   * across the boundary when the cron drifts.
   */
  get trackingPollIntervalMinutes(): number {
    return this.env.getNumber('ITHINK_TRACKING_POLL_INTERVAL_MINUTES', 25);
  }

  get trackingPollEnabled(): boolean {
    return this.env.getBoolean('ITHINK_TRACKING_POLL_ENABLED', false);
  }

  /** True when targeting the staging environment (pre-alpha host). */
  get isSandbox(): boolean {
    return this.env.getBoolean('ITHINK_USE_SANDBOX', true);
  }

  /**
   * Are credentials present and non-empty? Used by callers to short-
   * circuit gracefully when iThink isn't configured at all (e.g., dev
   * environments where another carrier is preferred).
   */
  get isConfigured(): boolean {
    const token = this.env.getOptional('ITHINK_ACCESS_TOKEN');
    const secret = this.env.getOptional('ITHINK_SECRET_KEY');
    return Boolean(token && secret);
  }

  /**
   * Returns `access_token` + `secret_key` as an object spread into
   * every request body. Centralised so we never sprinkle credential
   * reads through DTO mappers.
   */
  getAuthPayload(): { access_token: string; secret_key: string } {
    return {
      access_token: this.accessToken,
      secret_key: this.secretKey,
    };
  }
}
