import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { RazorpayAdapter } from '../../../../integrations/razorpay/adapters/razorpay.adapter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

export interface RefundGatewayResult {
  success: boolean;
  gatewayRefundId?: string;
  failureReason?: string;
  requiresManualProcessing?: boolean;
}

export interface RefundGatewayInput {
  orderId: string;
  orderNumber: string;
  paymentMethod: string; // 'COD', 'ONLINE', etc.
  amount: number;
  customerId: string;
  returnId: string;
  returnNumber: string;
}

export interface RefundGatewayStatus {
  status: 'PENDING' | 'PROCESSED' | 'FAILED';
  failureReason?: string;
}

/**
 * RefundGatewayService
 *
 * Abstraction over the payment gateway used to process refunds.
 * Handles both COD and online (Razorpay) refunds.
 */
@Injectable()
export class RefundGatewayService {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly razorpayAdapter: RazorpayAdapter,
    private readonly prisma: PrismaService,
  ) {
    this.logger.setContext('RefundGatewayService');
  }

  /**
   * Process a refund through the appropriate gateway.
   * - For ONLINE payments: calls Razorpay refund API
   * - For COD payments: marks as requires manual processing
   */
  async processRefund(
    input: RefundGatewayInput,
  ): Promise<RefundGatewayResult> {
    if (input.paymentMethod === 'COD') {
      // COD refunds require manual processing (bank transfer/cash)
      this.logger.log(
        `COD refund queued for manual processing — return=${input.returnNumber}, amount=₹${input.amount}`,
      );
      return {
        success: false,
        requiresManualProcessing: true,
        failureReason: 'COD refunds require manual processing by admin',
      };
    }

    // For online payments — call Razorpay refund API. The adapter wants
    // the Razorpay payment_id (pay_xxx), not our internal MasterOrder id.
    // A previous revision passed input.orderId, which is always rejected
    // by Razorpay as an unknown payment, silently falling every online
    // refund into the "requires manual processing" branch. The payment
    // id is stored at verify time (see checkout.service.verifyPayment)
    // so we just look it up here.
    try {
      const order = await this.prisma.masterOrder.findFirst({
        where: { id: input.orderId },
        select: {
          orderNumber: true,
          paymentStatus: true,
          razorpayPaymentId: true,
        },
      });

      if (!order || order.paymentStatus !== 'PAID') {
        this.logger.warn(
          `Order ${input.orderId} payment status is not PAID — refund requires manual processing`,
        );
        return {
          success: false,
          requiresManualProcessing: true,
          failureReason: 'Order payment not captured — manual processing required',
        };
      }

      if (!order.razorpayPaymentId) {
        // Paid but the gateway payment id never landed — can happen for
        // orders placed before the verify-payment flow started storing it,
        // or for COD orders mis-flagged as PAID. Fail closed to manual.
        this.logger.warn(
          `Order ${input.orderId} has no razorpayPaymentId — refund requires manual processing`,
        );
        return {
          success: false,
          requiresManualProcessing: true,
          failureReason:
            'Gateway payment reference missing — manual processing required',
        };
      }

      const refundResult = await this.razorpayAdapter.initiateRefund(
        order.razorpayPaymentId,
        input.amount,
        {
          return_id: input.returnId,
          return_number: input.returnNumber,
          order_number: input.orderNumber,
        },
      );

      if (refundResult.status === 'processed') {
        this.logger.log(
          `Refund processed via Razorpay: ${refundResult.providerRefundId} for return=${input.returnNumber}, amount=₹${input.amount}`,
        );
        return {
          success: true,
          gatewayRefundId: refundResult.providerRefundId,
        };
      }

      // Refund initiated but not yet processed
      this.logger.log(
        `Refund initiated via Razorpay (pending): ${refundResult.providerRefundId}`,
      );
      return {
        success: true,
        gatewayRefundId: refundResult.providerRefundId,
      };
    } catch (error) {
      this.logger.error(
        `Razorpay refund failed for return ${input.returnNumber}: ${(error as Error).message}`,
      );
      return {
        success: false,
        requiresManualProcessing: true,
        failureReason: `Razorpay refund error: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Check the status of a refund by gateway refund ID. The adapter's
   * `getRefundStatus` hits Razorpay's payment-scoped refund endpoint,
   * so we need the original razorpayPaymentId alongside the refund id.
   * We look that up through the Return → MasterOrder relation.
   *
   * Previously this method passed an empty string as paymentId, so
   * every status check failed and the auto-confirm loop in the
   * refund-processor never advanced any refund past REFUND_PROCESSING.
   */
  async checkRefundStatus(
    returnId: string,
    gatewayRefundId: string,
  ): Promise<RefundGatewayStatus> {
    try {
      const ret = await this.prisma.return.findFirst({
        where: { id: returnId },
        select: {
          masterOrder: { select: { razorpayPaymentId: true } },
        },
      });

      const paymentId = ret?.masterOrder?.razorpayPaymentId;
      if (!paymentId) {
        this.logger.warn(
          `No razorpayPaymentId linked to return ${returnId} — cannot poll refund status`,
        );
        return { status: 'PENDING' };
      }

      const refundStatus = await this.razorpayAdapter.getRefundStatus(
        paymentId,
        gatewayRefundId,
      );

      switch (refundStatus.status) {
        case 'processed':
          return { status: 'PROCESSED' };
        case 'failed':
          return { status: 'FAILED', failureReason: 'Refund failed at gateway' };
        default:
          return { status: 'PENDING' };
      }
    } catch (error) {
      this.logger.error(
        `Failed to check refund status for ${gatewayRefundId}: ${(error as Error).message}`,
      );
      return { status: 'PENDING' };
    }
  }
}
