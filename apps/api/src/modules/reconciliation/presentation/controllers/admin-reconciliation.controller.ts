import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type {
  ReconciliationKind,
  ReconciliationStatus,
} from '@prisma/client';
import {
  ReconciliationKind as ReconciliationKindEnum,
  ReconciliationStatus as ReconciliationStatusEnum,
} from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { BadRequestAppException } from '../../../../core/exceptions';
import { ReconciliationService } from '../../application/services/reconciliation.service';
import {
  AssignDiscrepancyDto,
  BulkTransitionDto,
  ReopenDiscrepancyDto,
  StartRunDto,
  TransitionDiscrepancyDto,
} from '../dtos/reconciliation.dto';

@ApiTags('Admin Reconciliation')
@Controller('admin/reconciliation')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Get('runs')
  @Permissions('recon.read')
  async listRuns(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
  ) {
    // Adversarial-review fix (Phase 173): validate the enum filters instead of
    // silently coercing a bad value to `undefined` (which returned ALL rows —
    // confusing, and masks a client bug). A bad value is now a 400.
    if (kind && !(kind in ReconciliationKindEnum)) {
      throw new BadRequestAppException(`Invalid kind: ${kind}`);
    }
    if (status && !(status in ReconciliationStatusEnum)) {
      throw new BadRequestAppException(`Invalid status: ${status}`);
    }
    const data = await this.service.listRuns({
      page: parseInt(page || '1', 10) || 1,
      limit: parseInt(limit || '20', 10) || 20,
      kind: kind ? (kind as ReconciliationKind) : undefined,
      status: status ? (status as ReconciliationStatus) : undefined,
    });
    return { success: true, message: 'Runs retrieved', data };
  }

  /**
   * Phase 173 (#1) — accept the run and return IMMEDIATELY. The scan runs in
   * the background; the client polls GET /runs/:id for status. (#2) a 409 is
   * returned if a live run already exists for the same (kind, period). (#10)
   * rate-limited so a compromised admin can't DoS the DB.
   */
  @Post('runs')
  @Permissions('recon.run')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async startRun(@Req() req: any, @Body() body: StartRunDto) {
    const run = await this.service.enqueueRun({
      kind: body.kind,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      startedByAdminId: req.adminId,
    });
    return {
      success: true,
      message: 'Reconciliation run queued',
      data: { runId: run.id, runNumber: run.runNumber, status: run.status },
    };
  }

  @Get('runs/:id')
  @Permissions('recon.read')
  async getRun(@Param('id') id: string) {
    const data = await this.service.getRun(id);
    return { success: true, message: 'Run retrieved', data };
  }

  /**
   * Phase 173 (#13) — streamed CSV export (cursor batches, never loads the
   * whole run into memory). (#3) every field formula-escaped. (#11) audited.
   * (#10) rate-limited.
   */
  @Get('runs/:id/discrepancies.csv')
  @Permissions('recon.read')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @Req() req: any,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="recon-${id}-discrepancies.csv"`,
    );
    res.setHeader('Transfer-Encoding', 'chunked');
    await this.service.auditCsvExport(id, req.adminId);
    let first = true;
    for await (const line of this.service.streamDiscrepancyCsv(id)) {
      res.write(first ? line : `\n${line}`);
      first = false;
    }
    res.end();
  }

  /**
   * Phase 173 (#12/#18) — CAS transition with an explicit state matrix; the
   * service throws 409 on a stale/illegal move. Phase 173 audit logs it; Phase
   * 174 (#2) writes an immutable history row + (#16) emits an event. (#19) the
   * note is DTO-validated. (#10) rate-limited so a compromised admin can't
   * batch-flip every discrepancy to IGNORED to hide real money problems.
   */
  @Patch('discrepancies/:id/status')
  @Permissions('recon.transition')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async transition(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: TransitionDiscrepancyDto,
  ) {
    const data = await this.service.transitionDiscrepancy({
      id,
      status: body.status,
      notes: body.notes,
      adminId: req.adminId,
    });
    return { success: true, message: 'Discrepancy updated', data };
  }

  /**
   * Phase 174 (#6) — assign / unassign a discrepancy (triage ownership). Omit
   * `assignedToAdminId` to self-assign; send `null` to unassign.
   */
  @Patch('discrepancies/:id/assign')
  @Permissions('recon.discrepancy.assign')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async assign(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: AssignDiscrepancyDto,
  ) {
    const assignedToAdminId =
      body.assignedToAdminId === undefined
        ? req.adminId ?? null
        : body.assignedToAdminId;
    const data = await this.service.assignDiscrepancy({
      id,
      assignedToAdminId,
      adminId: req.adminId,
    });
    return { success: true, message: 'Discrepancy assignment updated', data };
  }

  /**
   * Phase 174 (#8) — reopen a TERMINAL (RESOLVED/IGNORED) discrepancy. Separate
   * from the transition endpoint + gated by the dedicated CRITICAL
   * `recon.discrepancy.reopen` permission so a resolution can't be silently
   * undone. Reason required (DTO).
   */
  @Post('discrepancies/:id/reopen')
  @Permissions('recon.discrepancy.reopen')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async reopen(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: ReopenDiscrepancyDto,
  ) {
    const data = await this.service.reopenDiscrepancy({
      id,
      reason: body.reason,
      adminId: req.adminId,
    });
    return { success: true, message: 'Discrepancy reopened', data };
  }

  /**
   * Phase 174 (#11) — bulk status transition. Each id runs the SAME per-row
   * CAS + history + audit path; returns a per-id outcome (partial success).
   * Higher-gated (`recon.discrepancy.bulk`) + tightly throttled.
   */
  @Post('discrepancies/bulk-transition')
  @Permissions('recon.discrepancy.bulk')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async bulkTransition(@Req() req: any, @Body() body: BulkTransitionDto) {
    const data = await this.service.bulkTransition({
      ids: body.ids,
      status: body.status,
      notes: body.notes,
      adminId: req.adminId,
    });
    return { success: true, message: 'Bulk transition complete', data };
  }

  /**
   * Phase 174 (#2) — the transition timeline for one discrepancy (newest first),
   * for the detail-page history panel.
   */
  @Get('discrepancies/:id/history')
  @Permissions('recon.read')
  async history(@Param('id') id: string) {
    const data = await this.service.getDiscrepancyHistory(id);
    return { success: true, message: 'History retrieved', data };
  }
}
