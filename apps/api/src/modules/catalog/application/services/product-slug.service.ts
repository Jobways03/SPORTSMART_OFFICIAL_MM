import { Injectable, Inject } from '@nestjs/common';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../domain/repositories/product.repository.interface';

@Injectable()
export class ProductSlugService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
  ) {}

  async generateUniqueSlug(title: string): Promise<string> {
    const baseSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check if base slug is available
    const existing = await this.productRepo.findBySlug(baseSlug);

    if (!existing) {
      return baseSlug;
    }

    // Find the next available suffix
    let suffix = 2;
    while (true) {
      const candidateSlug = `${baseSlug}-${suffix}`;
      const collision = await this.productRepo.findBySlug(candidateSlug);

      if (!collision) {
        return candidateSlug;
      }

      suffix++;
    }
  }
}
