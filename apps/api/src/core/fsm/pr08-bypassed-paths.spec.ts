import { isTransitionAllowed, assertTransition } from './status-transitions';
import { BadRequestAppException } from '../exceptions';

/**
 * Phase 0 (PR 0.8) — FSM-matrix coverage for the bypassed call sites
 * fixed in this PR. The actual call sites still go through
 * `assertTransition` / `isTransitionAllowed`; these specs pin the
 * matrix entries so a future refactor can't quietly relax them.
 */

describe('FSM matrix — PR 0.8 newly-asserted transitions', () => {
  // ── PENDING_PAYMENT lifecycle (newly added) ──────────────────────

  it('allows PENDING_PAYMENT → PLACED (verifyPayment happy path)', () => {
    expect(isTransitionAllowed('OrderStatus', 'PENDING_PAYMENT', 'PLACED')).toBe(true);
    expect(() => assertTransition('OrderStatus', 'PENDING_PAYMENT', 'PLACED')).not.toThrow();
  });

  it('allows PENDING_PAYMENT → CANCELLED (payment-window expiry)', () => {
    expect(isTransitionAllowed('OrderStatus', 'PENDING_PAYMENT', 'CANCELLED')).toBe(true);
  });

  it('rejects PENDING_PAYMENT → DELIVERED (skipped lifecycle)', () => {
    expect(isTransitionAllowed('OrderStatus', 'PENDING_PAYMENT', 'DELIVERED')).toBe(false);
    expect(() => assertTransition('OrderStatus', 'PENDING_PAYMENT', 'DELIVERED')).toThrow(
      BadRequestAppException,
    );
  });

  // ── verifyPayment / markOrderPaid: resurrecting a CANCELLED order ──

  it('REJECTS resurrecting a CANCELLED order via OrderStatus → PLACED', () => {
    // The headline TOCTOU defense: even if the read-then-update window
    // lets us see `orderStatus=PENDING_PAYMENT` and then an admin
    // cancels before our write, the matrix-derived assertion blocks
    // CANCELLED → PLACED.
    expect(isTransitionAllowed('OrderStatus', 'CANCELLED', 'PLACED')).toBe(false);
    expect(() => assertTransition('OrderStatus', 'CANCELLED', 'PLACED')).toThrow(
      /Illegal OrderStatus transition: CANCELLED → PLACED/,
    );
  });

  it('REJECTS resurrecting a CANCELLED payment via OrderPaymentStatus → PAID', () => {
    expect(isTransitionAllowed('OrderPaymentStatus', 'CANCELLED', 'PAID')).toBe(false);
    expect(() => assertTransition('OrderPaymentStatus', 'CANCELLED', 'PAID')).toThrow(
      BadRequestAppException,
    );
  });

  // ── deliverSubOrder: master-status guard ─────────────────────────

  it('rejects EXCEPTION_QUEUE → DELIVERED (deliverSubOrder skip-and-log path)', () => {
    expect(isTransitionAllowed('OrderStatus', 'EXCEPTION_QUEUE', 'DELIVERED')).toBe(false);
  });

  it('allows DISPATCHED → DELIVERED (deliverSubOrder happy path)', () => {
    expect(isTransitionAllowed('OrderStatus', 'DISPATCHED', 'DELIVERED')).toBe(true);
  });

  // ── acceptSubOrder / rejectSubOrder / fulfillSubOrder ────────────

  it('REJECTS flipping a terminally REJECTED sub-order back to ACCEPTED', () => {
    expect(isTransitionAllowed('OrderAcceptStatus', 'REJECTED', 'ACCEPTED')).toBe(false);
    expect(() => assertTransition('OrderAcceptStatus', 'REJECTED', 'ACCEPTED')).toThrow(
      BadRequestAppException,
    );
  });

  it('REJECTS flipping a terminally CANCELLED accept-status to REJECTED', () => {
    expect(isTransitionAllowed('OrderAcceptStatus', 'CANCELLED', 'REJECTED')).toBe(false);
  });

  it('allows OPEN → ACCEPTED (acceptSubOrder happy path)', () => {
    expect(isTransitionAllowed('OrderAcceptStatus', 'OPEN', 'ACCEPTED')).toBe(true);
  });

  it('allows SHIPPED → FULFILLED (fulfillSubOrder happy path)', () => {
    expect(isTransitionAllowed('OrderFulfillmentStatus', 'SHIPPED', 'FULFILLED')).toBe(true);
  });

  it('REJECTS DELIVERED → FULFILLED (terminal state guard)', () => {
    expect(isTransitionAllowed('OrderFulfillmentStatus', 'DELIVERED', 'FULFILLED')).toBe(false);
  });

  // ── stale-return-processor / customer cancel race ────────────────

  it('allows REQUESTED → CANCELLED (auto-cancel happy path)', () => {
    expect(isTransitionAllowed('ReturnStatus', 'REQUESTED', 'CANCELLED')).toBe(true);
  });

  it('REJECTS RECEIVED → CANCELLED (FSM blocks late stale-cancel)', () => {
    // RECEIVED means warehouse has it; cancelling now would orphan
    // the goods. The FSM matrix already disallows; pin it so the
    // stale-return processor's pre-check skips correctly.
    expect(isTransitionAllowed('ReturnStatus', 'RECEIVED', 'CANCELLED')).toBe(false);
  });

  it('REJECTS COMPLETED → COMPLETED-redux (idempotent terminal)', () => {
    // Same-state transitions are allowed by the helper (idempotent),
    // but real callers should not be issuing them post-terminal.
    expect(isTransitionAllowed('ReturnStatus', 'COMPLETED', 'COMPLETED')).toBe(true);
  });

  // ── shipping facade — fulfillment from tracking event ────────────

  it('allows SHIPPED → DELIVERED (tracking-event happy path)', () => {
    expect(isTransitionAllowed('OrderFulfillmentStatus', 'SHIPPED', 'DELIVERED')).toBe(true);
  });

  it('REJECTS DELIVERED → SHIPPED (regression — late tracking event)', () => {
    // A late "in transit" or "out for delivery" tracking event arriving
    // after the parcel was already marked delivered would have
    // previously been written through `as any`. The matrix blocks it.
    expect(isTransitionAllowed('OrderFulfillmentStatus', 'DELIVERED', 'SHIPPED')).toBe(false);
  });
});
