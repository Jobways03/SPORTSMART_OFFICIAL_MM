export const PROCUREMENT_REPOSITORY = Symbol('ProcurementRepository');

export interface ProcurementRepository {
  // CRUD
  findById(id: string): Promise<any | null>;
  findByIdWithItems(id: string): Promise<any | null>;
  findByFranchiseId(
    franchiseId: string,
    params: { page: number; limit: number; status?: string },
  ): Promise<{ requests: any[]; total: number }>;
  findAllPaginated(params: {
    page: number;
    limit: number;
    status?: string;
    franchiseId?: string;
    search?: string;
  }): Promise<{ requests: any[]; total: number }>;

  create(data: {
    franchiseId: string;
    requestNumber: string;
    procurementFeeRate: number;
  }): Promise<any>;
  update(id: string, data: Record<string, unknown>): Promise<any>;

  // Items
  createItems(
    procurementRequestId: string,
    items: Array<{
      productId: string;
      variantId?: string;
      globalSku: string;
      productTitle: string;
      variantTitle?: string;
      requestedQty: number;
    }>,
  ): Promise<any[]>;
  updateItem(itemId: string, data: Record<string, unknown>): Promise<any>;
  findItemById(itemId: string): Promise<any | null>;

  // Sequence
  generateNextRequestNumber(): Promise<string>;

  // Aggregation
  calculateTotals(id: string): Promise<{
    totalRequestedAmount: number;
    totalApprovedAmount: number;
    procurementFeeAmount: number;
    finalPayableAmount: number;
  }>;
}
