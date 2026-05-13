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
import { Idempotent } from '../../core/decorators/idempotent.decorator';
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

  // Phase 1 (PR 1.3) — @Idempotent: batch creation is a one-shot
  // money-affecting POST (claims APPROVED settlements into a batch
  // and locks them). A retried create must not produce two batches
  // for the same cycle.
  @Post('cycles/:cycleId/batches')
  @Idempotent()
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

  // Phase 1 (PR 1.3) — @Idempotent: CSV ingest is the load-bearing
  // money-state transition (flips settlements to PAID). PR 0.3's
  // per-row amount check is the inner guard; this decorator prevents
  // double-ingest of the same uploaded file on a retry.
  @Post(':id/ingest-response')
  @Idempotent()
  @Permissions('payouts.ingestResponse')
  async ingest(
    @Param('id') id: string,
    @Body() body: {
      rows: Array<{
        settlementId: string;
        status: 'PAID' | 'FAILED';
        // Phase 0 (PR 0.3) — required for PAID rows. Compared against
        // settlement.totalSettlementAmountInPaise (±1 paise tolerance).
        // Drift demotes the row to FAILED and leaves the settlement
        // APPROVED for reconciliation.
        paidAmountInPaise?: number | string;
        utrReference?: string;
        failureReason?: string;
      }>;
    },
  ) {
    if (!Array.isArray(body?.rows)) {
      throw new BadRequestAppException('rows[] is required');
    }

    // Normalise paidAmountInPaise into a bigint at the boundary so the
    // service can treat both number-from-JSON and string-from-CSV
    // uniformly. Reject non-integer / negative values up front.
    const rows = body.rows.map((r) => {
      let normalisedPaise: bigint | undefined;
      if (r.paidAmountInPaise !== undefined && r.paidAmountInPaise !== null) {
        const raw = r.paidAmountInPaise;
        try {
          normalisedPaise = typeof raw === 'string' ? BigInt(raw) : BigInt(Math.trunc(raw as number));
        } catch {
          throw new BadRequestAppException(
            `Invalid paidAmountInPaise for settlement ${r.settlementId}: ${String(raw)}`,
          );
        }
        if (normalisedPaise < 0n) {
          throw new BadRequestAppException(
            `paidAmountInPaise must be non-negative for settlement ${r.settlementId}`,
          );
        }
      }
      return { ...r, paidAmountInPaise: normalisedPaise };
    });

    const data = await this.service.ingestBankResponse({ batchId: id, rows });
    return { success: true, message: 'Bank response ingested', data };
  }
}
