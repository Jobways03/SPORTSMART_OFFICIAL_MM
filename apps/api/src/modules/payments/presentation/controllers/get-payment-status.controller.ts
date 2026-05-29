// Phase 66 (2026-05-22) — customer-facing payment status query
// (audit Gap #14). Replaces the pre-Phase-66 U-prefix dead stub
// (`UgetUpaymentUstatusController`).
//
// Used by the storefront when the customer's browser closed during
// the Razorpay modal interaction and they need to confirm whether
// the payment captured before navigating to "View Order".
//
// The endpoint is read-only and customer-scoped — `masterOrder.
// customerId` is filtered against the JWT-supplied user id so a
// caller cannot probe another customer's payment status by
// guessing orderNumber.

import {
  Controller,
  Get,
  Param,
  NotFoundException,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@ApiTags('Customer Payments')
@Controller('customer/payments')
@UseGuards(UserAuthGuard)
export class GetPaymentStatusController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /customer/payments/by-order/:orderNumber
   *
   * Returns the canonical payment status for an order the
   * authenticated customer owns. Surfaces:
   *   - paymentStatus / paymentMethod / orderStatus from MasterOrder
   *   - razorpayOrderId + razorpayPaymentId (no signature / secret)
   *   - paymentExpiresAt for retry-window UX
   *   - last PaymentAttempt summary so the UI can render
   *     "Capture in progress…" vs "Payment failed (insufficient
   *     funds)" without polling the gateway.
   */
  @Get('by-order/:orderNumber')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getByOrderNumber(
    @Req() req: any,
    @Param('orderNumber') orderNumber: string,
  ) {
    const order = await this.prisma.masterOrder.findFirst({
      where: { orderNumber, customerId: req.userId },
      select: {
        id: true,
        orderNumber: true,
        paymentMethod: true,
        paymentStatus: true,
        orderStatus: true,
        razorpayOrderId: true,
        razorpayPaymentId: true,
        paymentExpiresAt: true,
        currency: true,
        totalAmount: true,
        totalAmountInPaise: true,
      },
    });
    if (!order) {
      // Don't leak whether the order exists for another customer.
      throw new NotFoundException('Order not found');
    }

    const lastAttempt = await this.prisma.paymentAttempt.findFirst({
      where: { masterOrderId: order.id },
      orderBy: { createdAt: 'desc' },
      select: {
        kind: true,
        status: true,
        providerPaymentId: true,
        amountInPaise: true,
        currency: true,
        failureReason: true,
        attemptNumber: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      message: 'Payment status retrieved',
      data: {
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        currency: order.currency,
        totalAmountInPaise: order.totalAmountInPaise.toString(),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: order.razorpayPaymentId,
        paymentExpiresAt: order.paymentExpiresAt
          ? order.paymentExpiresAt.toISOString()
          : null,
        lastAttempt: lastAttempt
          ? {
              kind: lastAttempt.kind,
              status: lastAttempt.status,
              providerPaymentId: lastAttempt.providerPaymentId,
              amountInPaise:
                lastAttempt.amountInPaise !== null
                  ? lastAttempt.amountInPaise.toString()
                  : null,
              currency: lastAttempt.currency,
              failureReason: lastAttempt.failureReason,
              attemptNumber: lastAttempt.attemptNumber,
              createdAt: lastAttempt.createdAt.toISOString(),
            }
          : null,
      },
    };
  }
}
