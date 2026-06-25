import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';
import {
  CreateReturnData,
  FindAllPaginatedParams,
  FindByCustomerParams,
  FindReturnsForFulfillmentNodeParams,
  ReturnRepository,
} from '../../domain/repositories/return.repository.interface';

const NON_ACTIVE_STATUSES = ['REJECTED', 'CANCELLED'] as const;
const NON_COUNTABLE_STATUSES = ['REJECTED', 'CANCELLED', 'COMPLETED'] as const;

@Injectable()
export class PrismaReturnRepository implements ReturnRepository {
  constructor(
    private readonly prisma: PrismaService,
    // Phase 7 (PR 7.4) — repository-layer choke for refundAmount writes.
    // Wired on every mutation method even when the data block looks
    // status-only; callers reach this repo through several layers and
    // a money field may arrive via the generic `update(id, data)` path.
    private readonly moneyDualWrite: MoneyDualWriteHelper,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────────────

  async findById(id: string): Promise<any | null> {
    return this.prisma.return.findUnique({ where: { id } });
  }

  async findByIdWithItems(id: string): Promise<any | null> {
    return this.prisma.return.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            orderItem: true,
          },
        },
        subOrder: true,
        masterOrder: true,
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        evidence: true,
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  // Phase 199 (2026-06-02) — Returns Flow PII audit #1/#3/#4/#20/#23.
  //
  // Customer-facing detail read. `findByIdWithItems` returns the FULL
  // Return row (it is also the admin/QC read), which leaks QC internals
  // (qcInternalNotes, qcRationale, qcCourierName, qcAwbNumber), risk
  // scoring (riskScore/riskFlags), liability attribution
  // (liabilityParty), the raw gateway failure reason + history, finance
  // pointers, internal actor ids (approvedBy/rejectedBy/receivedBy/
  // closedBy), seller snapshots, and the optimistic-lock `version`.
  //
  // This method is a strict whitelist `select` — only customer-safe
  // columns ship. Evidence is filtered to CUSTOMER + ADMIN uploads
  // (warehouse QC photos are deliberately shown under the forfeit
  // policy; SELLER/FRANCHISE evidence is internal) and drops
  // uploaderId. Status history drops `changedById` (internal actor id);
  // note sanitization happens at the service boundary. RefundTransaction
  // history (#23) is side-loaded WITHOUT gatewayRefundId.
  async findByIdForCustomer(id: string): Promise<any | null> {
    return this.prisma.return.findUnique({
      where: { id },
      select: {
        id: true,
        returnNumber: true,
        status: true,
        customerId: true,
        customerNotes: true,
        // Refund — customer-safe fields only. refundFailureReason +
        // refundFailureHistory are admin-only; the customer-safe mirror
        // is refundFailureMessageCustomer.
        refundMethod: true,
        refundAmount: true,
        refundAmountInPaise: true,
        refundProcessedAt: true,
        refundReference: true,
        refundFailureMessageCustomer: true,
        // Pickup
        pickupScheduledAt: true,
        pickupCourier: true,
        pickupTrackingNumber: true,
        // Receipt / QC outcome (customer-facing summary only)
        receivedAt: true,
        qcCompletedAt: true,
        qcDecision: true,
        qcNotes: true,
        // Decision / lifecycle
        rejectionReason: true,
        customerRemedy: true,
        replacementStatus: true,
        replacementOrderId: true,
        exchangePriceDiffPaise: true,
        exchangeRazorpayOrderId: true,
        exchangePaymentCompletedAt: true,
        closedAt: true,
        createdAt: true,
        updatedAt: true,
        // #24 (disputeId for the "Open dispute" CTA) is side-loaded in
        // the service via prisma.dispute.findFirst — Dispute.returnId is
        // a bare scalar FK (no Prisma relation, by design) so it cannot
        // be selected here.
        items: {
          select: {
            id: true,
            orderItemId: true,
            quantity: true,
            reasonCategory: true,
            reasonDetail: true,
            qcOutcome: true,
            qcQuantityApproved: true,
            qcNotes: true,
            refundAmount: true,
            refundAmountInPaise: true,
            orderItem: {
              select: {
                id: true,
                productTitle: true,
                variantTitle: true,
                sku: true,
                imageUrl: true,
                unitPrice: true,
              },
            },
          },
        },
        // #4 — only CUSTOMER + ADMIN (warehouse QC) evidence. Drop
        // uploaderId (internal actor). SELLER/FRANCHISE evidence stays
        // internal.
        evidence: {
          where: { uploadedBy: { in: ['CUSTOMER', 'ADMIN'] } },
          select: {
            id: true,
            uploadedBy: true,
            fileUrl: true,
            description: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        // #3 — drop changedById; notes sanitized at the service layer.
        statusHistory: {
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            changedBy: true,
            notes: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        // #23 — refund transaction history, customer-safe shape only.
        // gatewayRefundId AND the raw per-attempt failureReason are
        // deliberately omitted (the raw reason can carry gateway
        // internals like "Razorpay: card declined CVV mismatch"). The
        // customer-friendly explanation rides the parent's
        // refundFailureMessageCustomer instead; here we expose only the
        // attempt number + status + timestamp so the UI can show
        // "attempt N failed / retrying".
        refundTransactions: {
          select: {
            id: true,
            attemptNumber: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        subOrder: {
          select: { id: true, fulfillmentNodeType: true },
        },
        masterOrder: {
          select: { id: true, orderNumber: true },
        },
      },
    });
  }

  async findByReturnNumber(returnNumber: string): Promise<any | null> {
    return this.prisma.return.findUnique({
      where: { returnNumber },
      include: {
        items: {
          include: {
            orderItem: true,
          },
        },
      },
    });
  }

  async findByCustomerId(
    customerId: string,
    params: FindByCustomerParams,
  ): Promise<{ returns: any[]; total: number }> {
    const { page, limit, status } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.ReturnWhereInput = { customerId };
    if (status) {
      where.status = status as any;
    }

    const [returns, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({
        where,
        include: {
          items: {
            include: {
              orderItem: {
                select: {
                  id: true,
                  productTitle: true,
                  variantTitle: true,
                  sku: true,
                  imageUrl: true,
                  unitPrice: true,
                  quantity: true,
                },
              },
            },
          },
          subOrder: {
            select: {
              id: true,
              fulfillmentStatus: true,
              masterOrder: {
                select: {
                  id: true,
                  orderNumber: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.return.count({ where }),
    ]);

    return { returns, total };
  }

  // Phase 199 (2026-06-02) — Returns Flow PII audit #2 / #21.
  //
  // Customer list read. The existing findByCustomerId uses `include`,
  // which (Prisma semantics) returns EVERY top-level Return scalar —
  // leaking riskScore, qcInternalNotes, liabilityParty, the raw
  // failure reason, internal actor ids, etc. into the customer list.
  // This is a strict whitelist `select` carrying only what the
  // storefront list renders, plus the refund summary (#21).
  async findByCustomerIdSafe(
    customerId: string,
    params: FindByCustomerParams,
  ): Promise<{ returns: any[]; total: number }> {
    const { page, limit, status } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.ReturnWhereInput = { customerId };
    if (status) {
      where.status = status as any;
    }

    const [returns, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({
        where,
        select: {
          id: true,
          returnNumber: true,
          status: true,
          createdAt: true,
          customerNotes: true,
          // #21 — refund summary on the list row.
          refundAmount: true,
          refundAmountInPaise: true,
          refundMethod: true,
          refundProcessedAt: true,
          items: {
            select: {
              id: true,
              orderItemId: true,
              quantity: true,
              reasonCategory: true,
              reasonDetail: true,
              orderItem: {
                select: {
                  id: true,
                  productTitle: true,
                  variantTitle: true,
                  sku: true,
                  imageUrl: true,
                  unitPrice: true,
                },
              },
            },
          },
          masterOrder: {
            select: { id: true, orderNumber: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.return.count({ where }),
    ]);

    return { returns, total };
  }

  async findBySubOrderId(subOrderId: string): Promise<any[]> {
    return this.prisma.return.findMany({
      where: { subOrderId },
      include: {
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllPaginated(
    params: FindAllPaginatedParams,
  ): Promise<{ returns: any[]; total: number }> {
    const {
      page,
      limit,
      status,
      customerId,
      subOrderId,
      fulfillmentNodeType,
      fromDate,
      toDate,
      search,
      riskScoreMin,
      riskScoreMax,
      hasRiskScore,
      allowedSellerTypes,
    } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.ReturnWhereInput = {};

    if (status) {
      where.status = status as any;
    }
    if (customerId) {
      where.customerId = customerId;
    }
    if (subOrderId) {
      where.subOrderId = subOrderId;
    }
    if (fulfillmentNodeType) {
      where.subOrder = {
        ...(where.subOrder as any),
        fulfillmentNodeType,
      };
    }
    // Phase 38 (admin breadth) — scope to returns whose sub-order seller is in
    // the admin's seller-type scope.
    //
    // 2026-06-25 — channel isolation: a D2C/RETAIL-scoped admin sees only
    // SELLER-fulfilled returns of its own channel. A FRANCHISE-fulfilled return
    // belongs to the Franchise admin's returns view (admin-franchise-returns),
    // so exclude it here — even when the franchise sub-order still carries the
    // original (D2C/RETAIL) seller id, which would otherwise leak it in.
    if (allowedSellerTypes && allowedSellerTypes.length > 0) {
      where.subOrder = {
        ...(where.subOrder as any),
        fulfillmentNodeType: 'SELLER',
        seller: { sellerType: { in: allowedSellerTypes } },
      };
    }
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) (where.createdAt as any).gte = fromDate;
      if (toDate) (where.createdAt as any).lte = toDate;
    }
    if (search && search.trim().length > 0) {
      const term = search.trim();
      where.OR = [
        { returnNumber: { contains: term, mode: 'insensitive' } },
        {
          masterOrder: {
            orderNumber: { contains: term, mode: 'insensitive' },
          },
        },
      ];
    }
    // Phase 174 (audit #228) — server-side risk-score filter. A range
    // (min/max) implies scored (not-null); hasRiskScore alone toggles
    // scored vs unscored. Lets the risk-review dashboard request
    // "?riskScoreMin=60&page=1" instead of pulling 200 + filtering 100.
    if (riskScoreMin !== undefined || riskScoreMax !== undefined) {
      const rs: { gte?: number; lte?: number } = {};
      if (riskScoreMin !== undefined) rs.gte = riskScoreMin;
      if (riskScoreMax !== undefined) rs.lte = riskScoreMax;
      where.riskScore = rs;
    } else if (hasRiskScore === true) {
      where.riskScore = { not: null };
    } else if (hasRiskScore === false) {
      where.riskScore = null;
    }

    const [returns, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({
        where,
        include: {
          items: {
            include: {
              orderItem: {
                select: {
                  id: true,
                  productTitle: true,
                  variantTitle: true,
                  sku: true,
                  imageUrl: true,
                  unitPrice: true,
                  quantity: true,
                },
              },
            },
          },
          subOrder: {
            select: {
              id: true,
              fulfillmentStatus: true,
              fulfillmentNodeType: true,
              sellerId: true,
              franchiseId: true,
              masterOrder: {
                select: {
                  id: true,
                  orderNumber: true,
                },
              },
            },
          },
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.return.count({ where }),
    ]);

    return { returns, total };
  }

  async findReturnsForFulfillmentNode(
    params: FindReturnsForFulfillmentNodeParams,
  ): Promise<{ returns: any[]; total: number }> {
    const { nodeType, nodeId, page, limit, status } = params;
    const skip = (page - 1) * limit;

    const subOrderFilter: Prisma.SubOrderWhereInput = {
      fulfillmentNodeType: nodeType,
    };
    if (nodeType === 'SELLER') {
      subOrderFilter.sellerId = nodeId;
    } else {
      subOrderFilter.franchiseId = nodeId;
    }

    const where: Prisma.ReturnWhereInput = {
      subOrder: subOrderFilter,
    };
    if (status) {
      where.status = status as any;
    }

    const [returns, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({
        where,
        include: {
          items: {
            include: {
              orderItem: {
                select: {
                  id: true,
                  productTitle: true,
                  variantTitle: true,
                  sku: true,
                  imageUrl: true,
                  unitPrice: true,
                  quantity: true,
                },
              },
            },
          },
          subOrder: {
            select: {
              id: true,
              fulfillmentStatus: true,
              fulfillmentNodeType: true,
              sellerId: true,
              franchiseId: true,
              masterOrder: {
                select: {
                  id: true,
                  orderNumber: true,
                },
              },
            },
          },
          // The `Return` model has its own direct relation to MasterOrder
          // alongside the one nested under SubOrder. Surface it at the top
          // level so the seller/franchise UI can read `r.masterOrder` just
          // like the admin list does.
          masterOrder: {
            select: { id: true, orderNumber: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.return.count({ where }),
    ]);

    return { returns, total };
  }

  async create(data: CreateReturnData): Promise<any> {
    // Phase 93 (2026-05-23) — Customer Return Request hardening.
    //   Gap #1/#2 — evidence + seller-response state inside the tx.
    //   Gap #6    — SELECT FOR UPDATE on OrderItem rows + duplicate-
    //               active re-check under the lock.
    //   Gap #8    — node snapshot persisted at creation time.
    //   Gap #21   — items aggregated by orderItemId (callers may also
    //               de-dup but repo enforces).
    return this.prisma.$transaction(async (tx) => {
      const aggregated = new Map<
        string,
        { quantity: number; reasonCategory: string; reasonDetail?: string }
      >();
      for (const it of data.items) {
        const existing = aggregated.get(it.orderItemId);
        if (existing) {
          existing.quantity += it.quantity;
        } else {
          aggregated.set(it.orderItemId, {
            quantity: it.quantity,
            reasonCategory: it.reasonCategory,
            reasonDetail: it.reasonDetail,
          });
        }
      }
      const orderItemIds = Array.from(aggregated.keys());

      // Gap #6 — row lock + duplicate-active recheck under the lock.
      if (orderItemIds.length > 0) {
        await tx.$queryRawUnsafe(
          `SELECT id FROM order_items WHERE id IN (${orderItemIds
            .map((_, idx) => `$${idx + 1}`)
            .join(',')}) FOR UPDATE`,
          ...orderItemIds,
        );
        const activeDup = await tx.returnItem.findFirst({
          where: {
            orderItemId: { in: orderItemIds },
            return: { status: { notIn: ['REJECTED', 'CANCELLED'] } },
          },
          select: {
            id: true,
            orderItemId: true,
            return: { select: { returnNumber: true } },
          },
        });
        if (activeDup) {
          throw Object.assign(
            new Error(
              `An active return (${
                activeDup.return?.returnNumber ?? 'unknown'
              }) already exists for this item`,
            ),
            { code: 'DUPLICATE_ACTIVE_RETURN' },
          );
        }
      }

      const created = await tx.return.create({
        data: {
          returnNumber: data.returnNumber,
          subOrderId: data.subOrderId,
          masterOrderId: data.masterOrderId,
          customerId: data.customerId,
          status: 'REQUESTED',
          initiatedBy: data.initiatedBy,
          initiatorId: data.initiatorId,
          customerNotes: data.customerNotes,
          // Gap #2 seller-response state.
          sellerResponseStatus: (data.sellerResponseStatus ?? null) as any,
          sellerNotifiedAt: data.sellerNotifiedAt ?? null,
          sellerResponseDueAt: data.sellerResponseDueAt ?? null,
          // Gap #8 node snapshot.
          sellerIdSnapshot: data.sellerIdSnapshot ?? null,
          franchiseIdSnapshot: data.franchiseIdSnapshot ?? null,
          nodeTypeSnapshot: data.nodeTypeSnapshot ?? null,
          items: {
            create: Array.from(aggregated.entries()).map(
              ([orderItemId, it]) => ({
                orderItemId,
                quantity: it.quantity,
                reasonCategory: it.reasonCategory as any,
                reasonDetail: it.reasonDetail,
              }),
            ),
          },
        },
        include: { items: true },
      });

      await tx.returnStatusHistory.create({
        data: {
          returnId: created.id,
          fromStatus: null,
          toStatus: 'REQUESTED',
          changedBy: data.initiatedBy,
          changedById: data.initiatorId,
          notes:
            data.initiatedBy === 'CUSTOMER'
              ? 'Customer acknowledged forfeit policy at submission'
              : 'Return request submitted',
        },
      });

      // Gap #1 — evidence rows inside the tx.
      if (data.evidenceFileUrls && data.evidenceFileUrls.length > 0) {
        await tx.returnEvidence.createMany({
          data: data.evidenceFileUrls.map((url) => ({
            returnId: created.id,
            uploadedBy: data.initiatedBy,
            uploaderId: data.initiatorId,
            fileType: 'IMAGE',
            fileUrl: url,
            description: 'Customer-submitted issue evidence',
          })),
        });
      }

      // Phase 95 (2026-05-23) — Phase 93 deferred #26 closure.
      // Commission freeze inside the same tx. Pre-Phase-95 this ran
      // as a sequential post-create updateMany — a crash between the
      // create and the freeze let the settlement cron pay out a
      // commission that should have been held pending the return
      // outcome. Folding into the tx makes the two atomic.
      if (data.commissionFreezeReason) {
        const freeze = await tx.commissionRecord.updateMany({
          where: {
            subOrderId: data.subOrderId,
            status: 'PENDING' as any,
          },
          data: {
            status: 'ON_HOLD' as any,
            adjustmentReason: data.commissionFreezeReason,
          },
        });
        // Stash count on the returned object so the service can audit
        // it without re-querying.
        (created as any).__commissionFrozenCount = freeze.count;
      }

      return created;
    });
  }

  async update(id: string, data: Record<string, unknown>): Promise<any> {
    return this.prisma.return.update({
      where: { id },
      data: this.moneyDualWrite.applyPaise('return', data) as any,
    });
  }

  async updateWithVersion(
    id: string,
    expectedVersion: number,
    data: Record<string, unknown>,
  ): Promise<any> {
    return this.prisma.return.update({
      // Prisma's `where` is typed against the unique-constraint shape,
      // but it accepts compound matchers in practice. The {id, version}
      // tuple is what makes the optimistic-lock CAS work — a stale
      // expectedVersion produces a 0-row update, which Prisma surfaces
      // as P2025 ("record not found").
      where: { id, version: expectedVersion } as any,
      data: {
        ...(this.moneyDualWrite.applyPaise('return', data) as any),
        version: { increment: 1 },
      },
    });
  }

  // ── Status history ──────────────────────────────────────────────────────

  async recordStatusChange(
    returnId: string,
    fromStatus: string | null,
    toStatus: string,
    changedBy: string,
    changedById?: string,
    notes?: string,
  ): Promise<any> {
    return this.prisma.returnStatusHistory.create({
      data: {
        returnId,
        fromStatus: fromStatus as any,
        toStatus: toStatus as any,
        changedBy,
        changedById,
        notes,
      },
    });
  }

  // ── Sequence ────────────────────────────────────────────────────────────

  async generateNextReturnNumber(): Promise<string> {
    // Phase 95 (2026-05-23) — Phase 93 deferred #29 closure.
    //
    // Pre-Phase-95 this wrapped a Serializable-isolation tx around an
    // UPSERT on a singleton ReturnSequence row. Every concurrent
    // creator serialized on that one row, with ~50ms retry cost on
    // contention. Under burst load (mass-cancellation wave) the
    // serialization point became the bottleneck for return creation.
    //
    // Postgres SEQUENCE.nextval is a single atomic increment with no
    // row lock — orders of magnitude faster than the Serializable
    // upsert. Gaps from rolled-back txs are acceptable here (return
    // numbers only need uniqueness + monotonic, not gap-free).
    //
    // Fallback path uses the legacy table when nextval raises (e.g.,
    // local dev DBs that haven't applied the migration yet). The
    // fallback is best-effort and intentionally racy at low scale.
    const year = new Date().getFullYear();
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ nextval: bigint | number }>
      >("SELECT nextval('return_number_seq') AS nextval");
      const n = Number(rows[0]?.nextval ?? 0);
      if (n > 0) {
        return `RET-${year}-${String(n).padStart(6, '0')}`;
      }
    } catch (err) {
      // Fall through to the legacy path. We log so the migration
      // skew is observable in production.
      // eslint-disable-next-line no-console
      console.warn(
        `[generateNextReturnNumber] sequence unavailable, falling back to ReturnSequence: ${
          (err as Error)?.message ?? 'unknown error'
        }`,
      );
    }
    return this.prisma.$transaction(
      async (tx) => {
        const seq = await tx.returnSequence.upsert({
          where: { id: 1 },
          create: { id: 1, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        const padded = String(seq.lastNumber).padStart(6, '0');
        return `RET-${year}-${padded}`;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  // ── Eligibility helpers ─────────────────────────────────────────────────

  async countActiveReturnsForOrderItem(orderItemId: string): Promise<number> {
    return this.prisma.return.count({
      where: {
        items: { some: { orderItemId } },
        status: {
          notIn: NON_COUNTABLE_STATUSES as unknown as any[],
        },
      },
    });
  }

  async getReturnedQuantityForOrderItem(orderItemId: string): Promise<number> {
    const result = await this.prisma.returnItem.aggregate({
      _sum: { quantity: true },
      where: {
        orderItemId,
        return: {
          status: {
            notIn: NON_ACTIVE_STATUSES as unknown as any[],
          },
        },
      },
    });
    return result._sum.quantity ?? 0;
  }

  // ── QC (Phase R3) ───────────────────────────────────────────────────────

  async addEvidence(data: {
    returnId: string;
    returnItemId?: string;
    evidenceType?: string;
    uploadedBy: string;
    uploaderId?: string;
    fileType: string;
    fileUrl: string;
    publicId?: string;
    description?: string;
    width?: number;
    height?: number;
    bytes?: number;
    contentHash?: string;
  }): Promise<any> {
    return this.prisma.returnEvidence.create({
      data: {
        returnId: data.returnId,
        returnItemId: data.returnItemId ?? null,
        evidenceType: data.evidenceType ?? null,
        uploadedBy: data.uploadedBy,
        uploaderId: data.uploaderId,
        fileType: data.fileType,
        fileUrl: data.fileUrl,
        publicId: data.publicId,
        description: data.description,
        width: data.width ?? null,
        height: data.height ?? null,
        bytes: data.bytes ?? null,
        contentHash: data.contentHash ?? null,
      } as any,
    });
  }

  async updateReturnItemQc(
    itemId: string,
    data: {
      qcOutcome: string;
      qcQuantityApproved: number;
      qcNotes?: string;
      refundAmount?: number;
    },
  ): Promise<any> {
    return this.prisma.returnItem.update({
      where: { id: itemId },
      data: this.moneyDualWrite.applyPaise('returnItem', {
        qcOutcome: data.qcOutcome as any,
        qcQuantityApproved: data.qcQuantityApproved,
        qcNotes: data.qcNotes,
        refundAmount: data.refundAmount,
      }),
    });
  }

  // ── Refund processing (Phase R4) ────────────────────────────────────────

  async recordRefundAttempt(
    returnId: string,
    data: {
      gatewayRefundId?: string;
      success: boolean;
      failureReason?: string;
    },
  ): Promise<any> {
    return this.prisma.return.update({
      where: { id: returnId },
      data: this.moneyDualWrite.applyPaise('return', {
        refundAttempts: { increment: 1 },
        refundLastAttemptAt: new Date(),
        ...(data.success
          ? {
              refundReference: data.gatewayRefundId,
              refundFailureReason: null,
            }
          : { refundFailureReason: data.failureReason }),
      }),
    });
  }

  // Phase 101 (2026-05-23) — Refund Retry audit Gap #24 closure.
  // The `incrementRefundAttempts` method existed but had zero callers
  // (only recordRefundAttempt is used). Removed.

  // ── Analytics (Phase R6) ────────────────────────────────────────────────

  async getAnalyticsSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
    allowedSellerTypes?: ('D2C' | 'RETAIL')[];
  }) {
    const dateFilter: Prisma.ReturnWhereInput = {};
    if (params?.fromDate || params?.toDate) {
      dateFilter.createdAt = {};
      if (params.fromDate) (dateFilter.createdAt as any).gte = params.fromDate;
      if (params.toDate) (dateFilter.createdAt as any).lte = params.toDate;
    }
    // Phase 38 (admin breadth) — scope to returns whose sub-order seller is in
    // the admin's seller-type scope.
    if (params?.allowedSellerTypes && params.allowedSellerTypes.length > 0) {
      // Channel isolation — exclude franchise-fulfilled returns (see the list
      // query); they belong to the Franchise admin.
      (dateFilter as any).subOrder = {
        fulfillmentNodeType: 'SELLER',
        seller: { sellerType: { in: params.allowedSellerTypes } },
      };
    }

    const returns = await this.prisma.return.findMany({
      where: dateFilter,
      select: {
        id: true,
        status: true,
        refundAmount: true,
        createdAt: true,
        closedAt: true,
        items: { select: { reasonCategory: true } },
      },
    });

    const totalReturns = returns.length;
    let totalRefundAmount = 0;
    const byStatus: Record<string, number> = {};
    const byReasonCategory: Record<string, number> = {};
    let processedSum = 0;
    let processedCount = 0;
    let refundedCount = 0;
    let rejectedCount = 0;
    let pendingCount = 0;
    let inProgressCount = 0;

    const pendingStatuses = [
      'REQUESTED',
      'APPROVED',
      'PICKUP_SCHEDULED',
      'IN_TRANSIT',
      'RECEIVED',
    ];
    const inProgressStatuses = [
      'QC_APPROVED',
      'PARTIALLY_APPROVED',
      'REFUND_PROCESSING',
    ];

    for (const r of returns) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if (r.refundAmount) totalRefundAmount += Number(r.refundAmount);

      if (r.status === 'REFUNDED' || r.status === 'COMPLETED') refundedCount++;
      if (
        r.status === 'REJECTED' ||
        r.status === 'QC_REJECTED' ||
        r.status === 'CANCELLED'
      )
        rejectedCount++;
      if (pendingStatuses.includes(r.status)) pendingCount++;
      if (inProgressStatuses.includes(r.status)) inProgressCount++;

      if (r.closedAt) {
        const days =
          (r.closedAt.getTime() - r.createdAt.getTime()) /
          (1000 * 60 * 60 * 24);
        processedSum += days;
        processedCount++;
      }

      for (const item of r.items) {
        byReasonCategory[item.reasonCategory] =
          (byReasonCategory[item.reasonCategory] || 0) + 1;
      }
    }

    const averageProcessingDays =
      processedCount > 0 ? processedSum / processedCount : 0;
    const totalProcessed = refundedCount + rejectedCount;
    const refundSuccessRate =
      totalProcessed > 0 ? (refundedCount / totalProcessed) * 100 : 0;

    return {
      totalReturns,
      totalRefundAmount: Math.round(totalRefundAmount * 100) / 100,
      byStatus,
      byReasonCategory,
      averageProcessingDays: Math.round(averageProcessingDays * 100) / 100,
      refundedCount,
      rejectedCount,
      pendingCount,
      inProgressCount,
      refundSuccessRate: Math.round(refundSuccessRate * 100) / 100,
    };
  }

  async getReturnsByPeriod(params: {
    fromDate: Date;
    toDate: Date;
    groupBy: 'day' | 'week' | 'month';
    allowedSellerTypes?: ('D2C' | 'RETAIL')[];
  }) {
    const truncFn =
      params.groupBy === 'day'
        ? 'day'
        : params.groupBy === 'week'
        ? 'week'
        : 'month';

    // Phase 38 (admin breadth) — scope the trend to in-type sellers via a
    // sub-order → seller subquery (keeps the outer columns unqualified).
    const scopeClause =
      params.allowedSellerTypes && params.allowedSellerTypes.length > 0
        ? Prisma.sql`AND "sub_order_id" IN (SELECT so.id FROM sub_orders so JOIN sellers s ON s.id = so.seller_id WHERE so.fulfillment_node_type = 'SELLER' AND s.seller_type::text IN (${Prisma.join(params.allowedSellerTypes)}))`
        : Prisma.empty;

    const result = await this.prisma.$queryRaw<
      Array<{ period: Date; count: bigint; refund_amount: any }>
    >`
      SELECT
        date_trunc(${truncFn}, "created_at") as period,
        COUNT(*) as count,
        COALESCE(SUM("refund_amount"), 0) as refund_amount
      FROM returns
      WHERE "created_at" >= ${params.fromDate} AND "created_at" <= ${params.toDate} ${scopeClause}
      GROUP BY period
      ORDER BY period ASC
    `;

    return result.map((row) => ({
      period: row.period.toISOString(),
      count: Number(row.count),
      refundAmount: Number(row.refund_amount),
    }));
  }

  async getTopReturnReasons(
    limit: number,
    fromDate?: Date,
    toDate?: Date,
    allowedSellerTypes?: ('D2C' | 'RETAIL')[],
  ) {
    const where: Prisma.ReturnItemWhereInput = {};
    if (fromDate || toDate) {
      where.return = {};
      if (fromDate) (where.return as any).createdAt = { gte: fromDate };
      if (toDate)
        (where.return as any).createdAt = {
          ...((where.return as any).createdAt || {}),
          lte: toDate,
        };
    }
    // Phase 38 (admin breadth) — scope to in-type sellers (ReturnItem → return
    // → subOrder → seller).
    if (allowedSellerTypes && allowedSellerTypes.length > 0) {
      where.return = {
        ...((where.return as any) || {}),
        subOrder: {
          fulfillmentNodeType: 'SELLER',
          seller: { sellerType: { in: allowedSellerTypes } },
        },
      };
    }

    const results = await this.prisma.returnItem.groupBy({
      by: ['reasonCategory'],
      where,
      _count: { id: true },
      _sum: { quantity: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    return results.map((r) => ({
      reasonCategory: r.reasonCategory as string,
      count: r._count.id,
      totalQuantity: r._sum.quantity || 0,
    }));
  }

  async getReturnsByCustomer(customerId: string, allowedSellerTypes?: ('D2C' | 'RETAIL')[]) {
    // Phase 38 (admin breadth) — scope to in-type sellers.
    const sellerFilter: Prisma.ReturnWhereInput =
      allowedSellerTypes && allowedSellerTypes.length > 0
        ? {
            subOrder: {
              fulfillmentNodeType: 'SELLER',
              seller: { sellerType: { in: allowedSellerTypes } },
            },
          }
        : {};
    const [totalReturns, refundedAgg, recentReturns] = await Promise.all([
      this.prisma.return.count({ where: { customerId, ...sellerFilter } }),
      this.prisma.return.aggregate({
        where: {
          customerId,
          ...sellerFilter,
          status: { in: ['REFUNDED', 'COMPLETED'] },
        },
        _sum: { refundAmount: true },
      }),
      this.prisma.return.findMany({
        where: { customerId, ...sellerFilter },
        include: {
          items: true,
          masterOrder: { select: { orderNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      totalReturns,
      totalRefunded: Number(refundedAgg._sum.refundAmount || 0),
      recentReturns,
    };
  }
}
