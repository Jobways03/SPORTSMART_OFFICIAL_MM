export interface FranchiseRepository { findById(id: string): Promise<unknown | null>; save(franchise: unknown): Promise<void>; }
