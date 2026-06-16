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
    _returnRecord: any,
  ): { autoApprove: boolean; reason: string } {
    // Policy: auto-approval is DISABLED — every return must be reviewed and
    // approved by an admin, regardless of reason / value / risk. (Previously
    // trusted reasons up to Rs 5,000 auto-approved; turned off per request.)
    return {
      autoApprove: false,
      reason: 'Auto-approval disabled — admin approval required for all returns',
    };
  }
}
