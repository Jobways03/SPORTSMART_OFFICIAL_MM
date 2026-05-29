export const SELLER_MAPPING_REPOSITORY = Symbol('SellerMappingRepository');

export interface SellerMappingListParams {
  page: number;
  limit: number;
  sellerId?: string;
  productId?: string;
  isActive?: boolean;
  approvalStatus?: string;
  search?: string;
}

export interface ISellerMappingRepository {
  // ── Admin queries ──
  findByProduct(productId: string): Promise<any[]>;
  findAllPaginated(params: SellerMappingListParams): Promise<{ mappings: any[]; total: number }>;
  findPendingPaginated(page: number, limit: number): Promise<{ mappings: any[]; total: number }>;
  findById(mappingId: string): Promise<any | null>;
  update(mappingId: string, data: any): Promise<any>;
  /**
   * Phase 56 (2026-05-22) — lifecycle transitions stamp who + when.
   * Phase 57 (2026-05-22) — status-conditional. Each returns the
   * updated row on success, or `null` if the precondition check
   * (current approvalStatus) failed. Callers translate `null` to
   * a 400 with the actual current status.
   */
  approve(mappingId: string, adminId?: string): Promise<any | null>;
  reject(mappingId: string, adminId: string, reason: string): Promise<any | null>;
  stop(mappingId: string, adminId?: string, reason?: string): Promise<any | null>;
  /**
   * Phase 57 (2026-05-22) — explicit STOPPED → APPROVED transition
   * with a required reason. Separating this from `approve` makes
   * the audit log distinguish "fresh approval" from "lifted stop".
   * Returns null if the current status isn't STOPPED.
   */
  reapprove(mappingId: string, adminId: string, reason: string): Promise<any | null>;
  /**
   * Phase 57 — bulk approve for the pending queue. Atomic per row:
   * each row's status-conditional update runs inside a single
   * $transaction. Returns a per-row outcome so the caller can
   * report partial success.
   */
  bulkApprove(
    mappingIds: string[],
    adminId: string,
  ): Promise<Array<{ mappingId: string; ok: boolean; reason?: string }>>;
  /**
   * Phase 58 (2026-05-22) — bulk stop for compliance / quality
   * sweeps (audit Gap #17). Same per-row atomicity as bulkApprove
   * but each row only transitions from APPROVED. Rows in any other
   * status surface as `ok:false` with the current status so the
   * caller can show the admin what didn't move.
   */
  bulkStop(
    mappingIds: string[],
    adminId: string,
    reason: string,
  ): Promise<Array<{ mappingId: string; ok: boolean; reason?: string }>>;
  /**
   * Phase 58 (2026-05-22) — releases every active (RESERVED) stock
   * reservation pointing at this mapping (audit Gap #8). Each row
   * is flipped status RESERVED → RELEASED inside its own
   * transaction (matching the expiry-sweep CAS pattern) and the
   * mapping's reservedQty is decremented atomically. Returns a
   * per-reservation snapshot so the caller can write ledger entries
   * and emit cart-update events for each released reservation.
   *
   * Used by the admin /stop endpoint so customers holding reserved
   * stock on a now-stopped mapping aren't left in checkout limbo.
   */
  releaseActiveReservationsForMapping(
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
  }>>;
  /**
   * Phase 56 — seller-driven resubmit. Clears the rejection state on
   * a previously-REJECTED mapping, sending it back to
   * PENDING_APPROVAL so the admin queue picks it up again. Caller
   * must verify ownership upstream.
   */
  resubmit(mappingId: string): Promise<any>;

