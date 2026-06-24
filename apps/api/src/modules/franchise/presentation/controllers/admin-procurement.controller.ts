import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { ProcurementService } from '../../application/services/procurement.service';
import { ProcurementApproveDto } from '../dtos/procurement-approve.dto';
import { ProcurementRejectDto } from '../dtos/procurement-reject.dto';
import { ProcurementDispatchDto } from '../dtos/procurement-dispatch.dto';

@ApiTags('Admin Procurement')
@Controller('admin/procurement')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('franchise.read')
export class AdminProcurementController {
  constructor(private readonly procurementService: ProcurementService) {}

  @Get()
  async listAllRequests(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('franchiseId') franchiseId?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    const { requests, total } = await this.procurementService.listAllRequests(
      pageNum,
      limitNum,
      status,
      franchiseId,
      search,
    );

    // Wrap in the pagination envelope used by every other list
    // endpoint in this codebase (admin-products, admin-categories,
    // storefront-products, …). The affiliate/franchise dashboards
    // read `data.pagination.total` — without this wrapper they crashed
    // on first render.
    return {
      success: true,
      message: 'Procurement requests fetched successfully',
      data: {
        requests,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  @Get(':id')
  async getRequestDetail(@Param('id') id: string) {
    const data = await this.procurementService.getRequestDetailAdmin(id);

    return {
      success: true,
      message: 'Procurement request detail fetched successfully',
      data,
    };
  }

  @Patch(':id/approve')
  // Phase 159p (audit #5) — approving a procurement sets landed cost + the
  // franchise payable; it must require a dedicated write permission, not the
  // class-level franchise.read every admin inherits.
  @Permissions('franchise.procurement.approve')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async approveRequest(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ProcurementApproveDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.procurementService.approveRequest(
      adminId,
      id,
      dto.items,
    );

    return {
      success: true,
      message: 'Procurement request approved successfully',
      data,
    };
  }

  @Patch(':id/reject')
  // Reject is the other half of the approval decision — same write permission.
  @Permissions('franchise.procurement.approve')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async rejectRequest(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ProcurementRejectDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.procurementService.rejectRequest(
      adminId,
      id,
      dto.reason,
    );

    return {
      success: true,
      message: 'Procurement request rejected successfully',
      data,
    };
  }

  @Patch(':id/dispatch')
  @Permissions('franchise.procurement.dispatch')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async markDispatched(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ProcurementDispatchDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.procurementService.markDispatched(
      adminId,
      id,
      {
        trackingNumber: dto.trackingNumber ?? null,
        carrierName: dto.carrierName ?? null,
        expectedDeliveryAt: dto.expectedDeliveryAt
          ? new Date(dto.expectedDeliveryAt)
          : null,
      },
      dto.items,
    );

    return {
      success: true,
      message: 'Procurement request marked as dispatched',
      data,
    };
  }

  @Patch(':id/settle')
  @Permissions('franchise.procurement.settle')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async settleRequest(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.procurementService.settleRequest(adminId, id);

    return {
      success: true,
      message: 'Procurement request settled successfully',
      data,
    };
  }

  // ── Damage claims (receipt damage → admin photo review) ──────────────

  /** List the damage claims raised on a procurement request. */
  @Get(':id/damage-claims')
  async listDamageClaims(@Param('id') id: string) {
    const data = await this.procurementService.listDamageClaims(id);
    return { success: true, message: 'Damage claims fetched', data };
  }

  /** Approve a damage claim — units written off, franchise payable drops. */
  @Patch('damage-claims/:claimId/approve')
  @Permissions('franchise.procurement.approve')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async approveDamageClaim(
    @Req() req: Request,
    @Param('claimId') claimId: string,
    @Body() body: { note?: string },
  ) {
    const adminId = (req as any).adminId;
    const data = await this.procurementService.approveDamageClaim(
      adminId,
      claimId,
      body?.note,
    );
    return { success: true, message: 'Damage claim approved', data };
  }

  /** Reject a damage claim — units become saleable, franchise still pays. */
  @Patch('damage-claims/:claimId/reject')
  @Permissions('franchise.procurement.approve')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async rejectDamageClaim(
    @Req() req: Request,
    @Param('claimId') claimId: string,
    @Body() body: { note?: string },
  ) {
    const adminId = (req as any).adminId;
    const data = await this.procurementService.rejectDamageClaim(
      adminId,
      claimId,
      body?.note,
    );
    return { success: true, message: 'Damage claim rejected', data };
  }
}
