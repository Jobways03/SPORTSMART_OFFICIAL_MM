// Phase 37 — Admin HSN master CRUD.
//
// Adds the day-2 ops surface for the HSN code list. Without this,
// every rate change required a DB migration; now CA can plug in new
// codes / effective-dated rate revisions through the dashboard. The
// service does the versioning (closes the prior active row's window
// when a new code starts).
//
// Phase 161 (HSN Master flow audit): class-validator DTOs at the HTTP
// boundary (#6), @Throttle on mutating routes (#13), pagination on list
// (#9), a dedicated close-window route (#10), and a history route (#8).

import {
  Body,
  Controller,
  Get,
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
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { HsnMasterService } from '../../application/services/hsn-master.service';

const SUPPLY_TAXABILITY = [
  'TAXABLE',
  'NIL_RATED',
  'EXEMPT',
  'NON_GST',
  'ZERO_RATED',
  'OUT_OF_SCOPE',
] as const;

// Phase 161 #6 — typed, validated bodies. The service still re-validates +
// sanitises (defence in depth), but bad input now fails at the HTTP edge.
export class CreateHsnDto {
  @IsString()
  @Matches(/^[0-9]{4,8}$/, { message: 'hsnCode must be 4-8 digits' })
  hsnCode!: string;

  @IsString()
  @Length(1, 300)
  description!: string;

  @IsInt()
  @Min(0)
  @Max(4000)
  defaultGstRateBps!: number;

  @IsOptional()
  @IsIn(SUPPLY_TAXABILITY as unknown as string[])
  supplyTaxability?: (typeof SUPPLY_TAXABILITY)[number];

  @IsOptional()
  @ValidateIf((o: CreateHsnDto) => o.defaultUqcCode !== null)
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,8}$/, { message: 'defaultUqcCode must be 2-8 alphanumerics' })
  defaultUqcCode?: string | null;

  @IsOptional()
  @ValidateIf((o: CreateHsnDto) => o.categoryHint !== null)
  @IsString()
  @Length(0, 120)
  categoryHint?: string | null;

  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;
}

export class UpdateHsnDto {
  @IsOptional()
  @IsString()
  @Length(1, 300)
  description?: string;

  @IsOptional()
  @ValidateIf((o: UpdateHsnDto) => o.defaultUqcCode !== null)
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,8}$/, { message: 'defaultUqcCode must be 2-8 alphanumerics' })
  defaultUqcCode?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateHsnDto) => o.categoryHint !== null)
  @IsString()
  @Length(0, 120)
  categoryHint?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Phase 161 #11 — required by the service when isActive flips to false.
  @IsOptional()
  @IsString()
  @Length(5, 300)
  deactivationReason?: string;

  // Phase 161 #5 — override the live-reference guard (reason still recorded).
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  // Phase 161 #12 — optimistic-concurrency token.
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
  // NB: effectiveTo is intentionally absent (#10) — use POST :id/close-window.
}

export class CloseHsnWindowDto {
  // null re-opens the window (clears effectiveTo).
  @ValidateIf((o: CloseHsnWindowDto) => o.effectiveTo !== null)
  @IsISO8601()
  effectiveTo!: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}

@ApiTags('Admin / Tax Masters')
@Controller('admin/tax/hsn')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminHsnMasterController {
  constructor(private readonly hsn: HsnMasterService) {}

  @Get()
  @Permissions('tax.master.read')
  async list(
    @Query('search') search?: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.hsn.list({
      search: search || undefined,
      activeOnly: activeOnly === 'true',
      page: page ? parseInt(page, 10) || 1 : undefined,
      limit: limit ? parseInt(limit, 10) || undefined : undefined,
    });
    return { success: true, message: 'HSN rows', data: result };
  }

  @Get(':id/history')
  @Permissions('tax.master.read')
  async history(@Param('id') id: string) {
    const rows = await this.hsn.historyForRow(id);
    return { success: true, message: 'HSN history', data: rows };
  }

  @Post()
  @Permissions('tax.master.write')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async create(@Req() req: any, @Body() body: CreateHsnDto) {
    const row = await this.hsn.create(body, req.adminId ?? 'unknown-admin');
    return { success: true, message: 'HSN row created', data: row };
  }

  @Patch(':id')
  @Permissions('tax.master.write')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateHsnDto,
  ) {
    const row = await this.hsn.update(id, body, req.adminId ?? 'unknown-admin');
    return { success: true, message: 'HSN row updated', data: row };
  }

  @Post(':id/close-window')
  @Permissions('tax.master.write')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async closeWindow(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: CloseHsnWindowDto,
  ) {
    const row = await this.hsn.closeWindow(
      id,
      {
        effectiveTo: body.effectiveTo,
        reason: body.reason ?? null,
        expectedVersion: body.expectedVersion,
      },
      req.adminId ?? 'unknown-admin',
    );
    return { success: true, message: 'HSN window updated', data: row };
  }
}
