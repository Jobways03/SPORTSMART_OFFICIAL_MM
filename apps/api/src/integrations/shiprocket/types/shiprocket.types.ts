export type NormalizedShipmentStatus =
  | 'AWB_ASSIGNED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'NDR_RAISED'
  | 'NDR_RESOLVED'
  | 'RTO_INITIATED'
  | 'RTO_IN_TRANSIT'
  | 'RTO_DELIVERED';

export interface NormalizedTrackingEvent {
  shipmentId: string;
  awb: string;
  status: NormalizedShipmentStatus;
  location: string;
  timestamp: Date;
  rawStatus: string;
}

export interface NormalizedShipmentCreateResult {
  providerShipmentId: string;
  awb: string;
  labelUrl: string;
  createdAt: Date;
}
