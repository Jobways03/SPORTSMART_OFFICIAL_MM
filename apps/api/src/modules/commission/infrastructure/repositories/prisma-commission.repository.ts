import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';
import { OrdersPublicFacade } from '../../../orders/application/facades/orders-public.facade';
import {
  CommissionRepository,
  CommissionRecordFilter,
  CommissionSettingsData,
  CommissionSummary,
  CreateCommissionRecordData,
  DeliveredSubOrder,
  SellerProductMapping,
} from '../../domain/repositories/commission.repository.interface';

@Injectable()
export class PrismaCommissionRepository implements CommissionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersFacade: OrdersPublicFacade,
    // Phase 7 (PR 7.7) — paise-sibling dual-write for the
    // commissionSetting create + upsert paths. Settings have three
    // money fields (commissionValue, secondCommissionValue,
    // maxCommissionAmount).
    private readonly moneyDualWrite: MoneyDualWriteHelper,
  ) {}

  /* ── Processing ───────────────────────────────────────────────────── */

  async findDeliveredSubOrders(limit?: number): Promise<DeliveredSubOrder[]> {
    // Uses OrdersPublicFacade instead of direct subOrder query (module boundary)
    const subOrders =
      await this.ordersFacade.findDeliveredSubOrdersPastReturnWindow(limit);

    // Filter to seller-only orders (franchise orders processed separately)
    return subOrders.filter(
      (so: any) => so.fulfillmentNodeType === 'SELLER' && so.sellerId,
    ) as unknown as DeliveredSubOrder[];
  }

  async getSellerProductMapping(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): Promise<SellerProductMapping | null> {
    return this.prisma.sellerProductMapping.findFirst({
      where: {
        sellerId,
        productId,
        ...(variantId ? { variantId } : { variantId: null }),
        isActive: true,
        approvalStatus: 'APPROVED',
      },
      select: { settlementPrice: true },
    });
  }

  /**
   * Phase 135 — batch-prefetch settlement mappings for a whole tick's items
   * in ONE query, keyed by `sellerId:productId:variantId`. Eliminates the
   * per-item N+1 (200 sub-orders × N items used to be 1 round-trip each).
   * variantId null is normalised to '' in the key.
   */
  async getSellerProductMappingsBatch(
    keys: { sellerId: string; productId: string; variantId: string | null }[],
  ): Promise<Map<string, SellerProductMapping>> {
    const result = new Map<string, SellerProductMapping>();
    if (keys.length === 0) return result;
    // De-dupe the OR list so repeated (seller,product,variant) tuples across
    // sub-orders don't bloat the query.
    const seen = new Set<string>();
    const or: Prisma.SellerProductMappingWhereInput[] = [];
    for (const k of keys) {
      const id = `${k.sellerId}:${k.productId}:${k.variantId ?? ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      or.push({
        sellerId: k.sellerId,
        productId: k.productId,
        ...(k.variantId ? { variantId: k.variantId } : { variantId: null }),
      });
    }
    const rows = await this.prisma.sellerProductMapping.findMany({
      where: { OR: or, isActive: true, approvalStatus: 'APPROVED' },
      select: {
        sellerId: true,
        productId: true,
        variantId: true,
        settlementPrice: true,
      },
    });
    for (const r of rows) {
      result.set(
        `${r.sellerId}:${r.productId}:${r.variantId ?? ''}`,
        { settlementPrice: r.settlementPrice } as SellerProductMapping,
      );
    }
    return result;
  }

  /**
   * Phase 135 — DLQ. Record a sub-order whose commission computation threw,
   * so the cron tick can skip it (instead of wedging) and ops can review.
   * Idempotent on subOrderId: a re-failure bumps `attempts`. Best-effort —
   * a DLQ write failure must never mask the original processing error.
   */
  async recordCommissionFailure(
    subOrderId: string,
    trigger: string,
    error: string,
  ): Promise<void> {
    const msg = error.slice(0, 1000);
    await this.prisma.commissionFailure.upsert({
      where: { subOrderId },
      create: { subOrderId, trigger, error: msg },
      update: { attempts: { increment: 1 }, error: msg, resolvedAt: null },
    });
  }

  /**
   * Atomically creates commission records for every item in a sub-order
   * and marks the sub-order as processed — all inside a single transaction.
   */
  async processSubOrderCommission(
    subOrderId: string,
    records: CreateCommissionRecordData[],
    // Phase 135 — optional transactional hook, invoked INSIDE the txn only
    // when the atomic-claim actually wins. The service uses it to publish
    // `commission.locked` through the transactional outbox (eventBus.publish
    // with `{ tx }`), so the event commits atomically with the records — and,
    // crucially, is NOT emitted when the claim is a no-op (already processed
    // or a live return appeared), which the old post-txn publish did wrongly.
    onClaimed?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Atomic-claim: only mark this sub-order processed if it isn't already.
      // If another job instance beat us to it, the updateMany returns 0 and
      // we abort the transaction without writing duplicate commission rows.
      // This is the key idempotency guard for the lock-expired-mid-batch
      // race: lock TTL is 30s, this batch may take longer, a second instance
      // can pick up the same sub-order — but only one will win the claim.
      const claim = await tx.subOrder.updateMany({
        where: {
          id: subOrderId,
          commissionProcessed: false,
          // Phase 135 — re-validate the no-live-return predicate INSIDE the
          // transaction. The scan (findDeliveredSubOrders) filtered this at
          // SELECT time, but a return created between the SELECT and this
          // claim would otherwise be missed and commission locked anyway.
          // Folding it into the atomic-claim WHERE means a freshly-created
          // live return makes this match 0 rows → no commission is locked.
          NOT: {
            returns: {
              some: {
                status: { notIn: ['REJECTED', 'QC_REJECTED', 'CANCELLED'] },
              },
            },
          },
          // Phase 136 — re-validate the no-active-dispute predicate INSIDE the
          // transaction too (a dispute opened between the scan and this claim
          // would otherwise be missed and commission locked while it's open).
          // Covers BOTH the cron and immediate-trigger paths.
          disputes: {
            none: {
              status: {
                notIn: [
                  'RESOLVED_BUYER',
                  'RESOLVED_SELLER',
                  'RESOLVED_SPLIT',
                  'CLOSED',
                ],
              },
            },
          },
        },
        // Phase 75 (2026-05-22) — Phase 73 reject audit Gap #10.
        // PROCESSED alongside the existing flag so analytics can
        // distinguish "settlement actually ran" from "skipped"
        // (NOT_APPLICABLE, set by reject path).
        data: { commissionProcessed: true, commissionDecision: 'PROCESSED' as any },
      });
      if (claim.count === 0) {
        // Already processed by another instance, OR a live return appeared
        // after the scan — silent no-op either way.
        return false;
      }

      // Use createMany with skipDuplicates so a partially-written batch
      // (e.g. recovered from a crash) doesn't crash the whole transaction.
      // The orderItemId column is @unique so duplicates are ignored cleanly.
      if (records.length > 0) {
        // Phase 135 — dual-write the *InPaise sibling columns (ADR-007 source
        // of truth). No-op when MONEY_DUAL_WRITE_ENABLED=false; when on, the
        // money fields arrive as exact decimal-strings so toPaise() converts
        // them losslessly (it throws on fractional Numbers).
        await tx.commissionRecord.createMany({
          data: this.moneyDualWrite.applyPaiseMany(
            'commissionRecord',
            records as any,
          ) as any,
          skipDuplicates: true,
        });
      }

      // Phase 135 — transactional outbox publish (claim-won path only).
      if (onClaimed) await onClaimed(tx);
      return true;
    });
  }

  /* ── Commission records (admin) ───────────────────────────────────── */

  async getCommissionRecords(
    filter: CommissionRecordFilter,
    page: number,
    limit: number,
  ): Promise<{ records: any[]; total: number }> {
    const where = this.buildWhere(filter);
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.commissionRecord.count({ where }),
    ]);

    // Per-order NET PAYABLE — same figure the seller sees + the admin settlement
    // "net pay": settlement − commission GST (18% of margin, SAC 9985) − §52 TCS
    // (1% of taxable; gross/118 for the standard 18% slab). Authoritative net
    // (incl. TDS) lives on the settlement.
    const withNet = (records as any[]).map((r) => {
      const settlePaise =
        Number(r.totalSettlementAmountInPaise ?? 0) ||
        Math.round(Number(r.totalSettlementAmount ?? 0) * 100);
      const marginPaise =
        Number(r.platformMarginInPaise ?? 0) ||
        Math.round(Number(r.platformMargin ?? 0) * 100);
      const grossPaise =
        Number(r.totalPlatformAmountInPaise ?? 0) ||
        Math.round(Number(r.totalPlatformAmount ?? 0) * 100);
      const netPaise = Math.max(
        0,
        settlePaise - Math.round(marginPaise * 0.18) - Math.round(grossPaise / 118),
      );
      return { ...r, netPayableInPaise: String(netPaise) };
    });

    return { records: withNet, total };
  }

  /* ── Commission records (seller) ──────────────────────────────────── */

  async getSellerCommissionRecords(
    sellerId: string,
    filter: Omit<CommissionRecordFilter, 'sellerId' | 'commissionType'>,
    page: number,
    limit: number,
  ): Promise<{ records: any[]; total: number }> {
    const where = this.buildWhere({ ...filter, sellerId });
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      this.prisma.commissionRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.commissionRecord.count({ where }),
    ]);

    return { records, total };
  }

  /* ── Admin summary ────────────────────────────────────────────────── */

  async getAdminCommissionSummary(
    allowedSellerTypes?: ('D2C' | 'RETAIL')[] | null,
  ): Promise<CommissionSummary> {
    // Isolation fix (2026-06-16) — scope every aggregate to the admin's seller
    // type(s) via the owning-seller relation. null/empty = unrestricted totals.
    const scope =
      allowedSellerTypes && allowedSellerTypes.length > 0
        ? { seller: { sellerType: { in: allowedSellerTypes } } }
        : {};
    const [totalRecords, platformAgg, settlementAgg, marginAgg, pendingCount, settledCount] =
      await Promise.all([
        this.prisma.commissionRecord.count({ where: { ...scope } }),
        this.prisma.commissionRecord.aggregate({
          where: { ...scope },
          _sum: { totalPlatformAmount: true },
        }),
        this.prisma.commissionRecord.aggregate({
          where: { ...scope },
          _sum: { totalSettlementAmount: true },
        }),
        this.prisma.commissionRecord.aggregate({
          where: { ...scope },
          _sum: { platformMargin: true },
        }),
        this.prisma.commissionRecord.count({ where: { ...scope, status: 'PENDING' } }),
        this.prisma.commissionRecord.count({ where: { ...scope, status: 'SETTLED' } }),
      ]);

    return {
      totalRecords,
      pendingCount,
      settledCount,
      totalPlatformRevenue: Number(platformAgg._sum.totalPlatformAmount || 0),
      totalSellerPayouts: Number(settlementAgg._sum.totalSettlementAmount || 0),
      totalPlatformMargin: Number(marginAgg._sum.platformMargin || 0),
    };
  }

  /* ── Settings ─────────────────────────────────────────────────────── */

  async getCommissionSettings(): Promise<any> {
    let settings = await this.prisma.commissionSetting.findUnique({
      where: { id: 'global' },
    });

    if (!settings) {
      settings = await this.prisma.commissionSetting.create({
        data: this.moneyDualWrite.applyPaise('commissionSetting', {
          id: 'global',
        }),
      });
    }

    return settings;
  }

  async upsertCommissionSettings(data: CommissionSettingsData): Promise<any> {
    // Upsert has TWO data blocks (update + create) — wrap both through
    // the helper so paise siblings stay in lockstep on either branch.
    // The values are JS Numbers from the admin-input boundary; convert
    // via .toFixed(2) defensively for exact toPaise parsing.
    const commissionValueDec = Number(data.commissionValue).toFixed(2);
    const secondCommissionValueDec = Number(
      data.secondCommissionValue ?? 0,
    ).toFixed(2);
    const maxCommissionAmountDec =
      data.maxCommissionAmount == null
        ? null
        : Number(data.maxCommissionAmount).toFixed(2);
    return this.prisma.commissionSetting.upsert({
      where: { id: 'global' },
      update: this.moneyDualWrite.applyPaise('commissionSetting', {
        commissionType: data.commissionType as any,
        commissionValue: commissionValueDec,
        secondCommissionValue: secondCommissionValueDec,
        fixedCommissionType: data.fixedCommissionType ?? 'Product',
        enableMaxCommission: data.enableMaxCommission ?? false,
        maxCommissionAmount: maxCommissionAmountDec,
      }),
      create: this.moneyDualWrite.applyPaise('commissionSetting', {
        id: 'global',
        commissionType: data.commissionType as any,
        commissionValue: commissionValueDec,
        secondCommissionValue: secondCommissionValueDec,
        fixedCommissionType: data.fixedCommissionType ?? 'Product',
        enableMaxCommission: data.enableMaxCommission ?? false,
        maxCommissionAmount: maxCommissionAmountDec,
      }),
    });
  }

  /* ── Existence check ──────────────────────────────────────────────── */

  async commissionExistsForItem(orderItemId: string): Promise<boolean> {
    const record = await this.prisma.commissionRecord.findUnique({
      where: { orderItemId },
    });
    return !!record;
  }

  /* ── Private helpers ──────────────────────────────────────────────── */

  private buildWhere(filter: CommissionRecordFilter & { sellerId?: string }): any {
    const where: any = {};

    if (filter.sellerId) {
      where.sellerId = filter.sellerId;
    }

    // Isolation fix (2026-06-16) — restrict to the admin's seller-type scope
    // via the owning-seller relation. Absent/null = unrestricted (super /
    // franchise admin); ['D2C'] / ['RETAIL'] hides the other type's rows.
    if (filter.allowedSellerTypes && filter.allowedSellerTypes.length > 0) {
      where.seller = { sellerType: { in: filter.allowedSellerTypes } };
    }

    if (filter.commissionType) {
      where.commissionType = filter.commissionType;
    }

    if (
      filter.status &&
      ['PENDING', 'ON_HOLD', 'SETTLED', 'REFUNDED'].includes(filter.status)
    ) {
      where.status = filter.status;
    } else {
      // Hide reversed/refunded AND held commissions from the default list
      // — the money has been given back to the customer (REFUNDED) or is
      // in limbo pending a return decision (ON_HOLD), so showing them
      // mixed in with live PENDING/SETTLED records confuses admins.
      // Users can still opt in by picking the explicit status filter.
      where.status = { notIn: ['REFUNDED', 'ON_HOLD'] };
    }

    if (filter.dateFrom || filter.dateTo) {
      where.createdAt = {};
      if (filter.dateFrom) where.createdAt.gte = new Date(filter.dateFrom);
      if (filter.dateTo) {
        const to = new Date(filter.dateTo);
        to.setHours(23, 59, 59, 999);
        where.createdAt.lte = to;
      }
    }

    if (filter.search) {
      where.OR = [
        { orderNumber: { contains: filter.search, mode: 'insensitive' } },
        { productTitle: { contains: filter.search, mode: 'insensitive' } },
        { sellerName: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}
