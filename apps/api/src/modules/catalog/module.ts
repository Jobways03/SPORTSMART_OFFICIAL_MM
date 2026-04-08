import { Module } from '@nestjs/common';

// Facade
import { CatalogPublicFacade } from './application/facades/catalog-public.facade';

// Services
import { ProductSlugService } from './application/services/product-slug.service';
import { ProductCodeService } from './application/services/product-code.service';
import { MasterSkuService } from './application/services/master-sku.service';
import { ProductOwnershipService } from './application/services/product-ownership.service';
import { VariantGeneratorService } from './application/services/variant-generator.service';
import { ReApprovalService } from './application/services/re-approval.service';
import { ServiceabilityService } from './application/services/serviceability.service';
import { SellerAllocationService } from './application/services/seller-allocation.service';
import { DuplicateDetectionService } from './application/services/duplicate-detection.service';
import { CatalogCacheService } from './application/services/catalog-cache.service';

// Guards
import { SellerAuthGuard, AdminAuthGuard } from '../../core/guards';

// Integration adapters
import { CloudinaryAdapter } from '../../integrations/cloudinary/cloudinary.adapter';

// Controllers - Public
import { CatalogReferenceController } from './presentation/controllers/public/catalog-reference.controller';
import { StorefrontProductsController } from './presentation/controllers/public/storefront-products.controller';
import { StorefrontCollectionsController } from './presentation/controllers/public/storefront-collections.controller';
import { StorefrontServiceabilityController } from './presentation/controllers/public/storefront-serviceability.controller';
import { StorefrontAllocationController } from './presentation/controllers/public/storefront-allocation.controller';
import { PincodeLookupController } from './presentation/controllers/public/pincode-lookup.controller';

// Controllers - Admin Collections
import { AdminCollectionsController } from './presentation/controllers/admin/admin-collections.controller';

// Controllers - Seller
import { SellerProductsController } from './presentation/controllers/seller/seller-products.controller';
import { SellerProductVariantsController } from './presentation/controllers/seller/seller-product-variants.controller';
import { SellerProductImagesController } from './presentation/controllers/seller/seller-product-images.controller';
import { SellerVariantImagesController } from './presentation/controllers/seller/seller-variant-images.controller';
import { SellerProductMappingController } from './presentation/controllers/seller/seller-product-mapping.controller';
// Controllers - Admin
import { AdminProductsController } from './presentation/controllers/admin/admin-products.controller';
import { AdminProductVariantsController } from './presentation/controllers/admin/admin-product-variants.controller';
import { AdminProductImagesController } from './presentation/controllers/admin/admin-product-images.controller';
import { AdminVariantImagesController } from './presentation/controllers/admin/admin-variant-images.controller';
import { AdminSellerMappingsController } from './presentation/controllers/admin/admin-seller-mappings.controller';
import { AdminMetafieldDefinitionsController } from './presentation/controllers/admin/admin-metafield-definitions.controller';
import { AdminProductMetafieldsController } from './presentation/controllers/admin/admin-product-metafields.controller';
import { AdminStorefrontFiltersController } from './presentation/controllers/admin/admin-storefront-filters.controller';
import { AdminCategoriesController } from './presentation/controllers/admin/admin-categories.controller';
import { AdminBrandsController } from './presentation/controllers/admin/admin-brands.controller';

// Controllers - Public (Filters)
import { StorefrontFiltersController } from './presentation/controllers/public/storefront-filters.controller';

@Module({
  controllers: [
    CatalogReferenceController,
    StorefrontProductsController,
    StorefrontCollectionsController,
    StorefrontServiceabilityController,
    StorefrontAllocationController,
    PincodeLookupController,
    AdminCollectionsController,
    SellerProductsController,
    SellerProductVariantsController,
    SellerProductImagesController,
    SellerVariantImagesController,
    SellerProductMappingController,
    AdminProductsController,
    AdminProductVariantsController,
    AdminProductImagesController,
    AdminVariantImagesController,
    AdminSellerMappingsController,
    AdminMetafieldDefinitionsController,
    AdminProductMetafieldsController,
    AdminStorefrontFiltersController,
    AdminCategoriesController,
    AdminBrandsController,
    StorefrontFiltersController,
  ],
  providers: [
    CatalogPublicFacade,
    ProductSlugService,
    ProductCodeService,
    MasterSkuService,
    ProductOwnershipService,
    VariantGeneratorService,
    ReApprovalService,
    ServiceabilityService,
    SellerAllocationService,
    DuplicateDetectionService,
    CatalogCacheService,
    SellerAuthGuard,
    AdminAuthGuard,
    CloudinaryAdapter,
  ],
  exports: [CatalogPublicFacade, SellerAllocationService, CatalogCacheService],
})
export class CatalogModule {}
