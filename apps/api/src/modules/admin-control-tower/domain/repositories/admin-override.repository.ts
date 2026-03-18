export interface AdminOverrideRepository { findById(id: string): Promise<unknown | null>; save(override: unknown): Promise<void>; }
