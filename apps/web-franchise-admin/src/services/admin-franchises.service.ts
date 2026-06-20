import { apiClient, ApiResponse } from '@/lib/api-client';

export interface FranchiseListItem {
  id: string;
  franchiseCode: string;
  ownerName: string;
  businessName: string;
  email: string;
  phoneNumber: string;
  status: string;
  verificationStatus: string;
  state: string | null;
  city: string | null;
  profileCompletionPercentage: number;
  isEmailVerified: boolean;
  createdAt: string;
}

export interface FranchiseListResponse {
  franchises: FranchiseListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface FranchiseDetail {
  id: string;
  franchiseCode: string;
  ownerName: string;
  businessName: string;
  email: string;
  phoneNumber: string;
  gstNumber: string | null;
  panNumber: string | null;
  // Bank payout details (masked).
  hasBankDetails: boolean;
  bankName: string | null;
  bankAccountHolderName: string | null;
  bankAccountLast4: string | null;
  bankIfscCode: string | null;
  status: string;
  verificationStatus: string;
  isEmailVerified: boolean;
  profileCompletionPercentage: number;

  // Address — matches the FranchisePartner Prisma model exactly
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  locality: string | null;

  // Warehouse — only two fields exist on the backend today
  warehouseAddress: string | null;
  warehousePincode: string | null;

  // Zone — single string on the backend (FranchisePartner.assignedZone)
  assignedZone: string | null;

  // Commission rates
  onlineFulfillmentRate: number | null;
  procurementFeeRate: number | null;

  // Contract
  contractStartDate: string | null;
  contractEndDate: string | null;

  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;

  // Logistics pickup readiness — the gate for online order delivery. The admin
  // must register the franchise store as a courier "warehouse" before any online
  // order can be shipped. logisticsPickupRegistered = at least one partner
  // registration with a warehouse name (the same signal the ship flow checks).
  selfDeliveryEnabled?: boolean;
  logisticsPickupRegistered?: boolean;
  logisticsRegisteredPartners?: string[];
  logisticsPartnerAttempts?: number;
}

export interface ListFranchisesParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  verificationStatus?: string;
  sortBy?: string;
  sortOrder?: string;
  state?: string;
}

export interface FranchiseCatalogMapping {
  id: string;
  franchiseId: string;
  franchiseCode?: string;
  franchiseName?: string;
  productId: string;
  variantId: string | null;
  product: {
    id: string;
    title: string;
    slug?: string;
    productCode?: string;
  };
  variant: {
    id: string;
    masterSku: string;
    title: string;
    sku?: string;
  } | null;
  approvalStatus: string;
  sku: string | null;
  createdAt: string;
  updatedAt: string;
  // Live FranchiseStock joined server-side. `null` when no stock row
  // exists yet for this (franchise, product, variant) tuple — i.e.
  // the franchise has been approved but never received any units.
  stock?: {
    onHandQty: number;
    reservedQty: number;
    availableQty: number;
    damagedQty: number;
    inTransitQty: number;
    lowStockThreshold: number;
    lastRestockedAt: string | null;
  } | null;
}

