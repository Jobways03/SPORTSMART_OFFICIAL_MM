import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AdminAuthGuard } from '../../../../core/guards';

/**
 * Phase 11 / T7: Data Validation Endpoint
 *
 * Provides a comprehensive data integrity report that checks:
 * - Products without productCode
 * - Variants without masterSku
 * - Active products with no seller mappings
 * - Seller mappings referencing deleted products/variants
 * - Orders with invalid product references
 * - Commission records without matching orders
 * - Orphaned stock reservations (expired but not released)
 */
@ApiTags('Admin System')
@Controller('admin/system')
@UseGuards(AdminAuthGuard)
export class DataValidationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('data-validation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run data integrity validation across the system' })
  async runDataValidation() {
    const startTime = Date.now();

    // 1. Products without productCode (should be 0 after migration)
    const productsWithoutCode = await this.prisma.product.count({
      where: {
        productCode: null,
        isDeleted: false,
      },
    });

    const productsWithoutCodeSample = await this.prisma.product.findMany({
      where: {
        productCode: null,
        isDeleted: false,
      },
      select: { id: true, title: true, sellerId: true, createdAt: true },
      take: 10,
    });

    // 2. Variants without masterSku (should be 0 after migration)
    const variantsWithoutMasterSku = await this.prisma.productVariant.count({
      where: {
        masterSku: null,
        isDeleted: false,
      },
    });

    const variantsWithoutMasterSkuSample = await this.prisma.productVariant.findMany({
      where: {
        masterSku: null,
        isDeleted: false,
      },
      select: {
        id: true,
        productId: true,
        sku: true,
        title: true,
        createdAt: true,
      },
      take: 10,
    });

    // 3. Active products with no seller mappings (potential storefront visibility issue)
    const activeProductsNoMappings = await this.prisma.product.count({
      where: {
        status: 'ACTIVE',
        isDeleted: false,
        sellerMappings: {
          none: {},
        },
      },
    });

    const activeProductsNoMappingsSample = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        isDeleted: false,
        sellerMappings: {
          none: {},
        },
      },
      select: {
        id: true,
        title: true,
        productCode: true,
        sellerId: true,
        createdAt: true,
      },
      take: 10,
    });

    // 4. Seller mappings referencing deleted products
    const mappingsWithDeletedProducts = await this.prisma.sellerProductMapping.count({
      where: {
        product: {
          isDeleted: true,
        },
      },
    });

    // 5. Seller mappings referencing deleted variants
    const mappingsWithDeletedVariants = await this.prisma.sellerProductMapping.count({
      where: {
        variantId: { not: null },
        variant: {
          isDeleted: true,
        },
      },
    });

    // 6. Orders with invalid product references (products that are now deleted)
    const orderItemsWithDeletedProducts = await this.prisma.orderItem.count({
      where: {
        subOrder: {
          masterOrder: {
            paymentStatus: { not: 'CANCELLED' },
          },
        },
      },
    });

    // Count order items where the referenced product is actually deleted
    const orderItemsReferencingDeletedProducts = await this.prisma.$queryRaw<
      { count: number }[]
    >`
      SELECT COUNT(*)::int AS count
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE p.is_deleted = true
    `;

    const invalidProductOrderItems =
      orderItemsReferencingDeletedProducts[0]?.count ?? 0;

    // 7. Commission records without matching orders
    const orphanedCommissionRecords = await this.prisma.$queryRaw<
      { count: number }[]
    >`
      SELECT COUNT(*)::int AS count
      FROM commission_records cr
      LEFT JOIN master_orders mo ON mo.id = cr.master_order_id
      WHERE mo.id IS NULL
    `;

    const commissionWithoutOrders =
      orphanedCommissionRecords[0]?.count ?? 0;

    // 8. Orphaned stock reservations (expired but still RESERVED)
    const orphanedReservations = await this.prisma.stockReservation.count({
      where: {
        status: 'RESERVED',
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    const orphanedReservationsSample = await this.prisma.stockReservation.findMany({
      where: {
        status: 'RESERVED',
        expiresAt: {
          lt: new Date(),
        },
      },
      select: {
        id: true,
        mappingId: true,
        quantity: true,
        expiresAt: true,
        createdAt: true,
      },
      take: 10,
      orderBy: { expiresAt: 'desc' },
    });

    // 9. Active products with ACTIVE mappings that have zero stock
    const activeProductsZeroStock = await this.prisma.product.count({
      where: {
        status: 'ACTIVE',
        isDeleted: false,
        sellerMappings: {
          some: { isActive: true },
          every: {
            OR: [
              { stockQty: { lte: 0 } },
              { isActive: false },
            ],
          },
        },
      },
    });

    // 10. Summary stats
    const totalProducts = await this.prisma.product.count({
      where: { isDeleted: false },
    });
    const totalActiveProducts = await this.prisma.product.count({
      where: { isDeleted: false, status: 'ACTIVE' },
    });
    const totalVariants = await this.prisma.productVariant.count({
      where: { isDeleted: false },
    });
    const totalMappings = await this.prisma.sellerProductMapping.count();
    const totalActiveMappings = await this.prisma.sellerProductMapping.count({
      where: { isActive: true },
    });
    const totalOrders = await this.prisma.masterOrder.count();
    const totalCommissionRecords = await this.prisma.commissionRecord.count();
    const totalReservations = await this.prisma.stockReservation.count();

    const elapsedMs = Date.now() - startTime;

    // Build report with severity levels
    const issues: Array<{
      check: string;
      severity: 'OK' | 'WARNING' | 'ERROR';
      count: number;
      description: string;
      samples?: any[];
    }> = [
      {
        check: 'products_without_product_code',
        severity: productsWithoutCode === 0 ? 'OK' : 'ERROR',
        count: productsWithoutCode,
        description: 'Products without an auto-generated productCode',
        samples: productsWithoutCodeSample.length > 0 ? productsWithoutCodeSample : undefined,
      },
      {
        check: 'variants_without_master_sku',
        severity: variantsWithoutMasterSku === 0 ? 'OK' : 'ERROR',
        count: variantsWithoutMasterSku,
        description: 'Variants without an auto-generated masterSku',
        samples: variantsWithoutMasterSkuSample.length > 0 ? variantsWithoutMasterSkuSample : undefined,
      },
      {
        check: 'active_products_no_seller_mappings',
        severity: activeProductsNoMappings === 0 ? 'OK' : 'WARNING',
        count: activeProductsNoMappings,
        description: 'ACTIVE products with no seller mappings (invisible on storefront)',
        samples: activeProductsNoMappingsSample.length > 0 ? activeProductsNoMappingsSample : undefined,
      },
      {
        check: 'mappings_referencing_deleted_products',
        severity: mappingsWithDeletedProducts === 0 ? 'OK' : 'WARNING',
        count: mappingsWithDeletedProducts,
        description: 'Seller mappings pointing to soft-deleted products',
      },
      {
        check: 'mappings_referencing_deleted_variants',
        severity: mappingsWithDeletedVariants === 0 ? 'OK' : 'WARNING',
        count: mappingsWithDeletedVariants,
        description: 'Seller mappings pointing to soft-deleted variants',
      },
      {
        check: 'order_items_referencing_deleted_products',
        severity: invalidProductOrderItems === 0 ? 'OK' : 'WARNING',
        count: invalidProductOrderItems,
        description: 'Order items referencing deleted products (historical data)',
      },
      {
        check: 'commission_records_without_orders',
        severity: commissionWithoutOrders === 0 ? 'OK' : 'ERROR',
        count: commissionWithoutOrders,
        description: 'Commission records with no matching master order',
      },
      {
        check: 'orphaned_stock_reservations',
        severity: orphanedReservations === 0 ? 'OK' : 'WARNING',
        count: orphanedReservations,
        description: 'Stock reservations that expired but were not released',
        samples: orphanedReservationsSample.length > 0 ? orphanedReservationsSample : undefined,
      },
    ];

    const errorCount = issues.filter((i) => i.severity === 'ERROR').length;
    const warningCount = issues.filter((i) => i.severity === 'WARNING').length;
    const okCount = issues.filter((i) => i.severity === 'OK').length;

    const overallHealth =
      errorCount > 0 ? 'UNHEALTHY' : warningCount > 0 ? 'DEGRADED' : 'HEALTHY';

    return {
      success: true,
      message: `Data validation complete: ${overallHealth}`,
      data: {
        overallHealth,
        summary: {
          errors: errorCount,
          warnings: warningCount,
          passed: okCount,
          totalChecks: issues.length,
        },
        systemStats: {
          totalProducts,
          totalActiveProducts,
          totalVariants,
          totalMappings,
          totalActiveMappings,
          totalOrders,
          totalCommissionRecords,
          totalReservations,
        },
        issues,
        executionTimeMs: elapsedMs,
        runAt: new Date().toISOString(),
      },
    };
  }
}
