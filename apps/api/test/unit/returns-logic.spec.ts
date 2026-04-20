/**
 * Unit tests for returns module pure logic:
 * - Auto-approval evaluation
 * - Return eligibility (window + quantity)
 * - Refund calculation
 * - Stale-return stage mapping
 */

// ── Auto-approval ─────────────────────────────────────────────────

const AUTO_APPROVE_REASONS = [
  'DEFECTIVE',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'DAMAGED_IN_TRANSIT',
];
const AUTO_APPROVE_VALUE_THRESHOLD = 5000;

function evaluateAutoApproval(returnRecord: {
  items: Array<{
    reasonCategory: string;
    quantity: number;
    orderItem?: { unitPrice: number };
  }>;
}): { autoApprove: boolean; reason: string } {
  let totalValue = 0;
  let allReasonsTrusted = true;

  for (const item of returnRecord.items) {
    if (item.orderItem) {
      totalValue += item.orderItem.unitPrice * item.quantity;
    }
    if (!AUTO_APPROVE_REASONS.includes(item.reasonCategory)) {
      allReasonsTrusted = false;
    }
  }

  if (totalValue > AUTO_APPROVE_VALUE_THRESHOLD) {
    return { autoApprove: false, reason: 'Over threshold' };
  }
  if (!allReasonsTrusted) {
    return { autoApprove: false, reason: 'Non-trusted reason' };
  }
  return { autoApprove: true, reason: 'Qualifies' };
}

describe('Auto-approval logic', () => {
  it('should auto-approve defective items under threshold', () => {
    const result = evaluateAutoApproval({
      items: [
        { reasonCategory: 'DEFECTIVE', quantity: 1, orderItem: { unitPrice: 999 } },
      ],
    });
    expect(result.autoApprove).toBe(true);
  });

  it('should reject when total exceeds threshold', () => {
    const result = evaluateAutoApproval({
      items: [
        { reasonCategory: 'DEFECTIVE', quantity: 2, orderItem: { unitPrice: 3000 } },
      ],
    });
    // 3000 * 2 = 6000 > 5000
    expect(result.autoApprove).toBe(false);
  });

  it('should reject when reason is not trusted', () => {
    const result = evaluateAutoApproval({
      items: [
        { reasonCategory: 'CHANGED_MIND', quantity: 1, orderItem: { unitPrice: 500 } },
      ],
    });
    expect(result.autoApprove).toBe(false);
  });

  it('should reject if any one item has untrusted reason', () => {
    const result = evaluateAutoApproval({
      items: [
        { reasonCategory: 'DEFECTIVE', quantity: 1, orderItem: { unitPrice: 100 } },
        { reasonCategory: 'SIZE_FIT_ISSUE', quantity: 1, orderItem: { unitPrice: 200 } },
      ],
    });
    expect(result.autoApprove).toBe(false);
  });

  it('should auto-approve multiple trusted-reason items under threshold', () => {
    const result = evaluateAutoApproval({
      items: [
        { reasonCategory: 'WRONG_ITEM', quantity: 1, orderItem: { unitPrice: 1000 } },
        { reasonCategory: 'DAMAGED_IN_TRANSIT', quantity: 1, orderItem: { unitPrice: 2000 } },
      ],
    });
    // 1000 + 2000 = 3000 < 5000
    expect(result.autoApprove).toBe(true);
  });

  it('should auto-approve exactly at threshold boundary', () => {
    const result = evaluateAutoApproval({
      items: [
        { reasonCategory: 'DEFECTIVE', quantity: 1, orderItem: { unitPrice: 5000 } },
      ],
    });
    // 5000 is NOT > 5000, so passes
    expect(result.autoApprove).toBe(true);
  });
});

// ── Eligibility (window + quantity) ───────────────────────────────

