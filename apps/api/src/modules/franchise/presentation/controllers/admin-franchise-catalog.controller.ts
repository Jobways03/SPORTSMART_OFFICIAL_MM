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
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@ApiTags('Admin Franchise Catalog')
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminFranchiseCatalogController {
  constructor(
    @Inject(FRANCHISE_CATALOG_REPOSITORY)
    private readonly catalogRepo: FranchiseCatalogRepository,
    private readonly prisma: PrismaService,
  ) {}

  @Get('franchise-catalog')
  async listAllMappings(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('franchiseId') franchiseId?: string,
    @Query('approvalStatus') approvalStatus?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    const { mappings, total } = await this.catalogRepo.findAllPaginated({
      page: pageNum,
      limit: limitNum,
      franchiseId,
      approvalStatus,
      search,
    });

    // Bulk-load FranchiseStock for every (franchise,product,variant)
    // tuple in the page, so each row can render onHand / reserved /
    // available / damaged without N+1 queries. This is the only way
    // for the admin to see, at a glance, which franchise actually has
    // physical stock for a given mapping vs. which is empty.
    const franchiseIds = Array.from(new Set(mappings.map((m: any) => m.franchiseId)));
    const productIds = Array.from(new Set(mappings.map((m: any) => m.productId)));
    const stockRows = franchiseIds.length
      ? await this.prisma.franchiseStock.findMany({
          where: {
            franchiseId: { in: franchiseIds },
            productId: { in: productIds },
          },
          select: {
            franchiseId: true,
            productId: true,
            variantId: true,
            onHandQty: true,
            reservedQty: true,
            availableQty: true,
            damagedQty: true,
            inTransitQty: true,
            lowStockThreshold: true,
            lastRestockedAt: true,
          },
        })
      : [];

    const stockKey = (fid: string, pid: string, vid: string | null) =>
      `${fid}:${pid}:${vid ?? 'null'}`;
    const stockMap = new Map<string, (typeof stockRows)[number]>();
    for (const s of stockRows) {
      stockMap.set(stockKey(s.franchiseId, s.productId, s.variantId), s);
    }

    const enriched = mappings.map((m: any) => {
      const stock =
        stockMap.get(stockKey(m.franchiseId, m.productId, m.variantId)) ??
        // Fallback to product-level row when the mapping is variant-specific
        // but the franchise tracks stock at the product level.
        stockMap.get(stockKey(m.franchiseId, m.productId, null)) ??
        null;
      return {
        ...m,
        stock: stock
          ? {
              onHandQty: stock.onHandQty,
              reservedQty: stock.reservedQty,
              availableQty: stock.availableQty,
              damagedQty: stock.damagedQty,
              inTransitQty: stock.inTransitQty,
              lowStockThreshold: stock.lowStockThreshold,
              lastRestockedAt: stock.lastRestockedAt,
            }
          : null,
      };
    });

    // Pagination envelope — same shape used by admin-products,
    // admin-procurement, admin-franchise-settlements. The
    // franchise-admin catalog page reads `data.pagination.totalPages`
    // to decide whether to render the pager; without this wrapper the
    // pager stayed hidden even when more rows existed.
    return {
      success: true,
      message: 'Franchise catalog mappings fetched successfully',
      data: {
        mappings: enriched,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  @Get('franchise-catalog/:mappingId')
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

  @Patch('franchise-catalog/:mappingId/approve')
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

  @Patch('franchise-catalog/:mappingId/stop')
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

  @Patch('franchise-catalog/:mappingId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectMapping(@Param('mappingId') mappingId: string) {
    // Reject moves the mapping into a "needs revision" state. The
    // franchise can edit the row and re-submit; the next PATCH from
    // their end auto-resets the status to PENDING_APPROVAL for
    // re-review (see FranchiseCatalogService.updateMapping).
    const existing = await this.catalogRepo.findById(mappingId);
    if (!existing) {
      throw new NotFoundAppException('Catalog mapping not found');
    }

    const data = await this.catalogRepo.reject(mappingId);

    return {
      success: true,
      message: 'Catalog mapping rejected. The franchise can edit and re-submit.',
      data,
    };
  }

  /**
   * GET /admin/products/:productId/franchise-mappings
   * Returns all franchise catalog mappings for a product, joined with
   * FranchiseStock so the admin product edit page can show franchise
   * inventory parity with the seller inventory panel.
   */
  @Get('products/:productId/franchise-mappings')
  @HttpCode(HttpStatus.OK)
  async getMappingsForProduct(@Param('productId') productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true },
    });
    if (!product) throw new NotFoundAppException('Product not found');

    const mappings = await this.prisma.franchiseCatalogMapping.findMany({
      where: { productId },
      include: {
        franchise: {
          select: {
            id: true,
            businessName: true,
            status: true,
            warehousePincode: true,
            isDeleted: true,
          },
        },
        variant: { select: { id: true, sku: true, title: true } },
      },
      orderBy: [{ franchiseId: 'asc' }, { variantId: 'asc' }],
    });

    // Pull all stock rows for this product up-front to avoid N+1 queries.
    const stockRows = await this.prisma.franchiseStock.findMany({
      where: { productId },
      select: {
        franchiseId: true,
        variantId: true,
        onHandQty: true,
        reservedQty: true,
        availableQty: true,
        lowStockThreshold: true,
        updatedAt: true,
      },
    });
    const stockKey = (fid: string, vid: string | null) => `${fid}:${vid ?? 'null'}`;
    const stockMap = new Map<string, (typeof stockRows)[number]>();
    for (const s of stockRows) {
      stockMap.set(stockKey(s.franchiseId, s.variantId), s);
    }

    const data = mappings.map((m) => {
      const stock =
        stockMap.get(stockKey(m.franchiseId, m.variantId)) ??
        // Fall back to product-level (variantId=NULL) row if mapping is variant-specific
        // and stock was kept at the product level.
        stockMap.get(stockKey(m.franchiseId, null)) ??
        null;

      const onHandQty = stock?.onHandQty ?? 0;
      const reservedQty = stock?.reservedQty ?? 0;
      const availableQty = stock?.availableQty ?? 0;
      const lowStockThreshold = stock?.lowStockThreshold ?? 5;

      let mappingDisplayStatus: string;
      if (m.approvalStatus === 'PENDING_APPROVAL') {
        mappingDisplayStatus = 'PENDING_APPROVAL';
      } else if (!m.isActive || m.approvalStatus === 'STOPPED') {
        mappingDisplayStatus = 'INACTIVE';
      } else if (onHandQty === 0) {
        mappingDisplayStatus = 'OUT_OF_STOCK';
      } else if (availableQty <= lowStockThreshold) {
        mappingDisplayStatus = 'LOW_STOCK';
      } else {
        mappingDisplayStatus = 'ACTIVE';
      }

      return {
        id: m.id,
        productId: m.productId,
        variantId: m.variantId,
        franchise: {
          id: m.franchise.id,
          businessName: m.franchise.businessName,
          status: m.franchise.status,
          warehousePincode: m.franchise.warehousePincode,
        },
        variant: m.variant,
        globalSku: m.globalSku,
        franchiseSku: m.franchiseSku,
        stockQty: onHandQty,
        reservedQty,
        availableQty,
        lowStockThreshold,
        mappingDisplayStatus,
        approvalStatus: m.approvalStatus,
        isActive: m.isActive,
        isListedForOnlineFulfillment: m.isListedForOnlineFulfillment,
        createdAt: m.createdAt,
        updatedAt: stock?.updatedAt ?? m.updatedAt,
      };
    });

    return {
      success: true,
      message: 'Franchise mappings retrieved for product',
      data: {
        product,
        mappings: data,
        total: data.length,
      },
    };
  }
}
