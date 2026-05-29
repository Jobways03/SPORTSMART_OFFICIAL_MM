import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { CloudinaryAdapter } from '../../integrations/cloudinary/cloudinary.adapter';
import { ContentService } from './content.service';
import {
  AdminContentController,
  StorefrontContentController,
} from './content.controllers';
import { AdminStaticPagesController } from './presentation/admin-static-pages.controller';
import { ContentPageAuditService } from './services/content-page-audit.service';
import { StorefrontContentService } from './storefront-content/storefront-content.service';
import { ContentAuditService } from './storefront-content/content-audit.service';
import { AdminStorefrontContentController } from './storefront-content/admin-storefront-content.controller';
import { PublicStorefrontContentController } from './storefront-content/public-storefront-content.controller';
import { BlogPostsService } from './blog-posts/blog-posts.service';
import { BlogPostAuditService } from './blog-posts/blog-post-audit.service';
import { AdminBlogPostsController } from './blog-posts/admin-blog-posts.controller';
import { PublicBlogPostsController } from './blog-posts/public-blog-posts.controller';
import { StorefrontSlotsService } from './storefront-slots/storefront-slots.service';
import { AdminStorefrontSlotsController } from './storefront-slots/admin-storefront-slots.controller';
import { PublicStorefrontSlotsController } from './storefront-slots/public-storefront-slots.controller';

@Module({
  controllers: [
    StorefrontContentController,
    AdminContentController,
    AdminStaticPagesController,
    AdminStorefrontContentController,
    PublicStorefrontContentController,
    AdminBlogPostsController,
    PublicBlogPostsController,
    AdminStorefrontSlotsController,
    PublicStorefrontSlotsController,
  ],
  providers: [
    AdminAuthGuard,
    ContentService,
    ContentPageAuditService,
    StorefrontContentService,
    ContentAuditService,
    BlogPostsService,
    BlogPostAuditService,
    StorefrontSlotsService,
    CloudinaryAdapter,
  ],
  exports: [
    ContentService,
    ContentPageAuditService,
    StorefrontContentService,
    ContentAuditService,
    BlogPostsService,
    BlogPostAuditService,
    StorefrontSlotsService,
  ],
})
export class ContentModule {}
