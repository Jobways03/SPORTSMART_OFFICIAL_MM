import { Injectable, Inject } from '@nestjs/common';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../domain/repositories/product.repository.interface';
import { NotFoundAppException } from '../../../../core/exceptions';

@Injectable()
export class ProductOwnershipService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
  ) {}

  async validateOwnership(sellerId: string, productId: string): Promise<void> {
    const product = await this.productRepo.findByIdAndSeller(productId, sellerId);

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }
  }
}
