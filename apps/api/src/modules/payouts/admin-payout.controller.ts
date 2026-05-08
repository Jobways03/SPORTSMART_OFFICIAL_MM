import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../core/guards';
import { Permissions } from '../../core/decorators/permissions.decorator';
import { BadRequestAppException } from '../../core/exceptions';
import { PayoutService } from './payout.service';

@ApiTags('Admin Payouts')
@Controller('admin/payouts')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminPayoutController {
  constructor(private readonly service: PayoutService) {}

  @Get()
  @Permissions('payouts.read')
  async list() {
    const data = await this.service.listBatches();
    return { success: true, message: 'Batches', data };
  }

  @Get(':id')
  @Permissions('payouts.read')
  async get(@Param('id') id: string) {
    const data = await this.service.getBatch(id);
    return { success: true, message: 'Batch', data };
  }

  @Post('cycles/:cycleId/batches')
  @Permissions('payouts.export')
  async create(@Req() req: Request, @Param('cycleId') cycleId: string) {
    const data = await this.service.createBatch({
      cycleId,
      adminId: (req as any).adminId,
    });
    return { success: true, message: 'Batch created', data };
  }

  @Get(':id/export.csv')
  @Permissions('payouts.export')
  @Header('Content-Type', 'text/csv')
  async exportCsv(@Param('id') id: string, @Res() res: Response) {
    const csv = await this.service.generateExport(id);
    res.setHeader('Content-Disposition', `attachment; filename="payout-batch-${id}.csv"`);
    res.send(csv);
  }

  @Post(':id/ingest-response')
  @Permissions('payouts.ingestResponse')
  async ingest(
    @Param('id') id: string,
    @Body() body: { rows: Array<{ settlementId: string; status: 'PAID' | 'FAILED'; utrReference?: string; failureReason?: string }> },
  ) {
    if (!Array.isArray(body?.rows)) {
      throw new BadRequestAppException('rows[] is required');
    }
    const data = await this.service.ingestBankResponse({ batchId: id, rows: body.rows });
    return { success: true, message: 'Bank response ingested', data };
  }
}
