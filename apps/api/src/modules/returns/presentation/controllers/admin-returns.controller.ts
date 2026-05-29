import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, RolesGuard, PermissionsGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { BadRequestAppException } from '../../../../core/exceptions';
import { ReturnService } from '../../application/services/return.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { csvHeaderLine, csvRowLines, csvFilenameSlug } from '../../../../core/utils';
import { AdminApproveReturnDto } from '../dtos/admin-approve-return.dto';
import { AdminRejectReturnDto } from '../dtos/admin-reject-return.dto';
import { AdminSchedulePickupDto } from '../dtos/admin-schedule-pickup.dto';
import { ConfirmRefundDto } from '../dtos/confirm-refund.dto';
import { CustomerMarkHandedOverDto } from '../dtos/customer-mark-handed-over.dto';
import { InitiateRefundDto } from '../dtos/initiate-refund.dto';
import { MarkReceivedDto } from '../dtos/mark-received.dto';
import { MarkRefundFailedDto } from '../dtos/mark-refund-failed.dto';
import { SubmitQcDecisionDto } from '../dtos/submit-qc-decision.dto';
import { AdminExtendSellerResponseWindowDto } from '../dtos/admin-extend-seller-response-window.dto';
import { CloseReturnDto } from '../dtos/close-return.dto';
import { BulkReturnsDto } from '../dtos/bulk-returns.dto';
import { ExportReturnsDto } from '../dtos/export-returns.dto';
import { runWithConcurrency } from '../../../../core/util/concurrency';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

const QC_EVIDENCE_UPLOAD_OPTIONS = {
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
};

// Date-range helpers for the CSV export. `createdAt` is stored in UTC, so we
// resolve a date-only filter against the UTC day — independent of the server's
// local timezone (the previous `setHours` used process-local time, skewing the
// boundary by up to a day for non-UTC hosts).
function startOfUtcDay(s: string): Date {
  return new Date(s); // a date-only ISO string parses to 00:00:00.000Z
}
function endOfUtcDay(s: string): Date {
  const d = new Date(s);
  if (!s.includes('T')) d.setUTCHours(23, 59, 59, 999);
  return d;
}

@ApiTags('Admin Returns')
@Controller('admin/returns')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
export class AdminReturnsController {
  constructor(
    private readonly returnService: ReturnService,
    private readonly prisma: PrismaService,
    // Phase 101 (2026-05-23) — Phase 104 audit Gap #5 closure. Batch-
    // level audit row so investigators can trace a bulk operation by
    // its actor + timestamp without scraping N per-row rows.
    private readonly audit: AuditPublicFacade,
  ) {}

