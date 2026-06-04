import 'reflect-metadata';
import {
  CreditNoteService,
  CreditNoteIncompleteSnapshotError,
  SYSTEM_CREDIT_NOTE_ACTOR,
} from '../../src/modules/tax/application/services/credit-note.service';
import { CREDIT_NOTE_EVENTS } from '../../src/modules/tax/domain/credit-note-events';
import { calculateGstReversal } from '../../src/modules/discounts/domain/tax/calculate-gst';

// Phase 164 — Credit Note Generation flow audit remediation coverage.
//   #1/#6 advisory lock taken on the return (race + TOCTOU)
//   #2/#3 returnId-based idempotency survives an admin custom-reason override
//   #4   audit log on issuance
//   #8   cess reverses proportionally (was hardcoded 0n)
//   #9   amountInWords prefixed "Credit of"
//   #14  STRICT mode hard-stops on a missing snapshot; AUDIT issues partial + flags
//   #17  auto/cron path uses the SYSTEM actor sentinel
//   #18  line grossAmountInPaise is the canonical value
//   #19  tax.creditNote.issued domain event published
//   #20  customerNotifiedAt stamped after a successful notification

function snap(over: any = {}) {
  return {
    id: 'snap-1',
    orderItemId: 'oi-1',
    productId: 'p-1',
    variantId: null,
    description: 'Widget',
    hsnCode: '6109',
    uqcCode: 'PCS',
    gstRateBps: 1800,
    grossLineAmountInPaise: 100_000n, // ₹1000
    discountAmountInPaise: 0n,
    cgstAmountInPaise: 9_000n,
    sgstAmountInPaise: 9_000n,
    igstAmountInPaise: 0n,
    cessAmountInPaise: 0n,
    ...over,
  };
}

function sourceInvoice(over: any = {}) {
  return {
    id: 'inv-1',
    documentNumber: 'SM-INV-0001',
    documentType: 'TAX_INVOICE',
    generatedAt: new Date('2026-05-01T00:00:00Z'),
    status: 'PDF_GENERATED',
    subOrderId: 'so-1',
    masterOrderId: 'mo-1',
    sellerId: 'seller-1',
    customerId: 'cust-1',
    supplierType: 'SELLER',
    invoiceType: 'B2C',
    supplierGstin: '29ABCDE1234F1Z5',
    sellerRegistrationType: 'REGULAR',
    sellerLegalName: 'Acme',
    sellerAddressJson: {},
    sellerStateCode: '29',
    buyerGstin: null,
    buyerLegalName: 'Cust',
    billingAddressJson: {},
    shippingAddressJson: {},
    placeOfSupplyStateCode: '29',
    reverseChargeApplicable: false,
    reverseChargeReason: null,
    paymentMode: 'PREPAID',
    taxableAmountInPaise: 100_000n,
    ...over,
  };
}

