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

/**
 * B2B / off-platform seller return reversal (Phase 108).
 *
 * A reversal is a persisted, admin-approved request — NOT the old fire-and-
 * forget self-credit. Lifecycle: PENDING_APPROVAL → APPROVED | REJECTED |
 * CANCELLED. All financial + inventory effects happen ONLY on approval, inside
 * one transaction (so a failure anywhere rolls back the APPROVED flip too).
 *
 * Customer impact: none — `subOrder.fulfillmentStatus` stays DELIVERED (the
 * customer kept the goods). Only `subOrder.sellerReversalStatus` mirrors the
 * reversal lifecycle for dashboards.
 *
 * GST: deliberately not adjusted in-system (off-platform B2B) — see
 * docs/tax/GST_ASSUMPTIONS.md, pending CA sign-off.
 */
@Injectable()
export class SellerReversalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commissionReversal: ReturnCommissionReversalService,
    private readonly audit: AuditPublicFacade,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SellerReversalService');
  }

  // ── Seller: request a reversal ─────────────────────────────────────────
  async request(params: {
    sellerId: string;
    subOrderId: string;
    reason: string;
    items: Array<{ orderItemId: string; quantity: number }>;
    idempotencyKey?: string;
  }) {
    const { sellerId, subOrderId, reason, items } = params;

    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: { items: true },
    });
    // NotFound (not Forbidden) on ownership/type mismatch — no existence leak.
    if (
      !subOrder ||
      subOrder.fulfillmentNodeType !== 'SELLER' ||
      subOrder.sellerId !== sellerId
    ) {
      throw new NotFoundAppException('Seller order not found');
    }
    if (subOrder.fulfillmentStatus !== 'DELIVERED') {
      throw new BadRequestAppException('Can only reverse delivered orders');
    }
    if (subOrder.returnWindowEndsAt && new Date() > subOrder.returnWindowEndsAt) {
      throw new BadRequestAppException('Return window has expired');
    }

    // Idempotent replay: a prior request with the same key wins.
    if (params.idempotencyKey) {
      const existing = await this.prisma.sellerReversal.findUnique({
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
      const open = await tx.sellerReversal.findFirst({
        where: { subOrderId, status: 'PENDING_APPROVAL' },
        select: { id: true },
      });
      if (open) {
        throw new BadRequestAppException(
          'A reversal request is already pending for this sub-order',
        );
      }
      const created = await tx.sellerReversal.create({
        data: {
          subOrderId,
          sellerId,
          masterOrderId: subOrder.masterOrderId,
          status: 'PENDING_APPROVAL',
          reason,
          reversalValueInPaise,
          idempotencyKey: params.idempotencyKey ?? null,
          items: { create: itemRows },
        },
        include: { items: true },
      });
      await tx.subOrder.update({
        where: { id: subOrderId },
        data: { sellerReversalStatus: 'PENDING_APPROVAL' },
      });
      return created;
    });

    await this.audit.writeAuditLog({
      actorId: sellerId,
      actorRole: 'SELLER',
      action: 'seller.reversal.requested',
      module: 'returns',
      resource: 'seller_reversal',
      resourceId: reversal.id,
      metadata: {
        subOrderId,
        reason,
        items: itemRows.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })),
        reversalValueInPaise: reversalValueInPaise.toString(),
      },
    });
    return reversal;
  }

  // ── Admin: approve (applies all effects atomically) ────────────────────
  async approve(params: { reversalId: string; adminId: string; adminRole?: string }) {
    const { reversalId, adminId } = params;

    const sellerDebitPaise = await this.prisma.$transaction(async (tx) => {
      // CAS: only PENDING_APPROVAL → APPROVED. If a failure follows, the whole
      // tx (including this flip) rolls back, leaving the request PENDING.
      const claimed = await tx.sellerReversal.updateMany({
        where: { id: reversalId, status: 'PENDING_APPROVAL' },
        data: { status: 'APPROVED', decidedByAdminId: adminId, decidedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new BadRequestAppException(
          'Reversal is not pending approval (already decided or not found)',
        );
      }

      const reversal = await tx.sellerReversal.findUniqueOrThrow({
        where: { id: reversalId },
        include: { items: true },
      });
      const subOrder = await tx.subOrder.findUniqueOrThrow({
        where: { id: reversal.subOrderId },
        include: { items: true },
      });

      let debitPaise = 0n;
      for (const ri of reversal.items) {
        const oi = subOrder.items.find((i) => i.id === ri.orderItemId);
        if (!oi) {
          throw new NotFoundAppException(`Order item ${ri.orderItemId} missing`);
        }

        const mapping = await tx.sellerProductMapping.findFirst({
          where: { sellerId: reversal.sellerId, productId: ri.productId, variantId: ri.variantId },
        });
        if (!mapping) {
          // Don't silently lose the stock — fail the whole approval so an
          // admin re-lists the product or resolves manually.
          throw new BadRequestAppException(
            `No seller mapping for product ${ri.productId}${ri.variantId ? '/' + ri.variantId : ''}; cannot restock. Re-list the product or resolve manually.`,
          );
        }

        const before = mapping.stockQty;
        await tx.sellerProductMapping.update({
          where: { id: mapping.id },
          data: { stockQty: { increment: ri.quantity } },
        });
        // Mirror to the customer-facing aggregate (parity with the QC restock
        // path) so seller stock and storefront stock don't drift.
        if (ri.variantId) {
          await tx.productVariant.update({
            where: { id: ri.variantId },
            data: { stock: { increment: ri.quantity } },
          });
        } else {
          await tx.product.update({
            where: { id: ri.productId },
            data: { baseStock: { increment: ri.quantity } },
          });
        }
        // Inventory ledger row (traceability).
        await tx.stockMovement.create({
          data: {
            resourceType: 'SELLER_MAPPING',
            resourceId: mapping.id,
            mappingId: mapping.id,
            kind: 'RESTOCKED',
            quantityDelta: ri.quantity,
            beforeStockQty: before,
            afterStockQty: before + ri.quantity,
            reason: `Seller reversal ${reversalId}`,
            referenceType: 'SELLER_REVERSAL',
            referenceId: reversalId,
            actorId: adminId,
            actorRole: 'ADMIN',
          },
        });
        // Over-reversal guard for future requests on this item.
        await tx.orderItem.update({
          where: { id: oi.id },
          data: { reversedQuantity: { increment: ri.quantity } },
        });

        // Settlement claw-back basis: the seller's settlement price for the
        // reversed units (what the platform would otherwise pay them).
        const settlement = new Prisma.Decimal(mapping.settlementPrice ?? 0)
          .mul(ri.quantity)
          .mul(100)
          .toFixed(0);
        debitPaise += BigInt(settlement);
      }

      // Reverse the platform commission proportionally (reuse the proven
      // service; tag the audit rows SELLER_REVERSAL). Runs in this tx.
      await this.commissionReversal.reverseCommissionForReturn(
        {
          id: reversal.id,
          returnNumber: null,
          subOrder: {
            id: subOrder.id,
            fulfillmentNodeType: 'SELLER',
            sellerId: reversal.sellerId,
            franchiseId: null,
          },
          items: reversal.items.map((ri) => {
            const oi = subOrder.items.find((i) => i.id === ri.orderItemId)!;
            return {
              orderItem: { id: oi.id, unitPrice: oi.unitPrice, quantity: oi.quantity },
              qcQuantityApproved: ri.quantity,
            };
          }),
        },
        tx,
        {
          source: 'SELLER_REVERSAL',
          actorType: 'ADMIN',
          actorId: adminId,
          note: `Seller off-platform reversal ${reversalId}`,
        },
      );

      // SellerDebit so the settlement run recovers the seller's payout for the
      // reclaimed goods. (sourceType, sourceId) is unique → idempotent.
      let sellerDebitId: string | null = null;
      if (debitPaise > 0n) {
        const debit = await tx.sellerDebit.create({
          data: {
            sellerId: reversal.sellerId,
            sourceType: 'SELLER_REVERSAL',
            sourceId: reversalId,
            orderId: reversal.masterOrderId,
            subOrderId: reversal.subOrderId,
            amountInPaise: debitPaise,
            reason: `Seller off-platform reversal ${reversalId}`,
          },
        });
        sellerDebitId = debit.id;
      }

      await tx.sellerReversal.update({
        where: { id: reversalId },
        data: { sellerDebitId },
      });
      // fulfillmentStatus intentionally untouched (customer kept the goods).
      await tx.subOrder.update({
        where: { id: reversal.subOrderId },
        data: { sellerReversalStatus: 'APPROVED' },
      });

      return debitPaise;
    });

    await this.audit.writeAuditLog({
      actorId: adminId,
      actorRole: params.adminRole ?? 'ADMIN',
      action: 'seller.reversal.approved',
      module: 'returns',
      resource: 'seller_reversal',
      resourceId: reversalId,
      metadata: { sellerDebitInPaise: sellerDebitPaise.toString() },
    });
    return { reversalId, status: 'APPROVED' as const };
  }

  // ── Admin: reject ──────────────────────────────────────────────────────
  async reject(params: {
    reversalId: string;
    adminId: string;
    adminRole?: string;
    rejectionReason: string;
  }) {
    const claimed = await this.prisma.sellerReversal.updateMany({
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
    const reversal = await this.prisma.sellerReversal.findUniqueOrThrow({
      where: { id: params.reversalId },
      select: { subOrderId: true },
    });
    await this.prisma.subOrder.update({
      where: { id: reversal.subOrderId },
      data: { sellerReversalStatus: 'REJECTED' },
    });

    await this.audit.writeAuditLog({
      actorId: params.adminId,
      actorRole: params.adminRole ?? 'ADMIN',
      action: 'seller.reversal.rejected',
      module: 'returns',
      resource: 'seller_reversal',
      resourceId: params.reversalId,
      metadata: { rejectionReason: params.rejectionReason },
    });
    return { reversalId: params.reversalId, status: 'REJECTED' as const };
  }

  // ── Seller: cancel a pending request ───────────────────────────────────
  async cancel(params: { reversalId: string; sellerId: string }) {
    const claimed = await this.prisma.sellerReversal.updateMany({
      where: {
        id: params.reversalId,
        sellerId: params.sellerId,
        status: 'PENDING_APPROVAL',
      },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count === 0) {
      throw new BadRequestAppException(
        'Reversal cannot be cancelled (not found, not yours, or already decided)',
      );
    }
    const reversal = await this.prisma.sellerReversal.findUniqueOrThrow({
      where: { id: params.reversalId },
      select: { subOrderId: true },
    });
    await this.prisma.subOrder.update({
      where: { id: reversal.subOrderId },
      data: { sellerReversalStatus: 'CANCELLED' },
    });

    await this.audit.writeAuditLog({
      actorId: params.sellerId,
      actorRole: 'SELLER',
      action: 'seller.reversal.cancelled',
      module: 'returns',
      resource: 'seller_reversal',
      resourceId: params.reversalId,
    });
    return { reversalId: params.reversalId, status: 'CANCELLED' as const };
  }

  // ── Queries ────────────────────────────────────────────────────────────
  async getForSeller(reversalId: string, sellerId: string) {
    const reversal = await this.prisma.sellerReversal.findUnique({
      where: { id: reversalId },
      include: { items: true },
    });
    if (!reversal || reversal.sellerId !== sellerId) {
      throw new NotFoundAppException('Reversal not found');
    }
    return reversal;
  }

  async getForAdmin(reversalId: string) {
    const reversal = await this.prisma.sellerReversal.findUnique({
      where: { id: reversalId },
      include: { items: true },
    });
    if (!reversal) throw new NotFoundAppException('Reversal not found');
    return reversal;
  }

  async list(params: {
    sellerId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const where: Prisma.SellerReversalWhereInput = {};
    if (params.sellerId) where.sellerId = params.sellerId;
    if (params.status) where.status = params.status as Prisma.EnumSellerReversalStatusFilter['equals'];

    const [items, total] = await this.prisma.$transaction([
      this.prisma.sellerReversal.findMany({
        where,
        include: { items: true },
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sellerReversal.count({ where }),
    ]);
    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
}
