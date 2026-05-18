import { Injectable } from '@nestjs/common';
import type {
  PaymentAttemptKind,
  PaymentAttemptStatus,
  PaymentMismatchKind,
} from '@prisma/client';
import { PaymentOpsService } from '../services/payment-ops.service';

/**
 * Cross-module entry point. Checkout/refund services call this to log
 * each gateway round-trip and to flag mismatches detected at verify
 * time (signature mismatch, amount drift, etc.).
 */
@Injectable()
export class PaymentOpsFacade {
  constructor(private readonly service: PaymentOpsService) {}

  recordAttempt(args: {
    masterOrderId?: string | null;
    orderNumber?: string | null;
    kind: PaymentAttemptKind;
    status: PaymentAttemptStatus;
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
    providerRefundId?: string | null;
    amountInPaise?: number | null;
    currency?: string;
    responseSummary?: string | null;
    failureReason?: string | null;
  }) {
    return this.service.recordAttempt(args);
  }

  flagMismatch(args: {
    kind: PaymentMismatchKind;
    masterOrderId?: string | null;
    orderNumber?: string | null;
    providerPaymentId?: string | null;
    /**
     * Paise values can be `number` (when small enough to fit in
     * Number.MAX_SAFE_INTEGER), `bigint`, or `string` (BigInt
     * serialised across an HTTP boundary). We accept all three so
     * callers don't have to coerce — coercion happens once at the
     * persistence boundary in the service.
     */
    expectedInPaise?: number | bigint | string | null;
    actualInPaise?: number | bigint | string | null;
    description: string;
    severity?: number;
  }) {
    return this.service.createMismatchAlert(args);
  }
}