function makeHarness(opts: any = {}) {
  const mode = opts.mode ?? 'AUDIT';
  const snapshots: any[] = opts.snapshots ?? [snap()];
  const approvedItems = opts.approvedItems ?? [{ orderItemId: 'oi-1', qcQuantityApproved: 1 }];
  const purchasedQty = opts.purchasedQty ?? 1;
  const inv = opts.sourceInvoice ?? sourceInvoice();

  const createdCNs: any[] = [];
  const createdLines: any[] = [];
  let cnSeq = 0;

  const sourceLines = snapshots.map((s, i) => ({
    id: `srcline-${i}`,
    documentId: inv.id,
    sourceSnapshotId: s.id,
    productName: s.description,
  }));

  const taxDocCreate = async ({ data }: any) => {
    cnSeq++;
    const row = { id: `cn-${cnSeq}`, ...data };
    createdCNs.push(row);
    return row;
  };
  const lineCreate = async ({ data }: any) => {
    const row = { id: `ln-${createdLines.length + 1}`, ...data };
    createdLines.push(row);
    return row;
  };
  const taxDocFindMany = async ({ where }: any) => {
    if (where?.documentType !== 'CREDIT_NOTE') return [];
    // Prior-CN query (#7): OR[{returnId}, {returnId:null, originalDocumentId, reason}].
    if (where.OR) {
      const rid = where.OR[0]?.returnId;
      const legacyOrigin = where.OR[1]?.originalDocumentId;
      return createdCNs.filter(
        (c) =>
          (rid != null && c.returnId === rid) ||
          (legacyOrigin != null && c.originalDocumentId === legacyOrigin && c.returnId == null),
      );
    }
    // allCreditNotes (FSM cumulative) — scoped to this source invoice.
    if (where.originalDocumentId) {
      return createdCNs.filter((c) => c.originalDocumentId === where.originalDocumentId);
    }
    return [];
  };
  const lineFindMany = async ({ where }: any) => {
    if (typeof where?.documentId === 'string') {
      return where.documentId === inv.id ? sourceLines : [];
    }
    if (where?.documentId?.in) {
      const ids: string[] = where.documentId.in;
      return createdLines.filter((l) => ids.includes(l.documentId));
    }
    return [];
  };

  const tx: any = {
    $queryRaw: jest.fn(async () => [{ pg_advisory_xact_lock: '' }]),
    taxDocument: { findMany: jest.fn(taxDocFindMany), create: jest.fn(taxDocCreate) },
    taxDocumentLine: { findMany: jest.fn(lineFindMany), create: jest.fn(lineCreate) },
  };

  const prisma: any = {
    return: {
      findUnique: jest.fn(async () => ({
        id: 'r-1',
        returnNumber: 'RTN-1',
        subOrderId: inv.subOrderId,
        customerId: inv.customerId,
        items: approvedItems,
      })),
    },
    taxDocument: {
      findFirst: jest.fn(async () => inv),
      findMany: jest.fn(taxDocFindMany),
      create: jest.fn(taxDocCreate),
      update: jest.fn(async () => ({})),
    },
    taxDocumentLine: { findMany: jest.fn(lineFindMany) },
    orderItemTaxSnapshot: { findMany: jest.fn(async () => snapshots) },
    orderItem: { findUnique: jest.fn(async () => ({ quantity: purchasedQty })) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };

  const docSequence: any = {
    nextNumber: jest.fn(async () => ({ documentNumber: `SM-CN-000${++docSequence._n}` })),
    _n: 0,
  };
  const taxDocument: any = { transitionStatus: jest.fn(async () => ({})) };
  const notifications: any = {
    customerCreditNoteIssued: jest.fn(async () => undefined),
    customerB2bItcReversalRequired: jest.fn(async () => undefined),
  };
  const audit: any = { writeAuditLog: jest.fn(async () => undefined) };
  const taxMode: any = {
    getMode: jest.fn(async () => mode),
    report: jest.fn(async () => null),
  };
  const eventBus: any = { publish: jest.fn(async () => undefined) };

  const svc = new CreditNoteService(
    prisma,
    docSequence,
    taxDocument,
    notifications,
    audit,
    taxMode,
    eventBus,
  );
  return { svc, prisma, tx, docSequence, taxDocument, notifications, audit, taxMode, eventBus, createdCNs, createdLines };
}

describe('calculateGstReversal — cess (#8)', () => {
  it('reverses cess proportionally and includes it in the credit total', () => {
    const r = calculateGstReversal({
      originalGrossInPaise: 100_000n,
      originalDiscountInPaise: 0n,
      originalCgstInPaise: 14_000n,
      originalSgstInPaise: 14_000n,
      originalIgstInPaise: 0n,
      originalCessInPaise: 12_000n, // 12% cess
      purchasedQuantity: 2,
      returnedQuantity: 1,
    });
    expect(r.cessReversalInPaise).toBe(6_000n); // half
    // total = taxable(50000) + tax(14000) + cess(6000)
    expect(r.totalCreditNoteInPaise).toBe(50_000n + 14_000n + 6_000n);
  });

  it('defaults cess to 0n when not supplied (backward compatible)', () => {
    const r = calculateGstReversal({
      originalGrossInPaise: 100_000n,
      originalDiscountInPaise: 0n,
      originalCgstInPaise: 9_000n,
      originalSgstInPaise: 9_000n,
      originalIgstInPaise: 0n,
      purchasedQuantity: 1,
      returnedQuantity: 1,
    });
    expect(r.cessReversalInPaise).toBe(0n);
  });
});

describe('generateForReturn — issuance (#4/#8/#9/#19/#20/#17)', () => {
  it('issues a CN with cess, Credit-of words, audit, event, notify-stamp', async () => {
    const h = makeHarness({ snapshots: [snap({ cessAmountInPaise: 5_000n })] });
    const res = await h.svc.generateForReturn('r-1', {});
    expect(res.isNew).toBe(true);

    const cn = h.createdCNs[0];
    expect(cn.returnId).toBe('r-1'); // #2 structured linkage
    expect(cn.cessAmountInPaise).toBe(5_000n); // #8 cess flows
    expect(cn.amountInWords.startsWith('Credit of ')).toBe(true); // #9
    expect(cn.partialCoverageLineCount).toBe(0); // #14 full coverage

    // #18 — the line's grossAmountInPaise is canonical (₹1000).
    expect(h.createdLines[0].grossAmountInPaise).toBe(100_000n);
    expect(h.createdLines[0].cessAmountInPaise).toBe(5_000n);

    // #4 audit + #19 event + #20 notify stamp.
    expect(h.audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: CREDIT_NOTE_EVENTS.ISSUED }),
    );
    expect(h.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: CREDIT_NOTE_EVENTS.ISSUED }),
    );
    expect(h.notifications.customerCreditNoteIssued).toHaveBeenCalled();
    expect(h.prisma.taxDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { customerNotifiedAt: expect.any(Date) } }),
    );
  });

  it('#1/#6 — takes a per-return advisory lock before the read-compute-write', async () => {
    const h = makeHarness();
    await h.svc.generateForReturn('r-1', {});
    expect(h.tx.$queryRaw).toHaveBeenCalled();
  });

  it('#17 — auto path attributes the FSM transition to the SYSTEM actor sentinel', async () => {
    const h = makeHarness();
    await h.svc.generateForReturn('r-1', {}); // no actorId → system
    expect(h.taxDocument.transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: SYSTEM_CREDIT_NOTE_ACTOR }),
    );
  });
});

