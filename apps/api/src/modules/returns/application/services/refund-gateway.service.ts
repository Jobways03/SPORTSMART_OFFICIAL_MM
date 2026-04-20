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

    // For online payments — call Razorpay refund API
    try {
      // MasterOrder doesn't store paymentId directly.
      // Use the order number as the Razorpay receipt to look up the payment.
      // In production, the payment ID should be stored after checkout capture.
      // TODO: Replace with ordersFacade.getMasterOrderBasic(input.orderId)
      // once Returns module imports OrdersModule via forwardRef
      const order = await this.prisma.masterOrder.findFirst({
        where: { id: input.orderId },
        select: { orderNumber: true, paymentStatus: true },
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

      // Use order number as a reference for the refund.
      // In a complete integration, the Razorpay payment_id would be stored
      // after initial capture and used here.
      const refundResult = await this.razorpayAdapter.initiateRefund(
        input.orderId, // Would be razorpay payment_id in production
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
   * Check the status of a refund by gateway refund ID.
   */
  async checkRefundStatus(
    gatewayRefundId: string,
  ): Promise<RefundGatewayStatus> {
    try {
      // We need the payment ID to check refund status — for now we parse from the refund
      // In production, store the mapping (gatewayRefundId -> paymentId) in DB
      const refundStatus = await this.razorpayAdapter.getRefundStatus(
        '', // Payment ID would be stored from processRefund
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
