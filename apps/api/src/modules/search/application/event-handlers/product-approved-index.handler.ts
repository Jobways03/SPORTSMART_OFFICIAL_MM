import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { OpenSearchAdapter } from '../../../../integrations/opensearch/adapters/opensearch.adapter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

@Injectable()
export class ProductApprovedIndexHandler {
  private readonly logger = new Logger(ProductApprovedIndexHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openSearchAdapter: OpenSearchAdapter,
  ) {}

  // Phase 195 (#12) — was 'catalog.product.approved', an event NOBODY emits
  // (the real one is 'catalog.listing.approved', admin-products.controller),
  // so this handler never fired even once registered.
  @OnEvent('catalog.listing.approved')
  async handleProductApproved(event: DomainEvent): Promise<void> {
    try {
      const { productId } = event.payload as any;

      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
          tags: { select: { tag: true } },
        },
      });

      if (!product || product.status !== 'ACTIVE') return;

      await this.openSearchAdapter.indexProduct({
        id: product.id,
        title: product.title,
        description: product.description,
        slug: product.slug,
        baseSku: product.baseSku,
        basePrice: Number(product.basePrice),
        salePrice: product.compareAtPrice ? Number(product.compareAtPrice) : null,
        categoryId: product.categoryId,
        categoryName: product.category?.name ?? null,
        brandId: product.brandId,
        brandName: product.brand?.name ?? null,
        status: product.status,
        tags: product.tags.map((t: { tag: string }) => t.tag),
        imageUrl: product.images[0]?.url ?? null,
      });

      this.logger.log(`Product ${productId} indexed after approval`);
    } catch (error) {
      this.logger.error(`Product indexing failed: ${(error as Error).message}`);
    }
  }

  // Phase 195 (#12) — a rejected listing must drop out of the index. Was
  // 'catalog.product.archived' (never emitted); the real removal trigger is
  // 'catalog.listing.rejected' (admin-products.controller).
  @OnEvent('catalog.listing.rejected')
  async handleProductArchived(event: DomainEvent): Promise<void> {
    try {
      const { productId } = event.payload as any;
      await this.openSearchAdapter.removeProduct(productId);
      this.logger.log(`Product ${productId} removed from search index`);
    } catch (error) {
      this.logger.error(`Product removal from index failed: ${(error as Error).message}`);
    }
  }
}
