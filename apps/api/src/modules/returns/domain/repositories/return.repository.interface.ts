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
  findByReturnNumber(returnNumber: string): Promise<any | null>;
  findByCustomerId(
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
  addEvidence(data: {
    returnId: string;
    uploadedBy: string;
    uploaderId?: string;
    fileType: string;
    fileUrl: string;
    publicId?: string;
    description?: string;
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

  incrementRefundAttempts(returnId: string): Promise<any>;

  // ── Analytics (Phase R6) ──────────────────────────────────────────────
  getAnalyticsSummary(params?: {
    fromDate?: Date;
    toDate?: Date;
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
  ): Promise<
    Array<{
      reasonCategory: string;
      count: number;
      totalQuantity: number;
    }>
  >;

  getReturnsByCustomer(customerId: string): Promise<{
    totalReturns: number;
    totalRefunded: number;
    recentReturns: any[];
  }>;
}
