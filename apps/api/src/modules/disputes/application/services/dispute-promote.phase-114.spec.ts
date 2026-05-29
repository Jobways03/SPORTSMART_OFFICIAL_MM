// Phase 114 — promote-from-ticket input guards.
//
// These run BEFORE any dependency use (and before the dispute-number
// allocation), so they can be exercised with stubbed deps — mirroring the
// decision-matrix spec's approach.

import 'reflect-metadata';
import { DisputeService } from './dispute.service';

function makeService(): DisputeService {
  return new DisputeService(
    null as never, // prisma
    null as never, // eventBus
    null as never, // audit
    null as never, // caseDuplicates
    null as never, // refundInstruction
    null as never, // ledger
  );
}

const base = {
  ticketId: 't-1',
  adminId: 'a-1',
  summary: 'a valid promotion summary',
  filer: { type: 'CUSTOMER', id: 'c-1', name: 'Cust' },
  kind: 'OTHER',
  initialMessages: [],
} as any;

describe('DisputeService.promoteFromTicket — input guards (Phase 114)', () => {
  const svc = makeService();

  it('rejects an internalNote longer than 2000 chars (server backstop to the DTO)', async () => {
    await expect(
      svc.promoteFromTicket({ ...base, internalNote: 'x'.repeat(2001) }),
    ).rejects.toThrow(/internalNote too long/i);
  });

  it('accepts an internalNote at the 2000-char boundary (reaches dep use, then fails on null prisma — not the guard)', async () => {
    // 2000 chars passes the guard; the call then proceeds to dep use and
    // throws something OTHER than the length error. We assert the message is
    // NOT the length rejection.
    await expect(
      svc.promoteFromTicket({ ...base, internalNote: 'x'.repeat(2000) }),
    ).rejects.not.toThrow(/internalNote too long/i);
  });

  it('rejects a severity outside 1-100', async () => {
    await expect(svc.promoteFromTicket({ ...base, severity: 0 })).rejects.toThrow(
      /severity must be 1-100/i,
    );
    await expect(svc.promoteFromTicket({ ...base, severity: 101 })).rejects.toThrow(
      /severity must be 1-100/i,
    );
  });

  it('rejects an empty / whitespace summary', async () => {
    await expect(svc.promoteFromTicket({ ...base, summary: '   ' })).rejects.toThrow(
      /summary is required/i,
    );
  });
});