export interface FranchiseCatalogListResponse {
  mappings: FranchiseCatalogMapping[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ListFranchiseCatalogParams {
  page?: number;
  limit?: number;
  franchiseId?: string;
  approvalStatus?: string;
  search?: string;
}

export interface FranchiseInventoryItem {
  id: string;
  productId: string;
  variantId: string | null;
  productTitle: string;
  productCode?: string;
  sku: string | null;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  lowStockThreshold: number;
  updatedAt: string;
}

export interface FranchiseInventoryLedgerEntry {
  id: string;
  franchiseId: string;
  productId: string;
  variantId: string | null;
  type: string;
  quantity: number;
  balanceAfter: number;
  referenceId: string | null;
  referenceType: string | null;
  notes: string | null;
  createdAt: string;
}

export interface FranchiseOrderItem {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  totalAmount: number;
  itemsCount: number;
  createdAt: string;
}

/**
 * The /admin/franchise-orders/franchises/:id endpoint returns RAW sub-order
 * rows under the `subOrders` key (nested masterOrder + items) — NOT the
 * flattened FranchiseOrderItem the table renders. The page flattens these in
 * fetchOrders. Only the fields the UI consumes are typed here.
 */
export interface FranchiseSubOrderRaw {
  id: string;
  subTotal: string | number | null;
  fulfillmentStatus: string;
  acceptStatus: string;
  createdAt: string;
  items?: unknown[];
  masterOrder?: {
    orderNumber?: string;
    shippingAddressSnapshot?: { fullName?: string; name?: string } | null;
  } | null;
}

// Flat row for the global franchise-admin Orders table
// (GET /admin/franchise-orders). One row = one franchise sub-order.
export interface FranchiseOrderRow {
  id: string;
  subTotal: string | number | null;
  fulfillmentStatus: string;
  acceptStatus: string;
  deliveryMethod?: string | null;
  createdAt: string;
  masterOrder?: {
    id?: string;
    orderNumber?: string;
    totalAmount?: string | number | null;
    paymentMethod?: string | null;
    paymentStatus?: string | null;
    orderStatus?: string | null;
    createdAt?: string;
    shippingAddressSnapshot?: { fullName?: string; name?: string; phone?: string } | null;
    customer?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  } | null;
  franchise?: { id: string; businessName: string } | null;
  _count?: { items: number } | null;
}

export interface FranchiseAllOrdersResponse {
  subOrders: FranchiseOrderRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// Full franchise sub-order detail (GET /admin/franchise-orders/sub-orders/:id).
export interface FranchiseSubOrderDetailItem {
  id: string;
  productTitle: string;
  variantTitle?: string | null;
  sku?: string | null;
  imageUrl?: string | null;
  quantity: number;
  unitPrice: string | number | null;
  totalPrice: string | number | null;
}
export interface FranchiseSubOrderDetail {
  id: string;
  subTotal: string | number | null;
  fulfillmentStatus: string;
  acceptStatus: string;
  deliveryMethod?: string | null;
  trackingNumber?: string | null;
  courierName?: string | null;
  createdAt: string;
  items?: FranchiseSubOrderDetailItem[];
  franchise?: { id: string; businessName: string } | null;
  masterOrder?: {
    id: string;
    orderNumber?: string;
    shippingAddressSnapshot?: {
      fullName?: string;
      name?: string;
      phone?: string;
      addressLine1?: string;
      addressLine2?: string;
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      pincode?: string;
    } | null;
    totalAmount?: string | number | null;
    paymentMethod?: string;
    // Wallet-aware label from the API ("Paid by Wallet" / "Cash on Delivery
    // (Wallet ₹X applied)" / "Online" …) — prefer over raw paymentMethod.
    paymentMethodLabel?: string;
    walletAmountUsedInPaise?: string;
    paymentStatus?: string;
    orderStatus?: string;
    createdAt?: string;
  } | null;
}

// Shape of a row from GET /admin/franchises/:id/pos-sales (FranchisePosSale +
// _count.items). netAmount is a Prisma Decimal, serialised over JSON as a string.
export interface FranchisePosSale {
  id: string;
  saleNumber: string;
  saleType: string;
  status: string;
  netAmount: string;
  paymentMethod: string;
  soldAt: string;
  createdAt: string;
  _count?: { items: number };
}

export const adminFranchisesService = {
  listFranchises(params: ListFranchisesParams = {}): Promise<ApiResponse<FranchiseListResponse>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);
    if (params.verificationStatus) query.set('verificationStatus', params.verificationStatus);
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);
    if (params.state) query.set('state', params.state);
    const qs = query.toString();
    return apiClient<FranchiseListResponse>(`/admin/franchises${qs ? `?${qs}` : ''}`);
  },

  getFranchise(id: string): Promise<ApiResponse<FranchiseDetail>> {
    return apiClient<FranchiseDetail>(`/admin/franchises/${id}`);
  },

  updateStatus(id: string, status: string, reason?: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
  },

