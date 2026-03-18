export interface RefundRepository { findById(id: string): Promise<unknown | null>; save(refund: unknown): Promise<void>; }
