export interface AffiliateRepository { findById(id: string): Promise<unknown | null>; save(affiliate: unknown): Promise<void>; }
