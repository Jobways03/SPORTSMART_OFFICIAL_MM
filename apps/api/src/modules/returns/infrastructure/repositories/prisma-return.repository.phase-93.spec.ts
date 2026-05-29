// Phase 93 (2026-05-23) — repo create() hardening coverage.
//
// Gaps asserted:
//   #1 evidence rows persisted inside the tx
//   #2 seller-response state persisted inside the tx
//   #6 duplicate-active guard re-checked under the lock + thrown
//   #8 node snapshot columns populated
//   #21 items aggregated by orderItemId

import { PrismaReturnRepository } from './prisma-return.repository';

function buildMockTx(opts: any = {}) {
  return {
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    return: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'ret-1',
        ...data,
        items: [],
      })),
    },
    returnItem: {
      findFirst: jest.fn().mockResolvedValue(opts.activeDup ?? null),
    },
    returnStatusHistory: {
      create: jest.fn().mockResolvedValue({}),
    },
    returnEvidence: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function buildPrismaService(tx: any) {
  return {
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
  };
}

function buildMoneyDualWrite() {
  return { applyPaise: (_: string, d: any) => d };
}

describe('PrismaReturnRepository.create (Phase 93)', () => {
  it('Gap #1 — evidence rows persisted inside the same tx', async () => {
    const tx = buildMockTx();
    const repo = new PrismaReturnRepository(
      buildPrismaService(tx) as any,
      buildMoneyDualWrite() as any,
    );
    await repo.create({
      returnNumber: 'RET-2026-000001',
      subOrderId: 'sub-1',
      masterOrderId: 'master-1',
      customerId: 'cust-1',
      initiatedBy: 'CUSTOMER',
      initiatorId: 'cust-1',
      items: [{ orderItemId: 'oi-1', quantity: 1, reasonCategory: 'DEFECTIVE' }],
      evidenceFileUrls: ['https://res.cloudinary.com/a.jpg'],
    });
    expect(tx.returnEvidence.createMany).toHaveBeenCalledTimes(1);
    const evidenceData = tx.returnEvidence.createMany.mock.calls[0][0].data;
    expect(evidenceData[0].returnId).toBe('ret-1');
    expect(evidenceData[0].fileUrl).toBe('https://res.cloudinary.com/a.jpg');
  });

  it('Gap #2 — seller-response state on the create row', async () => {
    const tx = buildMockTx();
    const repo = new PrismaReturnRepository(
      buildPrismaService(tx) as any,
      buildMoneyDualWrite() as any,
    );
    const dueAt = new Date('2026-05-25T10:00:00Z');
    await repo.create({
      returnNumber: 'RET-2',
      subOrderId: 'sub-1',
      masterOrderId: 'master-1',
      customerId: 'cust-1',
      initiatedBy: 'CUSTOMER',
      initiatorId: 'cust-1',
      items: [{ orderItemId: 'oi-1', quantity: 1, reasonCategory: 'DEFECTIVE' }],
      sellerResponseStatus: 'PENDING',
      sellerNotifiedAt: new Date(),
      sellerResponseDueAt: dueAt,
    });
    const created = tx.return.create.mock.calls[0][0].data;
    expect(created.sellerResponseStatus).toBe('PENDING');
    expect(created.sellerResponseDueAt).toBe(dueAt);
  });

  it('Gap #6 — duplicate-active return throws DUPLICATE_ACTIVE_RETURN', async () => {
    const tx = buildMockTx({
      activeDup: {
        id: 'ri-dup',
        orderItemId: 'oi-1',
        return: { returnNumber: 'RET-EXISTING-001' },
      },
    });
    const repo = new PrismaReturnRepository(
      buildPrismaService(tx) as any,
      buildMoneyDualWrite() as any,
    );
    await expect(
      repo.create({
        returnNumber: 'RET-3',
        subOrderId: 'sub-1',
        masterOrderId: 'master-1',
        customerId: 'cust-1',
        initiatedBy: 'CUSTOMER',
        initiatorId: 'cust-1',
        items: [
          { orderItemId: 'oi-1', quantity: 1, reasonCategory: 'DEFECTIVE' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ACTIVE_RETURN' });
    // FOR UPDATE lock should have been issued before the dup check.
    expect(tx.$queryRawUnsafe).toHaveBeenCalled();
    // Return.create should NOT have fired after the guard threw.
    expect(tx.return.create).not.toHaveBeenCalled();
  });

  it('Gap #8 — node snapshot columns populated', async () => {
    const tx = buildMockTx();
    const repo = new PrismaReturnRepository(
      buildPrismaService(tx) as any,
      buildMoneyDualWrite() as any,
    );
    await repo.create({
      returnNumber: 'RET-4',
      subOrderId: 'sub-1',
      masterOrderId: 'master-1',
      customerId: 'cust-1',
      initiatedBy: 'CUSTOMER',
      initiatorId: 'cust-1',
      items: [{ orderItemId: 'oi-1', quantity: 1, reasonCategory: 'DEFECTIVE' }],
      sellerIdSnapshot: 'seller-7',
      nodeTypeSnapshot: 'SELLER',
    });
    const created = tx.return.create.mock.calls[0][0].data;
    expect(created.sellerIdSnapshot).toBe('seller-7');
    expect(created.nodeTypeSnapshot).toBe('SELLER');
  });

  it('Gap #21 — duplicate orderItemId rows aggregated to one create-row', async () => {
    const tx = buildMockTx();
    const repo = new PrismaReturnRepository(
      buildPrismaService(tx) as any,
      buildMoneyDualWrite() as any,
    );
    await repo.create({
      returnNumber: 'RET-5',
      subOrderId: 'sub-1',
      masterOrderId: 'master-1',
      customerId: 'cust-1',
      initiatedBy: 'CUSTOMER',
      initiatorId: 'cust-1',
      items: [
        { orderItemId: 'oi-1', quantity: 2, reasonCategory: 'DEFECTIVE' },
        { orderItemId: 'oi-1', quantity: 3, reasonCategory: 'DEFECTIVE' },
      ],
    });
    const itemsCreate = tx.return.create.mock.calls[0][0].data.items.create;
    expect(itemsCreate).toHaveLength(1);
    expect(itemsCreate[0].orderItemId).toBe('oi-1');
    expect(itemsCreate[0].quantity).toBe(5);
  });
});
