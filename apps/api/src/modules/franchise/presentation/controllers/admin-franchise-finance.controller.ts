import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, PermissionsGuard, PolicyGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Policy } from '../../../../core/decorators/policy.decorator';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { toCsv, csvFilenameSlug } from '../../../../core/utils';
import { FranchiseCommissionService } from '../../application/services/franchise-commission.service';
import { FranchiseLedgerAdjustmentDto } from '../dtos/franchise-ledger-adjustment.dto';
import { FranchiseLedgerPenaltyDto } from '../dtos/franchise-ledger-penalty.dto';

/**
 * Phase 181 (Franchise Ledger audit) hardening:
 *   #12 — @Throttle on the punitive/credit POSTs.
 *   #13 — every CRITICAL ledger write emits an audit_logs row (actor + IP + UA).
 *   #11 — a penalty ≥ the env threshold requires a second admin's
 *         co-acknowledgement (fail-closed: rejected without one).
 *   #1  — GET /balance (current + point-in-time `asOf`).
 *   #17 — GET /ledger/export.csv with the running-balance column.
 */
@ApiTags('Admin Franchise Finance')
@Controller('admin/franchise-finance')
@UseGuards(AdminAuthGuard, PermissionsGuard, PolicyGuard)
export class AdminFranchiseFinanceController {
  constructor(
    private readonly commissionService: FranchiseCommissionService,
    private readonly audit: AuditPublicFacade,
    private readonly env: EnvService,
  ) {}

  private async log(req: Request, action: string, franchiseId: string, resourceId: string, value: Record<string, unknown>) {
    await this.audit
      .writeAuditLog({
        actorId: (req as any).adminId,
        actorRole: 'ADMIN',
        action,
        module: 'franchise',
        resource: 'FranchiseFinanceLedger',
        resourceId,
        newValue: { franchiseId, ...value },
        metadata: { ip: (req as any).ip ?? null, userAgent: req.headers?.['user-agent'] ?? null },
      })
      .catch(() => undefined);
  }

  @Post(':franchiseId/adjustment')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('franchise.finance')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Policy({ resourceType: 'franchise-ledger', action: 'adjust', context: { amount: 'body.amount' } })
  async createAdjustment(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: FranchiseLedgerAdjustmentDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.commissionService.createManualAdjustment({ franchiseId, amount: dto.amount, reason: dto.reason, adminId });
    await this.log(req, 'franchise.ledger.adjustment.created', franchiseId, data.id, { amount: dto.amount, reason: dto.reason, balanceAfterInPaise: String(data.balanceAfterInPaise ?? '') });
    return { success: true, message: 'Manual ledger adjustment created successfully', data };
  }

  @Post(':franchiseId/penalty')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('franchise.finance')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Policy({ resourceType: 'franchise-ledger', action: 'penalize', context: { amount: 'body.amount' } })
  async createPenalty(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: FranchiseLedgerPenaltyDto,
  ) {
    const adminId = (req as any).adminId;
    // #11 — a penalty at/above the env threshold is NOT posted directly; it is
    // submitted for a SECOND admin's approval (two-person control, fail-closed).
    const threshold = this.env.getNumber('FRANCHISE_PENALTY_MAX_WITHOUT_APPROVAL_RUPEES', 50000);
    if (threshold > 0 && dto.amount >= threshold) {
      const approval = await this.commissionService.requestPenaltyApproval({ franchiseId, amount: dto.amount, reason: dto.reason, requestedByAdminId: adminId });
      await this.log(req, 'franchise.ledger.penalty.approval_requested', franchiseId, approval.id, { amount: dto.amount, reason: dto.reason });
      return { success: true, requiresApproval: true, message: `Penalty of ₹${dto.amount} exceeds the ₹${threshold} single-admin limit — submitted for approval.`, data: approval };
    }
    const data = await this.commissionService.createPenalty({ franchiseId, amount: dto.amount, reason: dto.reason, adminId });
    await this.log(req, 'franchise.ledger.penalty.created', franchiseId, data.id, { amount: dto.amount, reason: dto.reason, balanceAfterInPaise: String(data.balanceAfterInPaise ?? '') });
    return { success: true, message: 'Penalty recorded successfully', data };
  }

