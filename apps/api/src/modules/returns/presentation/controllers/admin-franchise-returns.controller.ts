import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { BadRequestAppException } from '../../../../core/exceptions';
import { ReturnService } from '../../application/services/return.service';
import { AdminApproveReturnDto } from '../dtos/admin-approve-return.dto';
import { AdminRejectReturnDto } from '../dtos/admin-reject-return.dto';
import { AdminSchedulePickupDto } from '../dtos/admin-schedule-pickup.dto';
import { MarkReceivedDto } from '../dtos/mark-received.dto';
import { SubmitQcDecisionDto } from '../dtos/submit-qc-decision.dto';
import { InitiateRefundDto } from '../dtos/initiate-refund.dto';
import { ConfirmRefundDto } from '../dtos/confirm-refund.dto';
import { MarkRefundFailedDto } from '../dtos/mark-refund-failed.dto';

/**
 * Admin (oversight) view AND lifecycle actions for a franchise partner's
 * returns — the franchise-admin counterpart of the seller-admin returns
 * surface. The franchise PORTAL endpoint (`/franchise/returns`,
 * FranchiseAuthGuard) is scoped to req.franchiseId and so is unusable by an
 * admin picking a franchise; this controller is admin-scoped and reuses
 * ReturnService's node-scoped readers + the SAME lifecycle services the
 * admin/seller surfaces use.
 *
 * SECURITY — every action takes `franchiseId` and runs `assertNodeOwnsReturn`
 * FIRST, so a holder can only ever act on a FRANCHISE-fulfilled return for the
 * named franchise (a D2C/Retail return's sub-order has no matching franchiseId
 * → ForbiddenAppException). The action endpoints are gated on the
 * franchise-only slugs `franchise.returns.manage` / `franchise.returns.refund`
 * (NOT the unscoped returns / refunds slugs), so a franchise role can never
 * reach the global admin return/refund endpoints.
 *
 * Reads stay on `returns.read` (class-level).
 */
@ApiTags('Admin Franchise Returns')
@Controller('admin/franchise-returns')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('returns.read')
export class AdminFranchiseReturnsController {
  constructor(private readonly returnService: ReturnService) {}

  /** Asserts the return is a FRANCHISE return owned by `franchiseId`. */
  private async assertOwns(returnId: string, franchiseId?: string) {
    if (!franchiseId) {
      throw new BadRequestAppException('franchiseId query param is required');
    }
    await this.returnService.assertNodeOwnsReturn(
      returnId,
      'FRANCHISE',
      franchiseId,
    );
  }

