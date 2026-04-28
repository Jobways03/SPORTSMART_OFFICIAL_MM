export interface ReturnRepository { findById(id: string): Promise<unknown | null>; save(ret: unknown): Promise<void>; }
