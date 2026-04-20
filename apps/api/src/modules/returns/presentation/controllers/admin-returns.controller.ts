import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminAuthGuard, RolesGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { BadRequestAppException } from '../../../../core/exceptions';
import { ReturnService } from '../../application/services/return.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { toCsv, csvFilenameSlug } from '../../../../core/utils';
import { AdminApproveReturnDto } from '../dtos/admin-approve-return.dto';
import { AdminRejectReturnDto } from '../dtos/admin-reject-return.dto';
import { AdminSchedulePickupDto } from '../dtos/admin-schedule-pickup.dto';
import { ConfirmRefundDto } from '../dtos/confirm-refund.dto';
import { CustomerMarkHandedOverDto } from '../dtos/customer-mark-handed-over.dto';
import { InitiateRefundDto } from '../dtos/initiate-refund.dto';
import { MarkReceivedDto } from '../dtos/mark-received.dto';
import { MarkRefundFailedDto } from '../dtos/mark-refund-failed.dto';
import { SubmitQcDecisionDto } from '../dtos/submit-qc-decision.dto';

const QC_EVIDENCE_UPLOAD_OPTIONS = {
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
};

@ApiTags('Admin Returns')
@Controller('admin/returns')
@UseGuards(AdminAuthGuard, RolesGuard)
export class AdminReturnsController {
  constructor(
    private readonly returnService: ReturnService,
    private readonly prisma: PrismaService,
  ) {}

