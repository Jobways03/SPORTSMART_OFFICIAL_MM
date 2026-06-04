// Phase 37 — Admin platform GST profile CRUD.
//
// Phase 161 (Platform GST Profile flow audit): class-validator DTOs (#9),
// actor capture at the boundary (B5), @Throttle (#14), a mandatory reason on
// set-default (#11), and a history route (#12).

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { PlatformGstProfileService } from '../../application/services/platform-gst-profile.service';

const REGISTRATION_TYPES = ['REGULAR', 'COMPOSITION', 'UNREGISTERED'] as const;

// Phase 161 #9 — typed, validated bodies. The service still re-validates
// (GSTIN checksum, PAN format, address structure) — defence in depth.
export class CreatePlatformProfileDto {
  @IsString()
  @Length(1, 200)
  legalBusinessName!: string;

  @IsString()
  // 15-char GSTIN shape; the service runs the full checksum via validateGstin.
  @Matches(/^[0-9]{2}[0-9A-Za-z]{13}$/, { message: 'gstin must be a 15-character GSTIN' })
  gstin!: string;

  @IsObject()
  registeredAddressJson!: Record<string, unknown>;

  @IsOptional()
  @IsIn(REGISTRATION_TYPES as unknown as string[])
  registrationType?: (typeof REGISTRATION_TYPES)[number];

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, { message: 'panNumber must match AAAAA9999A' })
  panNumber?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdatePlatformProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  legalBusinessName?: string;

  @IsOptional()
  @IsObject()
  registeredAddressJson?: Record<string, unknown>;

  @IsOptional()
  @IsIn(REGISTRATION_TYPES as unknown as string[])
  registrationType?: (typeof REGISTRATION_TYPES)[number];

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, { message: 'panNumber must match AAAAA9999A' })
  panNumber?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Phase 161 #17 — promote to default in the same call.
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  // Phase 161 #10 — required by the service when deactivating.
  @IsOptional()
  @IsString()
  @Length(5, 300)
  deactivationReason?: string;

  // Phase 161 #11 — required by the service when promoting to default.
  @IsOptional()
  @IsString()
  @Length(5, 300)
  setDefaultReason?: string;

  // Phase 161 #12 — optimistic-concurrency token.
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}

export class SetDefaultPlatformProfileDto {
  @IsString()
  @Length(5, 300)
  reason!: string;
}

@ApiTags('Admin / Platform GST')
@Controller('admin/tax/platform-gst')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminPlatformGstProfileController {
  constructor(private readonly profiles: PlatformGstProfileService) {}

  @Get()
  @Permissions('tax.master.read')
  async list() {
    const rows = await this.profiles.list();
    return { success: true, message: 'Platform GST profiles', data: rows };
  }

  @Get(':id/history')
  @Permissions('tax.master.read')
  async history(@Param('id') id: string) {
    const rows = await this.profiles.historyForRow(id);
    return { success: true, message: 'Platform GST profile history', data: rows };
  }

  @Post()
  @Permissions('tax.master.write')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async create(@Req() req: any, @Body() body: CreatePlatformProfileDto) {
    const row = await this.profiles.create(body, req.adminId ?? 'unknown-admin');
    return { success: true, message: 'Profile created', data: row };
  }

  @Patch(':id')
  @Permissions('tax.master.write')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdatePlatformProfileDto,
  ) {
    const row = await this.profiles.update(id, body, req.adminId ?? 'unknown-admin');
    return { success: true, message: 'Profile updated', data: row };
  }

  @Post(':id/set-default')
  @Permissions('tax.master.write')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async setDefault(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: SetDefaultPlatformProfileDto,
  ) {
    const row = await this.profiles.setDefault(id, body.reason, req.adminId ?? 'unknown-admin');
    return { success: true, message: 'Default updated', data: row };
  }
}
