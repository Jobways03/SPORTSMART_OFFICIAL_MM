import {
  Body,
  Controller,
  Delete,
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
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../../bootstrap/logging/app-logger.service';
import { BadRequestAppException } from '../../../../../core/exceptions';
import { SellerAuthGuard } from '../../../../../core/guards';

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
    private readonly prisma: PrismaService,
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

    const where: any = {
      sellerId,
      isActive: true,
    };

    if (search) {
      where.pincode = { contains: search };
    }

    const [serviceAreas, total] = await Promise.all([
      this.prisma.sellerServiceArea.findMany({
        where,
        orderBy: { pincode: 'asc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      this.prisma.sellerServiceArea.count({ where }),
    ]);

    return {
      success: true,
      message: 'Service areas retrieved successfully',
      data: {
        serviceAreas: serviceAreas.map((sa) => ({
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
    const result = await this.prisma.sellerServiceArea.createMany({
      data: uniquePincodes.map((pincode) => ({
        sellerId,
        pincode,
        isActive: true,
      })),
      skipDuplicates: true,
    });

    this.logger.log(
      `Seller ${sellerId} added ${result.count} service area(s) (${uniquePincodes.length} requested, duplicates skipped)`,
    );

    return {
      success: true,
      message: `${result.count} pincode(s) added successfully${uniquePincodes.length - result.count > 0 ? `, ${uniquePincodes.length - result.count} already existed` : ''}`,
      data: {
        added: result.count,
        requested: uniquePincodes.length,
        duplicatesSkipped: uniquePincodes.length - result.count,
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

    const existing = await this.prisma.sellerServiceArea.findUnique({
      where: {
        sellerId_pincode: { sellerId, pincode },
      },
    });

    if (!existing) {
      throw new BadRequestAppException(
        `Pincode ${pincode} is not in your service areas`,
      );
    }

    await this.prisma.sellerServiceArea.delete({
      where: {
        sellerId_pincode: { sellerId, pincode },
      },
    });

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

    const result = await this.prisma.sellerServiceArea.deleteMany({
      where: {
        sellerId,
        pincode: { in: uniquePincodes },
      },
    });

    this.logger.log(
      `Seller ${sellerId} removed ${result.count} service area(s)`,
    );

    return {
      success: true,
      message: `${result.count} pincode(s) removed from service areas`,
      data: {
        removed: result.count,
        requested: uniquePincodes.length,
      },
    };
  }
}
