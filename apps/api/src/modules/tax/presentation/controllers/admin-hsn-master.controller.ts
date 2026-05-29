// Phase 37 — Admin HSN master CRUD.
//
// Adds the day-2 ops surface for the HSN code list. Without this,
// every rate change required a DB migration; now CA can plug in new
// codes / effective-dated rate revisions through the dashboard. The
// service does the versioning (closes the prior active row's window
// when a new code starts).

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
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import {
  HsnMasterService,
  CreateHsnInput,
  UpdateHsnInput,
} from '../../application/services/hsn-master.service';

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
  ) {
    const rows = await this.hsn.list({
      search: search || undefined,
      activeOnly: activeOnly === 'true',
    });
    return { success: true, message: 'HSN rows', data: rows };
  }

  @Post()
  @Permissions('tax.master.write')
  async create(@Req() req: any, @Body() body: CreateHsnInput) {
    const row = await this.hsn.create(body, req.adminId ?? 'admin');
    return { success: true, message: 'HSN row created', data: row };
  }

  @Patch(':id')
  @Permissions('tax.master.write')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateHsnInput,
  ) {
    const row = await this.hsn.update(id, body, req.adminId ?? 'admin');
    return { success: true, message: 'HSN row updated', data: row };
  }
}
