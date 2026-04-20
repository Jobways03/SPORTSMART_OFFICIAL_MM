import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';

@Injectable()
export class ReturnAutoApprovalService {
  // Auto-approval thresholds (configurable)
  private readonly AUTO_APPROVE_REASONS = [
    'DEFECTIVE',
    'WRONG_ITEM',
    'NOT_AS_DESCRIBED',
    'DAMAGED_IN_TRANSIT',
  ];
  private readonly AUTO_APPROVE_VALUE_THRESHOLD = 5000; // Rs 5,000 — above this needs admin

  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext('ReturnAutoApprovalService');
  }

  /**
   * Determine if a return should be auto-approved.
   * Rules:
   * - All items have a "trusted" reason category (defective, wrong item, etc.)
   * - Total return value is below threshold
   * - Returns: { autoApprove: boolean, reason: string }
   */
  evaluateAutoApproval(
    returnRecord: any,
  ): { autoApprove: boolean; reason: string } {
    // Calculate total return value
    let totalValue = 0;
    let allReasonsTrusted = true;

    const items = returnRecord?.items ?? [];
    for (const item of items) {
      const orderItem = item.orderItem;
      if (orderItem) {
        totalValue += Number(orderItem.unitPrice) * item.quantity;
      }
      if (!this.AUTO_APPROVE_REASONS.includes(item.reasonCategory)) {
        allReasonsTrusted = false;
      }
    }

    if (totalValue > this.AUTO_APPROVE_VALUE_THRESHOLD) {
      return {
        autoApprove: false,
        reason: `Return value Rs ${totalValue} exceeds auto-approval threshold Rs ${this.AUTO_APPROVE_VALUE_THRESHOLD}`,
      };
    }

    if (!allReasonsTrusted) {
      return {
        autoApprove: false,
        reason:
          'Some items have non-trusted return reasons (CHANGED_MIND, SIZE_FIT_ISSUE, etc.) — admin review required',
      };
    }

    return {
      autoApprove: true,
      reason:
        'All items qualify for auto-approval (trusted reason + value below threshold)',
    };
  }
}
