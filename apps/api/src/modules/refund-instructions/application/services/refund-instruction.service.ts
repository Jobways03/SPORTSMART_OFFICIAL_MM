import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  RefundInstruction,
  RefundMethod,
  RefundSourceType,
} from '@prisma/client';
import { Optional } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { ConflictAppException } from '../../../../core/exceptions';
import { WalletPublicFacade } from '../../../wallet/application/facades/wallet-public.facade';
import { RefundSagaService } from '../../../payments-saga/application/services/refund-saga.service';
import type { SagaStep } from '../../../payments-saga/domain/saga-step.types';
import { RefundSplitCalculatorService } from './refund-split-calculator.service';

export interface CreateInstructionForDisputeArgs {
  disputeId: string;
  disputeNumber: string;
  customerId: string;
  masterOrderId: string | null;
  // Phase 172 (#5) — accept bigint too so callers don't have to down-cast; the
  // create() coerces via BigInt() (exact for integer paise — a JS number is
  // exact to 2^53 ≈ ₹90 trillion, so this was never a real-world precision risk).
  amountInPaise: number | bigint;
  // Phase 172 (#12) — optional apologetic customer-facing message for goodwill.
  customerVisibleMessage?: string | null;
  // Wallet is the default for dispute resolutions per ADR-009.
  // Admin can override to BANK_TRANSFER for high-value cases.
  refundMethod?: RefundMethod;
  /**
   * Phase 12 (ADR-017) — used by the threshold-gate logic to decide
   * whether the instruction auto-executes or queues for finance
   * approval. Goodwill always queues regardless of amount when the
   * `REFUND_GOODWILL_REQUIRES_APPROVAL` flag is on.
   */
  customerRemedy?:
    | 'FULL_REFUND'
    | 'PARTIAL_REFUND'
    | 'GOODWILL_CREDIT'
    | 'NO_REFUND';
  /**
   * Used to dedupe replays. The dispute decision uses
   * `dispute:${disputeId}` so a re-emission of disputes.decided cannot
   * mint a second instruction.
   */
  idempotencyKey?: string;
}

/**
 * Phase 12 (ADR-017) — return-side equivalent of the dispute create-args.
 * Returns don't carry a customerRemedy (they're always FULL_REFUND of the
 * approved amount), but the threshold gate still applies.
 */
export interface CreateInstructionForReturnArgs {
  returnId: string;
  returnNumber: string;
  customerId: string;
  masterOrderId: string | null;
  amountInPaise: number;
  refundMethod?: RefundMethod;
  idempotencyKey?: string;
}

export interface RefundExecutionContext {
  instructionId: string;
  customerId: string;
  amountInPaise: number;
  refundMethod: RefundMethod;
  refundIdempotencyKey: string;
  walletTransactionId?: string;
  gatewayRefundId?: string;
}

/**
 * Phase 3 (PR 3.4) — RefundInstructionService.
 *
 * Single entry-point for "create a refund and execute it." Replaces the
 * direct walletFacade.creditFromRefund call from DisputeRefundHandler
 * and the gateway-vs-wallet branching inside ReturnService.initiateRefund.
 *
 * Two-stage flow:
 *   1. createForDispute / createForReturn / createForGoodwill — persists
 *      a RefundInstruction in PROCESSING and starts the saga.
 *   2. RefundSagaService runs the steps:
 *        a. executeMethod (wallet credit / Razorpay refund / etc.)
 *        b. updateInstructionToSuccess
 *      On any failure the saga compensates and flips the instruction to
 *      FAILED with the reason.
 *
 * Behaviour at flag-OFF: createForDispute returns null. Callers fall
 * back to legacy direct-wallet-credit. Lets us land the schema +
 * service safely; flip REFUND_INSTRUCTION_REQUIRED on once the saga
 * paths have soaked.
 */
