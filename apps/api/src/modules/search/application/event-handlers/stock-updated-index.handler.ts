import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { SearchPublicFacade } from '../../application/facades/search-public.facade';

/**
 * Phase 195 (#12) — was a pair of logger-only stubs ("update may be
 * needed") and was never registered, so stock changes never touched the
 * search index. Now resolves the affected product from the seller mapping
 * and re-syncs its search document (re-index if still sellable, drop it
 * otherwise). All work is delegated to SearchPublicFacade.updateSearchDocument,
 * which no-ops when OpenSearch is disabled — so this is safe by default and
 * only does real work once a node is configured.
 */
@Injectable()
export class StockUpdatedIndexHandler {
  private readonly logger = new Logger(StockUpdatedIndexHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly searchFacade: SearchPublicFacade,
  ) {}

  @OnEvent('inventory.stock.out_of_stock')
  async handleOutOfStock(event: DomainEvent): Promise<void> {
    await this.resync(event, 'out_of_stock');
  }

  @OnEvent('inventory.stock.adjusted')
  async handleStockAdjusted(event: DomainEvent): Promise<void> {
    await this.resync(event, 'adjusted');
  }

  private async resync(event: DomainEvent, kind: string): Promise<void> {
    try {
      const payload = (event.payload ?? {}) as { productId?: string; mappingId?: string };
      let productId = payload.productId;
      if (!productId && payload.mappingId) {
        const mapping = await this.prisma.sellerProductMapping.findUnique({
          where: { id: payload.mappingId },
          select: { productId: true },
        });
        productId = mapping?.productId;
      }
      if (!productId) return;
      await this.searchFacade.updateSearchDocument(productId);
    } catch (error) {
      this.logger.warn(`Stock-${kind} index resync failed: ${(error as Error).message}`);
    }
  }
}
