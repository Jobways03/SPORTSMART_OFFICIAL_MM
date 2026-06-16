import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { FranchiseAuthGuard } from '../../../../core/guards';
import { FranchiseCatalogService } from '../../application/services/franchise-catalog.service';
import { FranchiseAddCatalogMappingDto, BulkAddCatalogMappingsDto } from '../dtos/franchise-add-catalog-mapping.dto';
import { FranchiseUpdateCatalogMappingDto } from '../dtos/franchise-update-catalog-mapping.dto';
import { FranchisePauseCatalogMappingDto } from '../dtos/franchise-pause-catalog-mapping.dto';
import { FranchiseActiveGuard } from '../../../../core/guards';

@ApiTags('Franchise Catalog')
@Controller('franchise/catalog')
@UseGuards(FranchiseAuthGuard, FranchiseActiveGuard)
// Phase 159n (audit #12) — coarse abuse cap on the franchise catalog surface.
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class FranchiseCatalogController {
  constructor(
    private readonly catalogService: FranchiseCatalogService,
  ) {}

  @Get('available-products')
  async browseAvailableProducts(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.catalogService.browseAvailableProducts({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search,
      categoryId,
      brandId,
      excludeFranchiseId: franchiseId,
    });

    return {
      success: true,
      message: 'Available products fetched successfully',
      data,
    };
  }

  @Get('mappings')
  async listMappings(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('approvalStatus') approvalStatus?: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.catalogService.listMappings(franchiseId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      approvalStatus,
    });

    return {
      success: true,
      message: 'Catalog mappings fetched successfully',
      data,
    };
  }

  @Get('mappings/:mappingId')
  async getMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.catalogService.getMapping(franchiseId, mappingId);

    return {
      success: true,
      message: 'Catalog mapping fetched successfully',
      data,
    };
  }

  @Post('mappings')
  @HttpCode(HttpStatus.CREATED)
  async addMapping(
    @Req() req: Request,
    @Body() dto: FranchiseAddCatalogMappingDto,
  ) {
    const franchiseId = (req as any).franchiseId;

    // Resolve globalSku — the service needs it but the franchise doesn't supply it directly.
    // We pass productId and variantId; the controller fetches the SKU via the catalog browse.
    // For now, pass a placeholder that the service can resolve, or pass it from the DTO.
    const data = await this.catalogService.addMapping(franchiseId, {
      productId: dto.productId,
      variantId: dto.variantId,
      globalSku: '', // Resolved in the service from the master/variant SKU.
      barcode: dto.barcode,
      isListedForOnlineFulfillment: dto.isListedForOnlineFulfillment,
    });

    return {
      success: true,
      message: 'Catalog mapping added successfully',
      data,
    };
  }

  @Post('mappings/bulk')
  @HttpCode(HttpStatus.CREATED)
  async addMappings(
    @Req() req: Request,
    @Body() body: BulkAddCatalogMappingsDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const mappingsData = body.mappings.map((m) => ({
      productId: m.productId,
      variantId: m.variantId,
      globalSku: '',
      barcode: m.barcode,
      isListedForOnlineFulfillment: m.isListedForOnlineFulfillment,
    }));

    const count = await this.catalogService.addMappings(franchiseId, mappingsData);

    return {
      success: true,
      message: `${count} catalog mapping(s) added successfully`,
      data: { count },
    };
  }

  @Patch('mappings/:mappingId')
  @HttpCode(HttpStatus.OK)
  async updateMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Body() dto: FranchiseUpdateCatalogMappingDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.catalogService.updateMapping(franchiseId, mappingId, dto);

    return {
      success: true,
      message: 'Catalog mapping updated successfully',
      data,
    };
  }

  // Franchise self-pause — temporarily stop selling THIS franchise's offer for
  // the SKU. Does not touch the shared Product or any other seller's/
  // franchise's offer; only an APPROVED, live mapping the franchise owns is
  // affected. Reversible via the resume endpoint below.
  @Patch('mappings/:mappingId/pause')
  @HttpCode(HttpStatus.OK)
  async pauseMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Body() dto: FranchisePauseCatalogMappingDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.catalogService.pauseMapping(
      franchiseId,
      mappingId,
      dto?.reason,
    );

    return {
      success: true,
      message: 'Sales paused for this product',
      data,
    };
  }

  // Franchise self-resume — lift a self-pause back to live. An admin STOP is
  // not resumable here (service guards on stoppedById === franchiseId).
  @Patch('mappings/:mappingId/resume')
  @HttpCode(HttpStatus.OK)
  async resumeMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.catalogService.resumeMapping(franchiseId, mappingId);

    return {
      success: true,
      message: 'Sales resumed for this product',
      data,
    };
  }

  @Delete('mappings/:mappingId')
  @HttpCode(HttpStatus.OK)
  async removeMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    await this.catalogService.removeMapping(franchiseId, mappingId);

    return {
      success: true,
      message: 'Catalog mapping removed successfully',
      data: null,
    };
  }
}
