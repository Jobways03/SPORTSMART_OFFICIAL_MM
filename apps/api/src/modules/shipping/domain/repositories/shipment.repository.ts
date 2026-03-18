export interface ShipmentRepository { findById(id: string): Promise<unknown | null>; findBySubOrderId(subOrderId: string): Promise<unknown | null>; save(shipment: unknown): Promise<void>; }
