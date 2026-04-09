import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { IProductImageRepository } from '../../domain/repositories/product-image.repository.interface';

@Injectable()
export class PrismaProductImageRepository implements IProductImageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countByProduct(productId: string): Promise<number> {
    return this.prisma.productImage.count({ where: { productId } });
  }

  async createProductImage(data: any): Promise<any> {
    return this.prisma.productImage.create({ data });
  }

  async findProductImage(imageId: string, productId: string): Promise<any | null> {
    return this.prisma.productImage.findFirst({ where: { id: imageId, productId } });
  }

  async deleteProductImage(imageId: string): Promise<void> {
    await this.prisma.productImage.delete({ where: { id: imageId } });
  }

  async findFirstByProduct(productId: string): Promise<any | null> {
    return this.prisma.productImage.findFirst({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async setImagePrimary(imageId: string): Promise<void> {
    await this.prisma.productImage.update({ where: { id: imageId }, data: { isPrimary: true } });
  }

  async reorderProductImages(productId: string, imageIds: string[]): Promise<any[]> {
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < imageIds.length; i++) {
        await tx.productImage.update({ where: { id: imageIds[i] }, data: { sortOrder: i } });
      }
    });
    return this.prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async countByVariant(variantId: string): Promise<number> {
    return this.prisma.productVariantImage.count({ where: { variantId } });
  }

  async createVariantImage(data: any): Promise<any> {
    return this.prisma.productVariantImage.create({ data });
  }

  async findVariantImage(imageId: string, variantId: string): Promise<any | null> {
    return this.prisma.productVariantImage.findFirst({ where: { id: imageId, variantId } });
  }

  async deleteVariantImage(imageId: string): Promise<void> {
    await this.prisma.productVariantImage.delete({ where: { id: imageId } });
  }

  async deleteVariantImagesByPublicId(variantIds: string[], publicId: string): Promise<void> {
    await this.prisma.productVariantImage.deleteMany({
      where: { variantId: { in: variantIds }, publicId },
    });
  }

  async reorderVariantImages(variantId: string, imageIds: string[]): Promise<void> {
    await this.prisma.$transaction(
      imageIds.map((id, index) =>
        this.prisma.productVariantImage.updateMany({
          where: { id, variantId },
          data: { sortOrder: index },
        }),
      ),
    );
  }

  async findColorSiblingVariantIds(productId: string, variantId: string): Promise<string[]> {
    const currentColorOption = await this.prisma.productVariantOptionValue.findFirst({
      where: { variantId, optionValue: { optionDefinition: { type: 'COLOR' } } },
      select: { optionValueId: true },
    });
    if (!currentColorOption) return [variantId];

    const siblings = await this.prisma.productVariantOptionValue.findMany({
      where: {
        optionValueId: currentColorOption.optionValueId,
        variant: { productId, isDeleted: false },
      },
      select: { variantId: true },
    });

    const ids = siblings.map((s) => s.variantId);
    if (!ids.includes(variantId)) ids.push(variantId);
    return ids;
  }

  async findVariant(variantId: string, productId: string): Promise<any | null> {
    return this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, isDeleted: false },
    });
  }
}
