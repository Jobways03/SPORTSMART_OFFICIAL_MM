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
    netAmount: number;
    paymentMethod: string;
    createdByStaffId?: string;
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
    }>;
  }): Promise<any>;

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
  ): Promise<number>;
  generateNextSaleNumber(franchiseCode: string): Promise<string>;

  getDailyReport(
    franchiseId: string,
    date: Date,
  ): Promise<{
    totalSales: number;
    totalGrossAmount: number;
    totalDiscountAmount: number;
    totalNetAmount: number;
    salesByPaymentMethod: Record<string, { count: number; amount: number }>;
    salesByType: Record<string, { count: number; amount: number }>;
  }>;
}
