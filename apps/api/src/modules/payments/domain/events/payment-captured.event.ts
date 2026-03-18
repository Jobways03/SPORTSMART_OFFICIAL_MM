export class PaymentCapturedEvent { constructor(public readonly paymentId: string, public readonly orderId: string) {} }
