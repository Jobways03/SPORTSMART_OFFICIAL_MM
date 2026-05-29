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
};
