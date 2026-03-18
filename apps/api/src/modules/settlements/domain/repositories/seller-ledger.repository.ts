export interface SellerLedgerRepository { findBySellerId(sellerId: string): Promise<unknown[]>; save(entry: unknown): Promise<void>; }
