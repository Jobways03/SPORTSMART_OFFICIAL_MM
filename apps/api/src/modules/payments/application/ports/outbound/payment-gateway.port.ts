export interface PaymentGatewayPort { createOrder(amount: number, currency: string): Promise<unknown>; verifySignature(payload: unknown): boolean; }