describe('Return eligibility', () => {
  it('should mark item eligible within window with available qty', () => {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000); // tomorrow
    const windowExpired = now > windowEnd;
    const quantity = 3;
    const alreadyReturned = 1;
    const available = quantity - alreadyReturned;
    const eligible = !windowExpired && available > 0;

    expect(eligible).toBe(true);
    expect(available).toBe(2);
  });

  it('should mark item ineligible when window has expired', () => {
    const now = new Date();
    const windowEnd = new Date(now.getTime() - 1000); // 1s ago
    const windowExpired = now > windowEnd;
    const eligible = !windowExpired && 3 > 0;

    expect(windowExpired).toBe(true);
    expect(eligible).toBe(false);
  });

  it('should mark item ineligible when fully returned', () => {
    const windowExpired = false;
    const quantity = 2;
    const alreadyReturned = 2;
    const available = quantity - alreadyReturned;
    const eligible = !windowExpired && available > 0;

    expect(available).toBe(0);
    expect(eligible).toBe(false);
  });

  it('should handle null returnWindowEndsAt as not expired', () => {
    const windowEnd = null as Date | null;
    const windowExpired = windowEnd !== null ? new Date() > windowEnd : false;
    expect(windowExpired).toBe(false);
  });
});

// ── Refund calculation ────────────────────────────────────────────

describe('Refund amount calculation', () => {
  function calculateRefund(
    items: Array<{ qcQuantityApproved: number; unitPrice: number }>,
  ): number {
    let total = 0;
    for (const item of items) {
      total += item.qcQuantityApproved * item.unitPrice;
    }
    return Math.round(total * 100) / 100;
  }

  it('should sum approved qty * unit price across items', () => {
    const amount = calculateRefund([
      { qcQuantityApproved: 2, unitPrice: 499.5 },
      { qcQuantityApproved: 1, unitPrice: 1299 },
    ]);
    expect(amount).toBe(2298);
  });

  it('should return 0 when no items are approved', () => {
    const amount = calculateRefund([
      { qcQuantityApproved: 0, unitPrice: 999 },
    ]);
    expect(amount).toBe(0);
  });

  it('should handle partial approval correctly', () => {
    // 3 ordered, 2 approved
    const amount = calculateRefund([
      { qcQuantityApproved: 2, unitPrice: 500 },
    ]);
    expect(amount).toBe(1000);
  });
});

// ── Stale-return stage mapping ────────────────────────────────────

describe('Stale-return action mapping', () => {
  function getStaleAction(status: string): 'AUTO_CANCEL' | 'AUTO_CLOSE' | 'ESCALATE' | 'SKIP' {
    const cancelStatuses = ['REQUESTED', 'APPROVED'];
    const closeStatuses = ['REFUNDED', 'QC_REJECTED'];
    const escalateStatuses = ['PICKUP_SCHEDULED', 'IN_TRANSIT', 'RECEIVED'];

    if (cancelStatuses.includes(status)) return 'AUTO_CANCEL';
    if (closeStatuses.includes(status)) return 'AUTO_CLOSE';
    if (escalateStatuses.includes(status)) return 'ESCALATE';
    return 'SKIP';
  }

  it('should auto-cancel REQUESTED returns', () => {
    expect(getStaleAction('REQUESTED')).toBe('AUTO_CANCEL');
  });

  it('should auto-cancel APPROVED returns', () => {
    expect(getStaleAction('APPROVED')).toBe('AUTO_CANCEL');
  });

  it('should auto-close REFUNDED returns', () => {
    expect(getStaleAction('REFUNDED')).toBe('AUTO_CLOSE');
  });

  it('should auto-close QC_REJECTED returns', () => {
    expect(getStaleAction('QC_REJECTED')).toBe('AUTO_CLOSE');
  });

  it('should escalate PICKUP_SCHEDULED returns', () => {
    expect(getStaleAction('PICKUP_SCHEDULED')).toBe('ESCALATE');
  });

  it('should escalate IN_TRANSIT returns', () => {
    expect(getStaleAction('IN_TRANSIT')).toBe('ESCALATE');
  });

  it('should escalate RECEIVED returns', () => {
    expect(getStaleAction('RECEIVED')).toBe('ESCALATE');
  });

  it('should skip REFUND_PROCESSING (handled by RefundProcessor)', () => {
    expect(getStaleAction('REFUND_PROCESSING')).toBe('SKIP');
  });

  it('should skip COMPLETED', () => {
    expect(getStaleAction('COMPLETED')).toBe('SKIP');
  });
});
