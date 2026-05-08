import { Injectable } from '@nestjs/common';

/**
 * Phase 10 (PR 10.3) — Sandbox mode helpers.
 *
 * The `environment` flag on ApiKey + WebhookEndpoint is the storage
 * truth. This service is the runtime decision helper:
 *
 *   - `isTest(req)` — true when the request authenticated with a
 *     TEST-mode API key.
 *   - `assertLiveOnly(action)` — defensive assertion for irreversible
 *     ops (charging customer cards, sending real emails) that the
 *     test-mode caller should never invoke.
 *   - `fakeRefundId()` / `fakeGatewayId()` — deterministic dummy
 *     identifiers so test-mode integrations get realistic-shaped
 *     responses without touching real money.
 *
 * Domain code consults this from inside the handler, e.g.:
 *
 *   const refund = sandbox.isTest(req)
 *     ? sandbox.fakeRefundResponse(input)
 *     : await this.realRefundProvider.charge(input);
 */
@Injectable()
export class SandboxModeService {
  /**
   * True when the request is authenticated with a TEST-mode API key.
   * Walks `req.apiKey.environment` first, then falls back to the legacy
   * test-cookie path if a future PR introduces it.
   */
  isTest(req: { apiKey?: { environment?: string } }): boolean {
    return req.apiKey?.environment === 'TEST';
  }

  /**
   * Throws if the caller is in test mode. Use as a defensive check
   * around code paths that should NEVER execute on test traffic
   * (real money movement, real email sends, real SMS).
   */
  assertLiveOnly(req: { apiKey?: { environment?: string } }, action: string): void {
    if (this.isTest(req)) {
      throw new Error(
        `Action "${action}" is LIVE-only and was invoked from a TEST-mode key. This is almost certainly a bug — wrap with sandbox.isTest(req).`,
      );
    }
  }

  /**
   * Deterministic fake refund id. Stable for a given input → makes
   * partner replays idempotent in test mode.
   */
  fakeRefundId(seed: string): string {
    return `rfd_test_${hashish(seed)}`;
  }

  fakeGatewayId(seed: string): string {
    return `gw_test_${hashish(seed)}`;
  }

  /**
   * Returns the canonical "test refund" response shape the documented
   * sandbox examples promise: success, fake gateway id, status SUCCEEDED,
   * settle delay 0.
   */
  fakeRefundResponse(input: {
    refundId: string;
    amountInPaise: number;
  }): {
    refundId: string;
    gatewayRefundId: string;
    status: 'SUCCEEDED';
    amountInPaise: number;
    test: true;
  } {
    return {
      refundId: input.refundId,
      gatewayRefundId: this.fakeGatewayId(input.refundId),
      status: 'SUCCEEDED',
      amountInPaise: input.amountInPaise,
      test: true,
    };
  }
}

/**
 * Cheap deterministic hash for fake-id construction. NOT
 * cryptographic — just stable across calls for the same input.
 */
function hashish(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
