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

/**
 * Strip the platform's cost breakdown from a procurement request before
 * it goes out to a franchise caller.
 *
 * The request + its items carry both the franchise-facing price
 * (finalUnitCostToFranchise, finalPayableAmount) AND the platform's
 * internal breakdown (landedUnitCost, procurementFeePerUnit,
 * totalApprovedAmount, procurementFeeAmount). The UI already hides the
 * breakdown, but the raw JSON still exposes it — a curious franchise
 * could `curl` the endpoint and read the platform's margin. Scrub the
 * breakdown here so the API contract matches the UI contract.
 *
 * Admin callers go through a different controller (admin-procurement)
 * which deliberately keeps the full breakdown.
 */
function scrubPlatformBreakdown<T extends Record<string, any>>(request: T): T {
  if (!request || typeof request !== 'object') return request;
  const {
    totalApprovedAmount: _totalApproved,
    procurementFeeAmount: _procurementFee,
    procurementFeeRate: _feeRate,
    ...safeRequest
  } = request as any;
  const items = Array.isArray((request as any).items)
    ? (request as any).items.map((it: any) => {
        const {
          landedUnitCost: _landed,
          procurementFeePerUnit: _feePerUnit,
          franchisePrice: _franchisePrice, // Option C override — landed cost, must never leak
          variant: rawVariant,
          product: rawProduct,
          ...rest
        } = it ?? {};
        // The repo include pulls costPrice off variant + product so
        // the admin approval modal can pre-fill landed cost from a
        // previous write-back. That's an internal platform number;
        // drop it before anything goes to a franchise caller.
        const variant = rawVariant
          ? (() => {
              const { costPrice: _vCost, ...safeVariant } = rawVariant;
              return safeVariant;
            })()
          : rawVariant;
        const product = rawProduct
          ? (() => {
              const { costPrice: _pCost, ...safeProduct } = rawProduct;
              return safeProduct;
            })()
          : rawProduct;
        return { ...rest, variant, product };
      })
    : (request as any).items;
  return { ...safeRequest, items } as T;
}

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
      data: scrubPlatformBreakdown(data),
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
        requests: requests.map(scrubPlatformBreakdown),
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
      data: scrubPlatformBreakdown(data),
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
      data: scrubPlatformBreakdown(data),
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
      data: scrubPlatformBreakdown(data),
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
      data: scrubPlatformBreakdown(data),
    };
  }
}