  // GET /admin/returns — list all returns
  @Get()
  @Permissions('returns.read')
  async listReturns(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('subOrderId') subOrderId?: string,
    @Query('fulfillmentNodeType') fulfillmentNodeType?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.returnService.listAllReturns({
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20)),
      status,
      customerId,
      subOrderId,
      fulfillmentNodeType,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      search,
    });
    return { success: true, message: 'Returns retrieved', data };
  }

  // ── Phase R6: Analytics endpoints ───────────────────────────────────────
  // IMPORTANT: These must be declared BEFORE the `:returnId` route so that
  // NestJS does not match `analytics` / `customers` as a returnId param.

  // GET /admin/returns/analytics/summary — returns analytics summary
  @Get('analytics/summary')
  @Permissions('returns.read')
  async getAnalyticsSummary(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const data = await this.returnService.getAnalytics(
      fromDate ? new Date(fromDate) : undefined,
      toDate ? new Date(toDate) : undefined,
    );
    return { success: true, message: 'Returns analytics retrieved', data };
  }

  // GET /admin/returns/analytics/trend — returns trend grouped by day/week/month
  @Get('analytics/trend')
  @Permissions('returns.read')
  async getReturnsTrend(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('groupBy') groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    if (!fromDate || !toDate) {
      throw new BadRequestAppException('fromDate and toDate are required');
    }
    const data = await this.returnService.getReturnsTrend(
      new Date(fromDate),
      new Date(toDate),
      groupBy,
    );
    return { success: true, message: 'Returns trend retrieved', data };
  }

  // GET /admin/returns/analytics/top-reasons — top return reasons
  @Get('analytics/top-reasons')
  @Permissions('returns.read')
  async getTopReasons(
    @Query('limit') limit?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const data = await this.returnService.getTopReturnReasons(
      parseInt(limit || '10', 10),
      fromDate ? new Date(fromDate) : undefined,
      toDate ? new Date(toDate) : undefined,
    );
    return { success: true, message: 'Top return reasons retrieved', data };
  }

  // GET /admin/returns/customers/:customerId/history — customer return history
  @Get('customers/:customerId/history')
  @Permissions('returns.read')
  async getCustomerHistory(@Param('customerId') customerId: string) {
    const data = await this.returnService.getCustomerReturnHistory(customerId);
    return {
      success: true,
      message: 'Customer return history retrieved',
      data,
    };
  }

  // GET /admin/returns/:returnId — return detail
  @Get(':returnId')
  @Permissions('returns.read')
  async getReturn(@Param('returnId') returnId: string) {
    const data = await this.returnService.getReturnByIdAdmin(returnId);
    return { success: true, message: 'Return retrieved', data };
  }

  // PATCH /admin/returns/:returnId/approve — approve return
  @Patch(':returnId/approve')
  @Permissions('returns.approve')
  async approveReturn(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: AdminApproveReturnDto,
  ) {
    const data = await this.returnService.approveReturn(
      returnId,
      req.adminId,
      dto.notes,
    );
    return { success: true, message: 'Return approved', data };
  }

  // PATCH /admin/returns/:returnId/reject — reject return
  @Patch(':returnId/reject')
  @Permissions('returns.reject')
  async rejectReturn(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: AdminRejectReturnDto,
  ) {
    const data = await this.returnService.rejectReturn(
      returnId,
      req.adminId,
      dto.reason,
    );
    return { success: true, message: 'Return rejected', data };
  }

  // Phase 95 (2026-05-23) — Phase 94 deferred #28 closure.
  // PATCH /admin/returns/:returnId/extend-response-window — admin
  // extends the seller's response deadline by N hours (1-168). Audit
  // captures who granted the extension + when so support can
  // distinguish "seller squeaked in inside their window" from "admin
  // gave them another 48h".
  @Patch(':returnId/extend-response-window')
  @Permissions('returns.approve')
  @Idempotent()
  async extendSellerResponseWindow(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: AdminExtendSellerResponseWindowDto,
  ) {
    const data = await this.returnService.extendSellerResponseWindow({
      returnId,
      adminId: req.adminId,
      additionalHours: dto.additionalHours,
      reason: dto.reason,
    });
    return { success: true, message: 'Seller response window extended', data };
  }

  // PATCH /admin/returns/:returnId/schedule-pickup — schedule pickup
  @Patch(':returnId/schedule-pickup')
  @Permissions('returns.schedulePickup')
  async schedulePickup(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: AdminSchedulePickupDto,
  ) {
    const data = await this.returnService.schedulePickup(
      returnId,
      req.adminId,
      {
        pickupScheduledAt: new Date(dto.pickupScheduledAt),
        pickupAddress: dto.pickupAddress,
        pickupTrackingNumber: dto.pickupTrackingNumber,
        pickupCourier: dto.pickupCourier,
      },
    );
    return { success: true, message: 'Pickup scheduled', data };
  }

  // PATCH /admin/returns/:returnId/mark-in-transit — mark in transit
  @Patch(':returnId/mark-in-transit')
  @Permissions('returns.schedulePickup')
  async markInTransit(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: CustomerMarkHandedOverDto,
  ) {
    const data = await this.returnService.markInTransit(
      returnId,
      'ADMIN',
      req.adminId,
      dto?.trackingNumber,
    );
    return { success: true, message: 'Return marked in transit', data };
  }

  // PATCH /admin/returns/:returnId/mark-received — admin marks received
  //
  // Phase 96 (2026-05-23) — Mark Received audit Gap #9 closure.
  @Patch(':returnId/mark-received')
  @Permissions('returns.receive')
  @Idempotent()
  async markReceived(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: MarkReceivedDto,
  ) {
    const data = await this.returnService.markReceived(
      returnId,
      'ADMIN',
      req.adminId,
      dto?.notes,
      dto?.parcelCondition,
    );
    return { success: true, message: 'Return marked as received', data };
  }

  // POST /admin/returns/:returnId/qc-evidence — upload QC evidence (admin)
  @Post(':returnId/qc-evidence')
  @Permissions('returns.uploadQcEvidence')
  @UseInterceptors(FileInterceptor('image', QC_EVIDENCE_UPLOAD_OPTIONS))
  async uploadQcEvidence(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { description?: string },
  ) {
    if (!file?.buffer) {
      throw new BadRequestAppException('Image file required');
    }
    const data = await this.returnService.uploadQcEvidence(
      returnId,
      'ADMIN',
      req.adminId,
      file.buffer,
      file.mimetype,
      body?.description,
    );
    return { success: true, message: 'Evidence uploaded', data };
  }

  // PATCH /admin/returns/:returnId/qc-decision — submit QC decision
  //
  // Phase 97 (2026-05-23) — QC audit Gap #14 closure. Without
  // @Idempotent a network retry would re-run the entire QC commit
  // (refund auto-initiation, credit-note generation, liability ledger
  // writes). The transaction protects the local writes, but Razorpay
  // refund + outbox publication live outside it — @Idempotent caches
  // the response so the retry returns the cached body.
  @Patch(':returnId/qc-decision')
  @Permissions('returns.qcDecide')
  @Idempotent()
  async submitQc(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: SubmitQcDecisionDto,
  ) {
    const data = await this.returnService.submitQcDecision(
      returnId,
      'ADMIN',
      req.adminId,
      dto,
    );
    return { success: true, message: 'QC decision submitted', data };
  }

  // ── Phase R4: Refund processing ─────────────────────────────────────────

  // PATCH /admin/returns/:returnId/initiate-refund — initiate refund.
  // All four refund-movement endpoints (initiate / confirm / fail /
  // retry) move real money, so we gate them to the same tier that can
  // adjust a commission record. Lower-tier admins can still approve,
  // reject, schedule pickup, and run QC — they just can't touch the
  // money at the gateway.
  @Patch(':returnId/initiate-refund')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('refunds.initiate')
  @Idempotent()
  async initiateRefund(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: InitiateRefundDto,
  ) {
    const data = await this.returnService.initiateRefund(
      returnId,
      'ADMIN',
      req.adminId,
      dto?.refundMethod,
    );
    return { success: true, message: 'Refund initiated', data };
  }

  // PATCH /admin/returns/:returnId/confirm-refund — confirm refund completed
  @Patch(':returnId/confirm-refund')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('refunds.confirm')
  @Idempotent()
  async confirmRefund(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: ConfirmRefundDto,
  ) {
    const data = await this.returnService.confirmRefund(
      returnId,
      'ADMIN',
      req.adminId,
      dto,
    );
    return { success: true, message: 'Refund confirmed', data };
  }

  // PATCH /admin/returns/:returnId/mark-refund-failed — mark refund failed
  //
  // Phase 105 (2026-05-23) — Phase 102 audit Gap #8 / #9 / #15 closure.
  // Granular permission `refunds.markFailed` separates this heavy
  // action from refunds.retry. @Idempotent dedups network retries.
  // @Throttle caps per-admin frequency.
  @Patch(':returnId/mark-refund-failed')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('refunds.markFailed')
  @Idempotent()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async markRefundFailed(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: MarkRefundFailedDto,
  ) {
    const data = await this.returnService.markRefundFailed(
      returnId,
      'ADMIN',
      req.adminId,
      dto.reason,
    );
    return { success: true, message: 'Refund marked as failed', data };
  }

  // PATCH /admin/returns/:returnId/retry-refund — retry refund via gateway
  @Patch(':returnId/retry-refund')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('refunds.retry')
  @Idempotent()
  async retryRefund(
    @Req() req: any,
    @Param('returnId') returnId: string,
  ) {
    const data = await this.returnService.retryRefund(
      returnId,
      'ADMIN',
      req.adminId,
    );
    return { success: true, message: 'Refund retry attempted', data };
  }

  // PATCH /admin/returns/:returnId/close — close return
  //
  // Phase 101 (2026-05-23) — Phase 103 audit Gap #6 closure.
  // @Idempotent prevents network-retry duplicate history/event/audit
  // rows. The same-state early-return in the service is the belt;
  // this is the suspenders.
  @Patch(':returnId/close')
  @Permissions('returns.close')
  @Idempotent()
  async closeReturn(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: CloseReturnDto = {} as CloseReturnDto,
  ) {
    const data = await this.returnService.closeReturn(
      returnId,
      'ADMIN',
      req.adminId,
      dto?.reason,
    );
    return { success: true, message: 'Return closed', data };
  }

  // ── Bulk operations ────────────────────────────────────────────

  // Bulk operations run across up to 100 records in one call — the same
  // per-record guards apply, but a bad call can fan out widely. Keep them
  // SUPER_ADMIN-only to limit blast radius on mass-mutations.
  // Phase 101 (2026-05-23) — Phase 104 audit closures.
  //
  //   Gap #2 — @Idempotent so a network retry doesn't fan out 100
  //            approves twice.
  //   Gap #3 — BulkReturnsDto enforces UUID array + max 100 + unique.
  //   Gap #4 — runWithConcurrency(..., 10) replaces Promise.all so we
  //            don't spike Prisma with 100 simultaneous transactions.
  //   Gap #5 — batch-level audit_logs row written before fan-out so
  //            investigators can trace the batch.
  //   Gap #6 — optional bulk-level reason persisted on each per-row
  //            approve/close.
  // Phase 105 (2026-05-23) — Phase 104 audit Gap #18 closure.
  // Per-admin rate limit. Bulk-fan-out actions are heavy; 5/min/IP
  // prevents script-hammering.
  @Post('bulk-approve')
  @Roles('SUPER_ADMIN')
  @Permissions('returns.approve')
  @Idempotent()
  // Phase 106 (2026-05-23) — Phase 104 audit Gap #10 closure.
  // Optional `?async=true` flag returns the BulkJob immediately with
  // status=PROCESSING and runs the per-row fan-out via setImmediate
  // (in-process). The full BullMQ worker queue is a multi-sprint
  // refactor; this lightweight async lane lets large batches escape
  // the request handler latency budget. UI polls GET /admin/returns/
  // bulk-jobs/:id for completion.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async bulkApprove(
    @Req() req: any,
    @Body() body: BulkReturnsDto,
    @Query('async') asyncMode?: string,
  ) {
    return this.runBulkAction(
      req,
      body,
      'BULK_APPROVE',
      // approveReturn signature: (returnId, adminId, notes?) — there's
      // no actorType arg. Bulk reason → per-row notes.
      (id, reason) =>
        this.returnService.approveReturn(id, req.adminId, reason),
      asyncMode === 'true' || asyncMode === '1',
    );
  }

  @Post('bulk-close')
  @Roles('SUPER_ADMIN')
  @Permissions('returns.close')
  @Idempotent()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async bulkClose(
    @Req() req: any,
    @Body() body: BulkReturnsDto,
    @Query('async') asyncMode?: string,
  ) {
    return this.runBulkAction(
      req,
      body,
      'BULK_CLOSE',
      (id, reason) =>
        this.returnService.closeReturn(id, 'ADMIN', req.adminId, reason),
      asyncMode === 'true' || asyncMode === '1',
    );
  }

  private async runBulkAction(
    req: any,
    body: BulkReturnsDto,
    action: 'BULK_APPROVE' | 'BULK_CLOSE',
    perRow: (returnId: string, reason?: string) => Promise<unknown>,
    asyncMode: boolean = false,
  ) {
    if (!Array.isArray(body?.returnIds) || body.returnIds.length === 0) {
      throw new BadRequestAppException('returnIds array is required');
    }
    if (body.returnIds.length > 100) {
      throw new BadRequestAppException('Batch capped at 100');
    }

    // Phase 105 (2026-05-23) — Phase 104 audit Gap #11 closure.
    // Create a BulkJob row BEFORE the fan-out so investigators can
    // trace the batch in `bulk_jobs` even if the request handler
    // crashes mid-flight. The row is updated atomically after the
    // fan-out completes with per-row results.
    const kind = action === 'BULK_APPROVE' ? 'RETURN_APPROVE' : 'RETURN_CLOSE';
    const idempotencyKey =
      (req.headers?.['x-idempotency-key'] as string | undefined) ?? null;
    const job: any = await (this.prisma as any).bulkJob.create({
      data: {
        kind: kind as any,
        actorId: req.adminId,
        actorRole: 'ADMIN',
        totalCount: body.returnIds.length,
        status: 'PROCESSING' as any,
        reason: body.reason ?? null,
        inputs: { returnIds: body.returnIds, reason: body.reason ?? null } as any,
        idempotencyKey,
      },
    });

    await this.audit
      .writeAuditLog({
        actorId: req.adminId,
        actorRole: 'ADMIN',
        action: `return.${action.toLowerCase()}`,
        module: 'returns',
        resource: 'returns_bulk',
        resourceId: job.id,
        newValue: {
          bulkJobId: job.id,
          batchSize: body.returnIds.length,
          returnIds: body.returnIds,
          reason: body.reason,
        },
      })
      .catch(() => undefined);

    const concurrency = 10;
    const runFanOut = async () =>
      runWithConcurrency(
        body.returnIds,
        concurrency,
        async (id) => {
          try {
            await perRow(id, body.reason);
            return { id, success: true };
          } catch (err) {
            return { id, success: false, error: (err as Error).message };
          }
        },
      );

    // Phase 106 (2026-05-23) — Phase 104 audit Gap #10 closure.
    // Async mode: detach the fan-out via setImmediate and return the
    // BulkJob row immediately. The same persistence path runs in the
    // background; UI polls GET /admin/returns/bulk-jobs/:id.
    if (asyncMode) {
      setImmediate(async () => {
        try {
          const r = await runFanOut();
          const ok = r.filter((row) => row.success).length;
          const bad = r.length - ok;
          const finalAsync =
            bad === 0
              ? 'COMPLETED'
              : ok === 0
                ? 'FAILED'
                : 'PARTIALLY_FAILED';
          await (this.prisma as any).bulkJob.update({
            where: { id: job.id },
            data: {
              status: finalAsync as any,
              succeededCount: ok,
              failedCount: bad,
              results: r as any,
              completedAt: new Date(),
            },
          });
        } catch (err) {
          // Worst case — mark the job FAILED with a single bulk-level
          // error so the UI sees a terminal state.
          await (this.prisma as any).bulkJob
            .update({
              where: { id: job.id },
              data: {
                status: 'FAILED' as any,
                completedAt: new Date(),
                results: [
                  { id: '*', success: false, error: (err as Error).message },
                ] as any,
              },
            })
            .catch(() => undefined);
        }
      });
      return {
        success: true,
        message: `${action}: queued (async)`,
        data: {
          action,
          bulkJobId: job.id,
          batchSize: body.returnIds.length,
          status: 'PROCESSING',
          async: true,
        },
      };
    }

    const results = await runFanOut();

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;
    const finalStatus =
      failed === 0
        ? 'COMPLETED'
        : succeeded === 0
          ? 'FAILED'
          : 'PARTIALLY_FAILED';

    await (this.prisma as any).bulkJob
      .update({
        where: { id: job.id },
        data: {
          status: finalStatus as any,
          succeededCount: succeeded,
          failedCount: failed,
          results: results as any,
          completedAt: new Date(),
        },
      })
      .catch((err: unknown) => {
        // Best-effort — the bulk action itself already committed
        // per-row; the BulkJob row update is observability only.
        // Logging is enough.
        // eslint-disable-next-line no-console
        console.warn(
          `[bulk] BulkJob ${job.id} status update failed: ${
            (err as Error)?.message ?? 'unknown error'
          }`,
        );
      });

    return {
      success: true,
      message: `${action}: ${succeeded}/${results.length} succeeded`,
      data: {
        action,
        bulkJobId: job.id,
        batchSize: results.length,
        succeededCount: succeeded,
        failedCount: failed,
        status: finalStatus,
        results,
      },
    };
  }

  // Phase 105 (2026-05-23) — Phase 104 audit Gap #11 closure.
  // Admin can query past bulk operations by job id (paginated by
  // actor in the GET-list endpoint below).
  @Get('bulk-jobs/:id')
  @Permissions('returns.read')
  async getBulkJob(@Param('id') id: string) {
    const job = await (this.prisma as any).bulkJob.findUnique({
      where: { id },
    });
    if (!job) {
      throw new BadRequestAppException(`Bulk job ${id} not found`);
    }
    return { success: true, message: 'Bulk job', data: job };
  }

  @Get('bulk-jobs')
  @Permissions('returns.read')
  async listBulkJobs(
    @Query('actorId') actorId?: string,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const l = Math.min(parseInt(limit || '50', 10) || 50, 200);
    const where: any = {};
    if (actorId) where.actorId = actorId;
    if (kind) where.kind = kind;
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      (this.prisma as any).bulkJob.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
      }),
      (this.prisma as any).bulkJob.count({ where }),
    ]);
    return {
      success: true,
      message: 'Bulk jobs',
      data: { items, total, page: p, limit: l },
    };
  }

  // ── CSV export ─────────────────────────────────────────────────
  // Streams returns as CSV in keyset-cursor batches so the API never buffers
  // the whole export in memory. Bounded by HARD_CAP. Gated by the dedicated
  // `returns.export` permission (not the single-return `returns.read` view)
  // and audited up front because the file carries customer PII. Throttled
  // tighter than the global limit — each call is an expensive multi-join scan.

  @Get('export')
  @Permissions('returns.export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async exportReturns(
    @Res() res: Response,
    @Req() req: any,
    @Query() query: ExportReturnsDto,
  ) {
    const HARD_CAP = 50_000;
    const BATCH_SIZE = 1_000;

    const where: any = {};
    if (query.status?.length) where.status = { in: query.status };
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = startOfUtcDay(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = endOfUtcDay(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { returnNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    // sellerIdSnapshot / franchiseIdSnapshot are indexed on Return — prefer
    // them over a join through the subOrder relation.
    if (query.sellerId) where.sellerIdSnapshot = query.sellerId;
    if (query.franchiseId) where.franchiseIdSnapshot = query.franchiseId;
    if (query.qcDecision) where.qcDecision = query.qcDecision;
    if (query.refundMethod) where.refundMethod = query.refundMethod;
    if (query.nodeType) where.subOrder = { fulfillmentNodeType: query.nodeType };

    const total = await this.prisma.return.count({ where });
    const truncated = total > HARD_CAP;

    // Audit BEFORE any PII leaves the process — fail closed: if the audit
    // write throws, the global filter returns a clean 500 and nothing streams.
    await this.audit.writeAuditLog({
      actorId: req.adminId,
      actorRole: req.adminRole,
      action: 'returns.exported',
      module: 'returns',
      resource: 'return',
      metadata: {
        filters: {
          status: query.status,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          search: query.search,
          sellerId: query.sellerId,
          franchiseId: query.franchiseId,
          qcDecision: query.qcDecision,
          refundMethod: query.refundMethod,
          nodeType: query.nodeType,
        },
        total,
        cap: HARD_CAP,
        truncated,
      },
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });

    const headers = [
      'createdAt',
      'returnNumber',
      'orderNumber',
      'customerName',
      'customerEmail',
      'nodeType',
      'status',
      'itemCount',
      'totalQuantity',
      'reasonCategories',
      'qcDecision',
      'refundAmount',
      'refundMethod',
      'refundReference',
      'refundAttempts',
      'refundFailureReason',
      'lastGatewayStatus',
      'paymentMethod',
      'closedAt',
    ];

    const filename = `${
      csvFilenameSlug(['returns', query.dateFrom, query.dateTo, ...(query.status ?? [])]) ||
      'returns_export'
    }.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Export-Total', String(total));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');

    // UTF-8 BOM (Excel renders non-ASCII names correctly) + the header row.
    res.write(String.fromCharCode(0xfeff));
    res.write(csvHeaderLine(headers));

    try {
      let cursor: string | undefined;
      let emitted = 0;
      while (emitted < HARD_CAP) {
        const take = Math.min(BATCH_SIZE, HARD_CAP - emitted);
        const batch = await this.prisma.return.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: {
            masterOrder: { select: { orderNumber: true, paymentMethod: true } },
            customer: { select: { firstName: true, lastName: true, email: true } },
            subOrder: { select: { fulfillmentNodeType: true } },
            items: { select: { quantity: true, reasonCategory: true } },
            refundTransactions: {
              select: { status: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });
        if (batch.length === 0) break;

        const mapped = batch.map((r: any) => {
          const reasonCategories = Array.from(
            new Set((r.items ?? []).map((i: any) => i.reasonCategory).filter(Boolean)),
          ).join('; ');
          return {
            createdAt: r.createdAt,
            returnNumber: r.returnNumber,
            orderNumber: r.masterOrder?.orderNumber ?? '',
            customerName: `${r.customer?.firstName ?? ''} ${r.customer?.lastName ?? ''}`.trim(),
            customerEmail: r.customer?.email ?? '',
            nodeType: r.subOrder?.fulfillmentNodeType ?? '',
            status: r.status,
            itemCount: r.items?.length ?? 0,
            totalQuantity: r.items?.reduce((s: number, i: any) => s + i.quantity, 0) ?? 0,
            reasonCategories,
            qcDecision: r.qcDecision ?? '',
            refundAmount: r.refundAmount != null ? Number(r.refundAmount) : '',
            refundMethod: r.refundMethod ?? '',
            refundReference: r.refundReference ?? '',
            refundAttempts: r.refundAttempts,
            refundFailureReason: r.refundFailureReason ?? '',
            lastGatewayStatus: r.refundTransactions?.[0]?.status ?? '',
            paymentMethod: r.masterOrder?.paymentMethod ?? '',
            closedAt: r.closedAt ?? '',
          };
        });

        res.write(csvRowLines(mapped, headers));
        emitted += batch.length;
        const last = batch[batch.length - 1];
        if (batch.length < take || !last) break;
        cursor = last.id;
      }
      res.end();
    } catch (err) {
      // Headers and some rows are already on the wire, so we cannot switch to
      // a JSON error response. End the stream (client gets a truncated file)
      // and log for investigation.
      // eslint-disable-next-line no-console
      console.error(
        `[returns.export] stream failed (matched=${total}): ${
          (err as Error)?.message ?? 'unknown error'
        }`,
      );
      if (!res.writableEnded) res.end();
    }
  }
}
