import type { Prisma } from '@prisma/client';

export const PROCUREMENT_REPOSITORY = Symbol('ProcurementRepository');

/**
 * Phase 159p (audit #4/#9) — read/write methods accept an optional transaction
 * client so callers (approveRequest, confirmReceipt) can compose the per-item
 * loop + status flip + totals recompute into one atomic unit. Omit it and the
 * method runs on the base (auto-commit) client as before.
 */
export interface ProcurementRepository {
  // CRUD
  findById(id: string): Promise<any | null>;
  findByIdWithItems(id: string, tx?: Prisma.TransactionClient): Promise<any | null>;
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

  create(
    data: {
      franchiseId: string;
      requestNumber: string;
      procurementFeeRate: number;
      notes?: string | null;
      requestedByStaffId?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<any>;
  update(id: string, data: Record<string, unknown>, tx?: Prisma.TransactionClient): Promise<any>;

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
      mrpSnapshot?: number | null;
    }>,
    tx?: Prisma.TransactionClient,
  ): Promise<any[]>;
  updateItem(itemId: string, data: Record<string, unknown>, tx?: Prisma.TransactionClient): Promise<any>;
  findItemById(itemId: string, tx?: Prisma.TransactionClient): Promise<any | null>;

  // Sequence
  generateNextRequestNumber(): Promise<string>;
  // Phase 235 — tx-aware allocation so the number is allocated inside the create
  // tx (a failed create rolls it back instead of burning it).
  nextRequestNumberInTx(tx: Prisma.TransactionClient): Promise<string>;

  // Aggregation. Returns Prisma.Decimal so money math stays exact end-to-end
  // (audit #13); callers store the values straight onto the Decimal columns.
  calculateTotals(id: string, tx?: Prisma.TransactionClient): Promise<{
    totalRequestedAmount: Prisma.Decimal;
    totalApprovedAmount: Prisma.Decimal;
    procurementFeeAmount: Prisma.Decimal;
    finalPayableAmount: Prisma.Decimal;
  }>;
}
