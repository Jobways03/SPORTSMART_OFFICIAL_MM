import { Injectable } from '@nestjs/common';

@Injectable()
export class InventoryPublicFacade {
  async checkAvailableStock(sellerVariantId: string): Promise<number> {
    throw new Error('Not implemented');
  }

  async reserveStock(sellerVariantId: string, quantity: number, referenceId: string): Promise<boolean> {
    throw new Error('Not implemented');
  }

  async releaseStock(sellerVariantId: string, quantity: number, referenceId: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async confirmDeduction(sellerVariantId: string, quantity: number, referenceId: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async getStockState(sellerVariantId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }
}
