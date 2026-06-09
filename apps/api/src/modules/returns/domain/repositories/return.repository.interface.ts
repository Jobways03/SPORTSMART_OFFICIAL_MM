export const RETURN_REPOSITORY = Symbol('ReturnRepository');

export interface CreateReturnData {
  returnNumber: string;
  subOrderId: string;
  masterOrderId: string;
  customerId: string;
  initiatedBy: string;
  initiatorId: string;
  customerNotes?: string;
  items: Array<{
    orderItemId: string;
    quantity: number;
    reasonCategory: string;
    reasonDetail?: string;
  }>;
  // Phase 93 (2026-05-23) — atomic-creation extensions.
  //   Gap #1  — evidence rows persisted inside the tx.
  //   Gap #2  — seller-response state set during the create.
  //   Gap #8  — node snapshot frozen at creation time.
  evidenceFileUrls?: string[];
  sellerResponseStatus?: 'PENDING' | 'NOT_REQUIRED';
  sellerNotifiedAt?: Date;
  sellerResponseDueAt?: Date;
  sellerIdSnapshot?: string | null;
  franchiseIdSnapshot?: string | null;
  nodeTypeSnapshot?: 'SELLER' | 'FRANCHISE' | null;
  // Phase 95 (2026-05-23) — Phase 93 deferred #26 closure. When set,
  // the repo folds the PENDING→ON_HOLD commission freeze for this
  // sub-order into the same $transaction as the Return.create. Pre-
  // Phase-95 the freeze happened as a separate updateMany after the
  // create returned; a crash between the two left a return without
  // its commission freeze (the next settlement cycle would have
  // mistakenly paid the seller). The repo now writes both atomically.
  commissionFreezeReason?: string;
}

export interface FindByCustomerParams {
  page: number;
  limit: number;
  status?: string;
}

export interface FindAllPaginatedParams {
  page: number;
  limit: number;
  status?: string;
  customerId?: string;
  subOrderId?: string;
  fulfillmentNodeType?: string; // 'SELLER' or 'FRANCHISE'
  fromDate?: Date;
  toDate?: Date;
  search?: string; // search by returnNumber or orderNumber
  // Phase 174 (audit #228) — server-side risk filter for the risk-review
  // dashboard (was client-side bucketing over a truncated 100-row page).
  riskScoreMin?: number;
  riskScoreMax?: number;
  hasRiskScore?: boolean;
  // Phase 38 (admin breadth) — restrict to returns whose sub-order seller is in
  // the admin's seller-type scope (undefined = all).
  allowedSellerTypes?: ('D2C' | 'RETAIL')[];
}

export interface FindReturnsForFulfillmentNodeParams {
  nodeType: 'SELLER' | 'FRANCHISE';
  nodeId: string;
  page: number;
  limit: number;
  status?: string;
}

export interface ReturnRepository {
  // CRUD
  findById(id: string): Promise<any | null>;
  findByIdWithItems(id: string): Promise<any | null>;
  // Phase 199 (2026-06-02) — customer-safe detail read (strict select
  // whitelist; no QC internals / risk / liability / internal actor ids /
  // version). Use this on the customer endpoint instead of
  // findByIdWithItems (which is the admin/QC full read).
  findByIdForCustomer(id: string): Promise<any | null>;
  findByReturnNumber(returnNumber: string): Promise<any | null>;
  findByCustomerId(
    customerId: string,
    params: FindByCustomerParams,
  ): Promise<{ returns: any[]; total: number }>;
  // Phase 199 (2026-06-02) — customer-safe list read (strict select).
  findByCustomerIdSafe(
    customerId: string,
    params: FindByCustomerParams,
  ): Promise<{ returns: any[]; total: number }>;
  findBySubOrderId(subOrderId: string): Promise<any[]>;

  findAllPaginated(
    params: FindAllPaginatedParams,
  ): Promise<{ returns: any[]; total: number }>;

  findReturnsForFulfillmentNode(
    params: FindReturnsForFulfillmentNodeParams,
  ): Promise<{ returns: any[]; total: number }>;

  create(data: CreateReturnData): Promise<any>;

  update(id: string, data: Record<string, unknown>): Promise<any>;

  /**
   * Compare-and-set update used by the FSM transition helper. Adds the
   * `version` field to the WHERE clause; a 0-row update raises P2025
   * which the helper translates into ConflictAppException. Caller's
   * `data` should NOT include `version` — the repo bumps it via Prisma's
   * `{ increment: 1 }`.
   */
  updateWithVersion(
    id: string,
    expectedVersion: number,
    data: Record<string, unknown>,
  ): Promise<any>;

  // Status history
  recordStatusChange(
    returnId: string,
    fromStatus: string | null,
    toStatus: string,
    changedBy: string,
    changedById?: string,
    notes?: string,
  ): Promise<any>;

  // Sequence
  generateNextReturnNumber(): Promise<string>;

  // Eligibility check helpers
  countActiveReturnsForOrderItem(orderItemId: string): Promise<number>;
  getReturnedQuantityForOrderItem(orderItemId: string): Promise<number>;

  // ── QC (Phase R3) ─────────────────────────────────────────────────────
  // Phase 97 (2026-05-23) — extended for per-item linkage + content
  // metadata (Gap #8 / #27).
  addEvidence(data: {
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
  }): Promise<any>;

  updateReturnItemQc(
    itemId: string,
    data: {
      qcOutcome: string;
      qcQuantityApproved: number;
      qcNotes?: string;
      refundAmount?: number;
    },
  ): Promise<any>;

  // ── Refund processing (Phase R4) ──────────────────────────────────────
  recordRefundAttempt(
    returnId: string,
    data: {
      gatewayRefundId?: string;
      success: boolean;
      failureReason?: string;
    },
  ): Promise<any>;

  // Phase 101 — Refund Retry audit Gap #24 closure. incrementRefundAttempts
  // had zero callers; removed.

  // ── Analytics (Phase R6) ──────────────────────────────────────────────
  getAnalyticsSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
    allowedSellerTypes?: ('D2C' | 'RETAIL')[];
  }): Promise<{
    totalReturns: number;
    totalRefundAmount: number;
    byStatus: Record<string, number>;
    byReasonCategory: Record<string, number>;
    averageProcessingDays: number;
    refundedCount: number;
    rejectedCount: number;
    pendingCount: number;
    inProgressCount: number;
    refundSuccessRate: number;
  }>;

  getReturnsByPeriod(params: {
    fromDate: Date;
    toDate: Date;
    groupBy: 'day' | 'week' | 'month';
    allowedSellerTypes?: ('D2C' | 'RETAIL')[];
  }): Promise<
    Array<{
      period: string;
      count: number;
      refundAmount: number;
    }>
  >;

  getTopReturnReasons(
    limit: number,
    fromDate?: Date,
    toDate?: Date,
    allowedSellerTypes?: ('D2C' | 'RETAIL')[],
  ): Promise<
    Array<{
      reasonCategory: string;
      count: number;
      totalQuantity: number;
    }>
  >;

  getReturnsByCustomer(customerId: string, allowedSellerTypes?: ('D2C' | 'RETAIL')[]): Promise<{
    totalReturns: number;
    totalRefunded: number;
    recentReturns: any[];
  }>;
}