  // ── Seller queries ──
  findBySeller(sellerId: string): Promise<any[]>;
  findDistinctProductIdsBySeller(sellerId: string): Promise<string[]>;
  findBySellerAndProduct(sellerId: string, productId: string, variantId?: string | null): Promise<any | null>;
  findBySellerForProduct(sellerId: string, productId: string): Promise<any[]>;
  create(data: any): Promise<any>;
  // Phase 42 (2026-05-21) — optional tx so variant-generation can share
  // the outer transaction with the mapping inserts.
  createMany(data: any[], tx?: import('@prisma/client').Prisma.TransactionClient): Promise<any[]>;
  delete(mappingId: string): Promise<void>;
  /**
   * Phase 1 (PR 1.10) — bulk stock-import floor.
   *
   * Enforces `stockQty >= reservedQty` per row inside a single
   * transaction. Throws `StockBelowReservedError` (from
   * `../errors/stock-below-reserved.error`) if any row would push
   * stock below its reserved count — the whole transaction rolls
   * back so the seller's catalog never lands in a half-imported state.
   *
   * On success, `violations` is `[]` and `updated` lists the touched
   * mappings (id + new stockQty + variant/product for downstream
   * variant-stock sync).
   */
  bulkUpdateStock(
    updates: Array<{ mappingId: string; stockQty: number }>,
  ): Promise<{
    updated: Array<{
      id: string;
      stockQty: number;
      variantId: string | null;
      productId: string;
    }>;
    violations: Array<{
      mappingId: string;
      requestedStock: number;
      reservedQty: number;
    }>;
  }>;
  /**
   * Phase 51 (2026-05-21) — bulk update that returns BEFORE + AFTER
   * stockQty + reservedQty per row so the controller can write a
   * MANUAL_ADJUST ledger entry for each. Optional `lowStockThreshold`
   * per row is applied alongside stockQty in the same transaction.
   */
  bulkUpdateStockWithBefore(
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
  }>;
  /**
   * Phase 51 — single-query ownership verification. Replaces the
   * pre-Phase-51 N findById loop (one round-trip per mapping)
   * with a single findMany filtered by id IN (...) AND sellerId.
   */
  findManyByIdsForSeller(
    mappingIds: string[],
    sellerId: string,
  ): Promise<Array<{ id: string; sellerId: string; productId: string; variantId: string | null; stockQty: number; reservedQty: number; deletedAt: Date | null }>>;
  /** Phase 51 — soft-delete by stamping deletedAt. */
  softDelete(mappingId: string): Promise<void>;
  /**
   * Phase 51 polish (2026-05-21) — row-locked update. Opens a
   * transaction, runs SELECT … FOR UPDATE on the target row, then
   * applies updateData. Re-checks ownership + deletedAt + reservedQty
   * floor INSIDE the lock so concurrent reservations cannot sneak
   * between the floor read and the stockQty write.
   *
   * Returns before/after stockQty + reservedQty so the controller can
   * write a MANUAL_ADJUST ledger row for the transition.
   *
   * Throws:
   *   - 'NOT_FOUND' — row missing or soft-deleted
   *   - 'FORBIDDEN' — sellerId mismatch
   *   - 'FLOOR_VIOLATION' — newStockQty < lockedRow.reservedQty
   */
  updateWithRowLock(
    mappingId: string,
    sellerId: string,
    updateData: Record<string, unknown>,
  ): Promise<{
    row: any;
    before: { stockQty: number; reservedQty: number };
    after: { stockQty: number; reservedQty: number };
  }>;
  /**
   * Phase 51 polish — read the StockMovement ledger for a single
   * mapping. Used by the seller-facing history endpoint. Ownership
   * verification is the controller's job (a seller could pass any
   * mappingId here without it).
   */
  listStockMovementsForMapping(
    mappingId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<Array<any>>;
  deleteBySellerProductVariantNull(sellerId: string, productId: string): Promise<void>;

  // ── My products (seller) ──
  findMyProductsPaginated(sellerId: string, page: number, limit: number, search?: string): Promise<{ products: any[]; total: number }>;

  // ── Service area ──
  findServiceAreasPaginated(sellerId: string, page: number, limit: number, search?: string): Promise<{ serviceAreas: any[]; total: number }>;
  addServiceAreas(sellerId: string, pincodes: string[]): Promise<number>;
  removeServiceArea(sellerId: string, pincode: string): Promise<void>;
  removeServiceAreas(sellerId: string, pincodes: string[]): Promise<number>;
  findServiceArea(sellerId: string, pincode: string): Promise<any | null>;
  /** Sprint 4 Story 3.1 — flip the COD-eligible flag on a single
   *  (seller, pincode) pair. Idempotent. Caller is responsible for
   *  verifying the seller owns the pincode (findServiceArea returns
   *  null if not). */
  setCodEligibility(sellerId: string, pincode: string, eligible: boolean): Promise<void>;

  // ── Auto-repair ──
  autoRepairMissingMappingsForSeller(sellerId: string): Promise<number>;
  /**
   * Phase 60 (2026-05-22) — fast pre-check for the admin read
   * hot path (audit Gap #6). Returns the count of stale
   * product-level mappings (variantId IS NULL AND deletedAt IS
   * NULL) for the given product. The repair logic only runs
   * when this is > 0; for the steady state (no stale mappings)
   * the read path skips the heavy fan-out entirely.
   */
  countStaleMappingsForProduct(productId: string): Promise<number>;
  /**
   * Phase 60 (2026-05-22) — safe stale-mapping fan-out (audit
   * Gaps #1-5 + #8 + #11 + #12 + #15 + #16).
   *
   * Replaces the pre-Phase-60 hard-delete + stock-loss + approval-
   * bypass path with a transactional migration:
   *   - Wrapped in $transaction (audit Gap #3).
   *   - Stale row is SOFT-deleted (deletedAt + isActive=false),
   *     never hard-deleted — ledger + reservations + LowStockAlert
   *     FK refs survive (audit Gap #2).
   *   - New per-variant mappings default to PENDING_APPROVAL +
   *     isActive=false REGARDLESS of stale's status (audit Gaps
   *     #4 + #5). Admin must approve the new variant rows
   *     through the standard flow.
   *   - When stale.stockQty > 0 and caller didn't pass
   *     allowStockLoss=true, the call is REJECTED with a typed
   *     error so the silent-stock-loss path can't happen
   *     accidentally (audit Gap #1 — Option D from the audit's
   *     recommendation).
   *   - Per-variant lookup: only creates mappings for variants
   *     that don't already have one — partial state from a prior
   *     crashed repair is now self-healing rather than skipped
   *     (audit Gap #11).
   *   - Stamps migratedFromMappingId + migratedAt on each new
   *     row (audit Gap #12).
   *   - Re-resolves lat/lng from PostOffice when pickupPincode
   *     is present (audit Gap #15).
   *   - dispatchSla uses ?? not || so a legitimate 0 (same-day
   *     dispatch) is preserved (audit Gap #16).
   *
   * Returns a per-stale-mapping outcome so the caller can write
   * a StockMovement WRITE_OFF on the stale + INITIAL on every
   * new mapping (audit Gap #8) outside the transaction.
   */
  repairStaleMappingsForProduct(
    productId: string,
    adminId: string,
    options?: { allowStockLoss?: boolean },
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
  }>>;

  // ── Product validation for mapping ──
  findProductForMapping(productId: string): Promise<any | null>;
  findVariantForMapping(variantId: string, productId: string): Promise<any | null>;
  findPostOfficeByPincode(pincode: string): Promise<any | null>;
}
