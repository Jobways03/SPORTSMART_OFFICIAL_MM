import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { AdminAuthGuard, RolesGuard, PermissionsGuard } from '../../core/guards';
import { Roles } from '../../core/decorators/roles.decorator';
import { Permissions } from '../../core/decorators/permissions.decorator';
import { Idempotent } from '../../core/decorators/idempotent.decorator';
import { BadRequestAppException } from '../../core/exceptions';
import { PayoutService } from './payout.service';
import { BankResponseParserService } from './bank-response-parser.service';
import { CancelBatchDto } from './dtos/cancel-batch.dto';

// Phase 152 — bank-response upload cap: bank files are small (a few KB);
// 5 MB is generous and bounds memory + parse cost.
const BANK_RESPONSE_MAX_BYTES = 5 * 1024 * 1024;

// Phase 151 — actor context (admin + IP + UA) for the audit trail on every
// money-state op.
function actorFrom(req: Request) {
  return {
    adminId: (req as any).adminId as string | undefined,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  };
}

@ApiTags('Admin Payouts')
@Controller('admin/payouts')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
export class AdminPayoutController {
  constructor(
    private readonly service: PayoutService,
    private readonly parser: BankResponseParserService,
  ) {}

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
  // Phase 151 — @Roles('SUPER_ADMIN') matches mark-paid's gate (this sets up
  // the same real-money movement) + @Throttle on the heavy transaction.
  @Post('cycles/:cycleId/batches')
  @Idempotent()
  @Roles('SUPER_ADMIN')
  @Permissions('payouts.export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async create(
    @Req() req: Request,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
  ) {
    const data = await this.service.createBatch({ cycleId, actor: actorFrom(req) });
    return { success: true, message: 'Batch created', data };
  }

  @Get(':id/export.csv')
  @Roles('SUPER_ADMIN')
  @Permissions('payouts.export')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const csv = await this.service.generateExport(id, actorFrom(req));
    // Phase 153 — short id + date; don't leak the full internal UUID in a
    // filename that may be forwarded over email / Slack.
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="payout-batch-${id.slice(0, 8)}-${ymd}.csv"`,
    );
    res.send(csv);
  }

  // Phase 1 (PR 1.3) — @Idempotent: CSV ingest is the load-bearing
  // money-state transition (flips settlements to PAID). PR 0.3's
  // per-row amount check is the inner guard; this decorator prevents
  // double-ingest of the same uploaded file on a retry.
  @Post(':id/ingest-response')
  @Idempotent()
  @Roles('SUPER_ADMIN')
  @Permissions('payouts.ingestResponse')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async ingest(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
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

    const data = await this.service.ingestBankResponse({
      batchId: id,
      rows,
      actor: actorFrom(req),
    });
    return { success: true, message: 'Bank response ingested', data };
  }

  // Phase 152 — upload the bank response as a CSV file (the exported file the
  // bank annotated). Parsed server-side → the SAME amount-checked ingest path.
  // multipart field name: "file". sha256 of the bytes blocks re-ingesting the
  // same file into the same batch.
  @Post(':id/ingest-response-file')
  @Idempotent()
  @Roles('SUPER_ADMIN')
  @Permissions('payouts.ingestResponse')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: BANK_RESPONSE_MAX_BYTES } }),
  )
  async ingestFile(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestAppException('A CSV file is required (multipart field "file")');
    }
    const name = (file.originalname ?? '').toLowerCase();
    // Only CSV is supported. XLSX needs a parser dependency + macro stripping
    // (a separate, security-sensitive addition) — reject it with a clear hint
    // rather than mis-parsing a binary blob.
    if (!name.endsWith('.csv')) {
      throw new BadRequestAppException(
        'Only .csv bank-response files are supported. Export the payout CSV, ' +
          'have the bank annotate status / paid_amount_in_paise / utr columns, and re-upload.',
      );
    }
    const text = file.buffer.toString('utf8');
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const { rows, rawRows } = this.parser.parse(text);

    const data = await this.service.ingestBankResponse({
      batchId: id,
      rows,
      rawRows,
      actor: actorFrom(req),
      source: 'FILE_UPLOAD',
      fileHash,
      fileName: file.originalname,
    });
    return { success: true, message: 'Bank response file ingested', data };
  }

  // Phase 151 — abort a DRAFT/EXPORTED batch created in error (releases the
  // settlement payout lock). SUPER_ADMIN only; blocked once money has moved.
  @Patch(':id/cancel')
  @Roles('SUPER_ADMIN')
  @Permissions('payouts.cancel')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async cancel(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelBatchDto,
  ) {
    const data = await this.service.cancelBatch(id, body.reason, actorFrom(req));
    return { success: true, message: 'Batch cancelled', data };
  }
}
