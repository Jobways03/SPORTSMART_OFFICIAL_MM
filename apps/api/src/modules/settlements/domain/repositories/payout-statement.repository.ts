export interface PayoutStatementRepository { findById(id: string): Promise<unknown | null>; save(statement: unknown): Promise<void>; }