  @Get('franchises/:franchiseId')
  async listFranchiseReturns(
    @Param('franchiseId') franchiseId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.returnService.listReturnsForFulfillmentNode({
      nodeType: 'FRANCHISE',
      nodeId: franchiseId,
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20)),
      status,
    });
    return { success: true, message: 'Franchise returns retrieved', data };
  }

  @Get(':returnId')
  async getFranchiseReturnDetail(
    @Param('returnId') returnId: string,
    @Query('franchiseId') franchiseId: string,
  ) {
    if (!franchiseId) {
      throw new BadRequestAppException('franchiseId query param is required');
    }
    const data = await this.returnService.getReturnDetailForNode(
      returnId,
      'FRANCHISE',
      franchiseId,
    );
    return { success: true, message: 'Franchise return retrieved', data };
  }

  // ── Lifecycle actions (node-scoped) ──────────────────────────────────────

  @Patch(':returnId/approve')
  @Permissions('franchise.returns.manage')
  async approve(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Query('franchiseId') franchiseId: string,
    @Body() dto: AdminApproveReturnDto,
  ) {
    await this.assertOwns(returnId, franchiseId);
    const data = await this.returnService.approveReturn(
      returnId,
      req.adminId,
      dto.notes,
    );
    return { success: true, message: 'Return approved', data };
  }

  @Patch(':returnId/reject')
  @Permissions('franchise.returns.manage')
  async reject(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Query('franchiseId') franchiseId: string,
    @Body() dto: AdminRejectReturnDto,
  ) {
    await this.assertOwns(returnId, franchiseId);
    const data = await this.returnService.rejectReturn(
      returnId,
      req.adminId,
      dto.reason,
    );
    return { success: true, message: 'Return rejected', data };
  }

  @Patch(':returnId/schedule-pickup')
  @Permissions('franchise.returns.manage')
  async schedulePickup(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Query('franchiseId') franchiseId: string,
    @Body() dto: AdminSchedulePickupDto,
  ) {
    await this.assertOwns(returnId, franchiseId);
    const data = await this.returnService.schedulePickup(returnId, req.adminId, {
      pickupScheduledAt: new Date(dto.pickupScheduledAt),
      pickupAddress: dto.pickupAddress,
      pickupTrackingNumber: dto.pickupTrackingNumber,
      pickupCourier: dto.pickupCourier,
    });
    return { success: true, message: 'Pickup scheduled', data };
  }

  @Patch(':returnId/mark-received')
  @Permissions('franchise.returns.manage')
  async markReceived(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Query('franchiseId') franchiseId: string,
    @Body() dto: MarkReceivedDto,
  ) {
    await this.assertOwns(returnId, franchiseId);
    const data = await this.returnService.markReceived(
      returnId,
      'ADMIN',
      req.adminId,
      dto?.notes,
      dto?.parcelCondition,
    );
    return { success: true, message: 'Return marked as received', data };
  }

  @Patch(':returnId/qc-decision')
  @Permissions('franchise.returns.manage')
  async submitQc(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Query('franchiseId') franchiseId: string,
    @Body() dto: SubmitQcDecisionDto,
  ) {
    await this.assertOwns(returnId, franchiseId);
    const data = await this.returnService.submitQcDecision(
      returnId,
      'ADMIN',
      req.adminId,
      dto,
    );
    return { success: true, message: 'QC decision submitted', data };
  }

  // ── Refund (moves money) ────────────────────────────────────────────────

  @Patch(':returnId/initiate-refund')
  @Permissions('franchise.returns.refund')
  async initiateRefund(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Query('franchiseId') franchiseId: string,
    @Body() dto: InitiateRefundDto,
  ) {
    await this.assertOwns(returnId, franchiseId);
    const data = await this.returnService.initiateRefund(
      returnId,
      'ADMIN',
      req.adminId,
      dto?.refundMethod,
    );
    return { success: true, message: 'Refund initiated', data };
  }

  @Patch(':returnId/confirm-refund')
  @Permissions('franchise.returns.refund')
  async confirmRefund(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Query('franchiseId') franchiseId: string,
    @Body() dto: ConfirmRefundDto,
  ) {
    await this.assertOwns(returnId, franchiseId);
    const data = await this.returnService.confirmRefund(
      returnId,
      'ADMIN',
      req.adminId,
      dto,
    );
    return { success: true, message: 'Refund confirmed', data };
  }

  @Patch(':returnId/mark-refund-failed')
  @Permissions('franchise.returns.refund')
  async markRefundFailed(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Query('franchiseId') franchiseId: string,
    @Body() dto: MarkRefundFailedDto,
  ) {
    await this.assertOwns(returnId, franchiseId);
    const data = await this.returnService.markRefundFailed(
      returnId,
      'ADMIN',
      req.adminId,
      dto.reason,
    );
    return { success: true, message: 'Refund marked failed', data };
  }

  @Patch(':returnId/retry-refund')
  @Permissions('franchise.returns.refund')
  async retryRefund(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Query('franchiseId') franchiseId: string,
  ) {
    await this.assertOwns(returnId, franchiseId);
    const data = await this.returnService.retryRefund(
      returnId,
      'ADMIN',
      req.adminId,
    );
    return { success: true, message: 'Refund retry triggered', data };
  }
}