  updateVerification(id: string, verificationStatus: string, reason?: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}/verification`, {
      method: 'PATCH',
      body: JSON.stringify({ verificationStatus, reason }),
    });
  },

  updateCommission(
    id: string,
    payload: { onlineFulfillmentRate?: number; procurementFeeRate?: number },
  ): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}/commission`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  // Franchise catalog
  listCatalog(params: ListFranchiseCatalogParams = {}): Promise<ApiResponse<FranchiseCatalogListResponse>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.franchiseId) query.set('franchiseId', params.franchiseId);
    if (params.approvalStatus) query.set('approvalStatus', params.approvalStatus);
    if (params.search) query.set('search', params.search);
    const qs = query.toString();
    return apiClient<FranchiseCatalogListResponse>(`/admin/franchise-catalog${qs ? `?${qs}` : ''}`);
  },

  approveCatalogMapping(mappingId: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-catalog/${mappingId}/approve`, {
      method: 'PATCH',
    });
  },

  stopCatalogMapping(mappingId: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-catalog/${mappingId}/stop`, {
      method: 'PATCH',
    });
  },

  rejectCatalogMapping(mappingId: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-catalog/${mappingId}/reject`, {
      method: 'PATCH',
    });
  },

  // Franchise orders
  listFranchiseOrders(
    franchiseId: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<ApiResponse<{ subOrders: FranchiseSubOrderRaw[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return apiClient(`/admin/franchise-orders/franchises/${franchiseId}${qs ? `?${qs}` : ''}`);
  },

  // Global flat list across ALL franchises — powers the franchise-admin
  // Orders table (parity with the seller-admin orders page).
  listAllFranchiseOrders(
    params: {
      page?: number;
      limit?: number;
      search?: string;
      orderStatus?: string;
      paymentStatus?: string;
      fulfillmentStatus?: string;
      acceptStatus?: string;
    } = {},
  ): Promise<ApiResponse<FranchiseAllOrdersResponse>> {
    const q = new URLSearchParams();
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    if (params.search) q.set('search', params.search);
    if (params.orderStatus) q.set('orderStatus', params.orderStatus);
    if (params.paymentStatus) q.set('paymentStatus', params.paymentStatus);
    if (params.fulfillmentStatus) q.set('fulfillmentStatus', params.fulfillmentStatus);
    if (params.acceptStatus) q.set('acceptStatus', params.acceptStatus);
    const qs = q.toString();
    return apiClient(`/admin/franchise-orders${qs ? `?${qs}` : ''}`);
  },

  getFranchiseOrder(
    subOrderId: string,
  ): Promise<ApiResponse<FranchiseSubOrderDetail>> {
    return apiClient(`/admin/franchise-orders/sub-orders/${subOrderId}`);
  },

  // Inventory
  getInventory(franchiseId: string): Promise<ApiResponse<{ inventory: FranchiseInventoryItem[] }>> {
    return apiClient<{ inventory: FranchiseInventoryItem[] }>(
      `/admin/franchises/${franchiseId}/inventory`,
    );
  },

  getInventoryLedger(
    franchiseId: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<ApiResponse<{ entries: FranchiseInventoryLedgerEntry[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return apiClient(`/admin/franchises/${franchiseId}/inventory/ledger${qs ? `?${qs}` : ''}`);
  },

  // ── Profile Edit ──────────────────────────────────────

  editFranchise(id: string, payload: Record<string, unknown>): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  // ── Send Message ──────────────────────────────────────

  sendMessage(id: string, subject: string, message: string, channel?: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}/message`, {
      method: 'POST',
      body: JSON.stringify({ subject, message, channel }),
    });
  },

  // ── Change Password ───────────────────────────────────

  changePassword(id: string, newPassword: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}/change-password`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword }),
    });
  },

  // ── Bank Details ──────────────────────────────────────

  updateBankDetails(
    id: string,
    dto: {
      accountHolderName: string;
      accountNumber: string;
      ifscCode: string;
      bankName: string;
      upiVpa?: string;
    },
  ): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}/bank-details`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    });
  },

  // ── Impersonate ───────────────────────────────────────

  impersonateFranchise(id: string): Promise<ApiResponse<{
    accessToken: string;
    expiresIn: number;
    franchise: {
      franchiseId: string;
      franchiseCode: string;
      ownerName: string;
      businessName: string;
      email: string;
    };
  }>> {
    return apiClient(`/admin/franchises/${id}/impersonate`, {
      method: 'POST',
    });
  },

  // ── Delete ────────────────────────────────────────────

  deleteFranchise(id: string, reason?: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    });
  },

  // ── POS Sales ─────────────────────────────────────────

  getPosSales(
    franchiseId: string,
    params: { page?: number; limit?: number; status?: string } = {},
  ): Promise<ApiResponse<{ sales: FranchisePosSale[]; total: number }>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.status) query.set('status', params.status);
    const qs = query.toString();
    return apiClient(`/admin/franchises/${franchiseId}/pos-sales${qs ? `?${qs}` : ''}`);
  },

  // ── Finance Ledger ────────────────────────────────────

  getFinanceLedger(
    franchiseId: string,
    params: { page?: number; limit?: number; sourceType?: string } = {},
  ): Promise<ApiResponse> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.sourceType) query.set('sourceType', params.sourceType);
    const qs = query.toString();
    return apiClient(`/admin/franchise-finance/${franchiseId}/ledger${qs ? `?${qs}` : ''}`);
  },

  createAdjustment(franchiseId: string, amount: number, reason: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-finance/${franchiseId}/adjustment`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    });
  },

  createPenalty(franchiseId: string, amount: number, reason: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-finance/${franchiseId}/penalty`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    });
  },

  // ── Settlements ───────────────────────────────────────

  listSettlements(
    params: { page?: number; limit?: number; franchiseId?: string; status?: string } = {},
  ): Promise<ApiResponse> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.franchiseId) query.set('franchiseId', params.franchiseId);
    if (params.status) query.set('status', params.status);
    const qs = query.toString();
    return apiClient(`/admin/franchise-settlements${qs ? `?${qs}` : ''}`);
  },

  // Full settlement detail incl. the per-order ledger entries (ledgerEntries[]).
  getSettlement(id: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-settlements/${id}`);
  },

  // Dry-run: what a Create-cycle would settle for the period, before committing.
  previewSettlementCycle(periodStart: string, periodEnd: string): Promise<ApiResponse> {
    const qs = new URLSearchParams({ periodStart, periodEnd }).toString();
    return apiClient(`/admin/franchise-settlements/preview?${qs}`);
  },

  createSettlementCycle(periodStart: string, periodEnd: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-settlements`, {
      method: 'POST',
      body: JSON.stringify({ periodStart, periodEnd }),
    });
  },

  approveSettlement(id: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-settlements/${id}/approve`, { method: 'PATCH' });
  },

  markSettlementPaid(
    id: string,
    payload: {
      paymentReference: string;
      paymentMethod?: string;
      paymentProofUrl?: string;
    },
  ): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-settlements/${id}/pay`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  // ── Order Actions ─────────────────────────────────────

  markOrderDelivered(subOrderId: string): Promise<ApiResponse> {
    return apiClient(`/admin/franchise-orders/${subOrderId}/mark-delivered`, {
      method: 'PATCH',
    });
  },

  // Cancel a (franchise) sub-order. Reuses the shared admin cancel route —
  // it handles fulfillmentNodeType FRANCHISE and operates on the same
  // SubOrder table, so subOrderId here is the correct param. Reason ≥10 chars
  // (DTO @Length(10,500)); X-Idempotency-Key pairs with the @Idempotent route.
  cancelOrder(subOrderId: string, reason: string, force = false): Promise<ApiResponse> {
    return apiClient(`/admin/shipping/sub-orders/${subOrderId}/cancel-with-courier`, {
      method: 'POST',
      body: JSON.stringify({ reason, force }),
      headers: {
        'X-Idempotency-Key': `cancel-sub-order-${subOrderId}-${Date.now()}`,
      },
    });
  },

  // ── Per-franchise procurement pricing (Option C) ───────
  //
  // Each row is a negotiated landed cost for a specific
  // (franchise, product, variant) combo. When present, it wins over
  // ProductVariant.costPrice in the procurement approval prefill
  // chain and is the target of the approval write-back.

  listProcurementPrices(franchiseId: string): Promise<ApiResponse<{
    prices: Array<{
      id: string;
      franchiseId: string;
      productId: string;
      variantId: string | null;
      landedUnitCost: string | number;
      notes: string | null;
      createdBy: string | null;
      createdAt: string;
      updatedAt: string;
      product?: { id: string; title: string } | null;
      variant?: { id: string; title: string | null; sku: string | null } | null;
    }>;
  }>> {
    return apiClient(`/admin/franchises/${franchiseId}/procurement-prices`);
  },

  upsertProcurementPrice(
    franchiseId: string,
    payload: {
      productId: string;
      variantId?: string;
      landedUnitCost: number;
      notes?: string;
    },
  ): Promise<ApiResponse> {
    return apiClient(`/admin/franchises/${franchiseId}/procurement-prices`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteProcurementPrice(
    franchiseId: string,
    priceId: string,
  ): Promise<ApiResponse> {
    return apiClient(
      `/admin/franchises/${franchiseId}/procurement-prices/${priceId}`,
      { method: 'DELETE' },
    );
  },
};
