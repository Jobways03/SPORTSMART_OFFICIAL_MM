export interface AffiliateCommissionRepository { findById(id: string): Promise<unknown | null>; save(commission: unknown): Promise<void>; }
