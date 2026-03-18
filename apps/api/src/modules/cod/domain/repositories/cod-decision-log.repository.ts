export interface CodDecisionLogRepository { save(log: unknown): Promise<void>; findByOrderId(orderId: string): Promise<unknown | null>; }
