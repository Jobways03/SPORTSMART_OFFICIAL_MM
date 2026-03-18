import { Module } from '@nestjs/common';

// Facade
import { CatalogPublicFacade } from './application/facades/catalog-public.facade';

// Services
import { ProductSlugService } from './application/services/product-slug.service';
import { ProductOwnershipService } from './application/services/product-ownership.service';
import { VariantGeneratorService } from './application/services/variant-generator.service';
import { ReApprovalService } from './application/services/re-approval.service';

// Guards
import { SellerAuthGuard, AdminAuthGuard } from '../../core/guards';

// Integration adapters
import { CloudinaryAdapter } from '../../integrations/cloudinary/cloudinary.adapter';

// Controllers - Public
import { CatalogReferenceController } from './presentation/controllers/public/catalog-reference.controller';
import { StorefrontProductsController } from './presentation/controllers/public/storefront-products.controller';
import { StorefrontCollectionsController } from './presentation/controllers/public/storefront-collections.controller';

// Controllers - Admin Collections
import { AdminCollectionsController } from './presentation/controllers/admin/admin-collections.controller';

// Controllers - Seller
import { SellerProductsController } from './presentation/controllers/seller/seller-products.controller';
import { SellerProductVariantsController } from './presentation/controllers/seller/seller-product-variants.controller';
import { SellerProductImagesController } from './presentation/controllers/seller/seller-product-images.controller';
import { SellerVariantImagesController } from './presentation/controllers/seller/seller-variant-images.controller';

// Controllers - Admin
import { AdminProductsController } from './presentation/controllers/admin/admin-products.controller';
import { AdminProductVariantsController } from './presentation/controllers/admin/admin-product-variants.controller';
import { AdminProductImagesController } from './presentation/controllers/admin/admin-product-images.controller';
import { AdminVariantImagesController } from './presentation/controllers/admin/admin-variant-images.controller';

@Module({
  controllers: [
    CatalogReferenceController,
    StorefrontProductsController,
    StorefrontCollectionsController,
    AdminCollectionsController,
    SellerProductsController,
    SellerProductVariantsController,
    SellerProductImagesController,
    SellerVariantImagesController,
    AdminProductsController,
    AdminProductVariantsController,
    AdminProductImagesController,
    AdminVariantImagesController,
  ],
  providers: [
    CatalogPublicFacade,
    ProductSlugService,
    ProductOwnershipService,
    VariantGeneratorService,
    ReApprovalService,
    SellerAuthGuard,
    AdminAuthGuard,
    CloudinaryAdapter,
  ],
  exports: [CatalogPublicFacade],
})
export class CatalogModule {}
