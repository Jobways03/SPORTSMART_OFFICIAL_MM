// Phase 113 — dispute decision money-routing fix.
//
// RefundInstruction.createForDispute previously used customerId = filedById.
// For a SELLER- or ADMIN-filed dispute resolved in the buyer's favour, that
// credits the FILER's wallet, not the order's customer. resolveCustomerForRefund
// must derive the customer from the order/return graph, and fall back to
// filedById ONLY when the filer is themselves the customer.

import 'reflect-metadata';
import { DisputeService } from './dispute.service';

function makeService(prisma: any): DisputeService {
  return new DisputeService(
    prisma as never, // prisma
    null as never, // eventBus
    null as never, // audit
    null as never, // caseDuplicates
    null as never, // refundInstruction
    null as never, // ledger
  );
}

const resolve = (svc: DisputeService, dispute: any): Promise<string | null> =>
  (svc as unknown as {
    resolveCustomerForRefund: (d: any) => Promise<string | null>;
  }).resolveCustomerForRefund(dispute);

const emptyPrisma = () => ({
  return: { findUnique: jest.fn() },
  subOrder: { findUnique: jest.fn() },
  masterOrder: { findUnique: jest.fn() },
});

describe('DisputeService.resolveCustomerForRefund (Phase 113)', () => {
  it('uses the RETURN customer (not the filer) for a seller-filed dispute', async () => {
    const prisma = emptyPrisma();
    prisma.return.findUnique.mockResolvedValue({ customerId: 'cust-9' });
    const out = await resolve(makeService(prisma), {
      returnId: 'ret-1', subOrderId: null, masterOrderId: null,
      filedByType: 'SELLER', filedById: 'seller-1',
    });
    expect(out).toBe('cust-9');
    expect(prisma.return.findUnique).toHaveBeenCalledWith({
      where: { id: 'ret-1' }, select: { customerId: true },
    });
  });

  it('falls back through subOrder.masterOrder.customerId for an admin-filed dispute', async () => {
    const prisma = emptyPrisma();
    prisma.subOrder.findUnique.mockResolvedValue({ masterOrder: { customerId: 'cust-7' } });
    const out = await resolve(makeService(prisma), {
      returnId: null, subOrderId: 'so-1', masterOrderId: null,
      filedByType: 'ADMIN', filedById: 'admin-1',
    });
    expect(out).toBe('cust-7');
  });

  it('uses masterOrder.customerId when only the order is linked', async () => {
    const prisma = emptyPrisma();
    prisma.masterOrder.findUnique.mockResolvedValue({ customerId: 'cust-5' });
    const out = await resolve(makeService(prisma), {
      returnId: null, subOrderId: null, masterOrderId: 'mo-1',
      filedByType: 'SELLER', filedById: 'seller-2',
    });
    expect(out).toBe('cust-5');
  });

  it('falls back to filedById ONLY when the filer is the customer and there is no order linkage', async () => {
    const out = await resolve(makeService(emptyPrisma()), {
      returnId: null, subOrderId: null, masterOrderId: null,
      filedByType: 'CUSTOMER', filedById: 'cust-self',
    });
    expect(out).toBe('cust-self');
  });

  it('returns null for a seller/admin-filed dispute with no order linkage (never the filer)', async () => {
    const out = await resolve(makeService(emptyPrisma()), {
      returnId: null, subOrderId: null, masterOrderId: null,
      filedByType: 'SELLER', filedById: 'seller-3',
    });
    expect(out).toBeNull();
  });
});
