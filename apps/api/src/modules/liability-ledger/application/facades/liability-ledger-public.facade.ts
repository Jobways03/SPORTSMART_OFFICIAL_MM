import { Injectable } from '@nestjs/common';
import type {
  AdminTaskKind,
  LedgerSourceType,
  PlatformExpenseType,
} from '@prisma/client';
import { AdminTaskService } from '../services/admin-task.service';
import { LogisticsClaimService } from '../services/logistics-claim.service';
import { PlatformExpenseService } from '../services/platform-expense.service';
import { SellerDebitService } from '../services/seller-debit.service';

/**
 * Single entry-point for other modules to write liability-ledger rows.
 * The disputes module is the primary caller; future return-only flows
 * (out-of-policy goodwill issued without a dispute) can also call here.
 *
 * All methods are idempotent on (sourceType, sourceId) — saga replays
 * + event handler retries are safe.
 */
@Injectable()
export class LiabilityLedgerPublicFacade {
  constructor(
    private readonly sellerDebit: SellerDebitService,
    private readonly logisticsClaim: LogisticsClaimService,
    private readonly platformExpense: PlatformExpenseService,
    private readonly adminTask: AdminTaskService,
  ) {}

  recordSellerDebit(args: {
    sellerId: string;
    sourceType: LedgerSourceType;
    sourceId: string;
    orderId?: string | null;
    subOrderId?: string | null;
    amountInPaise: number;
    reason: string;
  }) {
    return this.sellerDebit.record(args);
  }

  fileLogisticsClaim(args: {
    sourceType: LedgerSourceType;
    sourceId: string;
    courierName?: string | null;
    awbNumber?: string | null;
    amountInPaise: number;
    reason: string;
    evidenceFileId?: string | null;
    notes?: string | null;
  }) {
    return this.logisticsClaim.file(args);
  }

  recordPlatformExpense(args: {
    sourceType: LedgerSourceType;
    sourceId: string;
    expenseType: PlatformExpenseType;
    amountInPaise: number;
    reason: string;
  }) {
    return this.platformExpense.record(args);
  }

  enqueueAdminTask(args: {
    kind: AdminTaskKind;
    sourceType: LedgerSourceType;
    sourceId: string;
    reason: string;
    assignedTo?: string | null;
  }) {
    return this.adminTask.enqueue(args);
  }
}
