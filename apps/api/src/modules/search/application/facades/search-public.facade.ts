import { Injectable } from '@nestjs/common';

@Injectable()
export class SearchPublicFacade {
  async searchProducts(query: string, filters: Record<string, unknown>): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async rebuildSearchIndex(): Promise<void> {
    throw new Error('Not implemented');
  }

  async updateSearchDocument(productId: string): Promise<void> {
    throw new Error('Not implemented');
  }
}
