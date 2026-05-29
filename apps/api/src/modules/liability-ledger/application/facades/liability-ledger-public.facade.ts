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
    // Phase 0 (PR 0.14) — opt-in SLA deadline. Caller passes the
    // number of hours; the service sets `slaBreachAt` at create.
    slaHours?: number | null;
  }) {
    return this.adminTask.enqueue(args);
  }

  /**
   * Phase 127 — reverse ALL liability attribution for a source.
   *
   * A dispute decision books one of SellerDebit / LogisticsClaim /
   * PlatformExpense at decision time. If the resulting refund is later
   * rejected by finance, the money never moves, so the cost attribution
   * must be reversed — otherwise reconciliation shows a phantom liability
   * (and the seller is debited for a refund that never happened).
   *
   * Each row type reverses independently + idempotently (replay-safe).
   * `reversedAny` is true if at least one row flipped this call;
   * `needsManual` is true if a row was already applied/in-flight and
   * requires an ops settlement reversal / claim withdrawal — the caller
   * should enqueue an admin task in that case.
   */
  async reverseForSource(args: {
    sourceType: LedgerSourceType;
    sourceId: string;
    reason: string;
  }): Promise<{
    sellerDebit: 'reversed' | 'already_reversed' | 'needs_manual' | 'none';
    logisticsClaim: 'reversed' | 'already_reversed' | 'needs_manual' | 'none';
    platformExpense: 'reversed' | 'already_reversed' | 'none';
    reversedAny: boolean;
    needsManual: boolean;
  }> {
    const [sellerDebit, logisticsClaim, platformExpense] = await Promise.all([
      this.sellerDebit.reverseForSource(args),
      this.logisticsClaim.reverseForSource(args),
      this.platformExpense.reverseForSource(args),
    ]);
    return {
      sellerDebit,
      logisticsClaim,
      platformExpense,
      reversedAny: [sellerDebit, logisticsClaim, platformExpense].some(
        (r) => r === 'reversed',
      ),
      needsManual:
        sellerDebit === 'needs_manual' || logisticsClaim === 'needs_manual',
    };
  }
}
