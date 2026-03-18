export interface SellerPerformanceRepository { findBySellerId(sellerId: string): Promise<unknown | null>; }
