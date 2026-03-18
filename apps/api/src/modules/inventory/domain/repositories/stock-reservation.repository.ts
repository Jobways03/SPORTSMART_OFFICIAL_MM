export interface StockReservationRepository { findById(id: string): Promise<unknown | null>; save(reservation: unknown): Promise<void>; }
