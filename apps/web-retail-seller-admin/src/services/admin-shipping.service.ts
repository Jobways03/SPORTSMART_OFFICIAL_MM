import { apiClient, ApiResponse } from '@/lib/api-client';

// Mirrors what ShippingPublicFacade returns. `labelInfo` is a separate
// fetch — keeping it off the main shipment row lets the page lazy-load
// it only when the admin clicks "Print label" or expands the panel.
export interface ShipmentDetail {
  id: string;
  subOrderId: string;
  carrier: string | null;
  courierName: string | null;
  awb: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string | null;
  shipmentCreatedAt: string | null;
  lastTrackingEventAt: string | null;
}

export interface LabelInfo {
  // The facade returns whatever the carrier API gives back. Shiprocket
  // returns label_url + manifest_url + per-shipment AWB info. Keep this
  // loose since carrier shapes vary and are forwarded as-is.
  labelUrl?: string | null;
  manifestUrl?: string | null;
  awb?: string | null;
  carrier?: string | null;
  // Plus arbitrary carrier fields we want the admin to see.
  [key: string]: unknown;
}

export interface NdrRtoState {
  status: string | null;
  remarks: string | null;
  lastEventAt: string | null;
  attempts?: Array<{ at: string; reason: string | null }>;
}

export const adminShippingService = {
  getShipment(subOrderId: string): Promise<ApiResponse<ShipmentDetail | null>> {
    return apiClient<ShipmentDetail | null>(`/admin/shipping/sub-orders/${subOrderId}`);
  },

  createShipment(
    subOrderId: string,
    body: { courierName?: string; awb?: string; trackingUrl?: string },
  ): Promise<ApiResponse<ShipmentDetail>> {
    return apiClient<ShipmentDetail>(`/admin/shipping/sub-orders/${subOrderId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  getLabel(subOrderId: string): Promise<ApiResponse<LabelInfo>> {
    return apiClient<LabelInfo>(`/admin/shipping/sub-orders/${subOrderId}/label`);
  },

  updateStatus(
    subOrderId: string,
    body: { status: string; location?: string },
  ): Promise<ApiResponse<void>> {
    return apiClient<void>(`/admin/shipping/sub-orders/${subOrderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  getNdrRto(subOrderId: string): Promise<ApiResponse<NdrRtoState>> {
    return apiClient<NdrRtoState>(`/admin/shipping/sub-orders/${subOrderId}/ndr-rto`);
  },

  // ─── Phase 3 Delhivery wiring (2026-06-02) — carrier outbound actions ───

  /** Cancel the courier shipment at the carrier (Delhivery), by AWB. */
  courierCancel(
    subOrderId: string,
  ): Promise<ApiResponse<{ awb: string | null; success: boolean; message: string }>> {
    return apiClient<{ awb: string | null; success: boolean; message: string }>(
      `/admin/shipping/sub-orders/${subOrderId}/courier-cancel`,
      {
        method: 'POST',
        headers: { 'X-Idempotency-Key': `courier-cancel-${subOrderId}` },
      },
    );
  },

  /** Pull a fresh tracking snapshot from the carrier and ingest it. */
  refreshTracking(
    subOrderId: string,
  ): Promise<
    ApiResponse<{ awb: string | null; currentStatus: string | null; applied: boolean; message: string }>
  > {
    return apiClient<{
      awb: string | null;
      currentStatus: string | null;
      applied: boolean;
      message: string;
    }>(`/admin/shipping/sub-orders/${subOrderId}/track-refresh`, {
      method: 'POST',
    });
  },

  /** Trigger a carrier NDR action (re-attempt / convert-to-RTO). */
  ndrAction(
    subOrderId: string,
    action: 'REATTEMPT' | 'CONVERT_TO_RTO' | 'UPDATE_ADDRESS' = 'REATTEMPT',
  ): Promise<ApiResponse<{ outcome: string; message?: string }>> {
    return apiClient<{ outcome: string; message?: string }>(
      `/admin/shipping/sub-orders/${subOrderId}/ndr-action`,
      {
        method: 'POST',
        body: JSON.stringify({ action }),
      },
    );
  },

  /** Force RTO (Delhivery aliases to cancel/auto-RTO). Reason ≥ 10 chars. */
  forceRto(subOrderId: string, reason: string): Promise<ApiResponse<void>> {
    return apiClient<void>(`/admin/shipping/sub-orders/${subOrderId}/force-rto`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      headers: { 'X-Idempotency-Key': `force-rto-${subOrderId}` },
    });
  },

  /**
   * Request a Delhivery pickup for this sub-order's seller/franchise warehouse.
   * The backend resolves the registered pickup location + raises one pickup for
   * today (idempotent per warehouse+day at the facade, so re-clicks are safe).
   */
  requestPickup(
    subOrderId: string,
  ): Promise<
    ApiResponse<{
      success: boolean;
      warehouseName: string | null;
      date: string | null;
      expectedPackageCount: number;
      message: string;
    }>
  > {
    return apiClient<{
      success: boolean;
      warehouseName: string | null;
      date: string | null;
      expectedPackageCount: number;
      message: string;
    }>(`/admin/shipping/sub-orders/${subOrderId}/request-pickup`, {
      method: 'POST',
      headers: { 'X-Idempotency-Key': `pickup-${subOrderId}-${Date.now()}` },
    });
  },

  /**
   * Cancel the ORDER (sub-order). Also cancels the Delhivery shipment via the
   * orders.sub_order.cancelled_by_admin handler, refunds a prepaid customer,
   * and rolls up the master order. `force` is required for SHIPPED/in-transit
   * goods (and is permission-gated server-side on orders.subOrder.cancel.force).
   */
  cancelOrder(
    subOrderId: string,
    reason: string,
    force = false,
  ): Promise<ApiResponse<void>> {
    return apiClient<void>(
      `/admin/shipping/sub-orders/${subOrderId}/cancel-with-courier`,
      {
        method: 'POST',
        body: JSON.stringify({ reason, force }),
        headers: {
          'X-Idempotency-Key': `cancel-sub-order-${subOrderId}-${Date.now()}`,
        },
      },
    );
  },
};