  // GET /admin/returns — list all returns
  @Get()
  async listReturns(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('subOrderId') subOrderId?: string,
    @Query('fulfillmentNodeType') fulfillmentNodeType?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.returnService.listAllReturns({
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20)),
      status,
      customerId,
      subOrderId,
      fulfillmentNodeType,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      search,
    });
    return { success: true, message: 'Returns retrieved', data };
  }

  // ── Phase R6: Analytics endpoints ───────────────────────────────────────
  // IMPORTANT: These must be declared BEFORE the `:returnId` route so that
  // NestJS does not match `analytics` / `customers` as a returnId param.

  // GET /admin/returns/analytics/summary — returns analytics summary
  @Get('analytics/summary')
  async getAnalyticsSummary(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const data = await this.returnService.getAnalytics(
      fromDate ? new Date(fromDate) : undefined,
      toDate ? new Date(toDate) : undefined,
    );
    return { success: true, message: 'Returns analytics retrieved', data };
  }

  // GET /admin/returns/analytics/trend — returns trend grouped by day/week/month
  @Get('analytics/trend')
  async getReturnsTrend(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('groupBy') groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    if (!fromDate || !toDate) {
      throw new BadRequestAppException('fromDate and toDate are required');
    }
    const data = await this.returnService.getReturnsTrend(
      new Date(fromDate),
      new Date(toDate),
      groupBy,
    );
    return { success: true, message: 'Returns trend retrieved', data };
  }

  // GET /admin/returns/analytics/top-reasons — top return reasons
  @Get('analytics/top-reasons')
  async getTopReasons(
    @Query('limit') limit?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const data = await this.returnService.getTopReturnReasons(
      parseInt(limit || '10', 10),
      fromDate ? new Date(fromDate) : undefined,
      toDate ? new Date(toDate) : undefined,
    );
    return { success: true, message: 'Top return reasons retrieved', data };
  }

  // GET /admin/returns/customers/:customerId/history — customer return history
  @Get('customers/:customerId/history')
  async getCustomerHistory(@Param('customerId') customerId: string) {
    const data = await this.returnService.getCustomerReturnHistory(customerId);
    return {
      success: true,
      message: 'Customer return history retrieved',
      data,
    };
  }

  // GET /admin/returns/:returnId — return detail
  @Get(':returnId')
  async getReturn(@Param('returnId') returnId: string) {
    const data = await this.returnService.getReturnByIdAdmin(returnId);
    return { success: true, message: 'Return retrieved', data };
  }

  // PATCH /admin/returns/:returnId/approve — approve return
  @Patch(':returnId/approve')
  async approveReturn(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: AdminApproveReturnDto,
  ) {
    const data = await this.returnService.approveReturn(
      returnId,
      req.adminId,
      dto.notes,
    );
    return { success: true, message: 'Return approved', data };
  }

  // PATCH /admin/returns/:returnId/reject — reject return
  @Patch(':returnId/reject')
  async rejectReturn(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: AdminRejectReturnDto,
  ) {
    const data = await this.returnService.rejectReturn(
      returnId,
      req.adminId,
      dto.reason,
    );
    return { success: true, message: 'Return rejected', data };
  }

  // PATCH /admin/returns/:returnId/schedule-pickup — schedule pickup
  @Patch(':returnId/schedule-pickup')
  async schedulePickup(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: AdminSchedulePickupDto,
  ) {
    const data = await this.returnService.schedulePickup(
      returnId,
      req.adminId,
      {
        pickupScheduledAt: new Date(dto.pickupScheduledAt),
        pickupAddress: dto.pickupAddress,
        pickupTrackingNumber: dto.pickupTrackingNumber,
        pickupCourier: dto.pickupCourier,
      },
    );
    return { success: true, message: 'Pickup scheduled', data };
  }

  // PATCH /admin/returns/:returnId/mark-in-transit — mark in transit
  @Patch(':returnId/mark-in-transit')
  async markInTransit(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: CustomerMarkHandedOverDto,
  ) {
    const data = await this.returnService.markInTransit(
      returnId,
      'ADMIN',
      req.adminId,
      dto?.trackingNumber,
    );
    return { success: true, message: 'Return marked in transit', data };
  }

  // PATCH /admin/returns/:returnId/mark-received — admin marks received
  @Patch(':returnId/mark-received')
  async markReceived(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: MarkReceivedDto,
  ) {
    const data = await this.returnService.markReceived(
      returnId,
      'ADMIN',
      req.adminId,
      dto?.notes,
    );
    return { success: true, message: 'Return marked as received', data };
  }

  // POST /admin/returns/:returnId/qc-evidence — upload QC evidence (admin)
  @Post(':returnId/qc-evidence')
  @UseInterceptors(FileInterceptor('image', QC_EVIDENCE_UPLOAD_OPTIONS))
  async uploadQcEvidence(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { description?: string },
  ) {
    if (!file?.buffer) {
      throw new BadRequestAppException('Image file required');
    }
    const data = await this.returnService.uploadQcEvidence(
      returnId,
      'ADMIN',
      req.adminId,
      file.buffer,
      file.mimetype,
      body?.description,
    );
    return { success: true, message: 'Evidence uploaded', data };
  }

  // PATCH /admin/returns/:returnId/qc-decision — submit QC decision
  @Patch(':returnId/qc-decision')
  async submitQc(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: SubmitQcDecisionDto,
  ) {
    const data = await this.returnService.submitQcDecision(
      returnId,
      'ADMIN',
      req.adminId,
      dto,
    );
    return { success: true, message: 'QC decision submitted', data };
  }

  // ── Phase R4: Refund processing ─────────────────────────────────────────

  // PATCH /admin/returns/:returnId/initiate-refund — initiate refund.
  // All four refund-movement endpoints (initiate / confirm / fail /
  // retry) move real money, so we gate them to the same tier that can
  // adjust a commission record. Lower-tier admins can still approve,
  // reject, schedule pickup, and run QC — they just can't touch the
  // money at the gateway.
  @Patch(':returnId/initiate-refund')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  async initiateRefund(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: InitiateRefundDto,
  ) {
    const data = await this.returnService.initiateRefund(
      returnId,
      'ADMIN',
      req.adminId,
      dto?.refundMethod,
    );
    return { success: true, message: 'Refund initiated', data };
  }

  // PATCH /admin/returns/:returnId/confirm-refund — confirm refund completed
  @Patch(':returnId/confirm-refund')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  async confirmRefund(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: ConfirmRefundDto,
  ) {
    const data = await this.returnService.confirmRefund(
      returnId,
      'ADMIN',
      req.adminId,
      dto,
    );
    return { success: true, message: 'Refund confirmed', data };
  }

  // PATCH /admin/returns/:returnId/mark-refund-failed — mark refund failed
  @Patch(':returnId/mark-refund-failed')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  async markRefundFailed(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: MarkRefundFailedDto,
  ) {
    const data = await this.returnService.markRefundFailed(
      returnId,
      'ADMIN',
      req.adminId,
      dto.reason,
    );
    return { success: true, message: 'Refund marked as failed', data };
  }

  // PATCH /admin/returns/:returnId/retry-refund — retry refund via gateway
  @Patch(':returnId/retry-refund')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  async retryRefund(
    @Req() req: any,
    @Param('returnId') returnId: string,
  ) {
    const data = await this.returnService.retryRefund(
      returnId,
      'ADMIN',
      req.adminId,
    );
    return { success: true, message: 'Refund retry attempted', data };
  }

  // PATCH /admin/returns/:returnId/close — close return
  @Patch(':returnId/close')
  async closeReturn(
    @Req() req: any,
    @Param('returnId') returnId: string,
  ) {
    const data = await this.returnService.closeReturn(
      returnId,
      'ADMIN',
      req.adminId,
    );
    return { success: true, message: 'Return closed', data };
  }

  // ── Bulk operations ────────────────────────────────────────────

  // Bulk operations run across up to 100 records in one call — the same
  // per-record guards apply, but a bad call can fan out widely. Keep them
  // SUPER_ADMIN-only to limit blast radius on mass-mutations.
  @Post('bulk-approve')
  @Roles('SUPER_ADMIN')
  async bulkApprove(
    @Req() req: any,
    @Body() body: { returnIds: string[] },
  ) {
    if (!Array.isArray(body?.returnIds) || body.returnIds.length === 0) {
      throw new BadRequestAppException('returnIds array is required');
    }
    if (body.returnIds.length > 100) {
      throw new BadRequestAppException('Batch capped at 100');
    }

    const results = await Promise.all(
      body.returnIds.map(async (id) => {
        try {
          await this.returnService.approveReturn(id, 'ADMIN', req.adminId);
          return { id, success: true };
        } catch (err) {
          return { id, success: false, error: (err as Error).message };
        }
      }),
    );

    return {
      success: true,
      message: `Bulk approve: ${results.filter((r) => r.success).length}/${results.length} succeeded`,
      data: { results },
    };
  }

  @Post('bulk-close')
  @Roles('SUPER_ADMIN')
  async bulkClose(
    @Req() req: any,
    @Body() body: { returnIds: string[] },
  ) {
    if (!Array.isArray(body?.returnIds) || body.returnIds.length === 0) {
      throw new BadRequestAppException('returnIds array is required');
    }
    if (body.returnIds.length > 100) {
      throw new BadRequestAppException('Batch capped at 100');
    }

    const results = await Promise.all(
      body.returnIds.map(async (id) => {
        try {
          await this.returnService.closeReturn(id, 'ADMIN', req.adminId);
          return { id, success: true };
        } catch (err) {
          return { id, success: false, error: (err as Error).message };
        }
      }),
    );

    return {
      success: true,
      message: `Bulk close: ${results.filter((r) => r.success).length}/${results.length} succeeded`,
      data: { results },
    };
  }

  // ── CSV export ─────────────────────────────────────────────────

  @Get('export')
  async exportReturns(
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    const HARD_CAP = 50_000;
    const where: any = {};
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (search?.trim()) {
      where.OR = [
        { returnNumber: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const total = await this.prisma.return.count({ where });
    const rows = await this.prisma.return.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: HARD_CAP,
      include: {
        masterOrder: { select: { orderNumber: true, paymentMethod: true } },
        customer: { select: { firstName: true, lastName: true, email: true } },
        subOrder: { select: { sellerId: true, franchiseId: true, fulfillmentNodeType: true } },
        items: {
          select: {
            quantity: true,
            reasonCategory: true,
            qcOutcome: true,
            qcQuantityApproved: true,
            refundAmount: true,
            orderItem: { select: { productTitle: true, unitPrice: true } },
          },
        },
        refundTransactions: {
          select: { attemptNumber: true, status: true, gatewayRefundId: true, failureReason: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const headers = [
      'createdAt',
      'returnNumber',
      'orderNumber',
      'customerName',
      'customerEmail',
      'nodeType',
      'status',
      'itemCount',
      'totalQuantity',
      'qcDecision',
      'refundAmount',
      'refundMethod',
      'refundReference',
      'refundAttempts',
      'refundFailureReason',
      'lastGatewayStatus',
      'paymentMethod',
      'closedAt',
    ];

    const mapped = rows.map((r: any) => ({
      createdAt: r.createdAt,
      returnNumber: r.returnNumber,
      orderNumber: r.masterOrder?.orderNumber ?? '',
      customerName: `${r.customer?.firstName ?? ''} ${r.customer?.lastName ?? ''}`.trim(),
      customerEmail: r.customer?.email ?? '',
      nodeType: r.subOrder?.fulfillmentNodeType ?? '',
      status: r.status,
      itemCount: r.items?.length ?? 0,
      totalQuantity: r.items?.reduce((s: number, i: any) => s + i.quantity, 0) ?? 0,
      qcDecision: r.qcDecision ?? '',
      refundAmount: r.refundAmount != null ? Number(r.refundAmount) : '',
      refundMethod: r.refundMethod ?? '',
      refundReference: r.refundReference ?? '',
      refundAttempts: r.refundAttempts,
      refundFailureReason: r.refundFailureReason ?? '',
      lastGatewayStatus: r.refundTransactions?.[0]?.status ?? '',
      paymentMethod: r.masterOrder?.paymentMethod ?? '',
      closedAt: r.closedAt ?? '',
    }));

    const csv = toCsv(mapped, headers);
    const filename = `${csvFilenameSlug(['returns', dateFrom, dateTo, status]) || 'returns_export'}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Total', String(total));
    if (total > rows.length) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
  }
}
