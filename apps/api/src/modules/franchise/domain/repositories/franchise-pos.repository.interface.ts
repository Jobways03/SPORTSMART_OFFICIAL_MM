export const FRANCHISE_POS_REPOSITORY = Symbol('FranchisePosRepository');

export interface FranchisePosRepository {
  findById(id: string): Promise<any | null>;
  findByIdWithItems(id: string): Promise<any | null>;
  findByFranchiseId(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      status?: string;
      saleType?: string;
      fromDate?: Date;
      toDate?: Date;
      search?: string;
    },
  ): Promise<{ sales: any[]; total: number }>;

  createSale(data: {
    saleNumber: string;
    franchiseId: string;
    saleType: string;
    customerName?: string;
    customerPhone?: string;
    grossAmount: number;
    discountAmount: number;
    taxAmount: number;
    // Phase 26 GST (POS) — sale-level breakdown + per-item snapshot.
    cgstAmount?: number;
    sgstAmount?: number;
    igstAmount?: number;
    placeOfSupplyState?: string | null;
    netAmount: number;
    paymentMethod: string;
    createdByStaffId?: string | null;
    commissionRate?: number | null;
    items: Array<{
      productId: string;
      variantId?: string;
      globalSku: string;
      franchiseSku?: string;
      productTitle: string;
      variantTitle?: string;
      quantity: number;
      unitPrice: number;
      lineDiscount: number;
      lineTotal: number;
      hsnCode?: string | null;
      gstRateBps?: number;
      taxableAmount?: number;
      cgstAmount?: number;
      sgstAmount?: number;
      igstAmount?: number;
    }>;
    // Phase 159q (audit #2) — optional outer tx so the sale row + stock deducts
    // commit atomically.
  }, tx?: import('@prisma/client').Prisma.TransactionClient): Promise<any>;

  updateSale(id: string, data: Record<string, unknown>): Promise<any>;

  /**
   * Atomic state transition — only update when the row is currently in
   * `fromStatus`. Returns the number of rows actually updated (0 or 1).
   * This closes the read-then-write race in voidSale where two
   * concurrent requests both see COMPLETED and both fire the inventory
   * reversal.
   */
  claimSaleTransition(
    id: string,
    fromStatus: string,
    patch: Record<string, unknown>,
    tx?: import('@prisma/client').Prisma.TransactionClient,
  ): Promise<number>;
  generateNextSaleNumber(franchiseCode: string): Promise<string>;

  // Phase 159s — takes a pre-computed UTC day range (the service builds it from
  // the report timezone, audit #4). totalNetAmount is now refund-adjusted
  // (audit #1) and the response carries void/return/refund/tax breakdowns
  // (audit #2/#6).
  getDailyReport(
    franchiseId: string,
    range: { gte: Date; lte: Date },
  ): Promise<{
    totalSales: number;
    totalGrossAmount: number;
    totalDiscountAmount: number;
    totalNetAmount: number;
    salesByPaymentMethod: Record<string, { count: number; amount: number }>;
    salesByType: Record<string, { count: number; amount: number }>;
    refundTotal: number;
    voidedSales: { count: number; amount: number };
    returnedSales: { count: number };
    tax: { cgst: number; sgst: number; igst: number; total: number };
  }>;
}
