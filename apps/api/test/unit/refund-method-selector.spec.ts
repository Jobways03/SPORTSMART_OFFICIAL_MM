import 'reflect-metadata';
import { RefundMethodSelector } from '../../src/modules/refund-instructions/application/services/refund-method-selector';

/**
 * Phase 3 (PR 3.6) — Refund method auto-selection.
 *
 * The decision table is small + deterministic. These tests pin every
 * branch so a future "we changed the priority order" refactor surfaces
 * loudly in CI rather than silently re-routing money.
 */
describe('RefundMethodSelector', () => {
  const selector = new RefundMethodSelector();

  it('GOODWILL coupon overrides every other rule', () => {
    const d = selector.select({
      source: 'GOODWILL',
      isGoodwillCoupon: true,
      originalPaymentMethod: 'COD',
    });
    expect(d.method).toBe('COUPON');
    expect(d.requiresManualConfirmation).toBe(false);
  });

  it('customer preference for WALLET wins on a prepaid order', () => {
    const d = selector.select({
      source: 'RETURN',
      originalPaymentMethod: 'ONLINE',
      customerPreference: 'WALLET',
    });
    expect(d.method).toBe('WALLET');
  });

  it('GOODWILL with no order goes to wallet', () => {
    const d = selector.select({
      source: 'GOODWILL',
      originalPaymentMethod: null,
    });
    expect(d.method).toBe('WALLET');
  });

  it('prepaid order without preference goes to ORIGINAL_PAYMENT', () => {
    const d = selector.select({
      source: 'RETURN',
      originalPaymentMethod: 'ONLINE',
    });
    expect(d.method).toBe('ORIGINAL_PAYMENT');
    expect(d.requiresManualConfirmation).toBe(false);
  });

  it('prepaid order labelled PREPAID still goes to ORIGINAL_PAYMENT', () => {
    const d = selector.select({
      source: 'DISPUTE',
      originalPaymentMethod: 'PREPAID',
    });
    expect(d.method).toBe('ORIGINAL_PAYMENT');
  });

  it('COD with bank details on file → UPI (manual confirm required)', () => {
    const d = selector.select({
      source: 'RETURN',
      originalPaymentMethod: 'COD',
      codBankDetailsMissing: false,
    });
    expect(d.method).toBe('UPI');
    expect(d.requiresManualConfirmation).toBe(true);
  });

  it('COD without bank details → MANUAL', () => {
    const d = selector.select({
      source: 'RETURN',
      originalPaymentMethod: 'COD',
      codBankDetailsMissing: true,
    });
    expect(d.method).toBe('MANUAL');
    expect(d.requiresManualConfirmation).toBe(true);
    expect(d.reason).toMatch(/UPI \/ bank/);
  });

  it('unknown payment method falls back to MANUAL', () => {
    const d = selector.select({
      source: 'RETURN',
      originalPaymentMethod: 'CRYPTO',
    });
    expect(d.method).toBe('MANUAL');
    expect(d.requiresManualConfirmation).toBe(true);
  });

  it('case-insensitive on the original payment method string', () => {
    const lower = selector.select({
      source: 'RETURN',
      originalPaymentMethod: 'online',
    });
    expect(lower.method).toBe('ORIGINAL_PAYMENT');
  });
});
