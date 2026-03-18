export interface SellerRepository { findById(id: string): Promise<unknown | null>; save(seller: unknown): Promise<void>; }