  // #11 — pending high-value penalty queue (read).
  @Get('penalty-approvals')
  @Permissions('franchise.finance')
  async listPenaltyApprovals(
    @Query('status') status?: string,
    @Query('franchiseId') franchiseId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.commissionService.listPenaltyApprovals({
      status: status || undefined,
      franchiseId: franchiseId || undefined,
      page: page ? Math.max(1, parseInt(page, 10) || 1) : 1,
      limit: limit ? Math.min(100, Math.max(1, parseInt(limit, 10) || 20)) : 20,
    });
    return { success: true, message: 'Penalty approvals', data };
  }

  // #11 — approve (posts the penalty); CRITICAL, distinct-approver enforced.
  @Post('penalty-approvals/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('franchise.penalty.approve')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async approvePenalty(@Req() req: Request, @Param('id') id: string) {
    const approverAdminId = (req as any).adminId;
    const data = await this.commissionService.approvePenalty({ approvalId: id, approverAdminId });
    await this.log(req, 'franchise.ledger.penalty.approved', data.franchiseId, data.ledgerEntryId, { approvalId: id, amount: data.amount });
    return { success: true, message: 'Penalty approved and posted', data };
  }

  // #11 — reject (no ledger entry posted).
  @Post('penalty-approvals/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('franchise.penalty.approve')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async rejectPenalty(@Req() req: Request, @Param('id') id: string, @Body() body: { reason?: string }) {
    const approverAdminId = (req as any).adminId;
    const data = await this.commissionService.rejectPenalty({ approvalId: id, approverAdminId, reason: body?.reason });
    await this.log(req, 'franchise.ledger.penalty.rejected', (data as any)?.franchiseId ?? '', id, { reason: body?.reason ?? null });
    return { success: true, message: 'Penalty approval rejected', data };
  }

  // #1 — GET /admin/franchise-finance/:franchiseId/balance?asOf=ISO
  @Get(':franchiseId/balance')
  @Permissions('franchise.finance')
  async getBalance(
    @Param('franchiseId') franchiseId: string,
    @Query('asOf') asOf?: string,
  ) {
    let asOfDate: Date | undefined;
    if (asOf) {
      asOfDate = new Date(asOf);
      if (isNaN(asOfDate.getTime())) throw new BadRequestException('Invalid asOf date');
    }
    const data = await this.commissionService.getBalance(franchiseId, asOfDate);
    return { success: true, message: 'Franchise ledger balance', data };
  }

  @Get(':franchiseId/ledger')
  @Permissions('franchise.finance')
  async getFranchiseLedger(
    @Param('franchiseId') franchiseId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sourceType') sourceType?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.commissionService.getLedgerHistory(franchiseId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      sourceType,
      status,
    });
    return { success: true, message: 'Franchise ledger fetched successfully', data };
  }

  // #17 — GET /admin/franchise-finance/:franchiseId/ledger/export.csv (with balance)
  @Get(':franchiseId/ledger/export.csv')
  @Permissions('franchise.finance')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportLedgerCsv(
    @Req() req: Request,
    @Res() res: Response,
    @Param('franchiseId') franchiseId: string,
    @Query('sourceType') sourceType?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const from = fromDate ? new Date(fromDate) : undefined;
    const to = toDate ? new Date(toDate) : undefined;
    if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
      throw new BadRequestException('Invalid date');
    }
    const entries = await this.commissionService.getLedgerForExport(franchiseId, { sourceType, status, fromDate: from, toDate: to });
    await this.log(req, 'franchise.ledger.exported', franchiseId, franchiseId, { rows: entries.length, sourceType: sourceType ?? null, status: status ?? null });
    const rupees = (p: unknown) => {
      const v = BigInt((p ?? 0) as any);
      const neg = v < 0n; const a = neg ? -v : v;
      return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
    };
    const headers = ['createdAt', 'sourceType', 'sourceId', 'description', 'status', 'debit', 'credit', 'balanceAfter', 'createdByAdminId', 'currency'];
    const rows = entries.map((e: any) => ({
      createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : '',
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      description: e.description ?? '',
      status: e.status,
      debit: rupees(e.debitInPaise),
      credit: rupees(e.creditInPaise),
      balanceAfter: rupees(e.balanceAfterInPaise),
      createdByAdminId: e.createdByAdminId ?? (e.createdBySystem ? 'SYSTEM' : ''),
      currency: e.currency ?? 'INR',
    }));
    const csv = toCsv(rows, headers, { bom: true });
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilenameSlug(['franchise_ledger', franchiseId, new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)])}.csv"`);
    res.send(csv);
  }
}
