import { Prisma } from '@prisma/client';

// Phase 79 (2026-05-22) — history audit Gap #7. Typed contract for the
// reassignment-history reader so the UI <-> repo boundary has a
// compile-time shape check. The eventType union mirrors the Prisma
// enum (kept inline to avoid pulling Prisma types into the controller).
export type ReassignmentEventType =
  | 'ADMIN_MANUAL_OVERRIDE'
  | 'AUTO_AFTER_SELLER_REJECT'
  | 'AUTO_AFTER_FRANCHISE_REJECT'
  | 'AUTO_AFTER_EXCEPTION_REMEDIATE';

export type ReassignmentNodeType = 'SELLER' | 'FRANCHISE';

export interface ReassignmentLogEntity {
  id: string;
  subOrderId: string;
  masterOrderId: string;
  fromNodeType: ReassignmentNodeType;
  fromNodeId: string | null;
  toNodeType: ReassignmentNodeType;
  toNodeId: string | null;
  fromSellerId: string;
  toSellerId: string | null;
  reason: string;
  failureReason: string | null;
  successful: boolean;
  newSubOrderId: string | null;
  reassignedBy: string | null;
  reassignmentSequence: number;
  eventType: ReassignmentEventType;
  createdAt: Date;
}

export interface ReassignmentLogQueryOptions {
  /** Cursor — return rows older than this createdAt. */
  before?: Date;
  /** ISO datetime range filter (applied to createdAt). */
  from?: Date;
  to?: Date;
  /** Filter by event type. */
  eventType?: ReassignmentEventType;
  /** Page size. Repo clamps to a sane maximum. */
  limit?: number;
}

export interface OrderRepository {
  // ── Master Order queries ───────────────────────────────────────────────

  findMasterOrders(
    where: Prisma.MasterOrderWhereInput,
    skip: number,
    take: number,
  ): Promise<any[]>;

  countMasterOrders(where: Prisma.MasterOrderWhereInput): Promise<number>;

  findMasterOrderById(id: string): Promise<any | null>;

  findMasterOrderByIdWithDetails(id: string): Promise<any | null>;

  findMasterOrderByCustomer(
    orderNumber: string,
    customerId: string,
  ): Promise<any | null>;

  findCustomerOrders(
    customerId: string,
    skip: number,
    take: number,
    // Phase 197 (My-Orders audit #7) — optional server-side bucket.
    bucket?: 'all' | 'active' | 'delivered' | 'cancelled',
  ): Promise<any[]>;

  countCustomerOrders(
    customerId: string,
    bucket?: 'all' | 'active' | 'delivered' | 'cancelled',
  ): Promise<number>;

  // Phase 197 (My-Orders audit #7) — per-bucket counts for tab badges.
  countCustomerOrdersByBucket(customerId: string): Promise<{
    all: number;
    active: number;
    delivered: number;
    cancelled: number;
  }>;

  updateMasterOrder(id: string, data: any): Promise<any>;

  // ── Sub-Order queries ──────────────────────────────────────────────────

  findSubOrderById(id: string): Promise<any | null>;

  findSubOrderByIdWithItems(id: string): Promise<any | null>;

  findSubOrderByIdWithMasterOrder(id: string): Promise<any | null>;

  /** Look up a sub-order by its courier tracking number. Used by the
   *  Shiprocket webhook to find the right sub-order to mark delivered. */
  findSubOrderByTrackingNumber(trackingNumber: string): Promise<any | null>;

  findSubOrderForSeller(id: string, sellerId: string): Promise<any | null>;

  findSubOrderForSellerBasic(
    id: string,
    sellerId: string,
  ): Promise<any | null>;

  findSubOrderForSellerWithDetails(
    id: string,
    sellerId: string,
  ): Promise<any | null>;

  findSellerSubOrders(
    where: Prisma.SubOrderWhereInput,
    skip: number,
    take: number,
  ): Promise<any[]>;

  countSellerSubOrders(where: Prisma.SubOrderWhereInput): Promise<number>;

  findSubOrdersByMasterOrder(
    masterOrderId: string,
  ): Promise<any[]>;

  updateSubOrder(id: string, data: any): Promise<any>;

  createSubOrder(data: any): Promise<any>;

  // ── Reassignment logs ──────────────────────────────────────────────────

  /**
   * Phase 79 (2026-05-22) — history audit Gap #7/#10/#15/#20.
   * Typed return + cursor pagination + optional time-range filter.
   * Pagination uses (createdAt, id) — a millisecond-equal row gets a
   * deterministic tiebreak via id ASC so a paginating client never
   * skips or repeats a row across pages.
   */
  findReassignmentLogs(
    masterOrderId: string,
    opts?: ReassignmentLogQueryOptions,
  ): Promise<ReassignmentLogEntity[]>;

  countReassignmentLogs(
    masterOrderId: string,
    opts?: Pick<ReassignmentLogQueryOptions, 'from' | 'to' | 'eventType'>,
  ): Promise<number>;

  createReassignmentLog(data: any): Promise<any>;

  // ── Stock & reservation helpers ────────────────────────────────────────

  findSeller(id: string): Promise<any | null>;

  findSellerProductMapping(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): Promise<any | null>;

  findSellerProductMappingIds(
    productId: string,
    variantId: string | null,
    sellerIds: string[],
  ): Promise<string[]>;

  findStockReservations(
    orderId: string,
    sellerId: string,
  ): Promise<any[]>;

  releaseReservation(reservationId: string): Promise<void>;

  restoreStockFromConfirmedReservation(
    reservationId: string,
    mappingId: string,
    quantity: number,
  ): Promise<void>;

  releaseReservedStock(
    reservationId: string,
    mappingId: string,
    quantity: number,
  ): Promise<void>;

  createStockReservation(data: any): Promise<any>;

  incrementMappingReservedQty(mappingId: string, quantity: number): Promise<void>;

  // ── Product stock restore (for order rejection) ────────────────────────

  incrementVariantStock(variantId: string, quantity: number): Promise<void>;

  incrementProductStock(productId: string, quantity: number): Promise<void>;

  // ── Allocation log ─────────────────────────────────────────────────────

  createAllocationLog(data: any): Promise<void>;

  // ── Transaction support ────────────────────────────────────────────────

  // Phase 81 (2026-05-22) — generic return type so callers can
  // surface the cb's value (e.g. an updated row) without an extra
  // outer-scope ref. Backwards-compatible: existing void callers
  // resolve as `undefined`.
  executeTransaction<T = void>(fn: (tx: any) => Promise<T>): Promise<T>;
}

export const ORDER_REPOSITORY = Symbol('OrderRepository');
