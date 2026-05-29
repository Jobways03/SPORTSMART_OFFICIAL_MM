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

  /**
   * Phase 42 (2026-05-21) — atomic primary flip. Pre-Phase-42 this
   * was a single `update({ isPrimary: true })` which silently failed
   * with P2002 when another image on the same product was already
   * flagged primary (partial unique index from Phase 29). Now we
   * demote any current primary and promote the target inside one
   * transaction.
   *
   * Also fixes audit gap #2 by scoping the demote query to the
   * target's productId — never touches another seller's row.
   */
  async setImagePrimary(imageId: string): Promise<void> {
    const target = await this.prisma.productImage.findUnique({
      where: { id: imageId },
      select: { productId: true },
    });
    if (!target) return;
    await this.prisma.$transaction([
      this.prisma.productImage.updateMany({
        where: { productId: target.productId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.productImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      }),
    ]);
  }

  /**
   * Phase 42 (2026-05-21) — reorder with productId scope (Gap #2)
   * and isPrimary synced to position 0 (Gap #3).
   *
   * - Each updateMany filters on (id, productId) so a malicious
   *   payload mixing another seller's image ids no-ops on them.
   * - After sort order is applied, the image at imageIds[0] becomes
   *   the primary; any other primary on the product is demoted. This
   *   keeps storefront ORDER BY isPrimary DESC, sortOrder ASC
   *   consistent with the admin's drag-and-drop ordering.
   *
   * Returns the count of rows whose sortOrder was actually updated so
   * the controller can surface a clear error if any id didn't belong
   * to the product.
   */
  async reorderProductImages(productId: string, imageIds: string[]): Promise<any[]> {
    if (imageIds.length === 0) {
      return this.prisma.productImage.findMany({
        where: { productId },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
      });
    }

    const updatedCounts: number[] = [];
    await this.prisma.$transaction(async (tx) => {
      // Demote all current primaries on this product up-front; we'll
      // re-promote imageIds[0] in the last step. Using a single
      // updateMany so the partial-unique window is zero (we never
      // hold two primaries at once).
      await tx.productImage.updateMany({
        where: { productId, isPrimary: true },
        data: { isPrimary: false },
      });

      for (let i = 0; i < imageIds.length; i++) {
        const res = await tx.productImage.updateMany({
          where: { id: imageIds[i], productId },
          data: { sortOrder: i },
        });
        updatedCounts.push(res.count);
      }

      // Promote new hero. Skips if imageIds[0] didn't belong to the
      // product — the controller catches the mismatch via the count
      // array.
      const newPrimaryId = imageIds[0]!;
      await tx.productImage.updateMany({
        where: { id: newPrimaryId, productId },
        data: { isPrimary: true },
      });
    });

    const mismatch = updatedCounts.findIndex((c) => c === 0);
    if (mismatch >= 0) {
      throw new Error(
        `Reorder payload included image id "${imageIds[mismatch]}" which does not belong to product ${productId}`,
      );
    }

    return this.prisma.productImage.findMany({
      where: { productId },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
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

  /**
   * Phase 42 (2026-05-21) — variant reorder syncs isPrimary to
   * position 0 + validates each id belongs to the variant (the
   * existing where: { id, variantId } already gave us that scope;
   * we now surface a clear error if any update no-ops).
   */
  async reorderVariantImages(variantId: string, imageIds: string[]): Promise<void> {
    if (imageIds.length === 0) return;

    const updatedCounts: number[] = [];
    await this.prisma.$transaction(async (tx) => {
      await tx.productVariantImage.updateMany({
        where: { variantId, isPrimary: true },
        data: { isPrimary: false },
      });
      for (let i = 0; i < imageIds.length; i++) {
        const res = await tx.productVariantImage.updateMany({
          where: { id: imageIds[i], variantId },
          data: { sortOrder: i },
        });
        updatedCounts.push(res.count);
      }
      await tx.productVariantImage.updateMany({
        where: { id: imageIds[0]!, variantId },
        data: { isPrimary: true },
      });
    });

    const mismatch = updatedCounts.findIndex((c) => c === 0);
    if (mismatch >= 0) {
      throw new Error(
        `Reorder payload included variant image id "${imageIds[mismatch]}" which does not belong to variant ${variantId}`,
      );
    }
  }

  /**
   * Phase 41 (2026-05-21) — variant-image isPrimary helpers. Mirror
   * the Phase 29 pattern on ProductImage so the storefront / cart
   * thumbnail layer can pick the canonical image without falling back
   * on the implicit sortOrder=0 convention (which a future reorder
   * could break).
   */
  async findFirstByVariant(variantId: string): Promise<any | null> {
    return this.prisma.productVariantImage.findFirst({
      where: { variantId },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    });
  }

  async setVariantImagePrimary(imageId: string): Promise<void> {
    // The partial unique index (variant_id) WHERE is_primary = true
    // guarantees at-most-one. Demote the current primary first to keep
    // the constraint happy across the brief window between the two
    // writes; both inside one transaction.
    const target = await this.prisma.productVariantImage.findUnique({
      where: { id: imageId },
      select: { variantId: true },
    });
    if (!target) return;
    await this.prisma.$transaction([
      this.prisma.productVariantImage.updateMany({
        where: { variantId: target.variantId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.productVariantImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      }),
    ]);
  }

  async ensureVariantHasPrimary(variantId: string): Promise<void> {
    const existingPrimary = await this.prisma.productVariantImage.findFirst({
      where: { variantId, isPrimary: true },
      select: { id: true },
    });
    if (existingPrimary) return;
    const next = await this.prisma.productVariantImage.findFirst({
      where: { variantId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    if (next) {
      await this.prisma.productVariantImage.update({
        where: { id: next.id },
        data: { isPrimary: true },
      });
    }
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
