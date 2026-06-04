// Phase 37 — Admin UQC master CRUD.
//
// Phase 161 (UQC Master flow audit): class-validator DTOs (#6), @Throttle on
// mutating routes (#15), actor capture at the boundary (B2), pagination (#8),
// a bulk-import route (#14), and a history route (#7).

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
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { UqcMasterService } from '../../application/services/uqc-master.service';

// Phase 161 #6 — typed, validated bodies. The service still re-validates +
// sanitises (defence in depth).
export class CreateUqcDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,8}$/, { message: 'code must be 2-8 alphanumerics' })
  code!: string;

  @IsString()
  @Length(1, 200)
  description!: string;
}

export class UpdateUqcDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Phase 161 #11 — required by the service when deactivating.
  @IsOptional()
  @IsString()
  @Length(5, 300)
  deactivationReason?: string;

  // Phase 161 #5 — override the reference guard (reason still recorded).
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  // Phase 161 #9 — optimistic-concurrency token.
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}

export class BulkUqcRowDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,8}$/, { message: 'code must be 2-8 alphanumerics' })
  code!: string;

  @IsString()
  @Length(1, 200)
  description!: string;
}

export class BulkCreateUqcDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkUqcRowDto)
  rows!: BulkUqcRowDto[];
}

@ApiTags('Admin / Tax Masters')
@Controller('admin/tax/uqc')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminUqcMasterController {
  constructor(private readonly uqc: UqcMasterService) {}

  @Get()
  @Permissions('tax.master.read')
  async list(
    @Query('search') search?: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.uqc.list({
      search: search || undefined,
      activeOnly: activeOnly === 'true',
      page: page ? parseInt(page, 10) || 1 : undefined,
      limit: limit ? parseInt(limit, 10) || undefined : undefined,
    });
    return { success: true, message: 'UQC rows', data: result };
  }

  @Get(':id/history')
  @Permissions('tax.master.read')
  async history(@Param('id') id: string) {
    const rows = await this.uqc.historyForRow(id);
    return { success: true, message: 'UQC history', data: rows };
  }

  @Post()
  @Permissions('tax.master.write')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async create(@Req() req: any, @Body() body: CreateUqcDto) {
    const row = await this.uqc.create(body, req.adminId ?? 'unknown-admin');
    return { success: true, message: 'UQC row created', data: row };
  }

  @Post('bulk')
  @Permissions('tax.master.write')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async bulkCreate(@Req() req: any, @Body() body: BulkCreateUqcDto) {
    const result = await this.uqc.bulkCreate(body.rows, req.adminId ?? 'unknown-admin');
    return { success: true, message: 'UQC bulk import complete', data: result };
  }

  @Patch(':id')
  @Permissions('tax.master.write')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateUqcDto,
  ) {
    const row = await this.uqc.update(id, body, req.adminId ?? 'unknown-admin');
    return { success: true, message: 'UQC row updated', data: row };
  }
}
