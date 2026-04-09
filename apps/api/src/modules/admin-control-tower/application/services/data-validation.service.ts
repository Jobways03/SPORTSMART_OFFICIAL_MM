import { Inject, Injectable } from '@nestjs/common';
import {
  AdminControlTowerRepository,
  ADMIN_CONTROL_TOWER_REPOSITORY,
} from '../../domain/repositories/admin-control-tower.repository.interface';

@Injectable()
export class DataValidationService {
  constructor(
    @Inject(ADMIN_CONTROL_TOWER_REPOSITORY)
    private readonly repo: AdminControlTowerRepository,
  ) {}

  async runDataValidation() {
    const startTime = Date.now();

    // 1. Products without productCode (should be 0 after migration)
    const productsWithoutCode = await this.repo.countProductsWithoutCode();
    const productsWithoutCodeSample = await this.repo.sampleProductsWithoutCode(10);

    // 2. Variants without masterSku (should be 0 after migration)
    const variantsWithoutMasterSku = await this.repo.countVariantsWithoutMasterSku();
    const variantsWithoutMasterSkuSample = await this.repo.sampleVariantsWithoutMasterSku(10);

    // 3. Active products with no seller mappings (potential storefront visibility issue)
    const activeProductsNoMappings = await this.repo.countActiveProductsNoMappings();
    const activeProductsNoMappingsSample = await this.repo.sampleActiveProductsNoMappings(10);

    // 4. Seller mappings referencing deleted products
    const mappingsWithDeletedProducts = await this.repo.countMappingsWithDeletedProducts();

    // 5. Seller mappings referencing deleted variants
    const mappingsWithDeletedVariants = await this.repo.countMappingsWithDeletedVariants();

    // 6. Order items referencing deleted products
    const invalidProductOrderItems = await this.repo.countOrderItemsReferencingDeletedProducts();

    // 7. Commission records without matching orders
    const commissionWithoutOrders = await this.repo.countOrphanedCommissionRecords();

    // 8. Orphaned stock reservations (expired but still RESERVED)
    const orphanedReservations = await this.repo.countOrphanedReservations();
    const orphanedReservationsSample = await this.repo.sampleOrphanedReservations(10);

    // 9. Active products with ACTIVE mappings that have zero stock
    // (counted but not included as an issue in the original code)

    // 10. Summary stats
    const totalProducts = await this.repo.countTotalProducts();
    const totalActiveProducts = await this.repo.countTotalActiveProducts();
    const totalVariants = await this.repo.countTotalVariants();
    const totalMappings = await this.repo.countTotalMappings();
    const totalActiveMappings = await this.repo.countTotalActiveMappings();
    const totalOrders = await this.repo.countTotalOrders();
    const totalCommissionRecords = await this.repo.countTotalCommissionRecords();
    const totalReservations = await this.repo.countTotalReservations();

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
