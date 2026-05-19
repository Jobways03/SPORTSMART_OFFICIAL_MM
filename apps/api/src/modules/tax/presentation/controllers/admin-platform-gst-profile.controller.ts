// Phase 37 — Admin platform GST profile CRUD.

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import {
  PlatformGstProfileService,
  CreatePlatformProfileInput,
  UpdatePlatformProfileInput,
} from '../../application/services/platform-gst-profile.service';

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

  @Post()
  @Permissions('tax.master.write')
  async create(@Body() body: CreatePlatformProfileInput) {
    const row = await this.profiles.create(body);
    return { success: true, message: 'Profile created', data: row };
  }

  @Patch(':id')
  @Permissions('tax.master.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdatePlatformProfileInput,
  ) {
    const row = await this.profiles.update(id, body);
    return { success: true, message: 'Profile updated', data: row };
  }

  @Post(':id/set-default')
  @Permissions('tax.master.write')
  async setDefault(@Param('id') id: string) {
    const row = await this.profiles.setDefault(id);
    return { success: true, message: 'Default updated', data: row };
  }
}
