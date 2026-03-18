import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class CatalogPublicFacade {
  constructor(private readonly prisma: PrismaService) {}

  async getProductById(productId: string): Promise<unknown> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      include: {
        category: true,
        brand: true,
      },
    });
    return product;
  }

  async getVariantById(variantId: string): Promise<unknown> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, isDeleted: false },
      include: {
        product: true,
      },
    });
    return variant;
  }

  async getListingModerationStatus(productId: string): Promise<unknown> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      select: {
        id: true,
        status: true,
        moderationStatus: true,
        moderationNote: true,
      },
    });
    return product ? product.moderationStatus : null;
  }

  async validateSellerOwnsListing(
    sellerId: string,
    productId: string,
  ): Promise<boolean> {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        sellerId,
        isDeleted: false,
      },
      select: { id: true },
    });
    return !!product;
  }

  async getProductSnapshotForOrder(variantId: string): Promise<unknown> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, isDeleted: false },
      include: {
        product: {
          include: {
            images: {
              where: { isPrimary: true },
              take: 1,
            },
            category: { select: { id: true, name: true } },
            brand: { select: { id: true, name: true } },
          },
        },
        optionValues: {
          include: {
            optionValue: {
              include: {
                optionDefinition: true,
              },
            },
          },
        },
      },
    });

    if (!variant) return null;

    const primaryImage =
      variant.product.images.length > 0
        ? variant.product.images[0].url
        : null;

    return {
      productId: variant.product.id,
      variantId: variant.id,
      title: variant.product.title,
      variantTitle: variant.title,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      sku: variant.sku || variant.product.baseSku,
      imageUrl: primaryImage,
      categoryName: variant.product.category?.name || null,
      brandName: variant.product.brand?.name || null,
      sellerId: variant.product.sellerId,
      weight: variant.weight || variant.product.weight,
      weightUnit: variant.weightUnit || variant.product.weightUnit,
      options: variant.optionValues.map((ov) => ({
        name: ov.optionValue.optionDefinition.displayName,
        value: ov.optionValue.displayValue,
      })),
    };
  }

  async getReturnRelevantMetadata(productId: string): Promise<unknown> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      select: {
        id: true,
        title: true,
        returnPolicy: true,
        warrantyInfo: true,
        sellerId: true,
      },
    });
    return product;
  }
}
