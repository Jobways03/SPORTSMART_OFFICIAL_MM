import {
  isTransitionAllowed,
  assertTransition,
  allowedTransitions,
} from '../../src/core/fsm/status-transitions';
import { BadRequestAppException } from '../../src/core/exceptions';

describe('Status FSM — OrderStatus', () => {
  it('allows the happy path', () => {
    expect(isTransitionAllowed('OrderStatus', 'PLACED', 'VERIFIED')).toBe(true);
    expect(isTransitionAllowed('OrderStatus', 'VERIFIED', 'ROUTED_TO_SELLER')).toBe(true);
    expect(isTransitionAllowed('OrderStatus', 'ROUTED_TO_SELLER', 'SELLER_ACCEPTED')).toBe(true);
    expect(isTransitionAllowed('OrderStatus', 'SELLER_ACCEPTED', 'DISPATCHED')).toBe(true);
    expect(isTransitionAllowed('OrderStatus', 'DISPATCHED', 'DELIVERED')).toBe(true);
  });

  it('blocks DELIVERED → anything (terminal)', () => {
    expect(isTransitionAllowed('OrderStatus', 'DELIVERED', 'PLACED')).toBe(false);
    expect(isTransitionAllowed('OrderStatus', 'DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('blocks CANCELLED → anything (terminal)', () => {
    expect(isTransitionAllowed('OrderStatus', 'CANCELLED', 'VERIFIED')).toBe(false);
  });

  it('blocks skipping the verification step', () => {
    expect(isTransitionAllowed('OrderStatus', 'PLACED', 'DISPATCHED')).toBe(false);
    expect(isTransitionAllowed('OrderStatus', 'PLACED', 'DELIVERED')).toBe(false);
  });

  it('allows EXCEPTION_QUEUE recovery to non-terminal states', () => {
    expect(isTransitionAllowed('OrderStatus', 'EXCEPTION_QUEUE', 'VERIFIED')).toBe(true);
    expect(isTransitionAllowed('OrderStatus', 'EXCEPTION_QUEUE', 'CANCELLED')).toBe(true);
  });

  it('allows idempotent same-state updates', () => {
    expect(isTransitionAllowed('OrderStatus', 'VERIFIED', 'VERIFIED')).toBe(true);
    expect(isTransitionAllowed('OrderStatus', 'DELIVERED', 'DELIVERED')).toBe(true);
  });

  // Regression (2026-06-17): an admin cancelling SOME sub-orders of a
  // pre-routing order must be able to roll the master to PARTIALLY_CANCELLED.
  // Pre-fix the FSM rejected it from PLACED/PENDING_VERIFICATION, so the master
  // stayed PLACED and the cancelled order kept showing as active in admin.
  it('allows PARTIALLY_CANCELLED from pre-routing states (cancelled-shows-active fix)', () => {
    expect(isTransitionAllowed('OrderStatus', 'PLACED', 'PARTIALLY_CANCELLED')).toBe(true);
    expect(isTransitionAllowed('OrderStatus', 'PENDING_VERIFICATION', 'PARTIALLY_CANCELLED')).toBe(true);
    // and still legal from the already-supported routed/dispatched states
    expect(isTransitionAllowed('OrderStatus', 'VERIFIED', 'PARTIALLY_CANCELLED')).toBe(true);
  });
});

describe('Status FSM — OrderFulfillmentStatus', () => {
  it('allows the happy path', () => {
    expect(
      isTransitionAllowed('OrderFulfillmentStatus', 'UNFULFILLED', 'PACKED'),
    ).toBe(true);
    expect(
      isTransitionAllowed('OrderFulfillmentStatus', 'PACKED', 'SHIPPED'),
    ).toBe(true);
    expect(
      isTransitionAllowed('OrderFulfillmentStatus', 'SHIPPED', 'DELIVERED'),
    ).toBe(true);
  });

  it('blocks UNFULFILLED → DELIVERED (skip ahead)', () => {
    expect(
      isTransitionAllowed('OrderFulfillmentStatus', 'UNFULFILLED', 'DELIVERED'),
    ).toBe(false);
  });

  it('blocks resurrection from CANCELLED', () => {
    expect(
      isTransitionAllowed('OrderFulfillmentStatus', 'CANCELLED', 'PACKED'),
    ).toBe(false);
  });

  it('blocks DELIVERED → SHIPPED (regression)', () => {
    expect(
      isTransitionAllowed('OrderFulfillmentStatus', 'DELIVERED', 'SHIPPED'),
    ).toBe(false);
  });
});

describe('Status FSM — OrderPaymentStatus', () => {
  it('allows PENDING → PAID', () => {
    expect(isTransitionAllowed('OrderPaymentStatus', 'PENDING', 'PAID')).toBe(true);
  });

  it('blocks PAID → PENDING', () => {
    expect(isTransitionAllowed('OrderPaymentStatus', 'PAID', 'PENDING')).toBe(false);
  });

  it('blocks PAID → CANCELLED (refunds go through Returns module)', () => {
    expect(isTransitionAllowed('OrderPaymentStatus', 'PAID', 'CANCELLED')).toBe(false);
  });

  it('allows PAID → VOIDED (admin-only override)', () => {
    expect(isTransitionAllowed('OrderPaymentStatus', 'PAID', 'VOIDED')).toBe(true);
  });

  // Regression (online checkout): an ONLINE order starts at CREATED (Razorpay
  // intent minted) and must reach PAID on a successful capture. CREATED +
  // EXPIRED were missing from the FSM map, so a real payment threw
  // "Illegal OrderPaymentStatus transition: CREATED → PAID".
  it('allows CREATED → PAID (online capture happy path)', () => {
    expect(isTransitionAllowed('OrderPaymentStatus', 'CREATED', 'PAID')).toBe(true);
  });

  it('allows CREATED → PENDING / EXPIRED / CANCELLED', () => {
    expect(isTransitionAllowed('OrderPaymentStatus', 'CREATED', 'PENDING')).toBe(true);
    expect(isTransitionAllowed('OrderPaymentStatus', 'CREATED', 'EXPIRED')).toBe(true);
    expect(isTransitionAllowed('OrderPaymentStatus', 'CREATED', 'CANCELLED')).toBe(true);
  });

  it('allows PENDING → EXPIRED (payment-expiry sweep cron)', () => {
    expect(isTransitionAllowed('OrderPaymentStatus', 'PENDING', 'EXPIRED')).toBe(true);
  });

  it('blocks CREATED → VOIDED (nothing captured to void)', () => {
    expect(isTransitionAllowed('OrderPaymentStatus', 'CREATED', 'VOIDED')).toBe(false);
  });

  it('keeps EXPIRED terminal (no EXPIRED → PAID revival)', () => {
    expect(isTransitionAllowed('OrderPaymentStatus', 'EXPIRED', 'PAID')).toBe(false);
  });
});

describe('Status FSM — ReturnStatus', () => {
  it('allows the full happy path', () => {
    expect(isTransitionAllowed('ReturnStatus', 'REQUESTED', 'APPROVED')).toBe(true);
    expect(isTransitionAllowed('ReturnStatus', 'APPROVED', 'PICKUP_SCHEDULED')).toBe(true);
    expect(isTransitionAllowed('ReturnStatus', 'PICKUP_SCHEDULED', 'IN_TRANSIT')).toBe(true);
    expect(isTransitionAllowed('ReturnStatus', 'IN_TRANSIT', 'RECEIVED')).toBe(true);
    expect(isTransitionAllowed('ReturnStatus', 'RECEIVED', 'QC_APPROVED')).toBe(true);
    expect(isTransitionAllowed('ReturnStatus', 'QC_APPROVED', 'REFUND_PROCESSING')).toBe(true);
    expect(isTransitionAllowed('ReturnStatus', 'REFUND_PROCESSING', 'REFUNDED')).toBe(true);
    expect(isTransitionAllowed('ReturnStatus', 'REFUNDED', 'COMPLETED')).toBe(true);
  });

  it('allows partial-approval branch', () => {
    expect(
      isTransitionAllowed('ReturnStatus', 'RECEIVED', 'PARTIALLY_APPROVED'),
    ).toBe(true);
    expect(
      isTransitionAllowed('ReturnStatus', 'PARTIALLY_APPROVED', 'REFUND_PROCESSING'),
    ).toBe(true);
  });

  it('blocks QC_REJECTED → REFUND_PROCESSING (rejected returns get no refund)', () => {
    expect(
      isTransitionAllowed('ReturnStatus', 'QC_REJECTED', 'REFUND_PROCESSING'),
    ).toBe(false);
  });

  it('blocks REFUNDED → CANCELLED (terminal-ish)', () => {
    expect(isTransitionAllowed('ReturnStatus', 'REFUNDED', 'CANCELLED')).toBe(false);
  });

  it('blocks skip from REQUESTED to RECEIVED', () => {
    expect(isTransitionAllowed('ReturnStatus', 'REQUESTED', 'RECEIVED')).toBe(false);
  });

  it('allows PICKUP_SCHEDULED → RECEIVED (courier-skip shortcut)', () => {
    expect(
      isTransitionAllowed('ReturnStatus', 'PICKUP_SCHEDULED', 'RECEIVED'),
    ).toBe(true);
  });
});

describe('Status FSM — DisputeStatus', () => {
  it('allows OPEN to be picked up for review', () => {
    expect(isTransitionAllowed('DisputeStatus', 'OPEN', 'UNDER_REVIEW')).toBe(true);
    expect(isTransitionAllowed('DisputeStatus', 'OPEN', 'AWAITING_INFO')).toBe(true);
    expect(isTransitionAllowed('DisputeStatus', 'OPEN', 'CLOSED')).toBe(true);
  });

  it('allows admin to decide from UNDER_REVIEW', () => {
    expect(
      isTransitionAllowed('DisputeStatus', 'UNDER_REVIEW', 'RESOLVED_BUYER'),
    ).toBe(true);
    expect(
      isTransitionAllowed('DisputeStatus', 'UNDER_REVIEW', 'RESOLVED_SELLER'),
    ).toBe(true);
    expect(
      isTransitionAllowed('DisputeStatus', 'UNDER_REVIEW', 'RESOLVED_SPLIT'),
    ).toBe(true);
  });

  it('allows AWAITING_INFO to resolve directly', () => {
    expect(
      isTransitionAllowed('DisputeStatus', 'AWAITING_INFO', 'RESOLVED_BUYER'),
    ).toBe(true);
  });

  it('allows reopening a RESOLVED_* back to UNDER_REVIEW', () => {
    expect(
      isTransitionAllowed('DisputeStatus', 'RESOLVED_BUYER', 'UNDER_REVIEW'),
    ).toBe(true);
    expect(
      isTransitionAllowed('DisputeStatus', 'RESOLVED_SELLER', 'UNDER_REVIEW'),
    ).toBe(true);
  });

  it('blocks reopening a CLOSED dispute', () => {
    expect(
      isTransitionAllowed('DisputeStatus', 'CLOSED', 'UNDER_REVIEW'),
    ).toBe(false);
    expect(
      isTransitionAllowed('DisputeStatus', 'CLOSED', 'OPEN'),
    ).toBe(false);
  });

  it('blocks skipping from OPEN to RESOLVED_BUYER', () => {
    expect(
      isTransitionAllowed('DisputeStatus', 'OPEN', 'RESOLVED_BUYER'),
    ).toBe(false);
  });

  it('blocks RESOLVED → RESOLVED transitions (must reopen first)', () => {
    expect(
      isTransitionAllowed('DisputeStatus', 'RESOLVED_BUYER', 'RESOLVED_SELLER'),
    ).toBe(false);
  });
});

describe('Status FSM — assertTransition()', () => {
  it('does not throw on a valid transition', () => {
    expect(() =>
      assertTransition('OrderStatus', 'PLACED', 'VERIFIED'),
    ).not.toThrow();
  });

  it('throws BadRequestAppException with a clear message on illegal transitions', () => {
    expect(() =>
      assertTransition('OrderStatus', 'DELIVERED', 'PLACED'),
    ).toThrow(BadRequestAppException);
    expect(() =>
      assertTransition('OrderStatus', 'DELIVERED', 'PLACED'),
    ).toThrow('Illegal OrderStatus transition: DELIVERED → PLACED');
  });

  it('includes the FSM kind in the error message', () => {
    expect(() =>
      assertTransition('ReturnStatus', 'REFUNDED', 'CANCELLED'),
    ).toThrow('Illegal ReturnStatus transition: REFUNDED → CANCELLED');
  });
});

describe('Status FSM — allowedTransitions()', () => {
  it('returns the allowed next states for a current state', () => {
    const next = allowedTransitions('OrderStatus', 'PLACED');
    expect(next).toContain('VERIFIED');
    expect(next).toContain('CANCELLED');
    expect(next).not.toContain('DELIVERED');
  });

  it('returns an empty list for terminal states', () => {
    expect(allowedTransitions('OrderStatus', 'DELIVERED')).toEqual([]);
    expect(allowedTransitions('OrderStatus', 'CANCELLED')).toEqual([]);
  });

  it('returns an empty list for an unknown state (defensive)', () => {
    expect(allowedTransitions('OrderStatus', 'BOGUS')).toEqual([]);
  });
});
