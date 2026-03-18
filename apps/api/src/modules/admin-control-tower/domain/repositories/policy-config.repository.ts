export interface PolicyConfigRepository { findByKey(key: string): Promise<unknown | null>; save(config: unknown): Promise<void>; }
