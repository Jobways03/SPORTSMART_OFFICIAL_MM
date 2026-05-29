import { createHmac } from 'crypto';
import { TrackingWebhookController } from './tracking-webhook.controller';

/**
 * Phase 1 (PR 1.4) — Shiprocket webhook hardening.
 *
 * Pins two auth modes:
 *   - HMAC mode (preferred): `X-Shiprocket-Signature: t=<ts>,v1=<hmac>`,
 *     verified against `SHIPROCKET_WEBHOOK_HMAC_SECRET`. Stripe-style.
 *     Replays beyond 5 min are rejected by the timestamp window.
 *   - Bearer-token (legacy, deprecated): `x_token` in the request
 *     body, compared constant-time against `SHIPROCKET_WEBHOOK_TOKEN`.
 *     Kept for the operator-side cutover window only.
 *
 * Mode is selected by whether `SHIPROCKET_WEBHOOK_HMAC_SECRET` is set.
 * When BOTH paths are configured, HMAC takes priority and the legacy
 * bearer token is ignored entirely.
 */

const HMAC_SECRET = 'whsec_shiprocket_min32_chars_phase1_test';
const BEARER_TOKEN = 'shiprocket_legacy_bearer_token_long_value';

function sign(rawBody: string, nowMs = Date.now(), secret = HMAC_SECRET) {
  const t = Math.floor(nowMs / 1000);
  const hmac = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${hmac}`;
}

function buildController(opts: {
  hmacMode?: boolean;
  bearerMode?: boolean;
  subOrderId?: string | null;
  markDeliveredImpl?: () => Promise<unknown>;
}) {
  const env = {
    getOptional: jest.fn((key: string) => {
      if (key === 'SHIPROCKET_WEBHOOK_HMAC_SECRET') {
        return opts.hmacMode ? HMAC_SECRET : undefined;
      }
      if (key === 'SHIPROCKET_WEBHOOK_TOKEN') {
        return opts.bearerMode ? BEARER_TOKEN : undefined;
      }
      return undefined;
    }),
    // Phase 83 (2026-05-23) — controller checks NODE_ENV to gate
    // the legacy bearer-token fallback (production fails closed).
    // Tests default to development so the bearer mode tests still
    // exercise their original path.
    getString: jest.fn((key: string, fallback?: string) => {
      if (key === 'NODE_ENV') return 'development';
      return fallback;
    }),
  } as any;
  const redis = {
    acquireLock: jest.fn().mockResolvedValue(true),
  } as any;
  const subOrderById = opts.subOrderId === undefined ? { id: 'so-1' } : opts.subOrderId === null ? null : { id: opts.subOrderId };
  const ordersFacade = {
    findSubOrderByTrackingNumber: jest.fn().mockResolvedValue(subOrderById),
    markSubOrderDelivered:
      opts.markDeliveredImpl ?? jest.fn().mockResolvedValue(undefined),
    // Phase 4 (PR 4.4) — default to a successful claim so the
    // pre-existing PR-1.4 auth tests continue to exercise the
    // delivered-side path. The PR 4.4 ordering tests below override
    // this where needed.
    claimTrackingEvent: jest.fn().mockResolvedValue(true),
  } as any;

  // Phase 5 follow-up (2026-05-16) — controller now also injects
  // IngestTrackingUpdateUseCase for the iThink webhook path. Stubbing
  // it as a no-op preserves all Shiprocket-side tests.
  const ingestTracking = {
    ingestSingleSnapshot: jest
      .fn()
      .mockResolvedValue({ subOrderId: 'so-1', applied: true }),
  } as any;
  // Phase 83 (2026-05-23) — controller injects PrismaService for the
  // webhook_events audit log. Stub the upsert + update calls so the
  // existing tests run unchanged; the new Phase 83 spec exercises
  // the audit-log behaviour against real mock assertions.
  const prismaStub = {
    webhookEvent: {
      upsert: jest.fn().mockResolvedValue({ id: 'wh-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
  } as any;
  const controller = new TrackingWebhookController(
    env,
    redis,
    ordersFacade,
    ingestTracking,
    prismaStub,
  );
  return { controller, env, redis, ordersFacade };
}

function payload(opts: { withBearerToken?: boolean; status?: string; awb?: string } = {}) {
  return {
    awb: opts.awb ?? 'AWB123',
    current_status: opts.status ?? 'Delivered',
    ...(opts.withBearerToken ? { x_token: BEARER_TOKEN } : {}),
  };
}

describe('TrackingWebhookController — Phase 1 PR 1.4 HMAC verification', () => {
  // ── HMAC mode (preferred) ──────────────────────────────────────────

  it('HMAC mode: accepts a valid signed payload', async () => {
    const body = payload();
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = sign(rawBody.toString('utf8'));

    const { controller, ordersFacade } = buildController({ hmacMode: true });

    const res = await controller.handleShiprocketWebhook(
      signature,
      { rawBody } as any,
      body as any,
    );

    expect(res).toEqual({ success: true, message: 'Delivery confirmed' });
    expect(ordersFacade.markSubOrderDelivered).toHaveBeenCalledWith(
      'so-1',
      expect.objectContaining({ source: 'WEBHOOK_SHIPROCKET' }),
    );
  });

  it('HMAC mode: rejects a missing X-Shiprocket-Signature header', async () => {
    const body = payload();
    const rawBody = Buffer.from(JSON.stringify(body));

    const { controller } = buildController({ hmacMode: true });

    await expect(
      controller.handleShiprocketWebhook(undefined, { rawBody } as any, body as any),
    ).rejects.toThrow(/Missing X-Shiprocket-Signature/);
  });

  it('HMAC mode: rejects a mutated body (signature stale)', async () => {
    const originalBody = payload();
    const rawBody = Buffer.from(JSON.stringify(originalBody));
    const signature = sign(rawBody.toString('utf8'));

    // Attacker mutates the body but reuses the signature.
    const mutated = { ...originalBody, awb: 'ATTACKER_AWB' };
    const mutatedRawBody = Buffer.from(JSON.stringify(mutated));

    const { controller } = buildController({ hmacMode: true });

    await expect(
      controller.handleShiprocketWebhook(
        signature,
        { rawBody: mutatedRawBody } as any,
        mutated as any,
      ),
    ).rejects.toThrow(/Invalid Shiprocket webhook signature/);
  });

  it('HMAC mode: rejects a replay older than the 5-minute window', async () => {
    const body = payload();
    const rawBody = Buffer.from(JSON.stringify(body));
    // Sign with a timestamp 6 minutes in the past.
    const stale = sign(rawBody.toString('utf8'), Date.now() - 6 * 60 * 1000);

    const { controller } = buildController({ hmacMode: true });

    await expect(
      controller.handleShiprocketWebhook(stale, { rawBody } as any, body as any),
    ).rejects.toThrow(/Invalid Shiprocket webhook signature/);
  });

  it('HMAC mode: rejects a payload signed with the wrong secret', async () => {
    const body = payload();
    const rawBody = Buffer.from(JSON.stringify(body));
    const wrongSig = sign(rawBody.toString('utf8'), Date.now(), 'wrong_secret');

    const { controller } = buildController({ hmacMode: true });

    await expect(
      controller.handleShiprocketWebhook(wrongSig, { rawBody } as any, body as any),
    ).rejects.toThrow(/Invalid Shiprocket webhook signature/);
  });

  it('HMAC mode: IGNORES a legacy x_token body field even if present', async () => {
    // Belt-and-braces: an attacker who knows the legacy bearer token
    // can NOT bypass HMAC by sending the bearer.
    const body = { ...payload(), x_token: BEARER_TOKEN };
    const rawBody = Buffer.from(JSON.stringify(body));

    const { controller } = buildController({
      hmacMode: true,
      bearerMode: true, // both configured — HMAC takes priority
    });

    // No signature header → rejected even with a valid bearer token.
    await expect(
      controller.handleShiprocketWebhook(undefined, { rawBody } as any, body as any),
    ).rejects.toThrow(/Missing X-Shiprocket-Signature/);
  });

  // ── Bearer-token mode (legacy, deprecated) ────────────────────────

  it('Bearer mode: accepts the valid x_token from the body', async () => {
    const body = payload({ withBearerToken: true });
    const rawBody = Buffer.from(JSON.stringify(body));

    const { controller, ordersFacade } = buildController({ bearerMode: true });

    const res = await controller.handleShiprocketWebhook(
      undefined,
      { rawBody } as any,
      body as any,
    );

    expect(res).toEqual({ success: true, message: 'Delivery confirmed' });
    expect(ordersFacade.markSubOrderDelivered).toHaveBeenCalled();
  });

  it('Bearer mode: rejects a missing x_token', async () => {
    const body = payload(); // no x_token
    const rawBody = Buffer.from(JSON.stringify(body));

    const { controller } = buildController({ bearerMode: true });

    await expect(
      controller.handleShiprocketWebhook(
        undefined,
        { rawBody } as any,
        body as any,
      ),
    ).rejects.toThrow(/Missing webhook token/);
  });

  it('Bearer mode: rejects a wrong x_token', async () => {
    const body = { ...payload(), x_token: 'wrong_token_same_length_padded____padding' };
    const rawBody = Buffer.from(JSON.stringify(body));

    const { controller } = buildController({ bearerMode: true });

    await expect(
      controller.handleShiprocketWebhook(undefined, { rawBody } as any, body as any),
    ).rejects.toThrow(/Invalid webhook token/);
  });

  it('No auth configured: rejects every request', async () => {
    const body = payload({ withBearerToken: true });
    const rawBody = Buffer.from(JSON.stringify(body));

    const { controller } = buildController({});

    await expect(
      controller.handleShiprocketWebhook(undefined, { rawBody } as any, body as any),
    ).rejects.toThrow(/auth not configured/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Phase 4 (PR 4.4) — event-order guard
// ────────────────────────────────────────────────────────────────────

import { parseEventTimestamp } from './tracking-webhook.controller';

describe('TrackingWebhookController — event-order guard (PR 4.4)', () => {
  function buildOrderingController(opts: {
    claimResult: boolean;
    subOrderId?: string | null;
  }) {
    const env = {
      getOptional: jest.fn((key: string) =>
        key === 'SHIPROCKET_WEBHOOK_TOKEN' ? BEARER_TOKEN : undefined,
      ),
      // Phase 83 (2026-05-23) — controller checks NODE_ENV to gate
      // the legacy bearer-token fallback. Dev environment so the
      // bearer-mode tests still exercise their original path.
      getString: jest.fn((key: string, fallback?: string) => {
        if (key === 'NODE_ENV') return 'development';
        return fallback;
      }),
    } as any;
    const redis = { acquireLock: jest.fn().mockResolvedValue(true) } as any;
    const ordersFacade = {
      findSubOrderByTrackingNumber: jest
        .fn()
        .mockResolvedValue(opts.subOrderId === null ? null : { id: opts.subOrderId ?? 'so-1' }),
      markSubOrderDelivered: jest.fn().mockResolvedValue(undefined),
      claimTrackingEvent: jest.fn().mockResolvedValue(opts.claimResult),
    } as any;
    const ingestTracking = {
      ingestSingleSnapshot: jest
        .fn()
        .mockResolvedValue({ subOrderId: 'so-1', applied: true }),
    } as any;
    const prismaStub = {
      webhookEvent: {
        upsert: jest.fn().mockResolvedValue({ id: 'wh-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    return {
      controller: new TrackingWebhookController(
        env,
        redis,
        ordersFacade,
        ingestTracking,
        prismaStub,
      ),
      ordersFacade,
    };
  }

  function bodyWithTs(ts: string | number | undefined): any {
    return {
      awb: 'AWB123',
      current_status: 'Delivered',
      x_token: BEARER_TOKEN,
      ...(ts !== undefined ? { current_timestamp: ts } : {}),
    };
  }

  it('first DELIVERED with fresh timestamp: claim wins, sub-order marked delivered', async () => {
    const { controller, ordersFacade } = buildOrderingController({ claimResult: true });
    const body = bodyWithTs('2026-05-12T10:00:00Z');

    const result = await controller.handleShiprocketWebhook(
      undefined,
      { rawBody: Buffer.from(JSON.stringify(body)) } as any,
      body,
    );

    expect(result.success).toBe(true);
    expect(ordersFacade.claimTrackingEvent).toHaveBeenCalledWith(
      'so-1',
      expect.any(Date),
    );
    const claimedTs = ordersFacade.claimTrackingEvent.mock.calls[0][1] as Date;
    expect(claimedTs.toISOString()).toBe('2026-05-12T10:00:00.000Z');
    expect(ordersFacade.markSubOrderDelivered).toHaveBeenCalledWith(
      'so-1',
      expect.objectContaining({ source: 'WEBHOOK_SHIPROCKET' }),
    );
  });

  it('out-of-order DELIVERED (older event timestamp): claim returns false, mark NOT called', async () => {
    const { controller, ordersFacade } = buildOrderingController({ claimResult: false });
    const body = bodyWithTs('2026-05-12T09:00:00Z');

    const result = await controller.handleShiprocketWebhook(
      undefined,
      { rawBody: Buffer.from(JSON.stringify(body)) } as any,
      body,
    );

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/out-of-order/i);
    expect(ordersFacade.claimTrackingEvent).toHaveBeenCalledTimes(1);
    expect(ordersFacade.markSubOrderDelivered).not.toHaveBeenCalled();
  });

  it('non-DELIVERED status: short-circuits before claim (claim NOT called for noise events)', async () => {
    // Today only DELIVERED drives FSM change; the early-return for
    // other statuses skips the ordering guard. Pinning this preserves
    // the current scope. A future PR wiring up IN_TRANSIT handling
    // will need its own claim — and an updated assertion here.
    const { controller, ordersFacade } = buildOrderingController({ claimResult: true });
    const body = {
      awb: 'AWB123',
      current_status: 'IN TRANSIT',
      x_token: BEARER_TOKEN,
    };

    await controller.handleShiprocketWebhook(
      undefined,
      { rawBody: Buffer.from(JSON.stringify(body)) } as any,
      body as any,
    );

    expect(ordersFacade.claimTrackingEvent).not.toHaveBeenCalled();
  });

  it('AWB lookup miss: claim NOT attempted', async () => {
    const { controller, ordersFacade } = buildOrderingController({
      claimResult: true,
      subOrderId: null,
    });
    const body = bodyWithTs('2026-05-12T10:00:00Z');

    const result = await controller.handleShiprocketWebhook(
      undefined,
      { rawBody: Buffer.from(JSON.stringify(body)) } as any,
      body,
    );
    expect(result.success).toBe(false);
    expect(ordersFacade.claimTrackingEvent).not.toHaveBeenCalled();
  });
});

describe('parseEventTimestamp helper (PR 4.4)', () => {
  it('parses ISO-8601 from current_timestamp', () => {
    const ts = parseEventTimestamp({
      current_timestamp: '2026-05-12T10:00:00Z',
    } as any);
    expect(ts.toISOString()).toBe('2026-05-12T10:00:00.000Z');
  });

  it('parses Unix-milliseconds from current_timestamp', () => {
    // Phase 86 — within the 30-day sanity window from the current
    // wall clock so the clamp doesn't fall back to `new Date()`.
    const recentMs = Date.now() - 5 * 60 * 1000;
    const ts = parseEventTimestamp({
      current_timestamp: recentMs,
    } as any);
    expect(ts.getTime()).toBe(recentMs);
  });

  it('auto-detects Unix-seconds (value < 10^12 treated as seconds)', () => {
    const recentSeconds = Math.floor((Date.now() - 5 * 60 * 1000) / 1000);
    const ts = parseEventTimestamp({
      current_timestamp: recentSeconds,
    } as any);
    expect(ts.getTime()).toBe(recentSeconds * 1000);
  });

  it('falls back to nested data.current_timestamp', () => {
    const ts = parseEventTimestamp({
      data: { current_timestamp: '2026-05-12T11:00:00Z' },
    } as any);
    expect(ts.toISOString()).toBe('2026-05-12T11:00:00.000Z');
  });

  it('returns new Date() when no timestamp field is present', () => {
    const before = Date.now();
    const ts = parseEventTimestamp({ awb: 'X' } as any);
    const after = Date.now();
    expect(ts.getTime()).toBeGreaterThanOrEqual(before);
    expect(ts.getTime()).toBeLessThanOrEqual(after);
  });

  it('returns new Date() when the value is unparseable garbage', () => {
    const before = Date.now();
    const ts = parseEventTimestamp({
      current_timestamp: 'not-a-date',
    } as any);
    const after = Date.now();
    expect(ts.getTime()).toBeGreaterThanOrEqual(before);
    expect(ts.getTime()).toBeLessThanOrEqual(after);
  });
});
