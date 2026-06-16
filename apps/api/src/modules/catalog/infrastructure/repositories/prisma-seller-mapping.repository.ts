import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { ISellerMappingRepository, SellerMappingListParams } from '../../domain/repositories/seller-mapping.repository.interface';
import { StockBelowReservedError } from '../../domain/errors/stock-below-reserved.error';

const MAPPING_SELLER_SELECT = {
  id: true, sellerName: true, sellerShopName: true, email: true, status: true, storeAddress: true, sellerZipCode: true,
};
const MAPPING_PRODUCT_SELECT = {
  id: true, title: true, slug: true, productCode: true, status: true,
};
const MAPPING_VARIANT_SELECT = {
  id: true, masterSku: true, title: true, sku: true,
};

@Injectable()
export class PrismaSellerMappingRepository implements ISellerMappingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByProduct(productId: string, sellerTypes?: string[] | null): Promise<any[]> {
    const where: any = {
      productId,
      OR: [
        { variantId: null },
        { variant: { isDeleted: false } },
      ],
    };
    // Seller-type scope: a D2C/RETAIL-scoped admin only sees its own type's
    // seller mappings (and their SKUs) for the product. null = unrestricted.
    if (sellerTypes && sellerTypes.length > 0) {
      where.seller = { sellerType: { in: sellerTypes } };
    }
    return this.prisma.sellerProductMapping.findMany({
      where,
      include: {
        seller: { select: MAPPING_SELLER_SELECT },
        variant: { select: MAPPING_VARIANT_SELECT },
      },
      orderBy: { operationalPriority: 'desc' },
    });
  }

  async findAllPaginated(params: SellerMappingListParams): Promise<{ mappings: any[]; total: number }> {
    const { page, limit, sellerId, productId, isActive, approvalStatus, search, sellerTypes } = params;
    const where: any = {
      // Exclude mappings for soft-deleted variants
      OR: [
        { variantId: null },
        { variant: { isDeleted: false } },
      ],
    };
    if (sellerId) where.sellerId = sellerId;
    if (productId) where.productId = productId;
    if (isActive !== undefined) where.isActive = isActive;
    if (approvalStatus) where.approvalStatus = approvalStatus;
    // Seller-type scope: a D2C/RETAIL-scoped admin only sees mappings owned by
    // sellers of their type. null/undefined = unrestricted (super admin).
    if (sellerTypes && sellerTypes.length > 0) {
      where.seller = { sellerType: { in: sellerTypes } };
    }
    if (search) {
      where.AND = [
        {
          OR: [
            { product: { title: { contains: search, mode: 'insensitive' } } },
            { seller: { sellerName: { contains: search, mode: 'insensitive' } } },
            { seller: { sellerShopName: { contains: search, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const [mappings, total] = await Promise.all([
      this.prisma.sellerProductMapping.findMany({
        where,
        include: {
          seller: { select: MAPPING_SELLER_SELECT },
          product: { select: MAPPING_PRODUCT_SELECT },
          variant: { select: MAPPING_VARIANT_SELECT },
        },
        orderBy: [{ operationalPriority: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sellerProductMapping.count({ where }),
    ]);
    return { mappings, total };
  }

  async findPendingPaginated(
    page: number,
    limit: number,
    sellerTypes?: string[] | null,
  ): Promise<{ mappings: any[]; total: number }> {
    const where: any = {
      approvalStatus: 'PENDING_APPROVAL' as const,
      // Hide mappings whose product is a never-submitted draft (DRAFT +
      // moderationStatus PENDING) — consistent with the admin product list.
      // A seller's pending mapping shouldn't enter the approval queue (or the
      // sidebar badge count) until they submit the product for review; once
      // submitted the product leaves DRAFT and its mappings reappear here.
      product: { NOT: { status: 'DRAFT' as const, moderationStatus: 'PENDING' as const } },
      // Exclude mappings for soft-deleted variants
      OR: [
        { variantId: null },
        { variant: { isDeleted: false } },
      ],
    };
    // Seller-type scope: a D2C/RETAIL-scoped admin only sees its own type's
    // pending approvals. null/undefined = unrestricted (super admin).
    if (sellerTypes && sellerTypes.length > 0) {
      where.seller = { sellerType: { in: sellerTypes } };
    }
    const [mappings, total] = await Promise.all([
      this.prisma.sellerProductMapping.findMany({
        where,
        include: {
          seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true, status: true } },
          product: { select: MAPPING_PRODUCT_SELECT },
          variant: { select: MAPPING_VARIANT_SELECT },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sellerProductMapping.count({ where }),
    ]);
    return { mappings, total };
  }

  async findById(mappingId: string): Promise<any | null> {
    return this.prisma.sellerProductMapping.findUnique({ where: { id: mappingId } });
  }

  async findSellerScopeByIds(
    mappingIds: string[],
  ): Promise<Array<{ id: string; sellerType: string | null }>> {
    if (mappingIds.length === 0) return [];
    const rows = await this.prisma.sellerProductMapping.findMany({
      where: { id: { in: mappingIds } },
      select: { id: true, seller: { select: { sellerType: true } } },
    });
    return rows.map((r: any) => ({
      id: r.id,
      sellerType: r.seller?.sellerType ?? null,
    }));
  }

  async update(mappingId: string, data: any): Promise<any> {
    return this.prisma.sellerProductMapping.update({
      where: { id: mappingId },
      data,
      include: {
        seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } },
        product: { select: { id: true, title: true, slug: true, productCode: true } },
        variant: { select: MAPPING_VARIANT_SELECT },
      },
    });
  }

  async approve(mappingId: string, adminId?: string): Promise<any | null> {
    // Phase 57 (2026-05-22) — status-conditional. PENDING_APPROVAL is
    // the only legal starting state for a fresh approve. STOPPED →
    // APPROVED requires the explicit /reapprove endpoint with reason;
    // REJECTED mappings require seller resubmit first.
    const result = await this.prisma.sellerProductMapping.updateMany({
      where: { id: mappingId, approvalStatus: 'PENDING_APPROVAL' },
      data: {
        approvalStatus: 'APPROVED',
        isActive: true,
        approvedBy: adminId ?? null,
        approvedAt: new Date(),
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        stoppedBy: null,
        stoppedAt: null,
      },
    });
    if (result.count === 0) return null;
    return this.findById(mappingId);
  }

  async reject(
    mappingId: string,
    adminId: string,
    reason: string,
  ): Promise<any | null> {
    // Phase 57 — only PENDING_APPROVAL → REJECTED is allowed.
    const result = await this.prisma.sellerProductMapping.updateMany({
      where: { id: mappingId, approvalStatus: 'PENDING_APPROVAL' },
      data: {
        approvalStatus: 'REJECTED',
        isActive: false,
        rejectedBy: adminId,
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });
    if (result.count === 0) return null;
    return this.findById(mappingId);
  }

  async stop(
    mappingId: string,
    adminId?: string,
    reason?: string,
  ): Promise<any | null> {
    // Phase 58 (2026-05-22) — stop is legal ONLY from APPROVED.
    // Pre-Phase-58 PENDING_APPROVAL → STOPPED was also allowed, but
    // a never-live mapping cannot semantically be "stopped"; the
    // correct transition is /reject (audit Gap #13). REJECTED and
    // STOPPED are also blocked — the controller maps null to a 400
    // that directs callers to /reject or /reapprove respectively.
    const result = await this.prisma.sellerProductMapping.updateMany({
      where: { id: mappingId, approvalStatus: 'APPROVED' },
      data: {
        approvalStatus: 'STOPPED',
        isActive: false,
        stoppedBy: adminId ?? null,
        stoppedAt: new Date(),
        ...(reason !== undefined ? { rejectionReason: reason } : {}),
      },
    });
    if (result.count === 0) return null;
    return this.findById(mappingId);
  }

  async reapprove(
    mappingId: string,
    adminId: string,
    reason: string,
  ): Promise<any | null> {
    // Phase 57 (2026-05-22) — explicit STOPPED → APPROVED with reason.
    // Pre-Phase-57 admins could silently lift a STOPPED mapping via
    // /approve, masking compliance signals. The /reapprove route
    // makes the lift intentional + reason-stamped.
    const result = await this.prisma.sellerProductMapping.updateMany({
      where: { id: mappingId, approvalStatus: 'STOPPED' },
      data: {
        approvalStatus: 'APPROVED',
        isActive: true,
        approvedBy: adminId,
        approvedAt: new Date(),
        rejectionReason: `[Reapproved] ${reason}`,
      },
    });
    if (result.count === 0) return null;
    return this.findById(mappingId);
  }

  // 2026-06-15 — seller resumes their OWN paused offer. The stoppedBy guard
  // matches only rows this seller paused (repo.stop was called with the
  // sellerId), so a seller can never lift an admin STOP/SUSPEND — only an
  // admin reapprove can. Inverse of the seller pause.
  async resumeBySeller(mappingId: string, sellerId: string): Promise<any | null> {
    const result = await this.prisma.sellerProductMapping.updateMany({
      where: {
        id: mappingId,
        approvalStatus: 'STOPPED',
        stoppedBy: sellerId,
        deletedAt: null,
      },
      data: {
        approvalStatus: 'APPROVED',
        isActive: true,
        stoppedBy: null,
        stoppedAt: null,
        rejectionReason: null,
      },
    });
    if (result.count === 0) return null;
    return this.findById(mappingId);
  }

  async bulkApprove(
    mappingIds: string[],
    adminId: string,
  ): Promise<Array<{ mappingId: string; ok: boolean; reason?: string }>> {
    // Phase 57 — atomic per-row inside a single transaction. Each row
    // goes through the same status-conditional update, so a row
    // already-APPROVED (or STOPPED/REJECTED) returns ok:false with
    // its current status. Whole batch never fails — the caller
    // reports partial success and surfaces blocked rows.
    return this.prisma.$transaction(async (tx) => {
      const out: Array<{ mappingId: string; ok: boolean; reason?: string }> = [];
      for (const id of mappingIds) {
        const update = await tx.sellerProductMapping.updateMany({
          where: { id, approvalStatus: 'PENDING_APPROVAL' },
          data: {
            approvalStatus: 'APPROVED',
            isActive: true,
            approvedBy: adminId,
            approvedAt: new Date(),
            rejectedBy: null,
            rejectedAt: null,
            rejectionReason: null,
            stoppedBy: null,
            stoppedAt: null,
          },
        });
        if (update.count === 1) {
          out.push({ mappingId: id, ok: true });
        } else {
          const current = await tx.sellerProductMapping.findUnique({
            where: { id },
            select: { approvalStatus: true },
          });
          out.push({
            mappingId: id,
            ok: false,
            reason: current
              ? `Mapping is ${current.approvalStatus}, not PENDING_APPROVAL`
              : 'Mapping not found',
          });
        }
      }
      return out;
    });
  }

  async bulkStop(
    mappingIds: string[],
    adminId: string,
    reason: string,
  ): Promise<Array<{ mappingId: string; ok: boolean; reason?: string }>> {
    // Phase 58 (2026-05-22) — mirrors bulkApprove but for stop. Each
    // row only transitions from APPROVED (Phase 58 Gap #13). The
    // caller wraps this with per-row audit + event + reservation
    // release for the successful rows.
    return this.prisma.$transaction(async (tx) => {
      const out: Array<{ mappingId: string; ok: boolean; reason?: string }> = [];
      for (const id of mappingIds) {
        const update = await tx.sellerProductMapping.updateMany({
          where: { id, approvalStatus: 'APPROVED' },
          data: {
            approvalStatus: 'STOPPED',
            isActive: false,
            stoppedBy: adminId,
            stoppedAt: new Date(),
            rejectionReason: reason,
          },
        });
        if (update.count === 1) {
          out.push({ mappingId: id, ok: true });
        } else {
          const current = await tx.sellerProductMapping.findUnique({
            where: { id },
            select: { approvalStatus: true },
          });
          out.push({
            mappingId: id,
            ok: false,
            reason: current
              ? `Mapping is ${current.approvalStatus}, not APPROVED`
              : 'Mapping not found',
          });
        }
      }
      return out;
    });
  }

  async releaseActiveReservationsForMapping(
    mappingId: string,
  ): Promise<Array<{
    reservationId: string;
    quantity: number;
    orderId: string | null;
    customerId: string | null;
    sessionId: string | null;
    cartId: string | null;
    stockQty: number;
    beforeReservedQty: number;
    afterReservedQty: number;
  }>> {
    // Phase 58 (2026-05-22) — releases active reservations on a
    // stopped mapping (audit Gap #8). Pre-Phase-58 these dangling
    // reservations forced customers into checkout limbo (stock
    // reserved on a mapping the routing engine no longer touches)
    // until the expiry sweep cleared them. The CAS flip + per-row
    // transaction mirrors the expiry-sweep pattern so a concurrent
    // expiry doesn't double-count.
    // Only release cart-level holds (orderId IS NULL). A RESERVED hold that is
    // already attached to a placed order belongs to that order's lifecycle —
    // it will be CONFIRMED on payment or released on order cancel/expiry.
    // Releasing it here (on a mapping stop/pause) would free stock the order
    // still expects, letting another customer grab it → oversell.
    const reservations = await this.prisma.stockReservation.findMany({
      where: { mappingId, status: 'RESERVED', orderId: null },
      select: {
        id: true,
        quantity: true,
        orderId: true,
        customerId: true,
        sessionId: true,
        cartId: true,
      },
    });
    if (reservations.length === 0) return [];

    const out: Array<{
      reservationId: string;
      quantity: number;
      orderId: string | null;
      customerId: string | null;
      sessionId: string | null;
      cartId: string | null;
      stockQty: number;
      beforeReservedQty: number;
      afterReservedQty: number;
    }> = [];

    for (const r of reservations) {
      const result = await this.prisma.$transaction(async (tx) => {
        const flip = await tx.stockReservation.updateMany({
          where: { id: r.id, status: 'RESERVED' },
          data: { status: 'RELEASED', releasedAt: new Date() },
        });
        if (flip.count === 0) return null; // a concurrent expiry won
        const mappingBefore = await tx.sellerProductMapping.findUnique({
          where: { id: mappingId },
          select: { stockQty: true, reservedQty: true },
        });
        if (!mappingBefore) return null;
        const newReserved = Math.max(mappingBefore.reservedQty - r.quantity, 0);
        await tx.sellerProductMapping.update({
          where: { id: mappingId },
          data: { reservedQty: newReserved },
        });
        return {
          beforeReservedQty: mappingBefore.reservedQty,
          afterReservedQty: newReserved,
          stockQty: mappingBefore.stockQty,
        };
      });
      if (result) {
        out.push({
          reservationId: r.id,
          quantity: r.quantity,
          orderId: r.orderId,
          customerId: r.customerId,
          sessionId: r.sessionId,
          cartId: r.cartId,
          stockQty: result.stockQty,
          beforeReservedQty: result.beforeReservedQty,
          afterReservedQty: result.afterReservedQty,
        });
      }
    }
    return out;
  }

  async resubmit(mappingId: string): Promise<any> {
    // Phase 56 — seller-driven resubmit. Clears the REJECTED state
    // back to PENDING_APPROVAL so the admin queue re-processes it.
    // We do NOT clear rejectedBy/At/Reason here — the audit trail
    // for the prior rejection survives until the next approve()
    // call clears it (so admin can see "this was rejected for X
    // then resubmitted" while re-reviewing).
    return this.update(mappingId, {
      approvalStatus: 'PENDING_APPROVAL',
      isActive: false,
    });
  }

  async findBySeller(sellerId: string): Promise<any[]> {
    return this.prisma.sellerProductMapping.findMany({
      where: { sellerId },
      select: { id: true, sellerId: true },
    });
  }

  async findDistinctProductIdsBySeller(sellerId: string): Promise<string[]> {
    const mappings = await this.prisma.sellerProductMapping.findMany({
      where: { sellerId },
      select: { productId: true },
      distinct: ['productId'],
    });
    return mappings.map((m) => m.productId);
  }

  async findBySellerAndProduct(sellerId: string, productId: string, variantId?: string | null): Promise<any | null> {
    return this.prisma.sellerProductMapping.findFirst({
      where: { sellerId, productId, variantId: variantId ?? null },
    });
  }

  async findBySellerForProduct(sellerId: string, productId: string): Promise<any[]> {
    // Exclude soft-deleted rows — a deleted variant mapping must NOT count as
    // "already mapped", otherwise the re-map fan-out skips it forever and the
    // seller sees a misleading "already mapped all variants" conflict.
    return this.prisma.sellerProductMapping.findMany({
      where: { sellerId, productId, deletedAt: null },
      select: { id: true, variantId: true },
    });
  }

  async findSellerOffersForProduct(
    sellerId: string,
    productId: string,
  ): Promise<
    Array<{
      id: string;
      variantId: string | null;
      productId: string;
      approvalStatus: string;
      isActive: boolean;
      stoppedBy: string | null;
    }>
  > {
    return this.prisma.sellerProductMapping.findMany({
      where: { sellerId, productId, deletedAt: null },
      select: {
        id: true,
        variantId: true,
        productId: true,
        approvalStatus: true,
        isActive: true,
        stoppedBy: true,
      },
    }) as any;
  }

  async create(data: any): Promise<any> {
    // Restore-on-remap: a soft-deleted mapping still occupies the
    // (sellerId, productId, variantId) unique slot, so a plain insert would
    // throw P2002. If a soft-deleted row exists at that key, restore it with
    // the new data instead — this is the only way to re-map a variant the
    // seller previously removed. A LIVE duplicate falls through to create() and
    // surfaces the genuine "already mapped" P2002 the callers handle.
    const existing = await this.prisma.sellerProductMapping.findFirst({
      where: {
        sellerId: data.sellerId,
        productId: data.productId,
        variantId: data.variantId ?? null,
      },
      select: { id: true, deletedAt: true },
    });
    if (existing?.deletedAt) {
      return this.prisma.sellerProductMapping.update({
        where: { id: existing.id },
        data: { ...data, deletedAt: null },
        include: {
          product: { select: { id: true, title: true, productCode: true } },
          variant: { select: { id: true, sku: true, price: true } },
        },
      });
    }
    return this.prisma.sellerProductMapping.create({
      data,
      include: {
        product: { select: { id: true, title: true, productCode: true } },
        variant: { select: { id: true, sku: true, price: true } },
      },
    });
  }

  async createMany(data: any[], tx?: Prisma.TransactionClient): Promise<any[]> {
    // Phase 42 (2026-05-21) — accept external tx so the bulk insert
    // shares the variant-generation transaction. Without this, a
    // crash after variant generation but before mapping creation
    // left the seller with variants they couldn't sell.
    const exec = async (db: Prisma.TransactionClient) => {
      const results = [];
      for (const d of data) {
        // Restore-on-remap (same as create()): a soft-deleted row still occupies
        // the (sellerId,productId,variantId) unique slot, so a plain create in
        // the fan-out would throw P2002 and permanently block re-mapping a
        // previously-removed variant. Restore it instead when present.
        const existing = await db.sellerProductMapping.findFirst({
          where: {
            sellerId: d.sellerId,
            productId: d.productId,
            variantId: d.variantId ?? null,
          },
          select: { id: true, deletedAt: true },
        });
        const mapping = existing?.deletedAt
          ? await db.sellerProductMapping.update({
              where: { id: existing.id },
              data: { ...d, deletedAt: null },
              include: {
                product: { select: { id: true, title: true, productCode: true } },
                variant: { select: { id: true, sku: true, price: true } },
              },
            })
          : await db.sellerProductMapping.create({
              data: d,
              include: {
                product: { select: { id: true, title: true, productCode: true } },
                variant: { select: { id: true, sku: true, price: true } },
              },
            });
        results.push(mapping);
      }
      return results;
    };
    if (tx) return exec(tx);
    return this.prisma.$transaction(exec);
  }

  async delete(mappingId: string): Promise<void> {
    await this.prisma.sellerProductMapping.delete({ where: { id: mappingId } });
  }

  /**
   * Phase 1 (PR 1.10) — bulk stock-import floor.
   *
   * For each update, issue a status-conditional `updateMany`:
   *
   *   UPDATE seller_product_mappings
   *      SET stock_qty = $newStock
   *    WHERE id = $mappingId AND reserved_qty <= $newStock
   *
   * If the predicate fails (`reserved_qty > newStock`), `count` is 0
   * and the row is NOT written. We then re-read the row to extract its
   * current reservedQty and record a violation. After the loop, if any
   * violations were collected, we throw `StockBelowReservedError` from
   * inside the transaction callback — Prisma rolls back the rows we
   * already wrote, so the batch is all-or-nothing.
   *
   * Why per-row updateMany instead of one big WHERE-IN with a CASE
   * expression: each row has its own per-row predicate, and Prisma
   * doesn't expose a clean way to express that in a single statement.
   * The N round-trips are fine for the documented batch ceiling
   * (100 rows; see the controller's `if (dto.updates.length > 100)`).
   *
   * Why throw rather than return violations: a half-imported CSV is
   * harder to recover from than a clean rejection. Throwing inside
   * `$transaction` is the documented Prisma rollback mechanism.
   */
  async bulkUpdateStock(
    updates: Array<{ mappingId: string; stockQty: number }>,
  ): Promise<{
    updated: Array<{ id: string; stockQty: number; variantId: string | null; productId: string }>;
    violations: Array<{ mappingId: string; requestedStock: number; reservedQty: number }>;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const violations: Array<{ mappingId: string; requestedStock: number; reservedQty: number }> = [];
      const successIds: string[] = [];

      for (const update of updates) {
        const result = await tx.sellerProductMapping.updateMany({
          where: {
            id: update.mappingId,
            reservedQty: { lte: update.stockQty }, // floor enforced here
          },
          data: { stockQty: update.stockQty },
        });

        if (result.count === 0) {
          // Either the row was rejected by the floor predicate or
          // doesn't exist at all. Disambiguate so a missing row
          // doesn't masquerade as a floor violation (the controller's
          // existence/ownership check should have caught it already).
          const current = await tx.sellerProductMapping.findUnique({
            where: { id: update.mappingId },
            select: { id: true, reservedQty: true },
          });
          if (current) {
            violations.push({
              mappingId: update.mappingId,
              requestedStock: update.stockQty,
              reservedQty: current.reservedQty,
            });
          }
          // current === null: silently skip — controller's earlier
          // checks own existence validation, and treating it as a
          // violation would expose the wrong error to the seller.
        } else {
          successIds.push(update.mappingId);
        }
      }

      if (violations.length > 0) {
        // Roll back the writes already applied to earlier rows. The
        // controller catches this error and renders the violation list
        // to the seller.
        throw new StockBelowReservedError(violations);
      }

      const updated = await tx.sellerProductMapping.findMany({
        where: { id: { in: successIds } },
        select: { id: true, stockQty: true, variantId: true, productId: true },
      });
      return { updated, violations: [] };
    });
  }

  /**
   * Phase 51 (2026-05-21) — bulk update with before-state capture.
   *
   * Identical floor + transaction semantics to bulkUpdateStock, but
   * additionally reads each row's pre-write stockQty + reservedQty
   * BEFORE the UPDATE so the controller can write a MANUAL_ADJUST
   * StockMovement ledger row. Also accepts an optional
   * lowStockThreshold per row so sellers can bulk-set thresholds in
   * the same call (audit Gap #4).
   */
  async bulkUpdateStockWithBefore(
    updates: Array<{ mappingId: string; stockQty: number; lowStockThreshold?: number }>,
  ): Promise<{
    updated: Array<{
      id: string;
      productId: string;
      variantId: string | null;
      beforeStockQty: number;
      afterStockQty: number;
      reservedQty: number;
    }>;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const violations: Array<{ mappingId: string; requestedStock: number; reservedQty: number }> = [];
      const updated: Array<{
        id: string;
        productId: string;
        variantId: string | null;
        beforeStockQty: number;
        afterStockQty: number;
        reservedQty: number;
      }> = [];

      // Read everything first so we have stable BEFORE snapshots — these
      // pair up with the AFTER values for the ledger writes downstream.
      const ids = updates.map((u) => u.mappingId);
      const beforeRows = await tx.sellerProductMapping.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          productId: true,
          variantId: true,
          stockQty: true,
          reservedQty: true,
        },
      });
      const beforeMap = new Map(beforeRows.map((r) => [r.id, r]));

      for (const update of updates) {
        const before = beforeMap.get(update.mappingId);
        if (!before) continue; // ownership check upstream should catch this

        const updateData: { stockQty: number; lowStockThreshold?: number } = {
          stockQty: update.stockQty,
        };
        if (update.lowStockThreshold !== undefined) {
          updateData.lowStockThreshold = update.lowStockThreshold;
        }

        const result = await tx.sellerProductMapping.updateMany({
          where: {
            id: update.mappingId,
            reservedQty: { lte: update.stockQty }, // floor
          },
          data: updateData,
        });

        if (result.count === 0) {
          violations.push({
            mappingId: update.mappingId,
            requestedStock: update.stockQty,
            reservedQty: before.reservedQty,
          });
        } else {
          updated.push({
            id: before.id,
            productId: before.productId,
            variantId: before.variantId,
            beforeStockQty: before.stockQty,
            afterStockQty: update.stockQty,
            reservedQty: before.reservedQty,
          });
        }
      }

      if (violations.length > 0) {
        throw new StockBelowReservedError(violations);
      }

      return { updated };
    });
  }

  async findManyByIdsForSeller(
    mappingIds: string[],
    sellerId: string,
  ): Promise<Array<{ id: string; sellerId: string; productId: string; variantId: string | null; stockQty: number; reservedQty: number; deletedAt: Date | null }>> {
    return this.prisma.sellerProductMapping.findMany({
      where: { id: { in: mappingIds }, sellerId },
      select: {
        id: true,
        sellerId: true,
        productId: true,
        variantId: true,
        stockQty: true,
        reservedQty: true,
        deletedAt: true,
      },
    });
  }

  async softDelete(mappingId: string): Promise<void> {
    await this.prisma.sellerProductMapping.update({
      where: { id: mappingId },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * Phase 51 polish (2026-05-21) — row-locked update.
   *
   * Postgres SELECT … FOR UPDATE acquires a row-level lock that
   * blocks any concurrent transaction trying to also FOR UPDATE the
   * same row until our transaction commits. The seller-allocation
   * reservation path already uses FOR UPDATE on this same row, so
   * the two writers serialize naturally: a reservation that bumps
   * reservedQty either fully commits before we read, or waits for
   * our stockQty write to commit before it can re-lock.
   *
   * Concretely the failure mode this closes: pre-Phase-51 polish, a
   * concurrent reservation could land between the controller's
   * findById (read reservedQty) and the repo's update (write
   * stockQty), making the floor check stale. The DB CHECK
   * constraint then surfaced as a Prisma P2010 (which we catch and
   * remap), but that's a fail-late path. With FOR UPDATE we
   * fail-early with a clean 409.
   */
  async updateWithRowLock(
    mappingId: string,
    sellerId: string,
    updateData: Record<string, unknown>,
  ): Promise<{
    row: any;
    before: { stockQty: number; reservedQty: number };
    after: { stockQty: number; reservedQty: number };
  }> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Lock the row. Parameterised so the id can't be SQL-injected.
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          seller_id: string;
          stock_qty: number;
          reserved_qty: number;
          deleted_at: Date | null;
        }>
      >`
        SELECT id, seller_id, stock_qty, reserved_qty, deleted_at
        FROM seller_product_mappings
        WHERE id = ${mappingId}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
      }
      const before = locked[0]!;
      if (before.deleted_at) {
        throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
      }
      if (before.seller_id !== sellerId) {
        throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' });
      }

      // 2. Floor check INSIDE the lock — reservedQty cannot change
      //    out from under us until we commit.
      if (
        updateData.stockQty !== undefined &&
        typeof updateData.stockQty === 'number' &&
        updateData.stockQty < before.reserved_qty
      ) {
        throw Object.assign(new Error('FLOOR_VIOLATION'), {
          code: 'FLOOR_VIOLATION',
          requestedStock: updateData.stockQty,
          reservedQty: before.reserved_qty,
        });
      }

      // 3. Apply the update (still inside the lock).
      const row = await tx.sellerProductMapping.update({
        where: { id: mappingId },
        data: updateData as any,
        include: {
          seller: { select: { id: true, sellerName: true, sellerShopName: true, email: true } },
          product: { select: { id: true, title: true, slug: true, productCode: true } },
          variant: { select: MAPPING_VARIANT_SELECT },
        },
      });

      const afterStockQty =
        typeof updateData.stockQty === 'number' ? updateData.stockQty : before.stock_qty;
      return {
        row,
        before: { stockQty: before.stock_qty, reservedQty: before.reserved_qty },
        after: { stockQty: afterStockQty, reservedQty: before.reserved_qty },
      };
    });
  }

  async listStockMovementsForMapping(
    mappingId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<Array<any>> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    return this.prisma.stockMovement.findMany({
      where: { mappingId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async deleteBySellerProductVariantNull(sellerId: string, productId: string): Promise<void> {
    await this.prisma.sellerProductMapping.deleteMany({
      where: { sellerId, productId, variantId: null },
    });
  }

  async findMyProductsPaginated(sellerId: string, page: number, limit: number, search?: string): Promise<{ products: any[]; total: number }> {
    const where: any = {
      sellerMappings: { some: { sellerId } },
      isDeleted: false,
    };
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { productCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          sellerMappings: {
            where: {
              sellerId,
              OR: [
                { variantId: null },
                { variant: { isDeleted: false } },
              ],
            },
            include: {
              variant: {
                select: {
                  id: true, sku: true, price: true, compareAtPrice: true,
                  optionValues: { include: { optionValue: { include: { optionDefinition: true } } } },
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { title: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { products, total };
  }

  async findServiceAreasPaginated(sellerId: string, page: number, limit: number, search?: string): Promise<{ serviceAreas: any[]; total: number }> {
    const where: any = { sellerId, isActive: true };
    if (search) where.pincode = { contains: search };

    const [serviceAreas, total] = await Promise.all([
      this.prisma.sellerServiceArea.findMany({
        where,
        orderBy: { pincode: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sellerServiceArea.count({ where }),
    ]);
    return { serviceAreas, total };
  }

  async addServiceAreas(sellerId: string, pincodes: string[]): Promise<number> {
    const result = await this.prisma.sellerServiceArea.createMany({
      data: pincodes.map((pincode) => ({ sellerId, pincode, isActive: true })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async removeServiceArea(sellerId: string, pincode: string): Promise<void> {
    await this.prisma.sellerServiceArea.delete({
      where: { sellerId_pincode: { sellerId, pincode } },
    });
  }

  async removeServiceAreas(sellerId: string, pincodes: string[]): Promise<number> {
    const result = await this.prisma.sellerServiceArea.deleteMany({
      where: { sellerId, pincode: { in: pincodes } },
    });
    return result.count;
  }

  async setCodEligibility(sellerId: string, pincode: string, eligible: boolean): Promise<void> {
    await this.prisma.sellerServiceArea.update({
      where: { sellerId_pincode: { sellerId, pincode } },
      data: { codEligible: eligible },
    });
  }

  async findServiceArea(sellerId: string, pincode: string): Promise<any | null> {
    return this.prisma.sellerServiceArea.findUnique({
      where: { sellerId_pincode: { sellerId, pincode } },
    });
  }

  async autoRepairMissingMappingsForSeller(sellerId: string): Promise<number> {
    // Find products owned by this seller that have NO seller mappings.
    // Phase 60 (2026-05-22) — defaults flipped from APPROVED+active
    // to PENDING_APPROVAL+inactive (audit Gap #9). Pre-Phase-60 the
    // auto-create bypassed the admin gate that manual mapping
    // creation requires (Phase 56 sets PENDING_APPROVAL on the
    // seller /map path); even owned-product auto-create needs the
    // same review before going live.
    const ownedWithoutMappings = await this.prisma.product.findMany({
      where: {
        sellerId,
        isDeleted: false,
        sellerMappings: { none: { sellerId } },
      },
      include: {
        variants: { where: { isDeleted: false }, select: { id: true, stock: true, price: true } },
        seller: { select: { storeAddress: true, sellerZipCode: true } },
      },
    });

    if (ownedWithoutMappings.length === 0) return 0;

    let totalCreated = 0;
    for (const product of ownedWithoutMappings) {
      const seller = product.seller;
      const variants = product.variants || [];

      if (product.hasVariants && variants.length > 0) {
        for (const variant of variants) {
          await this.prisma.sellerProductMapping.create({
            data: {
              sellerId,
              productId: product.id,
              variantId: variant.id,
              stockQty: variant.stock ?? 0,
              settlementPrice: variant.price ? Number(variant.price) : (product.basePrice ? Number(product.basePrice) : 0),
              pickupAddress: seller?.storeAddress || null,
              pickupPincode: seller?.sellerZipCode || null,
              dispatchSla: 2,
              approvalStatus: 'PENDING_APPROVAL',
              isActive: false,
            },
          });
          totalCreated++;
        }
      } else {
        await this.prisma.sellerProductMapping.create({
          data: {
            sellerId,
            productId: product.id,
            variantId: null,
            stockQty: product.baseStock ?? 0,
            settlementPrice: product.basePrice ? Number(product.basePrice) : 0,
            pickupAddress: seller?.storeAddress || null,
            pickupPincode: seller?.sellerZipCode || null,
            dispatchSla: 2,
            approvalStatus: 'PENDING_APPROVAL',
            isActive: false,
          },
        });
        totalCreated++;
      }
    }

    return totalCreated;
  }

  async countStaleMappingsForProduct(productId: string): Promise<number> {
    // Phase 60 (2026-05-22) — hot-path pre-check (audit Gap #6).
    // The composite index (productId, variantId, deletedAt)
    // makes this a single index scan; 99% of admin reads hit the
    // steady state where this returns 0 and the caller skips the
    // heavy fan-out logic.
    return this.prisma.sellerProductMapping.count({
      where: { productId, variantId: null, deletedAt: null },
    });
  }

  async repairStaleMappingsForProduct(
    productId: string,
    adminId: string,
    options: { allowStockLoss?: boolean } = {},
  ): Promise<Array<{
    staleMappingId: string;
    sellerId: string;
    staleStockQty: number;
    staleDispatchSla: number;
    newMappings: Array<{
      id: string;
      variantId: string;
      stockQty: number;
    }>;
    blockedReason?: string;
  }>> {
    // Phase 60 (2026-05-22) — see interface jsdoc for the full
    // gap-closure narrative. Implementation does the fan-out
    // inside a single $transaction so partial state from a
    // crashed repair is impossible (audit Gap #3).
    const staleMappings = await this.prisma.sellerProductMapping.findMany({
      where: { productId, variantId: null, deletedAt: null },
    });
    if (staleMappings.length === 0) return [];

    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      include: {
        variants: {
          where: { isDeleted: false },
          select: { id: true, stock: true, price: true },
        },
      },
    });
    if (!product || product.variants.length === 0) return [];
    const variants = product.variants;
    const basePrice = product.basePrice ? Number(product.basePrice) : null;

    const out: Array<{
      staleMappingId: string;
      sellerId: string;
      staleStockQty: number;
      staleDispatchSla: number;
      newMappings: Array<{ id: string; variantId: string; stockQty: number }>;
      blockedReason?: string;
    }> = [];

    for (const stale of staleMappings) {
      const sellerId: string = stale.sellerId;

      // Audit Gap #1 (silent stock loss) — refuse to migrate when
      // the stale row has hand inventory unless the caller opted
      // in. Defaulting to "block" avoids the variant.stock fan-out
      // that pre-Phase-60 zeroed sellers' catalogs.
      if ((stale.stockQty ?? 0) > 0 && !options.allowStockLoss) {
        out.push({
          staleMappingId: stale.id,
          sellerId,
          staleStockQty: stale.stockQty ?? 0,
          staleDispatchSla: stale.dispatchSla ?? 2,
          newMappings: [],
          blockedReason:
            `Stale mapping has stockQty=${stale.stockQty}. Use the explicit migration tool with stockStrategy='reset' to acknowledge inventory will be zeroed.`,
        });
        continue;
      }

      // Phase 60 (audit Gap #15) — re-resolve lat/lng from
      // PostOffice when pickupPincode is present. Pre-Phase-60
      // the fan-out copied the seller-profile address but never
      // resolved coords, so the routing-engine distance score
      // stayed null on every new row.
      let resolvedLat: number | null = null;
      let resolvedLon: number | null = null;
      const pincode = (stale as any).pickupPincode ?? null;
      if (pincode) {
        const po = await this.findPostOfficeByPincode(pincode);
        if (po?.latitude && po?.longitude) {
          resolvedLat = Number(po.latitude);
          resolvedLon = Number(po.longitude);
        }
      }

      const result = await this.prisma.$transaction(async (tx) => {
        // Re-lock and re-validate inside the transaction. The
        // condition WHERE id=stale AND deletedAt IS NULL is the
        // CAS pattern: if a concurrent admin already migrated,
        // the soft-delete predicate fails and count=0 — we skip
        // gracefully (audit Gap #7).
        const recheck = await tx.sellerProductMapping.findFirst({
          where: { id: stale.id, deletedAt: null, variantId: null },
        });
        if (!recheck) return null;

        // Audit Gap #11 — only fan out variants that don't
        // already have a (non-soft-deleted) mapping for this
        // seller. Pre-Phase-60 the whole repair was skipped when
        // *any* per-variant mapping existed; partial state never
        // self-healed.
        const existingForSeller = await tx.sellerProductMapping.findMany({
          where: { sellerId, productId, variantId: { not: null }, deletedAt: null },
          select: { variantId: true },
        });
        const existingVariantIds = new Set(
          existingForSeller.map((m: any) => m.variantId).filter(Boolean) as string[],
        );

        const newMappings: Array<{ id: string; variantId: string; stockQty: number }> = [];

        for (const variant of variants) {
          if (existingVariantIds.has(variant.id)) continue;
          // Stock policy: explicit reset (variant.stock from the
          // product-variant table is treated as 0 for new mappings)
          // unless allowStockLoss=true and caller still wants to
          // multiply onto each variant — which is the audit's
          // documented "Copy to all" option (Option B), kept as
          // an escape hatch but never the default.
          const stockQty = options.allowStockLoss
            ? Number((stale as any).stockQty ?? variant.stock ?? 0)
            : 0;
          const created = await tx.sellerProductMapping.create({
            data: {
              sellerId,
              productId,
              variantId: variant.id,
              stockQty,
              settlementPrice: variant.price
                ? Number(variant.price)
                : basePrice ?? undefined,
              pickupAddress: (stale as any).pickupAddress ?? null,
              pickupPincode: pincode,
              latitude: resolvedLat,
              longitude: resolvedLon,
              // Audit Gap #16 — `??` preserves a legitimate 0
              // (same-day dispatch). The pre-Phase-60 `||` fell
              // through to 2 even when the seller had explicitly
              // set 0.
              dispatchSla: (stale as any).dispatchSla ?? 2,
              // Audit Gaps #4 + #5 — every new variant row goes
              // through the standard admin gate. The stale row's
              // approval is per-product; the new variants are
              // semantically different SKUs and need their own
              // review.
              approvalStatus: 'PENDING_APPROVAL',
              isActive: false,
              // Audit Gap #12 — migration trail.
              migratedFromMappingId: stale.id,
              migratedAt: new Date(),
            },
          });
          newMappings.push({
            id: created.id,
            variantId: variant.id,
            stockQty,
          });
        }

        // Audit Gap #2 — SOFT-delete the stale row. Hard-delete
        // would cascade to StockMovement (ledger), StockReservation,
        // and LowStockAlert FK refs; soft-delete keeps every
        // historical query honest. Routing/storefront already
        // filter isActive=true so the soft-deleted row is
        // functionally inert.
        await tx.sellerProductMapping.update({
          where: { id: stale.id },
          data: {
            deletedAt: new Date(),
            isActive: false,
          },
        });

        return { newMappings };
      });

      if (!result) continue;

      out.push({
        staleMappingId: stale.id,
        sellerId,
        staleStockQty: stale.stockQty ?? 0,
        staleDispatchSla: stale.dispatchSla ?? 2,
        newMappings: result.newMappings,
      });
    }

    return out;
  }

  async findProductForMapping(productId: string): Promise<any | null> {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: { where: { isDeleted: false }, select: { id: true } },
      },
    });
  }

  async findVariantForMapping(variantId: string, productId: string): Promise<any | null> {
    return this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, isDeleted: false },
    });
  }

  async findPostOfficeByPincode(pincode: string): Promise<any | null> {
    return this.prisma.postOffice.findFirst({
      where: { pincode, latitude: { not: null } },
      select: { latitude: true, longitude: true },
    });
  }
}
