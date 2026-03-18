export interface CodRuleRepository { findAll(): Promise<unknown[]>; save(rule: unknown): Promise<void>; }
