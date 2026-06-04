import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Optional,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { DataValidationService } from '../../application/services/data-validation.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

/**
 * Phase 11 / T7: Data Validation Endpoint
 *
 * Provides a comprehensive data integrity report that checks:
 * - Products without productCode
 * - Variants without masterSku
 * - Active products with no seller mappings
 * - Seller mappings referencing deleted products/variants
 * - Orders with invalid product references
 * - Commission records without matching orders
 * - Orphaned stock reservations (expired but not released)
 */
@ApiTags('Admin System')
@Controller('admin/system')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class DataValidationController {
  constructor(
    private readonly dataValidationService: DataValidationService,
    @Optional() private readonly audit?: AuditPublicFacade,
  ) {}

  // `audit.read` (cross-domain oversight) matches the sidebar/settings tile
  // gates and the sibling admin-queues / admin-timeline endpoints. It
  // previously required `analytics.read`, so an admin who saw the tile
  // (gated on audit.read) hit a 403 when the page called the API.
  @Get('data-validation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run data integrity validation across the system' })
  @Permissions('audit.read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async runDataValidation(@Req() req: Request) {
    const adminId = (req as any).adminId ?? 'unknown';
    const result = await this.dataValidationService.runDataValidation();
    void this.audit
      ?.writeAuditLog({
        actorId: adminId,
        actorType: 'ADMIN',
        action: 'audit.data_validation.viewed',
        module: 'audit',
        resource: 'data_validation',
        resourceId: 'system',
      })
      .catch(() => undefined);
    return result;
  }
}
