import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AppLoggerService } from '../../../../../bootstrap/logging/app-logger.service';
import { BadRequestAppException } from '../../../../../core/exceptions';
import { SellerAuthGuard } from '../../../../../core/guards';
import { SELLER_MAPPING_REPOSITORY, ISellerMappingRepository } from '../../../domain/repositories/seller-mapping.repository.interface';

// ─── DTOs (inline) ──────────────────────────────────────────────────

interface AddPincodesDto {
  pincodes: string[];
}

interface RemovePincodesDto {
  pincodes: string[];
}

@ApiTags('Seller Service Areas')
@Controller('seller/service-areas')
@UseGuards(SellerAuthGuard)
export class SellerServiceAreaController {
  constructor(
    @Inject(SELLER_MAPPING_REPOSITORY) private readonly sellerMappingRepo: ISellerMappingRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SellerServiceAreaController');
  }

  // ─── List seller's serviceable pincodes (paginated) ────────────────

  @Get()
  @HttpCode(HttpStatus.OK)
  async listServiceAreas(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const sellerId = (req as any).sellerId;
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));

    const { serviceAreas, total } = await this.sellerMappingRepo.findServiceAreasPaginated(
      sellerId, pageNum, limitNum, search,
    );

    return {
      success: true,
      message: 'Service areas retrieved successfully',
      data: {
        serviceAreas: serviceAreas.map((sa: any) => ({
          id: sa.id,
          pincode: sa.pincode,
          isActive: sa.isActive,
          createdAt: sa.createdAt,
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  // ─── Add pincodes (bulk upsert, skip duplicates) ──────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addServiceAreas(@Req() req: Request, @Body() dto: AddPincodesDto) {
    const sellerId = (req as any).sellerId;

    if (!dto.pincodes || !Array.isArray(dto.pincodes) || dto.pincodes.length === 0) {
      throw new BadRequestAppException(
        'pincodes array is required and must not be empty',
      );
    }

    if (dto.pincodes.length > 500) {
      throw new BadRequestAppException(
        'Maximum 500 pincodes per request',
      );
    }

    // Validate pincode format (Indian pincodes are 6 digits)
    const invalidPincodes = dto.pincodes.filter(
      (p) => typeof p !== 'string' || !/^\d{6}$/.test(p),
    );
    if (invalidPincodes.length > 0) {
      throw new BadRequestAppException(
        `Invalid pincode format (must be 6 digits): ${invalidPincodes.slice(0, 5).join(', ')}${invalidPincodes.length > 5 ? '...' : ''}`,
      );
    }

    // Deduplicate input
    const uniquePincodes = [...new Set(dto.pincodes)];

    // Bulk upsert — skipDuplicates ensures idempotency
    const addedCount = await this.sellerMappingRepo.addServiceAreas(sellerId, uniquePincodes);

    this.logger.log(
      `Seller ${sellerId} added ${addedCount} service area(s) (${uniquePincodes.length} requested, duplicates skipped)`,
    );

    return {
      success: true,
      message: `${addedCount} pincode(s) added successfully${uniquePincodes.length - addedCount > 0 ? `, ${uniquePincodes.length - addedCount} already existed` : ''}`,
      data: {
        added: addedCount,
        requested: uniquePincodes.length,
        duplicatesSkipped: uniquePincodes.length - addedCount,
      },
    };
  }

  // ─── Remove a single pincode ──────────────────────────────────────

  @Delete(':pincode')
  @HttpCode(HttpStatus.OK)
  async removeServiceArea(
    @Req() req: Request,
    @Param('pincode') pincode: string,
  ) {
    const sellerId = (req as any).sellerId;

    const existing = await this.sellerMappingRepo.findServiceArea(sellerId, pincode);

    if (!existing) {
      throw new BadRequestAppException(
        `Pincode ${pincode} is not in your service areas`,
      );
    }

    await this.sellerMappingRepo.removeServiceArea(sellerId, pincode);

    this.logger.log(
      `Seller ${sellerId} removed service area pincode ${pincode}`,
    );

    return {
      success: true,
      message: `Pincode ${pincode} removed from service areas`,
      data: null,
    };
  }

  // ─── Remove multiple pincodes (bulk) ──────────────────────────────

  @Delete()
  @HttpCode(HttpStatus.OK)
  async removeServiceAreas(@Req() req: Request, @Body() dto: RemovePincodesDto) {
    const sellerId = (req as any).sellerId;

    if (!dto.pincodes || !Array.isArray(dto.pincodes) || dto.pincodes.length === 0) {
      throw new BadRequestAppException(
        'pincodes array is required and must not be empty',
      );
    }

    const uniquePincodes = [...new Set(dto.pincodes)];

    const removedCount = await this.sellerMappingRepo.removeServiceAreas(sellerId, uniquePincodes);

    this.logger.log(
      `Seller ${sellerId} removed ${removedCount} service area(s)`,
    );

    return {
      success: true,
      message: `${removedCount} pincode(s) removed from service areas`,
      data: {
        removed: removedCount,
        requested: uniquePincodes.length,
      },
    };
  }
}
