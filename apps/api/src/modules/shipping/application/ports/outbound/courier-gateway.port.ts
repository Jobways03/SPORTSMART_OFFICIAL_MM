export interface CourierGatewayPort { createShipment(data: unknown): Promise<unknown>; getTracking(awb: string): Promise<unknown>; }
