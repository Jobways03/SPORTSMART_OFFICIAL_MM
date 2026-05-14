import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';

/**
 * Story 4.1 follow-up — operator visibility into RefundSaga rows.
 *
 * The stuck-saga sweep cron escalates orphan sagas into admin tasks,
 * but ops also needs a live queue view: "what's running right now,
 * which have failed, which are compensating." This is a read-only
 * surface — the cron + the saga executor still own state transitions.
 *
 * Status filter mirrors the RefundSagaStatus enum
 * (STARTED, IN_PROGRESS, COMPLETED, FAILED, COMPENSATED).
 * Default filter is "non-terminal" so the queue surfaces work in
 * flight rather than a long history of completed sagas.
 */
@ApiTags('Admin Refund Sagas')
@Controller('admin/refund-sagas')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminRefundSagasController {
  // Threshold above which a non-terminal saga is "stuck". Tuned to
  // match the cron's 15-min default — anything older than this is
  // either mid-retry or already escalated, and both cases want
  // operator eyes.
  private static readonly STUCK_AFTER_MS = 15 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Permissions('refunds.read')
  async list(
    @Query('status') status?: string,
    @Query('stuckOnly') stuckOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const l = Math.min(parseInt(limit || '50', 10) || 50, 200);

    const where: any = {};
    if (status) {
      // Allow comma-separated list ("IN_PROGRESS,FAILED") so the FE
      // can filter to actionable rows in one call.
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    } else {
      // Default to non-terminal rows so the queue isn't drowned by
      // months of COMPLETED sagas.
      where.status = { in: ['STARTED', 'IN_PROGRESS', 'FAILED'] };
    }

    if (stuckOnly === 'true') {
      const cutoff = new Date(Date.now() - AdminRefundSagasController.STUCK_AFTER_MS);
      where.startedAt = { lt: cutoff };
    }

    const [rows, total] = await Promise.all([
      this.prisma.refundSaga.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
      }),
      this.prisma.refundSaga.count({ where }),
    ]);

    return {
      success: true,
      message: 'Refund sagas',
      data: {
        items: rows.map((r) => this.serialize(r)),
        total,
        page: p,
        limit: l,
      },
    };
  }

  @Get(':id')
  @Permissions('refunds.read')
  async getOne(@Param('id') id: string) {
    const row = await this.prisma.refundSaga.findUnique({ where: { id } });
    if (!row) throw new NotFoundAppException('Saga not found');
    return { success: true, message: 'Saga', data: this.serialize(row) };
  }

  // BigInt isn't JSON-serialisable so we stringify amountInPaise; the
  // FE can format it back to ₹X.XX without precision loss.
  private serialize(r: any) {
    return {
      id: r.id,
      refundType: r.refundType,
      sourceId: r.sourceId,
      instructionId: r.instructionId,
      amountInPaise: r.amountInPaise.toString(),
      customerId: r.customerId,
      status: r.status,
      steps: r.steps,
      compensations: r.compensations,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      failureReason: r.failureReason,
      // Convenience: time since the saga started, used by the FE to
      // colour-code "fresh" vs "stuck" without a separate calc.
      ageMs: Date.now() - r.startedAt.getTime(),
    };
  }
}
