import { Injectable, Inject } from '@nestjs/common';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../domain/repositories/product.repository.interface';

@Injectable()
export class ProductCodeService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
  ) {}

  /**
   * Generates a unique product code like PRD-000001, PRD-000002, etc.
   * Uses an atomic database sequence to prevent race conditions.
   */
  async generateProductCode(): Promise<string> {
    return this.productRepo.generateNextProductCode();
  }
}
