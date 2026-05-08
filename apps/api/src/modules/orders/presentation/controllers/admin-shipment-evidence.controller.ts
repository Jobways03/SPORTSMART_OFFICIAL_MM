import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { FileService } from '../../../files/application/services/file.service';

/**
 * Phase 11 (post-Phase-10 feature) — Admin read of shipment evidence.
 *
 * Counterpart to the seller upload endpoint. Used by the admin returns
 * detail page to render the "Shipment Evidence" card alongside customer
 * claim + warehouse evidence. Read-only — admins don't upload pre-ship
 * photos, only sellers do.
 *
 * Permission: `returns.read` matches the existing returns read-tier;
 * any admin who can read returns can see the dispatch baseline.
 */
@ApiTags('Admin Shipment Evidence')
@Controller('admin/sub-orders/:subOrderId/shipment-evidence')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminShipmentEvidenceController {
  constructor(private readonly fileService: FileService) {}

  @Get()
  @Permissions('returns.read')
  async list(@Param('subOrderId') subOrderId: string) {
    const attachments = await this.fileService.listByResource(
      'sub_order',
      subOrderId,
    );
    // Mirror the seller controller — derive a viewable URL per item
    // since SHIPMENT_EVIDENCE is PRIVATE and providerUrl is null in
    // the DB. Admin already passed AdminAuthGuard + permissions.
    const data = attachments.map((att) => ({
      ...att,
      viewUrl: this.fileService.viewUrlFor(att.file),
    }));
    return { success: true, message: 'Shipment evidence retrieved', data };
  }
}
