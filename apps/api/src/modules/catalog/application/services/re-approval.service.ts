import { Injectable, Inject } from '@nestjs/common';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../domain/repositories/product.repository.interface';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';

/**
 * Shared service that triggers re-approval when a seller modifies
 * an already-approved/active product. If the product is in APPROVED or ACTIVE
 * status, it moves back to SUBMITTED + PENDING moderation so admins can review.
 */
@Injectable()
export class ReApprovalService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ReApprovalService');
  }

  /**
   * If the product is APPROVED or ACTIVE, move it back to SUBMITTED / PENDING.
   * Returns true if re-approval was triggered, false otherwise.
   */
  async triggerIfNeeded(productId: string, changedBy: string): Promise<boolean> {
    const product = await this.productRepo.findByIdBasic(productId);

    if (!product) return false;

    const needsReApproval =
      product.status === 'APPROVED' ||
      product.status === 'ACTIVE';

    if (!needsReApproval) return false;

    await this.productRepo.updateStatusInTransaction(
      productId,
      { status: 'SUBMITTED', moderationStatus: 'PENDING' },
      {
        fromStatus: product.status,
        toStatus: 'SUBMITTED',
        changedBy,
        reason: 'Product modified by seller — re-approval required',
      },
    );

    this.logger.log(
      `Re-approval triggered for product ${productId} (was ${product.status})`,
    );

    return true;
  }
}
