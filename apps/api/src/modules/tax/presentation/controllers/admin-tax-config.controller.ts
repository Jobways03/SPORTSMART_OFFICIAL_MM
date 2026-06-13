// Phase 37 — Admin tax config CRUD.
//
// Day-2 ops surface for the `tax_config` key/value store. Values are
// arbitrary JSON (number, string, boolean, object) so the same UI
// can edit knobs like:
//   - eway_bill_threshold_paise         (number)
//   - tcs_rate_bps                      (number)
//   - shipping_sac_code                 (string)
//   - shipping_tax_inclusive            (boolean)
//   - legacy_order_cutoff_date          (ISO string)

import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { TaxConfigService } from '../../application/services/tax-config.service';

@ApiTags('Admin / Tax Config')
@Controller('admin/tax/config')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminTaxConfigController {
  constructor(private readonly taxConfig: TaxConfigService) {}

  @Get()
  @Permissions('tax.master.read')
  async list() {
    const rows = await this.taxConfig.listAll();
    return { success: true, message: 'Tax config rows', data: rows };
  }

  @Put()
  @Permissions('tax.master.write')
  async upsert(
    @Req() req: any,
    @Body() body: { key: string; value: unknown; description?: string | null },
  ) {
    const row = await this.taxConfig.setAdmin({
      key: body.key,
      value: body.value,
      description: body.description ?? null,
      actor: req.adminId ?? 'admin',
    });
    return { success: true, message: 'Tax config saved', data: row };
  }

  // ── Phase 252 — settlement tax editor (GST / TCS / TDS rate + base) ──
  // A focused, validated view over the generic key/value store, powering the
  // admin "Settlement Charges" page.

  @Get('settlement-charges')
  @Permissions('tax.master.read')
  async getSettlementCharges() {
    const data = await this.taxConfig.getSettlementTaxConfig();
    return { success: true, message: 'Settlement tax config', data };
  }

  @Put('settlement-charges')
  @Permissions('tax.master.write')
  async setSettlementCharges(
    @Req() req: any,
    @Body()
    body: {
      gst?: { rateBps?: number; baseType?: string };
      tcs?: { rateBps?: number; baseType?: string };
      tds?: { rateBps?: number; baseType?: string };
    },
  ) {
    const data = await this.taxConfig.setSettlementTaxConfig(
      body,
      req.adminId ?? 'admin',
    );
    return { success: true, message: 'Settlement tax config saved', data };
  }
}
