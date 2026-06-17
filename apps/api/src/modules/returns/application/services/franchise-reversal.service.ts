import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { ReturnCommissionReversalService } from './return-commission-reversal.service';
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';

/**
 * B2B / off-platform franchise return reversal — franchise mirror of
 * SellerReversalService (Phase 108).
 *
 * The franchise portal can request / list / cancel a reversal. The binding
 * approval (admin-side) applies the financial + inventory effects.
 *
 * ATOMICITY NOTE: unlike the seller path (whose stock + debit live in this
 * module's prisma and commit in one tx), the franchise money/inventory effects
 * run through the franchise module's own services, each in its own transaction.
 * We therefore gate approval with a compare-and-set status flip FIRST so the
 * effects can never be applied twice (a retried/concurrent approve fails the
 * CAS). The residual risk is a crash mid-approve leaving the row APPROVED with
 * an effect not yet applied — surfaced via an error log for manual
 * reconciliation. This matches the existing franchise return QC path, which
 * also calls reverseCommissionForReturn in its own transaction.
 */
@Injectable()
export class FranchiseReversalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    private readonly logger: AppLoggerService,
    private readonly commissionReversal: ReturnCommissionReversalService,
    private readonly franchiseFacade: FranchisePublicFacade,
  ) {
    this.logger.setContext('FranchiseReversalService');
  }

  // ── Franchise: request a reversal ──────────────────────────────────────
  async request(params: {
    franchiseId: string;
    subOrderId: string;
    reason: string;
    items: Array<{ orderItemId: string; quantity: number }>;
    idempotencyKey?: string;
  }) {
    const { franchiseId, subOrderId, reason, items } = params;

    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: { items: true },
    });
    // NotFound (not Forbidden) on ownership/type mismatch — no existence leak.
    if (
      !subOrder ||
      subOrder.fulfillmentNodeType !== 'FRANCHISE' ||
      subOrder.franchiseId !== franchiseId
    ) {
      throw new NotFoundAppException('Franchise order not found');
    }
    if (subOrder.fulfillmentStatus !== 'DELIVERED') {
      throw new BadRequestAppException('Can only reverse delivered orders');
    }
    if (
      subOrder.returnWindowEndsAt &&
      new Date() > subOrder.returnWindowEndsAt
    ) {
      throw new BadRequestAppException('Return window has expired');
    }

    // Idempotent replay: a prior request with the same key wins.
    if (params.idempotencyKey) {
      const existing = await this.prisma.franchiseReversal.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
        include: { items: true },
      });
      if (existing) return existing;
    }

    // Validate items, enforce per-item remaining quantity, snapshot value.
    let reversalValueInPaise = 0n;
    const itemRows = items.map((ri) => {
      const oi = subOrder.items.find((i) => i.id === ri.orderItemId);
      if (!oi) {
        throw new NotFoundAppException(
          `Order item ${ri.orderItemId} not found on this sub-order`,
        );
      }
      if (!Number.isInteger(ri.quantity) || ri.quantity <= 0) {
        throw new BadRequestAppException(
          'Reversal quantity must be a positive integer',
        );
      }
      const remaining = oi.quantity - (oi.reversedQuantity ?? 0);
      if (ri.quantity > remaining) {
        throw new BadRequestAppException(
          `Cannot reverse ${ri.quantity} of order item ${oi.id}; only ${remaining} remain (ordered ${oi.quantity}, already reversed ${oi.reversedQuantity ?? 0})`,
        );
      }
      reversalValueInPaise += oi.unitPriceInPaise * BigInt(ri.quantity);
      return {
        orderItemId: oi.id,
        productId: oi.productId,
        variantId: oi.variantId,
        quantity: ri.quantity,
        unitPriceInPaise: oi.unitPriceInPaise,
      };
    });

    const reversal = await this.prisma.$transaction(async (tx) => {
      // At most one open request per sub-order, so two pending requests can't
      // each consume the same remaining quantity.
      const open = await tx.franchiseReversal.findFirst({
        where: { subOrderId, status: 'PENDING_APPROVAL' },
        select: { id: true },
      });
      if (open) {
        throw new BadRequestAppException(
          'A reversal request is already pending for this sub-order',
        );
      }
      return tx.franchiseReversal.create({
        data: {
          subOrderId,
          franchiseId,
          masterOrderId: subOrder.masterOrderId,
          status: 'PENDING_APPROVAL',
          reason,
          reversalValueInPaise,
          idempotencyKey: params.idempotencyKey ?? null,
          items: { create: itemRows },
        },
        include: { items: true },
      });
    });

    await this.audit.writeAuditLog({
      actorId: franchiseId,
      actorRole: 'FRANCHISE',
      action: 'franchise.reversal.requested',
      module: 'returns',
      resource: 'franchise_reversal',
      resourceId: reversal.id,
      metadata: {
        subOrderId,
        reason,
        items: itemRows.map((i) => ({
          orderItemId: i.orderItemId,
          quantity: i.quantity,
        })),
        reversalValueInPaise: reversalValueInPaise.toString(),
      },
    });
    return reversal;
  }

  // ── Franchise: cancel a pending request ────────────────────────────────
  async cancel(params: { reversalId: string; franchiseId: string }) {
    const claimed = await this.prisma.franchiseReversal.updateMany({
      where: {
        id: params.reversalId,
        franchiseId: params.franchiseId,
        status: 'PENDING_APPROVAL',
      },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count === 0) {
      throw new BadRequestAppException(
        'Reversal cannot be cancelled (not found, not yours, or already decided)',
      );
    }
    await this.audit.writeAuditLog({
      actorId: params.franchiseId,
      actorRole: 'FRANCHISE',
      action: 'franchise.reversal.cancelled',
      module: 'returns',
      resource: 'franchise_reversal',
      resourceId: params.reversalId,
    });
    return { reversalId: params.reversalId, status: 'CANCELLED' as const };
  }

  // ── Admin: approve (applies inventory + finance effects) ───────────────
  async approve(params: {
    reversalId: string;
    adminId: string;
    adminRole?: string;
  }) {
    const { reversalId, adminId } = params;

    // CAS gate FIRST — only PENDING_APPROVAL → APPROVED. A retried or
    // concurrent approve fails this (count 0), so the effects below can never
    // be applied twice (the main money-safety risk for the cross-tx franchise
    // path). See the class-level ATOMICITY NOTE.
    const claimed = await this.prisma.franchiseReversal.updateMany({
      where: { id: reversalId, status: 'PENDING_APPROVAL' },
      data: {
        status: 'APPROVED',
        decidedByAdminId: adminId,
        decidedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new BadRequestAppException(
        'Reversal is not pending approval (already decided or not found)',
      );
    }

    const reversal = await this.prisma.franchiseReversal.findUniqueOrThrow({
      where: { id: reversalId },
      include: { items: true },
    });
    const subOrder = await this.prisma.subOrder.findUniqueOrThrow({
      where: { id: reversal.subOrderId },
      include: { items: true },
    });

    try {
      // 1) Restock each reversed item into the franchise's on-hand inventory
      //    (the proven franchise-return restock path), and guard against
      //    future over-reversal on the same order item.
      for (const ri of reversal.items) {
        await this.franchiseFacade.recordReturn(
          reversal.franchiseId,
          ri.productId,
          ri.variantId,
          ri.quantity,
          reversal.subOrderId,
        );
        await this.prisma.orderItem.update({
          where: { id: ri.orderItemId },
          data: { reversedQuantity: { increment: ri.quantity } },
        });
      }

      // 2) Reverse the franchise commission/finance for the reclaimed value —
      //    records a RETURN_REVERSAL FranchiseFinanceLedger entry. Reuses the
      //    same path franchise returns use (its own tx + reversal-window guard).
      await this.commissionReversal.reverseCommissionForReturn(
        {
          id: reversal.id,
          returnNumber: null,
          subOrder: {
            id: subOrder.id,
            fulfillmentNodeType: 'FRANCHISE',
            sellerId: null,
            franchiseId: reversal.franchiseId,
          },
          items: reversal.items.map((ri) => {
            const oi = subOrder.items.find((i) => i.id === ri.orderItemId);
            return {
              orderItem: {
                id: oi?.id ?? ri.orderItemId,
                unitPrice: oi?.unitPrice ?? 0,
                quantity: oi?.quantity ?? ri.quantity,
              },
              qcQuantityApproved: ri.quantity,
            };
          }),
        },
        undefined,
        {
          actorType: 'ADMIN',
          actorId: adminId,
          note: `Franchise off-platform reversal ${reversalId}`,
        },
      );
    } catch (err) {
      this.logger.error(
        `Franchise reversal ${reversalId} flipped to APPROVED but applying its effects failed — MANUAL RECONCILIATION REQUIRED: ${(err as Error).message}`,
      );
      throw err;
    }

    await this.audit.writeAuditLog({
      actorId: adminId,
      actorRole: params.adminRole ?? 'ADMIN',
      action: 'franchise.reversal.approved',
      module: 'returns',
      resource: 'franchise_reversal',
      resourceId: reversalId,
      metadata: {
        reversalValueInPaise: reversal.reversalValueInPaise.toString(),
      },
    });
    return { reversalId, status: 'APPROVED' as const };
  }

  // ── Admin: reject (no effects) ─────────────────────────────────────────
  async reject(params: {
    reversalId: string;
    adminId: string;
    adminRole?: string;
    rejectionReason: string;
  }) {
    const claimed = await this.prisma.franchiseReversal.updateMany({
      where: { id: params.reversalId, status: 'PENDING_APPROVAL' },
      data: {
        status: 'REJECTED',
        decidedByAdminId: params.adminId,
        decidedAt: new Date(),
        rejectionReason: params.rejectionReason,
      },
    });
    if (claimed.count === 0) {
      throw new BadRequestAppException(
        'Reversal is not pending approval (already decided or not found)',
      );
    }
    await this.audit.writeAuditLog({
      actorId: params.adminId,
      actorRole: params.adminRole ?? 'ADMIN',
      action: 'franchise.reversal.rejected',
      module: 'returns',
      resource: 'franchise_reversal',
      resourceId: params.reversalId,
      metadata: { rejectionReason: params.rejectionReason },
    });
    return { reversalId: params.reversalId, status: 'REJECTED' as const };
  }

  // ── Queries ────────────────────────────────────────────────────────────
  async getForAdmin(reversalId: string) {
    const reversal = await this.prisma.franchiseReversal.findUnique({
      where: { id: reversalId },
      include: { items: true },
    });
    if (!reversal) throw new NotFoundAppException('Reversal not found');
    return reversal;
  }

  async getForFranchise(reversalId: string, franchiseId: string) {
    const reversal = await this.prisma.franchiseReversal.findUnique({
      where: { id: reversalId },
      include: { items: true },
    });
    if (!reversal || reversal.franchiseId !== franchiseId) {
      throw new NotFoundAppException('Reversal not found');
    }
    return reversal;
  }

  async list(params: {
    franchiseId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const where: Prisma.FranchiseReversalWhereInput = {};
    if (params.franchiseId) where.franchiseId = params.franchiseId;
    if (params.status)
      where.status =
        params.status as Prisma.EnumFranchiseReversalStatusFilter['equals'];

    const [items, total] = await this.prisma.$transaction([
      this.prisma.franchiseReversal.findMany({
        where,
        include: { items: true },
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.franchiseReversal.count({ where }),
    ]);
    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
