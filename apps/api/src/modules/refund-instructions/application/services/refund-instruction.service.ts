import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  RefundInstruction,
  RefundMethod,
  RefundSourceType,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { WalletPublicFacade } from '../../../wallet/application/facades/wallet-public.facade';
import { RefundSagaService } from '../../../payments-saga/application/services/refund-saga.service';
import type { SagaStep } from '../../../payments-saga/domain/saga-step.types';

export interface CreateInstructionForDisputeArgs {
  disputeId: string;
  disputeNumber: string;
  customerId: string;
  masterOrderId: string | null;
  amountInPaise: number;
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
  ) {}

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

    const idempotencyKey =
      args.idempotencyKey ?? `dispute:${args.disputeId}`;

    // Idempotent insert: if the same idempotencyKey already exists,
    // return that row instead of creating a duplicate. Race-safe via
    // the unique index on idempotency_key.
    const existing = await this.prisma.refundInstruction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      this.logger.log(
        `Reusing existing RefundInstruction ${existing.id} for ${idempotencyKey}`,
      );
      return existing;
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
          `(amount=₹${(args.amountInPaise / 100).toFixed(2)}, ` +
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
      amountInPaise: args.amountInPaise,
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
    const idempotencyKey =
      args.idempotencyKey ?? `return:${args.returnId}`;

    const existing = await this.prisma.refundInstruction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      this.logger.log(
        `Reusing existing RefundInstruction ${existing.id} for ${idempotencyKey}`,
      );
      return existing;
    }

    const requiresApproval = this.amountRequiresApproval(
      args.amountInPaise,
      args.refundMethod ?? 'WALLET',
    );

    let instruction: RefundInstruction;
    try {
      instruction = await this.prisma.refundInstruction.create({
        data: {
          sourceType: 'RETURN' as RefundSourceType,
          sourceId: args.returnId,
          customerId: args.customerId,
          orderId: args.masterOrderId,
          amountInPaise: BigInt(args.amountInPaise),
          refundMethod: args.refundMethod ?? 'WALLET',
          status: requiresApproval ? 'PENDING_APPROVAL' : 'PROCESSING',
          idempotencyKey,
        },
      });
    } catch (err) {
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
          `(return=${args.returnNumber}, amount=₹${(args.amountInPaise / 100).toFixed(2)}) — finance must approve`,
      );
      return instruction;
    }

    return this.runSagaForInstruction(instruction, idempotencyKey, {
      sourceType: 'RETURN',
      sourceId: args.returnId,
      label: args.returnNumber,
      customerId: args.customerId,
      amountInPaise: args.amountInPaise,
    });
  }

  /**
   * Phase 12 (ADR-017) — finance approval. Flips a PENDING_APPROVAL
   * instruction to PROCESSING and runs the saga. Throws if the
   * instruction is in any other state (idempotent on already-approved:
   * if it's already SUCCESS, return as-is; if it's CANCELLED, throw).
   *
   * Source-aware: dispute approvals don't touch the dispute row (the
   * decision was already final); return approvals additionally flip
   * the linked Return from REFUND_PROCESSING → REFUNDED on success so
   * the customer sees the right state.
   */
  async approveByFinance(args: {
    instructionId: string;
    adminId: string;
  }): Promise<RefundInstruction> {
    const row = await this.prisma.refundInstruction.findUnique({
      where: { id: args.instructionId },
    });
    if (!row) {
      throw new Error(`RefundInstruction ${args.instructionId} not found`);
    }
    if (row.status === 'SUCCESS') return row;
    if (row.status !== 'PENDING_APPROVAL') {
      throw new Error(
        `RefundInstruction ${args.instructionId} is ${row.status}, not PENDING_APPROVAL — cannot approve`,
      );
    }
    if (!row.idempotencyKey) {
      throw new Error(
        `RefundInstruction ${args.instructionId} has no idempotencyKey — cannot run saga safely`,
      );
    }

    // Stamp approval + flip to PROCESSING, then run saga.
    const claimed = await this.prisma.refundInstruction.update({
      where: { id: args.instructionId },
      data: {
        status: 'PROCESSING',
        approvedBy: args.adminId,
        approvedAt: new Date(),
      },
    });
    this.logger.log(
      `RefundInstruction ${claimed.id} approved by admin ${args.adminId} — running saga`,
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
  }): Promise<RefundInstruction> {
    const reason = args.reason?.trim();
    if (!reason || reason.length < 3) {
      throw new Error('reason (min 3 chars) is required to reject a refund');
    }
    const row = await this.prisma.refundInstruction.findUnique({
      where: { id: args.instructionId },
    });
    if (!row) {
      throw new Error(`RefundInstruction ${args.instructionId} not found`);
    }
    if (row.status === 'CANCELLED') return row;
    if (row.status !== 'PENDING_APPROVAL') {
      throw new Error(
        `RefundInstruction ${args.instructionId} is ${row.status}, not PENDING_APPROVAL — cannot reject`,
      );
    }
    const updated = await this.prisma.refundInstruction.update({
      where: { id: args.instructionId },
      data: {
        status: 'CANCELLED',
        rejectedBy: args.adminId,
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });
    this.logger.log(
      `RefundInstruction ${updated.id} rejected by admin ${args.adminId}: ${reason}`,
    );
    return updated;
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
    if (row.status !== 'PENDING_APPROVAL') {
      throw new Error(
        `RefundInstruction ${args.instructionId} is ${row.status}, not PENDING_APPROVAL — cannot request clarification`,
      );
    }
    this.logger.log(
      `RefundInstruction ${row.id}: clarification requested by admin ${args.adminId} — ${question}`,
    );
    // Row left untouched intentionally; the request is purely a
    // signal to the upstream admin via AdminTask + audit. The
    // caller wires the AdminTask creation (the controller does it,
    // since LiabilityLedgerPublicFacade isn't directly imported
    // here — keeping this service free of cross-module deps that
    // already exist for the createForDispute path).
    return row;
  }

  /**
   * Dispute-specific gate: applies both the amount threshold AND the
   * goodwill rule. Wraps `amountRequiresApproval` so the dispute path
   * preserves its existing remedy-aware behaviour.
   */
  private disputeRequiresApproval(
    args: CreateInstructionForDisputeArgs,
  ): boolean {
    const goodwillRequiresApproval = this.env.getBoolean(
      'REFUND_GOODWILL_REQUIRES_APPROVAL',
      true,
    );
    if (
      goodwillRequiresApproval &&
      args.customerRemedy === 'GOODWILL_CREDIT'
    ) {
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
    amountInPaise: number,
    refundMethod?: string,
  ): boolean {
    if (refundMethod) {
      const perMethodKey =
        `REFUND_AUTO_APPROVE_THRESHOLD_PAISE_${refundMethod}` as any;
      // env.getOptional returns undefined when the key isn't set;
      // a numeric value (incl. 0) means "use this override".
      const perMethod = this.env.getOptional(perMethodKey);
      if (perMethod !== undefined && perMethod !== '') {
        const n = Number(perMethod);
        if (Number.isFinite(n)) return amountInPaise > n;
      }
    }
    const thresholdPaise = this.env.getNumber(
      'REFUND_AUTO_APPROVE_THRESHOLD_PAISE',
      1_000_000, // ₹10,000
    );
    return amountInPaise > thresholdPaise;
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
    return updated;
  }

  // ─── Step builder ────────────────────────────────────────────────

  private buildStepsForMethod(
    method: RefundMethod,
    meta: { sourceType: RefundSourceType; label: string },
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
  }): SagaStep<RefundExecutionContext> {
    return {
      name: 'wallet.credit',
      execute: async (ctx) => {
        const noun = meta.sourceType === 'RETURN' ? 'Return' : 'Dispute';
        const description = meta.label
          ? `${noun} ${meta.label} — ₹${(ctx.amountInPaise / 100).toFixed(2)} refunded to wallet`
          : `Refund — ₹${(ctx.amountInPaise / 100).toFixed(2)}`;
        const result = await this.wallet.creditFromRefund({
          userId: ctx.customerId,
          amountInPaise: ctx.amountInPaise,
          // The wallet's own (referenceType, referenceId, type) UNIQUE
          // (PR 3.2) makes this idempotent at the DB level. We pass
          // the instruction id so the wallet row is traceable back.
          refundId: ctx.instructionId,
          description,
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
