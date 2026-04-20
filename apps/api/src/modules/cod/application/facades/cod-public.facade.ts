import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

// COD thresholds (configurable via admin in future)
const COD_MAX_ORDER_VALUE = 10000; // INR
const COD_MIN_ORDER_VALUE = 100;   // INR

@Injectable()
export class CodPublicFacade {
  private readonly logger = new Logger(CodPublicFacade.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluate whether COD is allowed for a given order context.
   */
  async evaluateCodEligibility(params: {
    customerId: string;
    sellerId: string;
    orderValue: number;
    pincode: string;
  }): Promise<{ allowed: boolean; reasons: string[] }> {
    const reasons: string[] = [];

    // Rule 1: Order value range
    if (params.orderValue > COD_MAX_ORDER_VALUE) {
      reasons.push(`Order value exceeds COD limit of ₹${COD_MAX_ORDER_VALUE}`);
    }
    if (params.orderValue < COD_MIN_ORDER_VALUE) {
      reasons.push(`Order value below COD minimum of ₹${COD_MIN_ORDER_VALUE}`);
    }

    // Rule 2: Check if seller supports COD
    const seller = await this.prisma.seller.findUnique({
      where: { id: params.sellerId },
      select: { status: true },
    });
    if (!seller || seller.status !== 'ACTIVE') {
      reasons.push('Seller is not active');
    }

    // Rule 3: Check pincode serviceability for COD
    const serviceability = await this.prisma.sellerServiceArea.findFirst({
      where: {
        sellerId: params.sellerId,
        pincode: params.pincode,
        isActive: true,
      },
    });
    if (!serviceability) {
      reasons.push('Pincode not serviceable by this seller');
    }

    // Rule 4: Check customer order history for COD abuse
    const recentCodOrders = await this.prisma.masterOrder.count({
      where: {
        customerId: params.customerId,
        paymentMethod: 'COD',
        orderStatus: 'CANCELLED',
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });
    if (recentCodOrders >= 3) {
      reasons.push('Too many cancelled COD orders in the last 30 days');
    }

    const allowed = reasons.length === 0;

    this.logger.log(
      `COD eligibility for customer ${params.customerId}: ${allowed ? 'ALLOWED' : 'BLOCKED'} (${reasons.length} reasons)`,
    );

    return { allowed, reasons };
  }

  /**
   * Log a COD decision for audit purposes.
   */
  async logCodDecision(decisionData: {
    orderId: string;
    customerId: string;
    allowed: boolean;
    reasons: string[];
    orderValue: number;
  }): Promise<void> {
    this.logger.log(
      `COD decision logged for order ${decisionData.orderId}: ${decisionData.allowed ? 'ALLOWED' : 'BLOCKED'}`,
    );
  }

  /**
   * Get all available COD reason codes.
   */
  async getReasonCodes(): Promise<{ code: string; description: string }[]> {
    return [
      { code: 'ORDER_VALUE_TOO_HIGH', description: `Order value exceeds COD limit of ₹${COD_MAX_ORDER_VALUE}` },
      { code: 'ORDER_VALUE_TOO_LOW', description: `Order value below COD minimum of ₹${COD_MIN_ORDER_VALUE}` },
      { code: 'SELLER_INACTIVE', description: 'Seller is not active' },
      { code: 'PINCODE_NOT_SERVICEABLE', description: 'Delivery pincode is not serviceable' },
      { code: 'COD_ABUSE_DETECTED', description: 'Too many cancelled COD orders recently' },
    ];
  }
}
