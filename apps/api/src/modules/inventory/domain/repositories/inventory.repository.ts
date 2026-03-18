export interface InventoryRepository { findBySellerVariantId(id: string): Promise<unknown | null>; save(item: unknown): Promise<void>; }
