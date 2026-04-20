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
import { Request } from 'express';
import { AdminAuthGuard } from '../../../../core/guards';
import { ProcurementService } from '../../application/services/procurement.service';
import { ProcurementApproveDto } from '../dtos/procurement-approve.dto';
import { ProcurementRejectDto } from '../dtos/procurement-reject.dto';
import { ProcurementDispatchDto } from '../dtos/procurement-dispatch.dto';

@ApiTags('Admin Procurement')
@Controller('admin/procurement')
@UseGuards(AdminAuthGuard)
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
  @HttpCode(HttpStatus.OK)
  async markDispatched(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ProcurementDispatchDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.procurementService.markDispatched(adminId, id, {
      trackingNumber: dto.trackingNumber ?? null,
      carrierName: dto.carrierName ?? null,
      expectedDeliveryAt: dto.expectedDeliveryAt
        ? new Date(dto.expectedDeliveryAt)
        : null,
    });

    return {
      success: true,
      message: 'Procurement request marked as dispatched',
      data,
    };
  }

  @Patch(':id/settle')
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
}
