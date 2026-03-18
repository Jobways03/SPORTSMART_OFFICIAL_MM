export interface ShipmentEventRepository { findByShipmentId(shipmentId: string): Promise<unknown[]>; save(event: unknown): Promise<void>; }
