import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';

/**
 * Shared service that triggers re-approval when a seller modifies
 * an already-approved/active product. If the product is in APPROVED or ACTIVE
 * status, it moves back to SUBMITTED + PENDING moderation so admins can review.
 */
@Injectable()
export class ReApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ReApprovalService');
  }

  /**
   * If the product is APPROVED or ACTIVE, move it back to SUBMITTED / PENDING.
   * Returns true if re-approval was triggered, false otherwise.
   */
  async triggerIfNeeded(productId: string, changedBy: string): Promise<boolean> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { status: true, moderationStatus: true },
    });

    if (!product) return false;

    const needsReApproval =
      product.status === 'APPROVED' ||
      product.status === 'ACTIVE';

    if (!needsReApproval) return false;

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          status: 'SUBMITTED',
          moderationStatus: 'PENDING',
        },
      });

      await tx.productStatusHistory.create({
        data: {
          productId,
          fromStatus: product.status,
          toStatus: 'SUBMITTED',
          changedBy,
          reason: 'Product modified by seller — re-approval required',
        },
      });
    });

    this.logger.log(
      `Re-approval triggered for product ${productId} (was ${product.status})`,
    );

    return true;
  }
}
