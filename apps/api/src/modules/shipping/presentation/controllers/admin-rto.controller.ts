// Phase 87 (2026-05-23) — NDR/RTO audit Gap #14/#24.
//
// Admin force-RTO endpoint. Pre-Phase-87 ops had no surface to push a
// stuck NDR into RTO ahead of the carrier's automatic conversion —
// they had to call the carrier or wait. With this endpoint an admin
// (with `orders.rto.force` permission) writes:
//   • SubOrder.rtoInitiatedAt + ndrStatus=EXHAUSTED
//   • RtoEvent row tagged source=ADMIN_FORCE
//   • Audit log row tracing the action
//   • shipping.rto.initiated event so downstream subscribers wake.
//
// Gap #22 admin manual override audit: every call writes a row to
// audit_logs via the AuditPublicFacade so finance/compliance can
// reconstruct who pushed which sub-order into RTO when.

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { CurrentAdmin } from '../../../../core/decorators/current-actor.decorator';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  NdrRtoService,
  type NdrCustomerAction,
} from '../../application/services/ndr-rto.service';

export class ForceRtoDto {
  // Reason text is required + min 10 chars so an admin can't fire
  // RTO without explaining why. Same threshold as the cancel modal.
  @IsString()
  @Length(10, 500)
  reason!: string;
}

// Phase 3 Delhivery wiring (2026-06-02) — admin NDR action (re-attempt etc.).
export class NdrActionDto {
  @IsString()
  @IsIn(['REATTEMPT', 'CONVERT_TO_RTO', 'UPDATE_ADDRESS'])
  action!: NdrCustomerAction;

  @IsOptional()
  @IsString()
  newAddress?: string;
}

@ApiTags('Admin Shipping')
@Controller('admin/shipping/sub-orders')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminRtoController {
  constructor(
    private readonly ndrRtoService: NdrRtoService,
    private readonly auditFacade: AuditPublicFacade,
  ) {}

  /**
   * POST /admin/shipping/sub-orders/:subOrderId/force-rto
   *
   * Requires `orders.rto.force` permission. Body must include a
   * reason ≥ 10 chars (audited).
   */
  @Post(':subOrderId/force-rto')
  @Permissions('orders.rto.force')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  async forceRto(
    @CurrentAdmin() adminId: string,
    @Param('subOrderId') subOrderId: string,
    @Body() body: ForceRtoDto,
  ): Promise<{ success: true; message: string }> {
    await this.ndrRtoService.forceInitiateRto({
      subOrderId,
      reason: body.reason,
      adminId,
    });

    // Gap #24 — admin override audit. Tamper-evident chain.
    await this.auditFacade.writeAuditLog({
      actorId: adminId,
      action: 'shipment.rto.force',
      module: 'shipping',
      resource: 'sub_order',
      resourceId: subOrderId,
      metadata: { reason: body.reason },
    });

    return { success: true, message: 'RTO initiated' };
  }

  /**
   * POST /admin/shipping/sub-orders/:subOrderId/ndr-action
   *
   * Phase 3 Delhivery wiring (2026-06-02) — admin-triggered NDR action
   * (re-attempt / convert-to-RTO / update-address). Reuses NdrRtoService
   * with actorType ADMIN; the carrier call goes through the Delhivery
   * adapter → facade. Returns outcome OK or CARRIER_ERROR.
   */
  @Post(':subOrderId/ndr-action')
  @Permissions('orders.ship.manual')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async ndrAction(
    @CurrentAdmin() adminId: string,
    @Param('subOrderId') subOrderId: string,
    @Body() body: NdrActionDto,
  ): Promise<{ success: boolean; message: string; data: unknown }> {
    const result = await this.ndrRtoService.handleNdrAction({
      subOrderId,
      action: body.action,
      actorType: 'ADMIN',
      actorId: adminId,
      newAddress: body.newAddress,
    });

    await this.auditFacade.writeAuditLog({
      actorId: adminId,
      action: 'shipment.ndr.action',
      module: 'shipping',
      resource: 'sub_order',
      resourceId: subOrderId,
      metadata: { ndrAction: body.action, outcome: result.outcome },
    });

    return {
      success: result.outcome === 'OK',
      message:
        result.message ??
        (result.outcome === 'OK'
          ? 'NDR action applied'
          : 'Carrier rejected the NDR action'),
      data: result,
    };
  }
}