describe('idempotency survives an admin custom reason (#2/#3)', () => {
  it('second call with a DIFFERENT reason returns the existing CN (isNew=false)', async () => {
    const h = makeHarness();
    const first = await h.svc.generateForReturn('r-1', { actorId: 'admin-1', reason: 'goodwill' });
    expect(first.isNew).toBe(true);
    // Re-run with a totally different reason — the old `reason CONTAINS`
    // discriminator would have MISSED the prior CN and double-issued.
    const second = await h.svc.generateForReturn('r-1', { actorId: 'admin-2', reason: 'a completely different reason' });
    expect(second.isNew).toBe(false);
    expect(h.createdCNs).toHaveLength(1); // no duplicate
  });
});

describe('partial coverage + GST mode (#14)', () => {
  it('STRICT mode throws CreditNoteIncompleteSnapshotError when a snapshot is missing', async () => {
    const h = makeHarness({
      mode: 'STRICT',
      approvedItems: [
        { orderItemId: 'oi-1', qcQuantityApproved: 1 },
        { orderItemId: 'oi-missing', qcQuantityApproved: 1 },
      ],
      snapshots: [snap()], // only oi-1 has a snapshot
    });
    await expect(h.svc.generateForReturn('r-1', {})).rejects.toBeInstanceOf(
      CreditNoteIncompleteSnapshotError,
    );
  });

  it('AUDIT mode issues a partial CN, flags the count, and reports the violation', async () => {
    const h = makeHarness({
      mode: 'AUDIT',
      approvedItems: [
        { orderItemId: 'oi-1', qcQuantityApproved: 1 },
        { orderItemId: 'oi-missing', qcQuantityApproved: 1 },
      ],
      snapshots: [snap()],
    });
    const res = await h.svc.generateForReturn('r-1', {});
    expect(res.isNew).toBe(true);
    expect(h.createdCNs[0].partialCoverageLineCount).toBe(1);
    expect(h.taxMode.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'cn.incomplete_snapshot' }),
    );
  });
});
