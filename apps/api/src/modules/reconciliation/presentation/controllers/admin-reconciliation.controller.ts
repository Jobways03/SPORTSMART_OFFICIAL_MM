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
import type { Response } from 'express';
import type {
  DiscrepancyStatus,
  ReconciliationKind,
  ReconciliationStatus,
} from '@prisma/client';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { BadRequestAppException } from '../../../../core/exceptions';
import { ReconciliationService } from '../../application/services/reconciliation.service';

interface StartRunDto {
  kind: ReconciliationKind;
  periodStart: string; // ISO
  periodEnd: string;   // ISO
}

interface TransitionDto {
  status: DiscrepancyStatus;
  notes?: string;
}

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
    const data = await this.service.listRuns({
      page: parseInt(page || '1', 10) || 1,
      limit: parseInt(limit || '20', 10) || 20,
      kind: kind ? (kind as ReconciliationKind) : undefined,
      status: status ? (status as ReconciliationStatus) : undefined,
    });
    return { success: true, message: 'Runs retrieved', data };
  }

  @Post('runs')
  @Permissions('recon.run')
  async startRun(@Req() req: any, @Body() body: StartRunDto) {
    if (!body?.kind || !body?.periodStart || !body?.periodEnd) {
      throw new BadRequestAppException('kind, periodStart, periodEnd required');
    }
    const data = await this.service.runAndCollect({
      kind: body.kind,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      startedByAdminId: req.adminId,
    });
    return { success: true, message: 'Run completed', data };
  }

  @Get('runs/:id')
  @Permissions('recon.read')
  async getRun(@Param('id') id: string) {
    const data = await this.service.getRun(id);
    return { success: true, message: 'Run retrieved', data };
  }

  @Get('runs/:id/discrepancies.csv')
  @Permissions('recon.read')
  @Header('Content-Type', 'text/csv')
  async exportCsv(@Param('id') id: string, @Res() res: Response) {
    const csv = await this.service.exportDiscrepanciesCsv(id);
    res.setHeader('Content-Disposition', `attachment; filename="recon-${id}-discrepancies.csv"`);
    res.send(csv);
  }

  @Patch('discrepancies/:id/status')
  @Permissions('recon.transition')
  async transition(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: TransitionDto,
  ) {
    if (!body?.status) throw new BadRequestAppException('status is required');
    const data = await this.service.transitionDiscrepancy({
      id, status: body.status, notes: body.notes, adminId: req.adminId,
    });
    return { success: true, message: 'Discrepancy updated', data };
  }
}
