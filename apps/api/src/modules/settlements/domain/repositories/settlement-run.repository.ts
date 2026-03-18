export interface SettlementRunRepository { findById(id: string): Promise<unknown | null>; save(run: unknown): Promise<void>; }
