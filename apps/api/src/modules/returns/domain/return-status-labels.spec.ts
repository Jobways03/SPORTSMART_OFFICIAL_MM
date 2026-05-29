// Phase 106 (2026-05-23) — Phase 103 audit Gap #1 coverage.

import {
  RETURN_STATUS_CLOSED,
  customerStatusLabel,
  adminStatusLabel,
  isReturnClosed,
} from './return-status-labels';

describe('return-status-labels (Phase 106)', () => {
  it('canonical CLOSED alias is COMPLETED at the enum level', () => {
    expect(RETURN_STATUS_CLOSED).toBe('COMPLETED');
  });

  it('customerStatusLabel renders Closed for COMPLETED', () => {
    expect(customerStatusLabel('COMPLETED')).toBe('Closed');
  });

  it('customerStatusLabel renders Refund completed for REFUNDED', () => {
    expect(customerStatusLabel('REFUNDED')).toBe('Refund completed');
  });

  it('customerStatusLabel renders "needs attention" copy for REFUND_FAILED', () => {
    expect(customerStatusLabel('REFUND_FAILED')).toMatch(/needs attention/i);
  });

  it('adminStatusLabel keeps Closed (Completed) so admin sees both terms', () => {
    expect(adminStatusLabel('COMPLETED')).toMatch(/closed.*completed/i);
  });

  it('falls back to raw status when unknown', () => {
    expect(customerStatusLabel('UNKNOWN_FUTURE')).toBe('UNKNOWN_FUTURE');
    expect(adminStatusLabel('UNKNOWN_FUTURE')).toBe('UNKNOWN_FUTURE');
  });

  it('isReturnClosed recognizes both spec alias and enum value', () => {
    expect(isReturnClosed('COMPLETED')).toBe(true);
    expect(isReturnClosed('CLOSED')).toBe(true);
    expect(isReturnClosed('REFUNDED')).toBe(false);
  });
});
