import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class VariantGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates variants from a Cartesian product of option value groups.
   * Each sub-array in optionValueGroups represents values for one option dimension.
   * E.g. [['red-id','blue-id'], ['S-id','M-id','L-id']] => 6 variants
   */
  async generateVariants(
    productId: string,
    optionValueGroups: string[][],
  ): Promise<void> {
    // Compute Cartesian product
    const combinations = this.cartesianProduct(optionValueGroups);

    // Fetch display values for auto-generated titles
    const allValueIds = optionValueGroups.flat();
    const optionValues = await this.prisma.optionValue.findMany({
      where: { id: { in: allValueIds } },
      select: { id: true, displayValue: true },
    });
    const valueMap = new Map(optionValues.map((v) => [v.id, v.displayValue]));

    // Create variants in a transaction
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < combinations.length; i++) {
        const combo = combinations[i];
        const title = combo.map((id) => valueMap.get(id) || id).join(' / ');

        const variant = await tx.productVariant.create({
          data: {
            productId,
            title,
            price: 0,
            stock: 0,
            sortOrder: i,
          },
        });

        // Create variant option value associations
        await tx.productVariantOptionValue.createMany({
          data: combo.map((optionValueId) => ({
            variantId: variant.id,
            optionValueId,
          })),
        });
      }
    });
  }

  private cartesianProduct(arrays: string[][]): string[][] {
    if (arrays.length === 0) return [[]];

    return arrays.reduce<string[][]>(
      (acc, curr) => {
        const result: string[][] = [];
        for (const a of acc) {
          for (const b of curr) {
            result.push([...a, b]);
          }
        }
        return result;
      },
      [[]],
    );
  }
}
