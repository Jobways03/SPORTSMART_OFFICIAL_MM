import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { FranchiseAuthGuard } from '../../../../core/guards';
import { ProcurementService } from '../../application/services/procurement.service';
import { ProcurementCreateDto } from '../dtos/procurement-create.dto';
import { ProcurementReceiptDto } from '../dtos/procurement-receipt.dto';
import { ProcurementCancelDto } from '../dtos/procurement-cancel.dto';

@ApiTags('Franchise Procurement')
@Controller('franchise/procurement')
@UseGuards(FranchiseAuthGuard)
export class FranchiseProcurementController {
  constructor(private readonly procurementService: ProcurementService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createRequest(
    @Req() req: Request,
    @Body() dto: ProcurementCreateDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.procurementService.createRequest(
      franchiseId,
      dto.items,
    );

    return {
      success: true,
      message: 'Procurement request created successfully',
      data,
    };
  }

  @Get()
  async listMyRequests(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    const { requests, total } = await this.procurementService.getMyRequests(
      franchiseId,
      pageNum,
      limitNum,
      status,
    );

    // Match the pagination envelope used by every other list endpoint
    // in the codebase. The admin-procurement controller was the sibling
    // outlier — both fixed together.
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
  async getRequestDetail(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.procurementService.getRequestDetail(
      franchiseId,
      id,
    );

    return {
      success: true,
      message: 'Procurement request detail fetched successfully',
      data,
    };
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  async submitRequest(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.procurementService.submitRequest(franchiseId, id);

    return {
      success: true,
      message: 'Procurement request submitted successfully',
      data,
    };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelRequest(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ProcurementCancelDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.procurementService.cancelRequest(
      franchiseId,
      id,
      dto.reason,
    );

    return {
      success: true,
      message: 'Procurement request cancelled successfully',
      data,
    };
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  async confirmReceipt(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ProcurementReceiptDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.procurementService.confirmReceipt(
      franchiseId,
      id,
      dto.items,
    );

    return {
      success: true,
      message: 'Procurement receipt confirmed successfully',
      data,
    };
  }
}
