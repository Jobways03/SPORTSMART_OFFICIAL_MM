import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AdminAuthGuard,
  PermissionsGuard,
  RequiresStepUp,
  StepUpGuard,
} from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import {
  BadRequestAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import {
  BulkApproveDto,
  RejectRefundDto,
  RequestInfoDto,
  RevertRejectionDto,
} from '../dtos/refund-approval.dto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { RefundInstructionService } from '../../application/services/refund-instruction.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { LiabilityLedgerPublicFacade } from '../../../liability-ledger/application/facades/liability-ledger-public.facade';

/**
 * Phase 12 (ADR-017) — finance approval queue for refund instructions.
 *
 * Refunds above the auto-approve threshold or any goodwill credit land
 * here as PENDING_APPROVAL. A separate role (`refunds.approve`)
 * approves or rejects each one. The dispute decision itself is
 * untouched — rejecting only halts the *money movement*, not the
 * legal outcome of the dispute.
 */
@ApiTags('Refunds — Admin')
@Controller('admin/refund-instructions')
@UseGuards(AdminAuthGuard, PermissionsGuard, StepUpGuard)
export class AdminRefundApprovalsController {
  private readonly logger = new Logger(AdminRefundApprovalsController.name);

  constructor(
    private readonly service: RefundInstructionService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    private readonly ledger: LiabilityLedgerPublicFacade,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * List refund instructions, optionally filtered by status. The most
   * common filter is status=PENDING_APPROVAL — that's the queue. Other
   * statuses are useful for "recently approved" / "recently rejected"
   * audit views.
   */
  @Get()
  @Permissions('refunds.read')
  async list(
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    // Phase 170 (#8) — finance triage filters.
    @Query('sourceType') sourceType?: string,
    @Query('refundMethod') refundMethod?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    // Phase 170 (#6) — overdue-only aging view.
    @Query('overdue') overdue?: string,
    // Phase 172 (#17) — "show goodwill only" finance filter.
    @Query('goodwill') goodwill?: string,
  ) {
    const validStatuses = [
      'PENDING_APPROVAL',
      'NEEDS_CLARIFICATION',
      'APPROVED',
      'PROCESSING',
      'SUCCESS',
      'SETTLED',
      'FAILED',
      'RETRYING',
      'MANUAL_REQUIRED',
      'CANCELLED',
    ];
    if (status && !validStatuses.includes(status)) {
      throw new BadRequestAppException(
        `status must be one of: ${validStatuses.join(', ')}`,
      );
    }
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const where: any = {};
    if (status) where.status = status as any;
    if (sourceType) where.sourceType = sourceType as any;
    if (refundMethod) where.refundMethod = refundMethod as any;
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }
    if (minAmount || maxAmount) {
      // Phase 170 review (L2#3) — guard BigInt() against non-numeric input so a
      // bad ?minAmount=abc returns a clean 400, not an unhandled 500.
      const toPaise = (v: string, label: string): bigint => {
        if (!/^\d+$/.test(v)) {
          throw new BadRequestAppException(`${label} must be a non-negative integer (paise)`);
        }
        return BigInt(v);
      };
      where.amountInPaise = {};
      if (minAmount) where.amountInPaise.gte = toPaise(minAmount, 'minAmount');
      if (maxAmount) where.amountInPaise.lte = toPaise(maxAmount, 'maxAmount');
    }
    if (overdue === 'true') {
      where.status = where.status
        ? where.status
        : { in: ['PENDING_APPROVAL', 'NEEDS_CLARIFICATION'] };
      where.approvalDueBy = { lt: new Date() };
    }
    // Phase 172 (#17) — goodwill-only filter for the finance queue.
    if (goodwill === 'true') where.isGoodwill = true;
    const [items, total] = await Promise.all([
      this.prisma.refundInstruction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * lim,
        take: lim,
      }),
      this.prisma.refundInstruction.count({ where }),
    ]);
    // BigInt → string for JSON; the global BigInt.prototype.toJSON
    // shim covers this but being explicit keeps the wire format
    // independent of bootstrap order.
    const data = items.map((row) => ({
      ...row,
      amountInPaise: row.amountInPaise.toString(),
    }));
    return {
      success: true,
      message: 'Refund instructions retrieved',
      data: { items: data, total, page: pageNum, limit: lim },
    };
  }

  @Get(':id')
  @Permissions('refunds.read')
  async get(@Param('id') id: string) {
    const row = await this.prisma.refundInstruction.findUnique({
      where: { id },
    });
    if (!row) {
      throw new BadRequestAppException('RefundInstruction not found');
    }

    // Bundle the source context inline so the finance UI doesn't need
    // disputes.read / returns.read just to render the approval page.
    // Whichever sourceType, we pull a small read-only summary that
    // tells finance WHY this refund was filed.
    let source: any = null;
    if (row.sourceType === 'DISPUTE') {
      // Dispute → masterOrder / return are FK columns only (no Prisma
      // relation declared on the Dispute model), so resolve numbers
      // via separate lookups.
      const d = await this.prisma.dispute.findUnique({
        where: { id: row.sourceId },
        select: {
          id: true,
          disputeNumber: true,
          kind: true,
          status: true,
          summary: true,
          filedByName: true,
          filedByType: true,
          decisionRationale: true,
          decisionAmountInPaise: true,
          decisionAt: true,
          liabilityParty: true,
          customerRemedy: true,
          masterOrderId: true,
          returnId: true,
        },
      });
      if (d) {
        const [order, ret, messages] = await Promise.all([
          d.masterOrderId
            ? this.prisma.masterOrder.findUnique({
                where: { id: d.masterOrderId },
                select: { orderNumber: true },
              })
            : Promise.resolve(null),
          d.returnId
            ? this.prisma.return.findUnique({
                where: { id: d.returnId },
                select: { returnNumber: true },
              })
            : Promise.resolve(null),
          // Full thread minus admin-only internal notes — finance
          // shouldn't see triage scribbles meant for the dispute team.
          this.prisma.disputeMessage.findMany({
            where: { disputeId: d.id, isInternalNote: false },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              senderType: true,
              senderName: true,
              body: true,
              createdAt: true,
            },
          }),
        ]);
        source = {
          sourceType: 'DISPUTE',
          id: d.id,
          number: d.disputeNumber,
          kind: d.kind,
          status: d.status,
          summary: d.summary,
          filedByName: d.filedByName,
          filedByType: d.filedByType,
          decisionRationale: d.decisionRationale,
          decisionAmountInPaise: d.decisionAmountInPaise,
          decisionAt: d.decisionAt,
          liabilityParty: d.liabilityParty,
          customerRemedy: d.customerRemedy,
          orderNumber: order?.orderNumber ?? null,
          returnNumber: ret?.returnNumber ?? null,
          messages,
        };
      }
    } else if (row.sourceType === 'RETURN') {
      const r = await this.prisma.return.findUnique({
        where: { id: row.sourceId },
        select: {
          id: true,
          returnNumber: true,
          status: true,
          customerNotes: true,
          rejectionReason: true,
          refundAmount: true,
          qcNotes: true,
          masterOrderId: true,
        },
      });
      if (r) {
        const order = r.masterOrderId
          ? await this.prisma.masterOrder.findUnique({
              where: { id: r.masterOrderId },
              select: { orderNumber: true },
            })
          : null;
        source = {
          sourceType: 'RETURN',
          id: r.id,
          number: r.returnNumber,
          status: r.status,
          customerNotes: r.customerNotes,
          rejectionReason: r.rejectionReason,
          qcNotes: r.qcNotes,
          refundAmount: r.refundAmount?.toString() ?? null,
          orderNumber: order?.orderNumber ?? null,
        };
      }
    }

    return {
      success: true,
      message: 'RefundInstruction retrieved',
      data: {
        ...row,
        amountInPaise: row.amountInPaise.toString(),
        source,
      },
    };
  }

  // Phase 1 (PR 1.3) — @Idempotent: approval triggers the refund saga
  // (gateway call + wallet credit). A retried PATCH must not double-
  // run the saga; the instruction's own status guard is the inner
  // belt, this decorator the outer.
  @Patch(':id/approve')
  @Idempotent()
  @Permissions('refunds.approve')
  // Phase 170 (#12) — a compromised admin token could batch-approve the queue
  // in seconds; cap approvals to 30/min.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  // Phase 26 — approval triggers the refund saga (gateway + wallet);
  // money moves. Tight 1-min window.
  @RequiresStepUp({ maxAgeMs: 60_000 })
  async approve(@Req() req: any, @Param('id') id: string) {
    // Phase 172 (Goodwill Credit audit #7) — approving a GOODWILL credit (a
    // non-recoverable platform expense) requires the dedicated, CRITICAL-tier
    // wallet.goodwill.approve permission IN ADDITION to refunds.approve. A
    // decorator can't express "conditional on the row", so enforce at runtime:
    // load the marker; if goodwill, require the extra grant.
    const target = await this.prisma.refundInstruction.findUnique({
      where: { id },
      select: { isGoodwill: true },
    });
    if (
      target?.isGoodwill &&
      !((req.adminPermissions ?? req.user?.permissions ?? []) as string[]).includes(
        'wallet.goodwill.approve',
      )
    ) {
      throw new ForbiddenAppException(
        'Approving a goodwill credit requires the wallet.goodwill.approve permission.',
      );
    }
    const updated = await this.service.approveByFinance({
      instructionId: id,
      adminId: req.adminId,
    });
    // Phase 125 — a high-value refund's FIRST approval only records the
    // approver; the money doesn't move until a second, distinct admin
    // approves. Word the response + audit accordingly.
    const pendingSecond = (updated as any).pendingSecondApproval === true;
    // Money-movement action — always audited (was previously only
    // logger.log'd, leaving no compliance trail on who released funds).
    this.audit
      .writeAuditLog({
        actorId: req.adminId,
        actorRole: 'ADMIN',
        action: pendingSecond
          ? 'refund.first_approval_recorded'
          : 'refund.approved',
        module: 'refund-instructions',
        resource: 'refund_instruction',
        resourceId: id,
        newValue: {
          status: updated.status,
          amountInPaise: updated.amountInPaise.toString(),
          firstApprovedBy: updated.firstApprovedBy ?? null,
          approvedBy: updated.approvedBy ?? null,
          pendingSecondApproval: pendingSecond,
        },
      })
      .catch(() => undefined);
    return {
      success: true,
      message: pendingSecond
        ? 'First approval recorded — a second, distinct approver is required'
        : 'Refund approved',
      data: { ...updated, amountInPaise: updated.amountInPaise.toString() },
    };
  }

  // Phase 1 (PR 1.3) — reject doesn't move money but does emit an
  // audit + customer-notification event. Decorate for consistency.
  @Patch(':id/reject')
  @Idempotent()
  @Permissions('refunds.reject')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  // Phase 26 — rejection halts money movement; reversible only via
  // ops intervention. 5-min window.
  @RequiresStepUp()
  async reject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: RejectRefundDto,
  ) {
    if (!body?.reason?.trim()) {
      throw new BadRequestAppException('reason is required');
    }
    const updated = await this.service.rejectByFinance({
      instructionId: id,
      adminId: req.adminId,
      reason: body.reason.trim(),
      // Phase 171 (#6) — optional SAFE customer-facing message.
      customerVisibleReason: body.customerVisibleReason?.trim() || undefined,
    });
    // Phase 171 (#1) — dispute-sourced rejections route back to the dispute
    // team (the headline rule). The service flips status to
    // ROUTED_BACK_TO_DISPUTE; the actual dispute reopen + thread message +
    // re-decision admin task run in the disputes module's
    // RefundRejectedDisputeHandler, triggered by the event below (event-driven
    // to avoid the refund-instructions → disputes circular import).
    const routedBackToDispute = (updated as any).routedBackToDispute === true;

    // Phase 171 review (#1 durability) — enqueue the re-decision ops task HERE,
    // synchronously, not only in the event handler. The dispute reopen itself is
    // event-driven (RefundRejectedDisputeHandler), but that event is best-effort;
    // if it's lost, the instruction is durably ROUTED_BACK_TO_DISPUTE while the
    // dispute stays RESOLVED. This task (idempotent on kind+source) is the
    // durable backstop so ops always sees a rejected-refund dispute needs a
    // re-decision, even if the reopen event never lands.
    if (routedBackToDispute) {
      await this.ledger
        .enqueueAdminTask({
          kind: 'DISPUTE_REFUND_REJECTED_NEEDS_REDECISION',
          sourceType: 'DISPUTE',
          sourceId: updated.sourceId,
          reason:
            `Finance rejected the refund for dispute ${updated.sourceId}. ` +
            `The dispute needs re-decision. Reason: ${body.reason.trim()}`,
          slaHours: 48,
        })
        .catch(() => undefined);
    }

    // Phase 127 — reverse the dispute's liability-ledger attribution. The
    // decision booked a SellerDebit / LogisticsClaim / PlatformExpense at
    // decision time; a rejected refund means the money never moved, so the
    // cost attribution must be reversed — else the seller is debited (or the
    // platform shows an expense) for a refund that never happened. RETURN-
    // sourced rejections are left alone: their ledger semantics differ and
    // aren't part of the dispute-decision attribution path.
    let reversal: Awaited<
      ReturnType<LiabilityLedgerPublicFacade['reverseForSource']>
    > | null = null;
    if (updated.sourceType === 'DISPUTE') {
      reversal = await this.ledger
        .reverseForSource({
          sourceType: 'DISPUTE',
          sourceId: updated.sourceId,
          reason: `Refund rejected by finance: ${body.reason.trim()}`,
        })
        .catch((err) => {
          this.logger.error(
            `Liability reversal failed for dispute ${updated.sourceId}: ${
              (err as Error).message
            }`,
          );
          return null;
        });
      // A debit/claim was already applied or in-flight with the courier —
      // undoing it is a settlement reversal / claim withdrawal, not a status
      // flip. Queue it for ops with a 24h SLA.
      if (reversal?.needsManual) {
        await this.ledger
          .enqueueAdminTask({
            kind: 'SELLER_DEBIT_DISPUTED',
            sourceType: 'DISPUTE',
            sourceId: updated.sourceId,
            reason:
              `Refund for dispute ${updated.sourceId} was rejected, but a liability row is ` +
              `already applied/in-flight — manual reversal required ` +
              `(sellerDebit=${reversal.sellerDebit}, logisticsClaim=${reversal.logisticsClaim}).`,
            slaHours: 24,
          })
          .catch(() => undefined);
      }
    }

    this.audit
      .writeAuditLog({
        actorId: req.adminId,
        actorRole: 'ADMIN',
        action: 'refund.rejected',
        module: 'refund-instructions',
        resource: 'refund_instruction',
        resourceId: id,
        newValue: {
          status: updated.status,
          reason: body.reason.trim(),
          amountInPaise: updated.amountInPaise.toString(),
          liabilityReversal: reversal ?? undefined,
        },
      })
      .catch(() => undefined);
    // Phase 130 — tell the customer their refund is on hold. Without this they
    // were told (on disputes.decided) that a refund was coming, then never saw
    // it. Emitted as an event so the notification handler stays decoupled +
    // replay-safe (@IdempotentHandler). Best-effort: a notify hiccup must not
    // fail the rejection itself.
    this.eventBus
      .publish({
        eventName: 'refunds.instruction.rejected',
        aggregate: 'RefundInstruction',
        aggregateId: updated.id,
        occurredAt: new Date(),
        payload: {
          instructionId: updated.id,
          sourceType: updated.sourceType,
          sourceId: updated.sourceId,
          customerId: updated.customerId,
          amountInPaise: updated.amountInPaise.toString(),
          reason: body.reason.trim(),
          // Phase 171 — drives the disputes-module route-back handler (#1) and
          // lets the notification handler tailor the customer message (#5/#6).
          routedBackToDispute,
          disputeId: routedBackToDispute ? updated.sourceId : null,
          actorId: req.adminId,
          customerVisibleReason: body.customerVisibleReason?.trim() || null,
        },
      })
      .catch((err) =>
        this.logger.error(
          `Failed to emit refunds.instruction.rejected for ${updated.id}: ${
            (err as Error).message
          }`,
        ),
      );
    return {
      success: true,
      message: routedBackToDispute
        ? 'Refund rejected — routed back to the dispute team for re-decision'
        : 'Refund rejected',
      data: {
        ...updated,
        amountInPaise: updated.amountInPaise.toString(),
        liabilityReversal: reversal ?? undefined,
      },
    };
  }

  /**
   * Phase 13 completion (ADR-017 future-work) — third action
   * between approve and reject. Finance asks the upstream admin
   * (the one who decided the dispute / submitted the QC) for
   * clarification before deciding. The instruction stays in
   * PENDING_APPROVAL; an AdminTask is enqueued so the upstream
   * admin sees the request in their queue. Audit-logged for
   * compliance reasons (every refund decision step is traceable).
   */
  @Patch(':id/request-info')
  @Permissions('refunds.approve')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async requestInfo(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: RequestInfoDto,
  ) {
    if (!body?.question?.trim() || body.question.trim().length < 3) {
      throw new BadRequestAppException(
        'question (min 3 chars) is required to request additional info',
      );
    }
    const question = body.question.trim();
    const row = await this.service.requestClarification({
      instructionId: id,
      adminId: req.adminId,
      question,
    });
    // Side effects (AdminTask + audit) outside the service so the
    // service stays free of cross-module deps.
    // Phase 170 (#11) — dedicated REFUND_CLARIFICATION_REQUESTED kind (was the
    // generic OTHER bucket) so ops can filter refund clarification requests.
    await this.ledger
      .enqueueAdminTask({
        kind: 'REFUND_CLARIFICATION_REQUESTED' as any,
        sourceType: row.sourceType as any,
        sourceId: row.sourceId,
        reason: `Finance needs more info on RefundInstruction ${row.id} before approving: ${question}`,
        slaHours: 48,
      })
      .catch(() => undefined);
    this.audit
      .writeAuditLog({
        actorId: req.adminId,
        actorRole: 'ADMIN',
        action: 'refund.clarification_requested',
        module: 'refund-instructions',
        resource: 'refund_instruction',
        resourceId: row.id,
        newValue: { question, status: row.status, sourceType: row.sourceType, sourceId: row.sourceId },
      })
      .catch(() => undefined);
    return {
      success: true,
      message: 'Clarification requested — instruction moved to NEEDS_CLARIFICATION',
      data: { ...row, amountInPaise: row.amountInPaise.toString() },
    };
  }

  /**
   * Phase 170 (#9) — bulk approve. Each id is approved independently (own saga,
   * audit row, history) so a partial failure doesn't strand the rest; returns a
   * per-id outcome. Dual-approval still applies per row (a high-value refund in
   * the batch only records the first approval). Throttled hard.
   */
  @Post('bulk-approve')
  @Idempotent()
  @Permissions('refunds.approve')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequiresStepUp({ maxAgeMs: 60_000 })
  async bulkApprove(@Req() req: any, @Body() body: BulkApproveDto) {
    const results: Array<{ id: string; ok: boolean; status?: string; reason?: string; pendingSecondApproval?: boolean }> = [];
    let approved = 0;
    let failed = 0;
    for (const id of body.ids) {
      try {
        const updated = await this.service.approveByFinance({
          instructionId: id,
          adminId: req.adminId,
        });
        const pendingSecond = (updated as any).pendingSecondApproval === true;
        this.audit
          .writeAuditLog({
            actorId: req.adminId,
            actorRole: 'ADMIN',
            action: pendingSecond ? 'refund.first_approval_recorded' : 'refund.approved',
            module: 'refund-instructions',
            resource: 'refund_instruction',
            resourceId: id,
            newValue: {
              status: updated.status,
              amountInPaise: updated.amountInPaise.toString(),
              bulk: true,
              pendingSecondApproval: pendingSecond,
            },
          })
          .catch(() => undefined);
        results.push({ id, ok: true, status: updated.status, pendingSecondApproval: pendingSecond });
        approved++;
      } catch (err) {
        results.push({ id, ok: false, reason: (err as Error)?.message ?? 'failed' });
        failed++;
      }
    }
    return {
      success: true,
      message: `Bulk approve: ${approved} approved, ${failed} skipped`,
      data: { approved, failed, results },
    };
  }

  /**
   * Phase 170 (#15) — undo a wrong rejection (CANCELLED → PENDING_APPROVAL).
   * The original instruction (and its @unique idempotencyKey) is reused, so a
   * fresh createForReturn/Dispute isn't needed.
   */
  @Patch(':id/revert-rejection')
  @Idempotent()
  @Permissions('refunds.approve')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequiresStepUp()
  async revertRejection(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: RevertRejectionDto,
  ) {
    const reason = body?.reason?.trim();
    if (!reason || reason.length < 3) {
      throw new BadRequestAppException('reason (min 3 chars) is required');
    }
    const updated = await this.service.revertRejection({
      instructionId: id,
      adminId: req.adminId,
      reason,
    });
    this.audit
      .writeAuditLog({
        actorId: req.adminId,
        actorRole: 'ADMIN',
        action: 'refund.rejection_reverted',
        module: 'refund-instructions',
        resource: 'refund_instruction',
        resourceId: id,
        newValue: { status: updated.status, reason },
      })
      .catch(() => undefined);
    return {
      success: true,
      message: 'Rejection reverted — instruction back in the approval queue',
      data: { ...updated, amountInPaise: updated.amountInPaise.toString() },
    };
  }
}
