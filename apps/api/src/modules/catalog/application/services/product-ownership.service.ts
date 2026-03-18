import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';

@Injectable()
export class ProductOwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  async validateOwnership(sellerId: string, productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        sellerId,
        isDeleted: false,
      },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }
  }
}
