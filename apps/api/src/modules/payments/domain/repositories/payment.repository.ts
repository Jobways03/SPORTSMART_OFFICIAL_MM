export interface PaymentRepository { findById(id: string): Promise<unknown | null>; findByOrderId(orderId: string): Promise<unknown | null>; save(payment: unknown): Promise<void>; }
