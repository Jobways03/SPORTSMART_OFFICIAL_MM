// Phase 37 — Admin UQC master CRUD.

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { UqcMasterService } from '../../application/services/uqc-master.service';

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
  ) {
    const rows = await this.uqc.list({
      search: search || undefined,
      activeOnly: activeOnly === 'true',
    });
    return { success: true, message: 'UQC rows', data: rows };
  }

  @Post()
  @Permissions('tax.master.write')
  async create(@Body() body: { code: string; description: string }) {
    const row = await this.uqc.create(body);
    return { success: true, message: 'UQC row created', data: row };
  }

  @Patch(':id')
  @Permissions('tax.master.write')
  async update(
    @Param('id') id: string,
    @Body() body: { description?: string; isActive?: boolean },
  ) {
    const row = await this.uqc.update(id, body);
    return { success: true, message: 'UQC row updated', data: row };
  }
}
