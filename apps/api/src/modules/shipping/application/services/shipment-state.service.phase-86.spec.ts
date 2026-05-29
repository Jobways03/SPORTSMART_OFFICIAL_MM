// Phase 86 (2026-05-23) — shipment FSM coverage.
//
// Covers ShipmentStateService:
//   Gap #2/#18 — internal ShipmentStatus enum + FSM matrix
//   Gap #3     — assertTransition rejects illegal moves
//   Gap #26    — CANCELLED transition gated against terminal states

import { ShipmentStateService } from './shipment-state.service';
import { BadRequestAppException } from '../../../../core/exceptions';

describe('ShipmentStateService (Phase 86)', () => {
  const svc = new ShipmentStateService();

  describe('initial transitions (from = null)', () => {
    it('allows CREATED, PICKUP_PENDING, PICKED_UP, IN_TRANSIT, DELIVERED', () => {
      expect(svc.isTransitionAllowed(null, 'CREATED')).toBe(true);
      expect(svc.isTransitionAllowed(null, 'PICKUP_PENDING')).toBe(true);
      expect(svc.isTransitionAllowed(null, 'PICKED_UP')).toBe(true);
      expect(svc.isTransitionAllowed(null, 'IN_TRANSIT')).toBe(true);
      expect(svc.isTransitionAllowed(null, 'DELIVERED')).toBe(true);
    });

    it('blocks RTO_* on first scan (carrier cannot initiate RTO on a shipment we never saw)', () => {
      expect(svc.isTransitionAllowed(null, 'RTO_INITIATED')).toBe(false);
      expect(svc.isTransitionAllowed(null, 'RTO_IN_TRANSIT')).toBe(false);
      expect(svc.isTransitionAllowed(null, 'RTO_DELIVERED')).toBe(false);
    });
  });

  describe('happy path forward lifecycle', () => {
    it('PICKED_UP → IN_TRANSIT', () => {
      expect(svc.isTransitionAllowed('PICKED_UP', 'IN_TRANSIT')).toBe(true);
    });

    it('IN_TRANSIT → OUT_FOR_DELIVERY', () => {
      expect(
        svc.isTransitionAllowed('IN_TRANSIT', 'OUT_FOR_DELIVERY'),
      ).toBe(true);
    });

    it('OUT_FOR_DELIVERY → DELIVERED', () => {
      expect(
        svc.isTransitionAllowed('OUT_FOR_DELIVERY', 'DELIVERED'),
      ).toBe(true);
    });

    it('IN_TRANSIT → IN_TRANSIT (carrier reshuffle between hubs)', () => {
      expect(svc.isTransitionAllowed('IN_TRANSIT', 'IN_TRANSIT')).toBe(true);
    });
  });

  describe('RTO branch', () => {
    it('IN_TRANSIT → RTO_INITIATED', () => {
      expect(svc.isTransitionAllowed('IN_TRANSIT', 'RTO_INITIATED')).toBe(true);
    });

    it('RTO_INITIATED → RTO_IN_TRANSIT → RTO_DELIVERED', () => {
      expect(
        svc.isTransitionAllowed('RTO_INITIATED', 'RTO_IN_TRANSIT'),
      ).toBe(true);
      expect(
        svc.isTransitionAllowed('RTO_IN_TRANSIT', 'RTO_DELIVERED'),
      ).toBe(true);
    });
  });

  describe('regression blocking — Gap #3', () => {
    it('blocks DELIVERED → IN_TRANSIT', () => {
      expect(svc.isTransitionAllowed('DELIVERED', 'IN_TRANSIT')).toBe(false);
    });

    it('blocks DELIVERED → OUT_FOR_DELIVERY', () => {
      expect(
        svc.isTransitionAllowed('DELIVERED', 'OUT_FOR_DELIVERY'),
      ).toBe(false);
    });

    it('blocks DELIVERED → CANCELLED (Gap #26: terminal-to-terminal cancel blocked)', () => {
      expect(svc.isTransitionAllowed('DELIVERED', 'CANCELLED')).toBe(false);
    });

    it('blocks RTO_DELIVERED → DELIVERED', () => {
      expect(svc.isTransitionAllowed('RTO_DELIVERED', 'DELIVERED')).toBe(false);
    });

    it('blocks LOST → DELIVERED', () => {
      expect(svc.isTransitionAllowed('LOST', 'DELIVERED')).toBe(false);
    });
  });

  describe('CANCELLED gating — Gap #26', () => {
    it('allows CANCELLED only from pre-shipment states', () => {
      expect(svc.isTransitionAllowed('CREATED', 'CANCELLED')).toBe(true);
      expect(svc.isTransitionAllowed('PICKUP_PENDING', 'CANCELLED')).toBe(true);
      expect(svc.isTransitionAllowed('PICKED_UP', 'CANCELLED')).toBe(true);
    });

    it('blocks CANCELLED from IN_TRANSIT (goods in motion)', () => {
      expect(svc.isTransitionAllowed('IN_TRANSIT', 'CANCELLED')).toBe(false);
    });

    it('blocks CANCELLED from OUT_FOR_DELIVERY (last mile)', () => {
      expect(
        svc.isTransitionAllowed('OUT_FOR_DELIVERY', 'CANCELLED'),
      ).toBe(false);
    });
  });

  describe('MANIFESTED / UNDELIVERED — follow-up enum promotion', () => {
    it('allows MANIFESTED as a first scan', () => {
      expect(svc.isTransitionAllowed(null, 'MANIFESTED')).toBe(true);
    });

    it('MANIFESTED → IN_TRANSIT', () => {
      expect(svc.isTransitionAllowed('MANIFESTED', 'IN_TRANSIT')).toBe(true);
    });

    it('MANIFESTED → PICKED_UP (some carriers backfill pickup after manifest)', () => {
      expect(svc.isTransitionAllowed('MANIFESTED', 'PICKED_UP')).toBe(true);
    });

    it('blocks MANIFESTED → DELIVERED (must pass through transit)', () => {
      expect(svc.isTransitionAllowed('MANIFESTED', 'DELIVERED')).toBe(false);
    });

    it('OUT_FOR_DELIVERY → UNDELIVERED (NDR)', () => {
      expect(svc.isTransitionAllowed('OUT_FOR_DELIVERY', 'UNDELIVERED')).toBe(
        true,
      );
    });

    it('UNDELIVERED → OUT_FOR_DELIVERY (retry)', () => {
      expect(svc.isTransitionAllowed('UNDELIVERED', 'OUT_FOR_DELIVERY')).toBe(
        true,
      );
    });

    it('UNDELIVERED → RTO_INITIATED', () => {
      expect(svc.isTransitionAllowed('UNDELIVERED', 'RTO_INITIATED')).toBe(
        true,
      );
    });

    it('UNDELIVERED → DELIVERED (eventual success)', () => {
      expect(svc.isTransitionAllowed('UNDELIVERED', 'DELIVERED')).toBe(true);
    });
  });

  describe('LOST / DAMAGED — Gap #27', () => {
    it('IN_TRANSIT → LOST', () => {
      expect(svc.isTransitionAllowed('IN_TRANSIT', 'LOST')).toBe(true);
    });

    it('OUT_FOR_DELIVERY → DAMAGED', () => {
      expect(svc.isTransitionAllowed('OUT_FOR_DELIVERY', 'DAMAGED')).toBe(true);
    });

    it('PICKED_UP → LOST', () => {
      expect(svc.isTransitionAllowed('PICKED_UP', 'LOST')).toBe(true);
    });
  });

  describe('assertTransition throws on illegal moves', () => {
    it('throws BadRequestAppException on DELIVERED → IN_TRANSIT', () => {
      expect(() => svc.assertTransition('DELIVERED', 'IN_TRANSIT')).toThrow(
        BadRequestAppException,
      );
    });

    it('throws with descriptive message', () => {
      expect(() => svc.assertTransition('DELIVERED', 'IN_TRANSIT')).toThrow(
        /Illegal ShipmentStatus transition: DELIVERED → IN_TRANSIT/,
      );
    });

    it('accepts legal move without throwing', () => {
      expect(() => svc.assertTransition('IN_TRANSIT', 'DELIVERED')).not.toThrow();
    });
  });

  describe('isTerminal', () => {
    it('reports DELIVERED, RTO_DELIVERED, LOST, DAMAGED, CANCELLED as terminal', () => {
      expect(svc.isTerminal('DELIVERED')).toBe(true);
      expect(svc.isTerminal('RTO_DELIVERED')).toBe(true);
      expect(svc.isTerminal('LOST')).toBe(true);
      expect(svc.isTerminal('DAMAGED')).toBe(true);
      expect(svc.isTerminal('CANCELLED')).toBe(true);
    });

    it('reports in-flight states as non-terminal', () => {
      expect(svc.isTerminal('IN_TRANSIT')).toBe(false);
      expect(svc.isTerminal('OUT_FOR_DELIVERY')).toBe(false);
      expect(svc.isTerminal('RTO_IN_TRANSIT')).toBe(false);
    });
  });
});
