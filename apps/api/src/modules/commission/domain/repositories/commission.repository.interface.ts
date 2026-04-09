/* ── Commission Repository Interface ─────────────────────────────────
 *  All database operations the commission module needs, expressed as
 *  a technology-agnostic contract.
 * ──────────────────────────────────────────────────────────────────── */

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
  platformPrice: number;
  settlementPrice: number;
  quantity: number;
  totalPlatformAmount: number;
  totalSettlementAmount: number;
  platformMargin: number;
  status: string;
  unitPrice: number;
  totalPrice: number;
  commissionType: string;
  commissionRate: string;
  unitCommission: number;
  totalCommission: number;
  adminEarning: number;
  productEarning: number;
}

export interface CommissionRecordFilter {
  sellerId?: string;
  commissionType?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
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
  findDeliveredSubOrders(): Promise<DeliveredSubOrder[]>;
  getSellerProductMapping(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): Promise<SellerProductMapping | null>;
  processSubOrderCommission(
    subOrderId: string,
    records: CreateCommissionRecordData[],
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
  getAdminCommissionSummary(): Promise<CommissionSummary>;

  /* ── Settings ── */
  getCommissionSettings(): Promise<any>;
  upsertCommissionSettings(data: CommissionSettingsData): Promise<any>;

  /* ── Existence check (used inside transaction, exposed for unit testing) ── */
  commissionExistsForItem(orderItemId: string): Promise<boolean>;
}

export const COMMISSION_REPOSITORY = Symbol('CommissionRepository');
