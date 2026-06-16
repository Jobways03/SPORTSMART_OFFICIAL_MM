/* ── Commission Repository Interface ─────────────────────────────────
 *  All database operations the commission module needs, expressed as
 *  a technology-agnostic contract.
 * ──────────────────────────────────────────────────────────────────── */

import type { Prisma } from '@prisma/client';

// ── DTOs / return types ────────────────────────────────────────────

export interface SubOrderItem {
  id: string;
  productId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  unitPrice: any;
  totalPrice: any;
  quantity: number;
}

export interface DeliveredSubOrder {
  id: string;
  sellerId: string;
  masterOrderId: string;
  items: SubOrderItem[];
  masterOrder: { orderNumber: string; paymentStatus: string };
  seller: { id: string; sellerShopName: string } | null;
}

export interface SellerProductMapping {
  settlementPrice: any;
}

export interface CreateCommissionRecordData {
  orderItemId: string;
  subOrderId: string;
  masterOrderId: string;
  sellerId: string;
  productId: string;
  productTitle: string;
  variantTitle: string | null;
  orderNumber: string;
  sellerName: string;
  // Phase 135 — money fields are exact decimal-STRINGS (Prisma.Decimal
  // `.toFixed(2)`), not JS Numbers. Prisma's Decimal columns accept strings
  // losslessly, and the money-dual-write helper's toPaise() parses strings
  // exactly (it THROWS on a fractional Number). `number` is kept in the union
  // only for whole-rupee/legacy callers. See commission-processor.service.ts.
  platformPrice: number | string;
  settlementPrice: number | string;
  quantity: number;
  totalPlatformAmount: number | string;
  totalSettlementAmount: number | string;
  platformMargin: number | string;
  status: string;
  unitPrice: number | string;
  totalPrice: number | string;
  commissionType: string;
  commissionRate: string;
  unitCommission: number | string;
  totalCommission: number | string;
  adminEarning: number | string;
  productEarning: number | string;
  // Phase 135 — processing provenance + numeric rate (analytics).
  processedAt?: Date;
  processedBy?: string;
  commissionRateBps?: number;
  // Phase 136 — stable settlement date (sub-order returnWindowEndsAt, or now
  // for the early/immediate path). Settlement filters by this, not createdAt.
  settlableAt?: Date;
}

export interface CommissionRecordFilter {
  sellerId?: string;
  commissionType?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  // Phase 140 — export-only drill-down filters.
  subOrderId?: string;
  productId?: string;
  settlementStatus?: string;
  adjustedOnly?: boolean;
  reversedOnly?: boolean;
  // Isolation fix (2026-06-16) — the admin's seller-type scope. `null`/absent =
  // unrestricted (SUPER_ADMIN, FRANCHISE_ADMIN); a list (e.g. ['D2C']) limits
  // the result to records whose owning seller is of that type, so a D2C_ADMIN
  // never sees RETAIL commission rows (and vice versa). Applied via the
  // CommissionRecord.seller relation in buildWhere.
  allowedSellerTypes?: ('D2C' | 'RETAIL')[] | null;
}

export interface CommissionSettingsData {
  commissionType: string;
  commissionValue: number;
  secondCommissionValue?: number;
  fixedCommissionType?: string;
  enableMaxCommission?: boolean;
  maxCommissionAmount?: number | null;
}

export interface CommissionSummary {
  totalRecords: number;
  pendingCount: number;
  settledCount: number;
  totalPlatformRevenue: number;
  totalSellerPayouts: number;
  totalPlatformMargin: number;
}

// ── Repository interface ───────────────────────────────────────────

export interface CommissionRepository {
  /* ── Processing ── */
  // Phase 135 — `limit` caps the per-tick batch so a large backlog (e.g. after
  // a processor outage) can't load the entire matching set + nested includes
  // into one query and OOM the worker.
  findDeliveredSubOrders(limit?: number): Promise<DeliveredSubOrder[]>;
  getSellerProductMapping(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): Promise<SellerProductMapping | null>;
  // Phase 135 — one-query prefetch of mappings for a whole tick (kills the
  // per-item N+1). Keyed by `sellerId:productId:variantId` (null variant → '').
  getSellerProductMappingsBatch(
    keys: { sellerId: string; productId: string; variantId: string | null }[],
  ): Promise<Map<string, SellerProductMapping>>;
  processSubOrderCommission(
    subOrderId: string,
    records: CreateCommissionRecordData[],
    // Phase 135 — invoked inside the persist txn iff the atomic-claim wins
    // (used to publish commission.locked through the transactional outbox).
    onClaimed?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<boolean>; // true if this call won the claim + wrote records
  // Phase 135 — DLQ: record a sub-order whose commission computation threw.
  recordCommissionFailure(
    subOrderId: string,
    trigger: string,
    error: string,
  ): Promise<void>;

  /* ── Commission records (admin) ── */
  getCommissionRecords(
    filter: CommissionRecordFilter,
    page: number,
    limit: number,
  ): Promise<{ records: any[]; total: number }>;

  /* ── Commission records (seller) ── */
  getSellerCommissionRecords(
    sellerId: string,
    filter: Omit<CommissionRecordFilter, 'sellerId' | 'commissionType'>,
    page: number,
    limit: number,
  ): Promise<{ records: any[]; total: number }>;

  /* ── Admin summary ── */
  getAdminCommissionSummary(
    allowedSellerTypes?: ('D2C' | 'RETAIL')[] | null,
  ): Promise<CommissionSummary>;

  /* ── Settings ── */
  getCommissionSettings(): Promise<any>;
  upsertCommissionSettings(data: CommissionSettingsData): Promise<any>;

  /* ── Existence check (used inside transaction, exposed for unit testing) ── */
  commissionExistsForItem(orderItemId: string): Promise<boolean>;
}

export const COMMISSION_REPOSITORY = Symbol('CommissionRepository');
