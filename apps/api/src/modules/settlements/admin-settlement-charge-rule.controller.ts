import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, RolesGuard, PermissionsGuard } from '../../core/guards';
import { Roles } from '../../core/decorators/roles.decorator';
import { Permissions } from '../../core/decorators/permissions.decorator';
import { SettlementChargeRuleService } from './settlement-charge-rule.service';
import { CreateSettlementChargeRuleDto } from './dtos/settlement-charge-rule.dto';

/**
 * Super-admin CRUD for settlement tax/charge rules (dynamic charges).
 * SUPER_ADMIN-only — tax/charge configuration is not delegated to other roles.
 */
@ApiTags('Admin Settlement Charge Rules')
@Controller('admin/settlements/charge-rules')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
@Roles('SUPER_ADMIN')
export class AdminSettlementChargeRuleController {
  constructor(private readonly rules: SettlementChargeRuleService) {}

  /* ── GET /admin/settlements/charge-rules ── */
  @Get()
  @Permissions('settlements.charges.read')
  async list() {
    const data = await this.rules.list();
    return { success: true, message: 'Settlement charge rules', data };
  }

  /* ── POST /admin/settlements/charge-rules ── */
  @Post()
  @Permissions('settlements.charges.write')
  async create(@Req() req: Request, @Body() body: CreateSettlementChargeRuleDto) {
    const adminId = (req as any).adminId ?? 'unknown-admin';
    const data = await this.rules.create(body, adminId);
    return { success: true, message: 'Charge rule created', data };
  }

  /* ── DELETE /admin/settlements/charge-rules/:id ──
   * Delete a rule. It stops applying to new cycles; past settlements keep their
   * frozen charge lines. Blocked when another rule is levied on this one. */
  @Delete(':id')
  @Permissions('settlements.charges.write')
  async remove(@Param('id') id: string) {
    const data = await this.rules.delete(id);
    return { success: true, message: 'Charge rule deleted', data };
  }
}
