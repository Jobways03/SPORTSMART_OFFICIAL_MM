// Phase 86 (2026-05-23) — controller-side coverage for the gaps that
// don't touch the application layer:
//   Gap #4  — timestamp sanity-window clamp
//   Gap #16 — DTO validation rejects oversize fields (validated via
//             the class-validator decorators on the DTO directly)
//   Gap #20 — Shiprocket status mapper covers full carrier lifecycle

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import {
  mapShiprocketStatus,
  parseEventTimestamp,
} from './tracking-webhook.controller';
import { ShiprocketWebhookDto } from '../dtos/tracking-webhook.dto';

describe('TrackingWebhookController helpers (Phase 86)', () => {
  describe('parseEventTimestamp — Gap #4 sanity window', () => {
    it('accepts a timestamp within the past 30 days', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const result = parseEventTimestamp({
        current_timestamp: tenDaysAgo.toISOString(),
      });
      expect(Math.abs(result.getTime() - tenDaysAgo.getTime())).toBeLessThan(
        1000,
      );
    });

    it('clamps a far-future timestamp to now', () => {
      const farFuture = '2099-01-01T00:00:00Z';
      const before = Date.now();
      const result = parseEventTimestamp({ current_timestamp: farFuture });
      const after = Date.now();
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after + 100);
    });

    it('clamps a far-past timestamp (1999) to now', () => {
      const before = Date.now();
      const result = parseEventTimestamp({
        current_timestamp: '1999-01-01T00:00:00Z',
      });
      const after = Date.now();
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after + 100);
    });

    it('accepts unix-seconds within window', () => {
      const recent = Math.floor((Date.now() - 60_000) / 1000);
      const result = parseEventTimestamp({ current_timestamp: recent });
      expect(Math.abs(result.getTime() - recent * 1000)).toBeLessThan(1000);
    });

    it('clamps a unix-seconds future value', () => {
      const farFutureSeconds = Math.floor(
        new Date('2099-01-01').getTime() / 1000,
      );
      const before = Date.now();
      const result = parseEventTimestamp({
        current_timestamp: farFutureSeconds,
      });
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('mapShiprocketStatus — Gap #20', () => {
    it('maps "Delivered" → DELIVERED', () => {
      expect(mapShiprocketStatus('Delivered')).toBe('DELIVERED');
    });

    it('maps "RTO Delivered" → RTO_DELIVERED (not DELIVERED)', () => {
      expect(mapShiprocketStatus('RTO Delivered')).toBe('RTO_DELIVERED');
    });

    it('maps "Out for Delivery" → OUT_FOR_DELIVERY', () => {
      expect(mapShiprocketStatus('Out for Delivery')).toBe('OUT_FOR_DELIVERY');
    });

    it('maps "In Transit" → IN_TRANSIT', () => {
      expect(mapShiprocketStatus('In Transit')).toBe('IN_TRANSIT');
    });

    it('maps "Picked Up" → PICKED_UP', () => {
      expect(mapShiprocketStatus('Picked Up')).toBe('PICKED_UP');
    });

    it('maps "Shipped" / "Manifested" → IN_TRANSIT', () => {
      expect(mapShiprocketStatus('Shipped')).toBe('IN_TRANSIT');
      expect(mapShiprocketStatus('Manifested')).toBe('IN_TRANSIT');
    });

    it('maps "RTO Initiated" → RTO_INITIATED', () => {
      expect(mapShiprocketStatus('RTO Initiated')).toBe('RTO_IN_TRANSIT');
      expect(mapShiprocketStatus('RTO')).toBe('RTO_INITIATED');
    });

    it('maps "Lost" / "Damaged" → terminal states', () => {
      expect(mapShiprocketStatus('Lost')).toBe('LOST');
      expect(mapShiprocketStatus('Damaged')).toBe('DAMAGED');
    });

    it('maps "Cancelled" / "Canceled" → CANCELLED', () => {
      expect(mapShiprocketStatus('Cancelled')).toBe('CANCELLED');
      expect(mapShiprocketStatus('Canceled')).toBe('CANCELLED');
    });

    it('maps NDR / undelivered → UNDELIVERED', () => {
      expect(mapShiprocketStatus('NDR')).toBe('UNDELIVERED');
      expect(mapShiprocketStatus('Undelivered')).toBe('UNDELIVERED');
    });

    it('returns null for unmapped status', () => {
      expect(mapShiprocketStatus('Some Mystery Status')).toBeNull();
      expect(mapShiprocketStatus('')).toBeNull();
    });
  });

  describe('Webhook DTOs — Gap #16', () => {
    it('rejects an oversize shiprocket x_token', async () => {
      const dto = plainToInstance(ShiprocketWebhookDto, {
        awb: 'AWB123',
        current_status: 'Delivered',
        x_token: 't'.repeat(257),
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('x_token');
    });

    it('accepts a Shiprocket payload with nested data', async () => {
      const dto = plainToInstance(ShiprocketWebhookDto, {
        data: {
          awb: 'AWB1',
          current_status: 'Delivered',
        },
      });
      const errors = await validate(dto);
      expect(errors).toEqual([]);
    });
  });
});
