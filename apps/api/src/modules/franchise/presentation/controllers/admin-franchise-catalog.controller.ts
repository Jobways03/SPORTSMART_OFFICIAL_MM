import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import {
  FranchiseCatalogRepository,
  FRANCHISE_CATALOG_REPOSITORY,
} from '../../domain/repositories/franchise-catalog.repository.interface';
import { NotFoundAppException } from '../../../../core/exceptions';

@ApiTags('Admin Franchise Catalog')
@Controller('admin/franchise-catalog')
@UseGuards(AdminAuthGuard)
export class AdminFranchiseCatalogController {
  constructor(
    @Inject(FRANCHISE_CATALOG_REPOSITORY)
    private readonly catalogRepo: FranchiseCatalogRepository,
  ) {}

  @Get()
  async listAllMappings(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('franchiseId') franchiseId?: string,
    @Query('approvalStatus') approvalStatus?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.catalogRepo.findAllPaginated({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      franchiseId,
      approvalStatus,
      search,
    });

    return {
      success: true,
      message: 'Franchise catalog mappings fetched successfully',
      data,
    };
  }

  @Get(':mappingId')
  async getMappingDetail(@Param('mappingId') mappingId: string) {
    const data = await this.catalogRepo.findById(mappingId);
    if (!data) {
      throw new NotFoundAppException('Catalog mapping not found');
    }

    return {
      success: true,
      message: 'Catalog mapping fetched successfully',
      data,
    };
  }

  @Patch(':mappingId/approve')
  @HttpCode(HttpStatus.OK)
  async approveMapping(@Param('mappingId') mappingId: string) {
    const existing = await this.catalogRepo.findById(mappingId);
    if (!existing) {
      throw new NotFoundAppException('Catalog mapping not found');
    }

    const data = await this.catalogRepo.approve(mappingId);

    return {
      success: true,
      message: 'Catalog mapping approved successfully',
      data,
    };
  }

  @Patch(':mappingId/stop')
  @HttpCode(HttpStatus.OK)
  async stopMapping(@Param('mappingId') mappingId: string) {
    const existing = await this.catalogRepo.findById(mappingId);
    if (!existing) {
      throw new NotFoundAppException('Catalog mapping not found');
    }

    const data = await this.catalogRepo.stop(mappingId);

    return {
      success: true,
      message: 'Catalog mapping stopped successfully',
      data,
    };
  }
}
