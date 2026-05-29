// Phase 109 (2026-05-25) — error classification for refund routing.
//
// submitQcDecision routes a return to the wallet adjustment + flags it
// REQUIRES_FINANCE_REVIEW when generateForReturn throws
// SourceInvoiceNotFoundError (distinct from the generic-error path, which just
// logs and lets the normal refund proceed). This locks in that the
// missing-invoice case throws the *distinct* type the caller switches on.

import {
  CreditNoteService,
  SourceInvoiceNotFoundError,
} from './credit-note.service';

function build(prisma: any) {
  // Only `prisma` is exercised before the SourceInvoiceNotFoundError throw;
  // the other constructor deps are unused on this path.
  return new CreditNoteService(prisma, {} as any, {} as any, {} as any);
}

describe('CreditNoteService.generateForReturn — missing source invoice (Phase 109)', () => {
  it('throws SourceInvoiceNotFoundError (a distinct type, not a generic Error) when no source invoice exists', async () => {
    const prisma = {
      return: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          returnNumber: 'RET-1',
          subOrderId: 'so1',
          items: [{ orderItemId: 'oi1', qcQuantityApproved: 1 }],
        }),
      },
      taxDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const service = build(prisma);

    await expect(service.generateForReturn('r1', {})).rejects.toBeInstanceOf(
      SourceInvoiceNotFoundError,
    );
  });

  it('the error carries the sub-order id for the audit trail', () => {
    const err = new SourceInvoiceNotFoundError('so-123');
    expect(err.subOrderId).toBe('so-123');
    expect(err.name).toBe('SourceInvoiceNotFoundError');
  });
});
