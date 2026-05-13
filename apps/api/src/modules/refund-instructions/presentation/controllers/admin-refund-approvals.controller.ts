import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { BadRequestAppException } from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
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
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminRefundApprovalsController {
  constructor(
    private readonly service: RefundInstructionService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    private readonly ledger: LiabilityLedgerPublicFacade,
  ) {}

  /**
   * List refund instructions, optionally filtered by status. The most
   * common filter is status=PENDING_APPROVAL — that's the queue. Other
   * statuses are useful for "recently approved" / "recently rejected"
   * audit views.
   */
  @Get()
  @Permissions('refunds.approve')
  async list(
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const validStatuses = [
      'PENDING_APPROVAL',
      'APPROVED',
      'PROCESSING',
      'SUCCESS',
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
    const where = status ? { status: status as any } : {};
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
  @Permissions('refunds.approve')
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
  async approve(@Req() req: any, @Param('id') id: string) {
    const updated = await this.service.approveByFinance({
      instructionId: id,
      adminId: req.adminId,
    });
    return {
      success: true,
      message: 'Refund approved',
      data: { ...updated, amountInPaise: updated.amountInPaise.toString() },
    };
  }

  // Phase 1 (PR 1.3) — reject doesn't move money but does emit an
  // audit + customer-notification event. Decorate for consistency.
  @Patch(':id/reject')
  @Idempotent()
  @Permissions('refunds.approve')
  async reject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    if (!body?.reason?.trim()) {
      throw new BadRequestAppException('reason is required');
    }
    const updated = await this.service.rejectByFinance({
      instructionId: id,
      adminId: req.adminId,
      reason: body.reason.trim(),
    });
    return {
      success: true,
      message: 'Refund rejected',
      data: { ...updated, amountInPaise: updated.amountInPaise.toString() },
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
  async requestInfo(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { question: string },
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
    // RefundSourceType (`DISPUTE` | `RETURN` | `GOODWILL`) is a strict
    // subset of LedgerSourceType for our purposes. Cast keeps the
    // call-site narrow without leaking enum-mapping plumbing into
    // the LiabilityLedger facade.
    await this.ledger
      .enqueueAdminTask({
        kind: 'OTHER' as any,
        sourceType: row.sourceType as any,
        sourceId: row.sourceId,
        reason: `Finance needs more info on RefundInstruction ${row.id} before approving: ${question}`,
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
        newValue: { question, sourceType: row.sourceType, sourceId: row.sourceId },
      })
      .catch(() => undefined);
    return {
      success: true,
      message: 'Clarification request sent to upstream admin',
      data: { ...row, amountInPaise: row.amountInPaise.toString() },
    };
  }
}