@Injectable()
export class RefundInstructionService {
  private readonly logger = new Logger(RefundInstructionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly wallet: WalletPublicFacade,
    private readonly saga: RefundSagaService,
    private readonly splitCalculator: RefundSplitCalculatorService,
    // Phase 170 (#2-approve) — emit refunds.instruction.approved for the
    // customer-notification handler. @Optional so existing specs that construct
    // the service with 5 args keep working (EventBus is @Global in prod).
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Phase 170 (#16) — append a status-transition history row (best-effort; a
   * history-write failure must never fail the money operation). `actorId` is an
   * admin id or a SYSTEM sentinel ('saga', 'recon', 'system').
   */
  private async recordHistory(
    instructionId: string,
    fromStatus: RefundInstruction['status'] | null,
    toStatus: RefundInstruction['status'],
    actorId: string | null,
    notes?: string,
  ): Promise<void> {
    try {
      await this.prisma.refundInstructionStatusHistory.create({
        data: {
          instructionId,
          fromStatus: fromStatus ?? null,
          toStatus,
          actorId: actorId ?? null,
          notes: notes ?? null,
        },
      });
    } catch (err) {
      // Best-effort: a history-write failure must never fail the money op.
      this.logger.error(
        `Failed to record status history for ${instructionId} (${fromStatus}→${toStatus}): ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /**
   * Phase 170 (#6) — compute the approval SLA deadline for a freshly-queued
   * instruction (createdAt + REFUND_APPROVAL_SLA_HOURS, default 48h).
   */
  private approvalDueByFromNow(): Date {
    const hours = this.env.getNumber('REFUND_APPROVAL_SLA_HOURS', 48);
    return new Date(Date.now() + Math.max(1, hours) * 3_600_000);
  }

  /**
   * Multi-payment refund split (2026-05-16). When an order was paid via
   * wallet AND gateway, the refund must split proportionally back to
   * each source. This helper centralises the split logic for both
   * dispute and return refunds.
   *
   * Returns the list of RefundInstruction rows created (one per leg).
   * Single-source orders get exactly one row, identical to the legacy
   * behaviour.
   *
   * Idempotency: each leg's key is `<base>:<legSuffix>` (e.g.
   * `return:R-1234:wallet`), so a re-emission of the source event
   * finds existing legs via findUnique and short-circuits.
   */
  async createSplitForRefund(args: {
    sourceType: RefundSourceType;
    sourceId: string;
    sourceLabel: string;
    customerId: string;
    masterOrderId: string | null;
    amountInPaise: bigint;
    baseIdempotencyKey: string;
    customerPreferredMethod?: RefundMethod;
    /**
     * Phase 258 — route the entire refund to the wallet (store credit) as a
     * single leg, used for pre-acceptance cancels/rejections.
     */
    forceFullWallet?: boolean;
    /**
     * Override the amount/method approval-threshold gate. The cancel flow sets
     * this to gate approval by SHIP STATUS (pre-ship = auto-credit, post-ship =
     * finance approval) — both legs are WALLET, so the per-method threshold
     * can't distinguish them. When undefined, the threshold logic applies.
     */
    requiresApproval?: boolean;
  }): Promise<RefundInstruction[]> {
    const legs = await this.splitCalculator.calculateSplit({
      masterOrderId: args.masterOrderId,
      totalRefundAmountInPaise: args.amountInPaise,
      customerPreferredMethod: args.customerPreferredMethod,
      forceFullWallet: args.forceFullWallet,
    });
    if (legs.length === 0) {
      this.logger.warn(
        `createSplitForRefund: no legs for ${args.sourceType} ${args.sourceLabel}`,
      );
      return [];
    }

    const created: RefundInstruction[] = [];
    for (const leg of legs) {
      const legKey =
        legs.length === 1
          ? args.baseIdempotencyKey
          : `${args.baseIdempotencyKey}:${leg.legSuffix}`;

      const existing = await this.prisma.refundInstruction.findUnique({
        where: { idempotencyKey: legKey },
      });
      if (existing) {
        created.push(existing);
        continue;
      }

      const requiresApproval =
        args.requiresApproval ??
        this.amountRequiresApproval(Number(leg.amountInPaise), leg.method);

      try {
        const row = await this.prisma.refundInstruction.create({
          data: {
            sourceType: args.sourceType,
            sourceId: args.sourceId,
            customerId: args.customerId,
            orderId: args.masterOrderId,
            amountInPaise: leg.amountInPaise,
            refundMethod: leg.method,
            status: requiresApproval ? 'PENDING_APPROVAL' : 'PROCESSING',
            // Phase 170 (#6) — SLA deadline only while it awaits approval.
            approvalDueBy: requiresApproval ? this.approvalDueByFromNow() : null,
            idempotencyKey: legKey,
            // For multi-leg splits, surface the leg context via the
            // failureReason column with a [SPLIT_LEG] prefix so it's
            // distinguishable from a real failure. (A future migration
            // can promote this to its own `legReason` column.)
            failureReason:
              legs.length > 1 ? `[SPLIT_LEG] ${leg.reason}` : null,
          },
        });
        created.push(row);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const winner = await this.prisma.refundInstruction.findUnique({
            where: { idempotencyKey: legKey },
          });
          if (winner) {
            created.push(winner);
            continue;
          }
        }
        throw err;
      }
    }

    // Kick off saga per leg in parallel. A failure in one leg must
    // not strand the others.
    for (const row of created) {
      if (row.status !== 'PROCESSING') continue;
      this.runSagaForInstruction(row, row.idempotencyKey ?? '', {
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        label: args.sourceLabel,
        customerId: args.customerId,
        amountInPaise: Number(row.amountInPaise),
      }).catch((err) => {
        this.logger.error(
          `Saga for leg ${row.id} (${row.refundMethod}) failed: ${(err as Error).message}`,
        );
      });
    }

    this.logger.log(
      `createSplitForRefund: ${created.length} leg(s) for ${args.sourceType} ${args.sourceLabel} ` +
        `[${legs.map((l) => `${l.method}=₹${(l.amountInPaise / 100n).toString()}`).join(', ')}]`,
    );

    return created;
  }

  /**
   * Build + execute a refund instruction triggered by a buyer-favoured
   * (or split) dispute decision.
   *
   * Phase 12 (ADR-016): the legacy direct-wallet fallback in
   * DisputeRefundHandler was deleted. The Phase-3 feature flag
   * `REFUND_INSTRUCTION_REQUIRED` no longer gates this path — disputes
   * MUST go through the instruction → saga flow. The flag still
   * applies to RETURN-driven refunds (createForReturn / createForGoodwill)
   * during their own gradual cutover. Comments + docstring kept the
   * mention of the flag below for the return paths.
   */
  async createForDispute(
    args: CreateInstructionForDisputeArgs,
  ): Promise<RefundInstruction | null> {
    // Intentionally NOT gated on this.required() — see docstring above.

    const baseKey = args.idempotencyKey ?? `dispute:${args.disputeId}`;
    let idempotencyKey = baseKey;

    // Idempotent insert: if the same idempotencyKey already exists,
    // return that row instead of creating a duplicate. Race-safe via
    // the unique index on idempotency_key.
    const existing = await this.prisma.refundInstruction.findUnique({
      where: { idempotencyKey: baseKey },
    });
    if (existing) {
      // Phase 171 review (CRITICAL) — if the existing instruction for this key
      // is in a finance-REJECTED terminal state (the dispute bounced back and is
      // being re-decided), reusing it would mean the re-decision mints NO new
      // refund and the customer is never paid. Mint a FRESH instruction under a
      // versioned key instead. A genuine replay of a live/decided instruction
      // (PENDING_APPROVAL/PROCESSING/SUCCESS/etc.) still dedups to the row.
      const rejectedTerminal =
        existing.status === 'ROUTED_BACK_TO_DISPUTE' ||
        existing.status === 'REJECTED' ||
        existing.status === 'CANCELLED';
      if (!rejectedTerminal) {
        this.logger.log(
          `Reusing existing RefundInstruction ${existing.id} for ${baseKey}`,
        );
        return existing;
      }
      // Find the next free versioned key (base:redecide-2, -3, …). The count of
      // prior rejected attempts gives a stable, collision-resistant suffix.
      const priorAttempts = await this.prisma.refundInstruction.count({
        where: { sourceType: 'DISPUTE', sourceId: args.disputeId },
      });
      idempotencyKey = `${baseKey}:redecide-${priorAttempts + 1}`;
      // Guard the (rare) case where that versioned key already exists (a prior
      // re-decision that itself was rejected): return it if it's still live.
      const versioned = await this.prisma.refundInstruction.findUnique({
        where: { idempotencyKey },
      });
      if (
        versioned &&
        versioned.status !== 'ROUTED_BACK_TO_DISPUTE' &&
        versioned.status !== 'REJECTED' &&
        versioned.status !== 'CANCELLED'
      ) {
        return versioned;
      }
      if (versioned) {
        // even the versioned slot is rejected — bump once more.
        idempotencyKey = `${baseKey}:redecide-${priorAttempts + 2}`;
      }
      this.logger.log(
        `Prior refund for dispute ${args.disputeId} was finance-rejected ` +
          `(${existing.status}); minting a fresh instruction under ${idempotencyKey}`,
      );
    }

    // ── Phase 12 (ADR-017) — finance approval gate ─────────────────
    // Decide auto-execute vs queue-for-approval before we write the row.
    // Two rules:
    //   (a) amountInPaise > REFUND_AUTO_APPROVE_THRESHOLD_PAISE → queue.
    //   (b) GOODWILL_CREDIT remedy AND REFUND_GOODWILL_REQUIRES_APPROVAL
    //       → queue (goodwill is non-recoverable, finance signs off).
    // Default threshold ₹10,000 = 1_000_000 paise. Default goodwill =
    // requires approval. Both knobs configurable per env.
    const requiresApproval = this.disputeRequiresApproval(args);

    let instruction: RefundInstruction;
    try {
      instruction = await this.prisma.refundInstruction.create({
        data: {
          sourceType: 'DISPUTE' as RefundSourceType,
          sourceId: args.disputeId,
          customerId: args.customerId,
          orderId: args.masterOrderId,
          amountInPaise: BigInt(args.amountInPaise),
          refundMethod: args.refundMethod ?? 'WALLET',
          status: requiresApproval ? 'PENDING_APPROVAL' : 'PROCESSING',
          // Phase 170 (#6) — SLA deadline only while it awaits approval.
          approvalDueBy: requiresApproval ? this.approvalDueByFromNow() : null,
          // Phase 171 (#4) — explicit dispute link for fast dispute→refund lookup.
          linkedDisputeId: args.disputeId,
          // Phase 172 (#2/#12) — goodwill is first-class on the row now: an
          // indexed marker + the remedy snapshot (so the row is self-describing
          // for the finance queue + reconciliation) + the customer-facing note.
          isGoodwill: args.customerRemedy === 'GOODWILL_CREDIT',
          customerRemedy: args.customerRemedy ?? null,
          customerVisibleMessage: args.customerVisibleMessage ?? null,
          idempotencyKey,
        },
      });
    } catch (err) {
      // Race lost: another caller minted the instruction between our
      // findUnique and our create. Fetch and use theirs.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const winner = await this.prisma.refundInstruction.findUnique({
          where: { idempotencyKey },
        });
        if (winner) return winner;
      }
      throw err;
    }

    if (requiresApproval) {
      this.logger.log(
        `RefundInstruction ${instruction.id} PENDING_APPROVAL ` +
          `(amount=₹${(Number(args.amountInPaise) / 100).toFixed(2)}, ` +
          `remedy=${args.customerRemedy ?? 'unknown'}) — finance must approve`,
      );
      return instruction;
    }

    // Auto-path: run the saga inline.
    return this.runSagaForInstruction(instruction, idempotencyKey, {
      sourceType: 'DISPUTE',
      sourceId: args.disputeId,
      label: args.disputeNumber,
      customerId: args.customerId,
      amountInPaise: Number(args.amountInPaise),
    });
  }

  /**
   * Phase 12 (ADR-017) — return-side analogue of createForDispute.
   *
   * Returns now go through the same finance approval gate. The QC-approved
   * refund amount is the source of truth; the gate only differs in that
   * returns have no remedy column (it's always FULL_REFUND of the
   * approved amount, by construction). Same threshold rule applies:
   * amount > REFUND_AUTO_APPROVE_THRESHOLD_PAISE → PENDING_APPROVAL,
   * else PROCESSING + saga inline.
   */
  async createForReturn(
    args: CreateInstructionForReturnArgs,
  ): Promise<RefundInstruction> {
    const baseIdempotencyKey =
      args.idempotencyKey ?? `return:${args.returnId}`;

    // Phase 3.2 (2026-05-16) — multi-payment refund split.
    // If the original order had a wallet contribution alongside the
    // gateway payment, the refund splits into a wallet leg + a gateway
    // leg. Single-source orders produce one leg, identical to the
    // legacy single-instruction behaviour.
    //
    // We keep the return signature of `createForReturn` as
    // `Promise<RefundInstruction>` for backwards compatibility with the
    // dozen-ish callers; in the split case we return the "primary"
    // (gateway) leg if present, else the first leg. Callers that need
    // all legs should switch to `createSplitForRefund` directly.
    const legs = await this.createSplitForRefund({
      sourceType: 'RETURN' as RefundSourceType,
      sourceId: args.returnId,
      sourceLabel: args.returnNumber,
      customerId: args.customerId,
      masterOrderId: args.masterOrderId,
      amountInPaise: BigInt(args.amountInPaise),
      baseIdempotencyKey,
      customerPreferredMethod: args.refundMethod,
    });

    if (legs.length === 0) {
      throw new Error(
        `createForReturn: split produced zero legs for return ${args.returnNumber}`,
      );
    }

    // Pick the primary leg to return — gateway leg if present
    // (typically the larger amount), else the first.
    const primary =
      legs.find((l) => l.refundMethod === 'ORIGINAL_PAYMENT') ?? legs[0]!;
    return primary;
  }

  /**
   * Phase 12 (ADR-017) — finance approval. Flips a PENDING_APPROVAL
   * instruction to PROCESSING and runs the saga. Throws if the
   * instruction is in any other state (idempotent on already-approved:
   * if it's already SUCCESS, return as-is; if it's CANCELLED, throw).
   *
   * Phase 125 — dual-approval (two-person rule). Refunds at/above
   * REFUND_DUAL_APPROVAL_THRESHOLD_PAISE require TWO distinct finance
   * approvers (separation of duties — the same control banks apply to
   * high-value disbursements). The first approval is *recorded* but does
   * NOT release money: firstApprovedBy is stamped and the instruction
   * stays PENDING_APPROVAL. Only a second approval by a DIFFERENT admin
   * flips it to PROCESSING and runs the saga. The same admin approving
   * twice is rejected (409). The release flip is a compare-and-swap on
   * status so two distinct second-approvers racing can't double-run the
   * saga. Below the threshold the legacy single-approval path is intact.
   *
   * The boolean `pendingSecondApproval` on the returned object lets the
   * controller word its response + audit row correctly ("first approval
   * recorded" vs "approved — executing"). It's a transient annotation,
   * not a persisted column.
   *
   * Source-aware: dispute approvals don't touch the dispute row (the
   * decision was already final); return approvals additionally flip
   * the linked Return from REFUND_PROCESSING → REFUNDED on success so
   * the customer sees the right state.
   */
  async approveByFinance(args: {
    instructionId: string;
    adminId: string;
  }): Promise<RefundInstruction & { pendingSecondApproval?: boolean }> {
    const row = await this.prisma.refundInstruction.findUnique({
      where: { id: args.instructionId },
    });
    if (!row) {
      throw new Error(`RefundInstruction ${args.instructionId} not found`);
    }
    if (row.status === 'SUCCESS') return row;
    // Phase 170 (#10) — a NEEDS_CLARIFICATION instruction is still decidable;
    // approving it resolves the clarification and proceeds.
    if (row.status !== 'PENDING_APPROVAL' && row.status !== 'NEEDS_CLARIFICATION') {
      throw new ConflictAppException(
        `RefundInstruction ${args.instructionId} is ${row.status}, not awaiting approval — cannot approve`,
      );
    }
    const fromStatus = row.status; // PENDING_APPROVAL | NEEDS_CLARIFICATION
    if (!row.idempotencyKey) {
      throw new Error(
        `RefundInstruction ${args.instructionId} has no idempotencyKey — cannot run saga safely`,
      );
    }

    // ── Phase 125 — dual-approval gate ─────────────────────────────────
    const dualThreshold = this.env.getNumber(
      'REFUND_DUAL_APPROVAL_THRESHOLD_PAISE',
      10_000_000, // ₹1,00,000
    );
    const requiresDual = Number(row.amountInPaise) >= dualThreshold;

    if (requiresDual) {
      // Stage 1 — no first approver yet: record this admin as the first
      // approver and HOLD. CAS on firstApprovedBy=null so two concurrent
      // "first approvals" can't both win the slot.
      if (!row.firstApprovedBy) {
        const claim = await this.prisma.refundInstruction.updateMany({
          where: {
            id: args.instructionId,
            status: { in: ['PENDING_APPROVAL', 'NEEDS_CLARIFICATION'] },
            firstApprovedBy: null,
          },
          data: {
            firstApprovedBy: args.adminId,
            firstApprovedAt: new Date(),
          },
        });
        if (claim.count === 1) {
          const held = await this.prisma.refundInstruction.findUnique({
            where: { id: args.instructionId },
          });
          this.logger.log(
            `RefundInstruction ${args.instructionId}: first approval recorded by ` +
              `admin ${args.adminId} (amount=₹${(Number(row.amountInPaise) / 100).toFixed(2)}) ` +
              `— a second, distinct approver is required before the refund executes`,
          );
          return { ...(held as RefundInstruction), pendingSecondApproval: true };
        }
        // Lost the race for the first-approval slot — another admin became
        // the first approver. Re-read and fall through to the SoD check so
        // we treat this caller as the (potential) second approver.
        const fresh = await this.prisma.refundInstruction.findUnique({
          where: { id: args.instructionId },
        });
        if (
          !fresh ||
          (fresh.status !== 'PENDING_APPROVAL' &&
            fresh.status !== 'NEEDS_CLARIFICATION')
        ) {
          throw new ConflictAppException(
            `RefundInstruction ${args.instructionId} is no longer awaiting approval`,
          );
        }
        row.firstApprovedBy = fresh.firstApprovedBy;
      }

      // Stage 2 — separation of duties: the second approver must differ
      // from the first.
      if (row.firstApprovedBy === args.adminId) {
        throw new ConflictAppException(
          'Separation of duties: this high-value refund needs a second, ' +
            'distinct approver — you recorded the first approval.',
        );
      }
    }

    // Stamp approval + flip to PROCESSING via CAS, then run saga. The
    // CAS (status: PENDING_APPROVAL in the WHERE) guarantees exactly one
    // releaser even if two distinct admins approve concurrently.
    const release = await this.prisma.refundInstruction.updateMany({
      where: {
        id: args.instructionId,
        status: { in: ['PENDING_APPROVAL', 'NEEDS_CLARIFICATION'] },
      },
      data: {
        status: 'PROCESSING',
        approvedBy: args.adminId,
        approvedAt: new Date(),
        approvalDueBy: null,
      },
    });
    if (release.count === 0) {
      const fresh = await this.prisma.refundInstruction.findUnique({
        where: { id: args.instructionId },
      });
      if (fresh && fresh.status === 'SUCCESS') return fresh;
      throw new ConflictAppException(
        `RefundInstruction ${args.instructionId} was already actioned by another approver`,
      );
    }
    const claimed = (await this.prisma.refundInstruction.findUnique({
      where: { id: args.instructionId },
    })) as RefundInstruction;
    this.logger.log(
      `RefundInstruction ${claimed.id} approved by admin ${args.adminId} — running saga` +
        (requiresDual
          ? ` (dual-approval: first=${claimed.firstApprovedBy}, second=${args.adminId})`
          : ''),
    );
    await this.recordHistory(claimed.id, fromStatus, 'PROCESSING', args.adminId, 'finance approved');
    // Phase 170 (#2-approve) — emit the approved event so the customer is told
    // their refund cleared finance review (mirror of the rejected event). The
    // notification handler consumes it; best-effort so a notify hiccup can't
    // fail the approval.
    await this.eventBus
      ?.publish({
        eventName: 'refunds.instruction.approved',
        aggregate: 'RefundInstruction',
        aggregateId: claimed.id,
        occurredAt: new Date(),
        payload: {
          instructionId: claimed.id,
          sourceType: claimed.sourceType,
          sourceId: claimed.sourceId,
          customerId: claimed.customerId,
          amountInPaise: claimed.amountInPaise.toString(),
        },
      })
      .catch((err) =>
        this.logger.error(
          `Failed to emit refunds.instruction.approved for ${claimed.id}: ${(err as Error).message}`,
        ),
      );

    const labelPrefix = claimed.sourceType === 'RETURN' ? 'return' : 'dispute';
    const ranInstruction = await this.runSagaForInstruction(
      claimed,
      claimed.idempotencyKey!,
      {
        sourceType: claimed.sourceType,
        sourceId: claimed.sourceId,
        // We don't have the original return/dispute number here; the
        // saga's step builder only uses it for the wallet description
        // string. The id-prefixed fallback is enough for audit trail.
        label: `${labelPrefix}:${claimed.sourceId.slice(0, 8)}`,
        customerId: claimed.customerId,
        amountInPaise: Number(claimed.amountInPaise),
      },
    );

    // Return-side post-approval bookkeeping: the linked Return is sitting
    // in REFUND_PROCESSING (since the gateway returned completed=false
    // when it queued for approval). Flip it to REFUNDED only when the
    // saga actually settled the wallet.
    if (
      ranInstruction.sourceType === 'RETURN' &&
      ranInstruction.status === 'SUCCESS'
    ) {
      try {
        await this.prisma.return.update({
          where: { id: ranInstruction.sourceId },
          data: {
            status: 'REFUNDED',
            refundProcessedAt: new Date(),
            refundReference:
              ranInstruction.walletTransactionId
                ? `wallet:${ranInstruction.walletTransactionId}`
                : (ranInstruction.gatewayRefundId ?? null),
          },
        });
        this.logger.log(
          `Return ${ranInstruction.sourceId} flipped to REFUNDED after finance approval`,
        );
      } catch (err) {
        // The instruction is SUCCESS regardless — we don't want a stale
        // return-row update to mask a successful wallet credit. Log and
        // surface to ops.
        this.logger.error(
          `Return ${ranInstruction.sourceId} REFUNDED-flip failed after approve: ${(err as Error).message}`,
        );
      }
    }

    return ranInstruction;
  }

  /**
   * Phase 12 (ADR-017) — finance reject. Flips PENDING_APPROVAL to
   * CANCELLED with reason. Does NOT reverse the dispute decision —
   * that's a separate ops action (the dispute is decided; rejecting
   * the refund means finance is contesting the *money movement*, not
   * the legal outcome). If the dispute should be undecided too, ops
   * does that explicitly.
   */
  async rejectByFinance(args: {
    instructionId: string;
    adminId: string;
    reason: string;
    // Phase 171 (#6) — optional SAFE customer-facing message, kept separate
    // from the internal `reason` (which may contain "fraud signals" etc).
    customerVisibleReason?: string;
  }): Promise<RefundInstruction & { routedBackToDispute?: boolean }> {
    const reason = args.reason?.trim();
    if (!reason || reason.length < 3) {
      throw new Error('reason (min 3 chars) is required to reject a refund');
    }
    const customerVisibleReason = args.customerVisibleReason?.trim() || null;
    const row = await this.prisma.refundInstruction.findUnique({
      where: { id: args.instructionId },
    });
    if (!row) {
      throw new Error(`RefundInstruction ${args.instructionId} not found`);
    }
    // Phase 171 (#2) — idempotent on either finance-rejection terminal state.
    if (
      row.status === 'CANCELLED' ||
      row.status === 'REJECTED' ||
      row.status === 'ROUTED_BACK_TO_DISPUTE'
    ) {
      return row;
    }
    // Phase 170 (#10) — a NEEDS_CLARIFICATION instruction is rejectable too.
    if (row.status !== 'PENDING_APPROVAL' && row.status !== 'NEEDS_CLARIFICATION') {
      // Phase 171 (#13) — symmetric defence: never reject a row whose money may
      // already be moving/moved (PROCESSING/SUCCESS/SETTLED/MANUAL_REQUIRED).
      throw new ConflictAppException(
        `RefundInstruction ${args.instructionId} is ${row.status}, not awaiting approval — cannot reject`,
      );
    }
    // Phase 171 (#1/#2/#3) — a dispute-sourced rejection ROUTES BACK to the
    // dispute team (the headline rule); a non-dispute (e.g. RETURN) rejection is
    // a plain finance REJECTED. Both are distinct from an admin pre-approval
    // CANCELLED.
    const isDispute = row.sourceType === 'DISPUTE';
    const terminalStatus = isDispute ? 'ROUTED_BACK_TO_DISPUTE' : 'REJECTED';
    // Phase 170 (#4)/#171(#8/#9) — CAS so a concurrent approve can't race a
    // reject (both read PENDING_APPROVAL, both write). Exactly one wins.
    const res = await this.prisma.refundInstruction.updateMany({
      where: {
        id: args.instructionId,
        status: { in: ['PENDING_APPROVAL', 'NEEDS_CLARIFICATION'] },
      },
      data: {
        status: terminalStatus,
        rejectedBy: args.adminId,
        rejectedAt: new Date(),
        rejectionReason: reason,
        customerVisibleReason,
        approvalDueBy: null,
        linkedDisputeId: isDispute ? row.sourceId : row.linkedDisputeId,
        routedBackAt: isDispute ? new Date() : null,
        routedBackBy: isDispute ? args.adminId : null,
      },
    });
    if (res.count === 0) {
      const fresh = await this.prisma.refundInstruction.findUnique({
        where: { id: args.instructionId },
      });
      if (
        fresh &&
        (fresh.status === 'CANCELLED' ||
          fresh.status === 'REJECTED' ||
          fresh.status === 'ROUTED_BACK_TO_DISPUTE')
      ) {
        return fresh;
      }
      throw new ConflictAppException(
        `RefundInstruction ${args.instructionId} was already actioned by another approver`,
      );
    }
    await this.recordHistory(args.instructionId, row.status, terminalStatus, args.adminId, reason);
    const updated = (await this.prisma.refundInstruction.findUnique({
      where: { id: args.instructionId },
    })) as RefundInstruction;
    this.logger.log(
      `RefundInstruction ${updated.id} ${terminalStatus} by admin ${args.adminId}: ${reason}`,
    );
    return { ...updated, routedBackToDispute: isDispute };
  }

  /**
   * Phase 13 completion (ADR-017 future-work) — "request additional
   * info" action between approve and reject. Finance reviewer flags
   * the instruction as needing clarification from the QC admin
   * (was the receiver damaged before QC opened the box? was the
   * vendor name correctly captured? etc). The instruction stays in
   * PENDING_APPROVAL — the QC admin sees the request via the
   * AdminTask queue and either updates the underlying return /
   * dispute or replies; finance then re-reviews.
   *
   * No schema migration needed: the request is captured as an
   * AdminTask + audit-log entry. Heavier "QC amends his decision"
   * flows can come later.
   */
  async requestClarification(args: {
    instructionId: string;
    adminId: string;
    question: string;
  }): Promise<RefundInstruction> {
    const question = args.question?.trim();
    if (!question || question.length < 3) {
      throw new Error('question (min 3 chars) is required');
    }
    const row = await this.prisma.refundInstruction.findUnique({
      where: { id: args.instructionId },
    });
    if (!row) {
      throw new Error(`RefundInstruction ${args.instructionId} not found`);
    }
    // Phase 170 (#10) — allow re-asking while already NEEDS_CLARIFICATION
    // (finance can append a follow-up question), but not from a decided state.
    if (row.status !== 'PENDING_APPROVAL' && row.status !== 'NEEDS_CLARIFICATION') {
      throw new Error(
        `RefundInstruction ${args.instructionId} is ${row.status}, not awaiting approval — cannot request clarification`,
      );
    }
    // Phase 170 (#10) — flip OUT of the "to decide" queue into
    // NEEDS_CLARIFICATION + persist the question/actor, via CAS so a concurrent
    // approve/reject can't be clobbered. Idempotent re-ask: if already
    // NEEDS_CLARIFICATION the CAS still matches and updates the note.
    const res = await this.prisma.refundInstruction.updateMany({
      where: {
        id: args.instructionId,
        status: { in: ['PENDING_APPROVAL', 'NEEDS_CLARIFICATION'] },
      },
      data: {
        status: 'NEEDS_CLARIFICATION',
        clarificationNote: question,
        clarificationBy: args.adminId,
        clarificationAt: new Date(),
      },
    });
    if (res.count === 0) {
      throw new ConflictAppException(
        `RefundInstruction ${args.instructionId} is no longer awaiting approval`,
      );
    }
    if (row.status !== 'NEEDS_CLARIFICATION') {
      await this.recordHistory(
        args.instructionId,
        row.status,
        'NEEDS_CLARIFICATION',
        args.adminId,
        question,
      );
    }
    this.logger.log(
      `RefundInstruction ${row.id}: clarification requested by admin ${args.adminId} — ${question}`,
    );
    return (await this.prisma.refundInstruction.findUnique({
      where: { id: args.instructionId },
    })) as RefundInstruction;
  }

  /**
   * Phase 170 (Refund Queue audit #15) — undo a wrong rejection. Flips a
   * CANCELLED instruction back to PENDING_APPROVAL (CAS-guarded) so finance
   * doesn't have to mint a fresh instruction (which the @unique idempotencyKey
   * would block). Clears the rejection stamps + re-sets the SLA clock.
   */
  async revertRejection(args: {
    instructionId: string;
    adminId: string;
    reason: string;
  }): Promise<RefundInstruction> {
    const reason = args.reason?.trim();
    if (!reason || reason.length < 3) {
      throw new Error('reason (min 3 chars) is required to revert a rejection');
    }
    const row = await this.prisma.refundInstruction.findUnique({
      where: { id: args.instructionId },
    });
    if (!row) {
      throw new Error(`RefundInstruction ${args.instructionId} not found`);
    }
    if (row.status === 'PENDING_APPROVAL') return row; // idempotent
    if (row.status !== 'CANCELLED') {
      throw new ConflictAppException(
        `RefundInstruction ${args.instructionId} is ${row.status}, not CANCELLED — cannot revert`,
      );
    }
    const res = await this.prisma.refundInstruction.updateMany({
      where: { id: args.instructionId, status: 'CANCELLED' },
      data: {
        status: 'PENDING_APPROVAL',
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        approvalDueBy: this.approvalDueByFromNow(),
        // Phase 170 review (L1#2) — CLEAR the dual-approval stamps. A re-opened
        // instruction must require FRESH approvals; leaving a stale
        // firstApprovedBy would let a single second approver release a
        // high-value refund, bypassing the two-person rule.
        firstApprovedBy: null,
        firstApprovedAt: null,
        approvedBy: null,
        approvedAt: null,
      },
    });
    if (res.count === 0) {
      throw new ConflictAppException(
        `RefundInstruction ${args.instructionId} was concurrently modified`,
      );
    }
    await this.recordHistory(
      args.instructionId,
      'CANCELLED',
      'PENDING_APPROVAL',
      args.adminId,
      `rejection reverted: ${reason}`,
    );
    this.logger.log(
      `RefundInstruction ${args.instructionId} rejection reverted by admin ${args.adminId}: ${reason}`,
    );
    return (await this.prisma.refundInstruction.findUnique({
      where: { id: args.instructionId },
    })) as RefundInstruction;
  }

  /**
   * Phase 170 (#6) — overdue PENDING_APPROVAL / NEEDS_CLARIFICATION sweep for
   * the aging report (?overdue=true). Returns the rows past their SLA deadline.
   */
  async listOverdueAwaitingApproval(limit = 100) {
    return this.prisma.refundInstruction.findMany({
      where: {
        status: { in: ['PENDING_APPROVAL', 'NEEDS_CLARIFICATION'] },
        approvalDueBy: { lt: new Date() },
      },
      orderBy: { approvalDueBy: 'asc' },
      take: Math.min(200, Math.max(1, limit)),
    });
  }

  /**
   * Dispute-specific gate: applies both the amount threshold AND the
   * goodwill rule. Wraps `amountRequiresApproval` so the dispute path
   * preserves its existing remedy-aware behaviour.
   */
  private disputeRequiresApproval(
    args: CreateInstructionForDisputeArgs,
  ): boolean {
    // Phase 172 (Goodwill Credit audit #1) — goodwill ALWAYS queues for finance
    // approval, regardless of amount. This is a policy INVARIANT, not a tunable:
    // goodwill is a non-recoverable platform expense, so the rule must not be a
    // single config flip away from auto-approving below threshold. Pre-172 this
    // was gated on REFUND_GOODWILL_REQUIRES_APPROVAL (default true) — that flag
    // is now retired from this decision (the constant below is unconditional).
    if (args.customerRemedy === 'GOODWILL_CREDIT') {
      return true;
    }
    return this.amountRequiresApproval(
      args.amountInPaise,
      args.refundMethod ?? 'WALLET',
    );
  }

  /**
   * Pulls the env config for the threshold rule. Defaults to ₹10,000.
   * Centralised so dispute, return, and (future) goodwill paths all
   * share one knob.
   *
   * Phase 13 completion — supports per-method overrides too.
   * Looks for a method-specific env first
   * (`REFUND_AUTO_APPROVE_THRESHOLD_PAISE_<METHOD>`); falls back to
   * the global `REFUND_AUTO_APPROVE_THRESHOLD_PAISE`. Use case from
   * the original spec: "WALLET ₹10k, BANK_TRANSFER ₹0" — wire-bank
   * refunds always require a finance signoff.
   */
  private amountRequiresApproval(
    amountInPaiseRaw: number | bigint,
    refundMethod?: string,
  ): boolean {
    // Phase 172 (#5) — accept bigint; coerce once for the numeric comparison
    // (paise is exact in a JS number up to 2^53 ≈ ₹90 trillion).
    const amountInPaise = Number(amountInPaiseRaw);
    if (refundMethod) {
      const perMethodKey =
        `REFUND_AUTO_APPROVE_THRESHOLD_PAISE_${refundMethod}` as any;
      // env.getOptional returns undefined when the key isn't set;
      // a numeric value (incl. 0) means "use this override".
      const perMethod = this.env.getOptional(perMethodKey);
      if (perMethod !== undefined && perMethod !== '') {
        const n = Number(perMethod);
        // Phase 170 (#17) — >= so a refund EXACTLY at the threshold queues for
        // approval (the defensive choice; an at-threshold refund is precisely
        // the boundary finance wants eyes on).
        if (Number.isFinite(n)) return amountInPaise >= n;
      }
    }
    const thresholdPaise = this.env.getNumber(
      'REFUND_AUTO_APPROVE_THRESHOLD_PAISE',
      1_000_000, // ₹10,000
    );
    // Phase 170 (#17) — >= (was >). At-threshold now requires approval.
    return amountInPaise >= thresholdPaise;
  }

  /**
   * Shared saga-execution helper. Used by the auto-path in
   * createForDispute / createForReturn AND by approveByFinance.
   * Reconciles the instruction status on success or failure.
   *
   * `sourceType` drives the saga's RefundType tag (used for ledgering)
   * and the human label that appears in the wallet description.
   */
  private async runSagaForInstruction(
    instruction: RefundInstruction,
    idempotencyKey: string,
    src: {
      sourceType: RefundSourceType;
      sourceId: string;
      label: string;
      customerId: string;
      amountInPaise: number;
    },
  ): Promise<RefundInstruction> {
    const sagaResult = await this.saga.run<RefundExecutionContext>({
      refundType: src.sourceType,
      sourceId: src.sourceId,
      customerId: src.customerId,
      amountInPaise: src.amountInPaise,
      // Phase 96 (2026-05-23) — Phase 99 audit Gap #11 / #15 closure.
      // Thread idempotencyKey + instructionId so the saga executor
      // can dedupe via @@unique([idempotencyKey]) at the DB layer.
      idempotencyKey: idempotencyKey,
      instructionId: instruction.id,
      context: {
        instructionId: instruction.id,
        customerId: src.customerId,
        amountInPaise: src.amountInPaise,
        refundMethod: instruction.refundMethod,
        refundIdempotencyKey: idempotencyKey,
      },
      steps: this.buildStepsForMethod(instruction.refundMethod, {
        sourceType: src.sourceType,
        label: src.label,
        // Phase 172 (#6/#8/#9) — thread goodwill context (read off the persisted
        // instruction row) into the wallet step so it picks goodwill wording + a
        // GOODWILL creditType + an expiry date.
        isGoodwill: instruction.isGoodwill === true,
        customerRemedy: instruction.customerRemedy ?? undefined,
        customerVisibleMessage: instruction.customerVisibleMessage ?? undefined,
      }),
    });

    if (sagaResult.status === 'COMPLETED') {
      const updated = await this.prisma.refundInstruction.update({
        where: { id: instruction.id },
        data: {
          status: 'SUCCESS',
          processedAt: new Date(),
          walletTransactionId:
            sagaResult.finalContext.walletTransactionId ?? null,
          gatewayRefundId:
            sagaResult.finalContext.gatewayRefundId ?? null,
        },
      });
      this.logger.log(
        `RefundInstruction ${instruction.id} SUCCESS via ${instruction.refundMethod}`,
      );
      await this.recordHistory(instruction.id, instruction.status, 'SUCCESS', 'saga');
      return updated;
    }

    const updated = await this.prisma.refundInstruction.update({
      where: { id: instruction.id },
      data: {
        status: 'FAILED',
        failureReason: sagaResult.failureReason ?? 'Unknown failure',
        attempts: { increment: 1 },
      },
    });
    this.logger.error(
      `RefundInstruction ${instruction.id} FAILED: ${sagaResult.failureReason}`,
    );
    await this.recordHistory(
      instruction.id,
      instruction.status,
      'FAILED',
      'saga',
      sagaResult.failureReason ?? undefined,
    );
    return updated;
  }

  /**
   * Phase 167 (Refund Execution audit #1/#7) — gateway-reconciliation flip.
   * Called by the refund-gateway recon cron (and the refund.settled webhook)
   * AFTER it polls Razorpay's refund GET for a PROCESSING instruction. CAS-
   * guarded so it's idempotent against the webhook / a concurrent recon tick:
   *   - SUCCESS  : gateway says `processed` — PROCESSING → SUCCESS.
   *   - SETTLED  : bank credited (refund.settled webhook) — SUCCESS → SETTLED.
   *   - FAILED   : gateway says `failed` — PROCESSING → FAILED.
   * Returns flipped=false when another path already moved it (no double work).
   */
  async markGatewayOutcome(args: {
    instructionId: string;
    outcome: 'SUCCESS' | 'FAILED' | 'SETTLED';
    failureReason?: string | null;
  }): Promise<{ flipped: boolean }> {
    const fromStatuses =
      args.outcome === 'SETTLED' ? ['SUCCESS'] : ['PROCESSING'];
    const data =
      args.outcome === 'SUCCESS'
        ? { status: 'SUCCESS' as const, processedAt: new Date() }
        : args.outcome === 'SETTLED'
          ? { status: 'SETTLED' as const, settledAt: new Date() }
          : {
              status: 'FAILED' as const,
              failureReason: args.failureReason ?? 'Gateway reported refund failed',
              attempts: { increment: 1 },
            };
    const res = await this.prisma.refundInstruction.updateMany({
      where: { id: args.instructionId, status: { in: fromStatuses as any } },
      data,
    });
    return { flipped: res.count > 0 };
  }

  // ─── Step builder ────────────────────────────────────────────────

  private buildStepsForMethod(
    method: RefundMethod,
    meta: {
      sourceType: RefundSourceType;
      label: string;
      // Phase 172 (#6/#8/#9) — goodwill context for the wallet step.
      isGoodwill?: boolean;
      customerRemedy?: string;
      customerVisibleMessage?: string;
    },
  ): SagaStep<RefundExecutionContext>[] {
    switch (method) {
      case 'WALLET':
        return [this.walletCreditStep(meta)];
      case 'BANK_TRANSFER':
      case 'UPI':
      case 'MANUAL':
        // Manual methods don't execute synchronously here. The
        // instruction stays in PROCESSING / MANUAL_REQUIRED for ops
        // to wire money externally and confirm via the admin endpoint
        // (PR 3.5/3.6). For Phase 3 we just persist the intent.
        return [this.markManualRequiredStep()];
      case 'ORIGINAL_PAYMENT':
        // Razorpay-side refund. Wired in PR 3.6 once the gateway
        // adapter accepts an instruction id; for now mark manual.
        return [this.markManualRequiredStep()];
      case 'COUPON':
        // Goodwill coupon path. Out of scope for Phase 3.
        return [this.markManualRequiredStep()];
      default:
        return [this.markManualRequiredStep()];
    }
  }

  private walletCreditStep(meta: {
    sourceType: RefundSourceType;
    label: string;
    // Phase 172 (#6/#8/#9) — goodwill credit context.
    isGoodwill?: boolean;
    customerRemedy?: string | null;
    customerVisibleMessage?: string;
  }): SagaStep<RefundExecutionContext> {
    return {
      name: 'wallet.credit',
      execute: async (ctx) => {
        const noun = meta.sourceType === 'RETURN' ? 'Return' : 'Dispute';
        // Phase 172 (#6) — a goodwill credit reads differently on the customer's
        // wallet statement than a genuine refund: it's an apology, not money we
        // owed. Prefer an explicit customer-visible message if finance set one.
        const rupees = (ctx.amountInPaise / 100).toFixed(2);
        const description = meta.isGoodwill
          ? meta.customerVisibleMessage?.trim()
            ? meta.customerVisibleMessage.trim()
            : `${noun}${meta.label ? ` ${meta.label}` : ''} — ₹${rupees} goodwill credit (with our apologies)`
          : meta.label
            ? `${noun} ${meta.label} — ₹${rupees} refunded to wallet`
            : `Refund — ₹${rupees}`;
        // Phase 172 (#9) — goodwill credit lapses after a configurable window
        // (default 180 days); a genuine refund never expires.
        const expiresAt = meta.isGoodwill
          ? new Date(
              Date.now() +
                this.env.getNumber('GOODWILL_CREDIT_EXPIRY_DAYS', 180) *
                  24 *
                  60 *
                  60 *
                  1000,
            )
          : undefined;
        const result = await this.wallet.creditFromRefund({
          userId: ctx.customerId,
          amountInPaise: ctx.amountInPaise,
          // The wallet's own (referenceType, referenceId, type) UNIQUE
          // (PR 3.2) makes this idempotent at the DB level. We pass
          // the instruction id so the wallet row is traceable back.
          refundId: ctx.instructionId,
          description,
          // Phase 172 (#8) — reconciliation discriminator: goodwill is a
          // platform expense, a refund is a liability reversal.
          creditType: meta.isGoodwill ? 'GOODWILL' : 'REFUND_ORIGINAL',
          expiresAt,
        });
        return {
          result: { walletTransactionId: result.transaction.id },
          contextUpdate: {
            walletTransactionId: result.transaction.id,
          },
        };
      },
      // Compensation: a wallet credit isn't trivially reversible. We
      // post a CREDIT_ADJUSTMENT debit with a clear "refund-saga rollback"
      // reference. In practice the saga's only forward step is the
      // credit itself, so compensation only fires when a later step
      // (none today) fails — none today, so this is documentary.
      compensate: async (ctx, forwardResult) => {
        const r = forwardResult as { walletTransactionId?: string };
        this.logger.warn(
          `wallet.credit compensation requested for tx ${r.walletTransactionId} — manual review required`,
        );
        // Intentionally NOT auto-debiting. A wallet rollback from a
        // failed downstream step is operationally rare AND a financial
        // reversal we don't want to do silently. Surface to ops via
        // the saga's recorded compensation row (status=FAILED).
        throw new Error(
          'wallet.credit compensation requires manual ops review',
        );
      },
    };
  }

  private markManualRequiredStep(): SagaStep<RefundExecutionContext> {
    return {
      name: 'instruction.manual-required',
      execute: async (ctx) => {
        await this.prisma.refundInstruction.update({
          where: { id: ctx.instructionId },
          data: { status: 'MANUAL_REQUIRED' },
        });
        return { result: { manual: true } };
      },
    };
  }

  // ─── Internals ────────────────────────────────────────────────────

  private required(): boolean {
    return this.env.getBoolean('REFUND_INSTRUCTION_REQUIRED', false);
  }
}
