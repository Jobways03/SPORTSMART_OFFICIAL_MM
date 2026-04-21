import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { MasterSkuService } from './master-sku.service';
import { VARIANT_REPOSITORY, IVariantRepository } from '../../domain/repositories/variant.repository.interface';

@Injectable()
export class VariantGeneratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterSkuService: MasterSkuService,
    @Inject(VARIANT_REPOSITORY) private readonly variantRepo: IVariantRepository,
  ) {}

  /**
   * Generates variants from a Cartesian product of option value groups.
   * Each sub-array in optionValueGroups represents values for one option dimension.
   * E.g. [['red-id','blue-id'], ['S-id','M-id','L-id']] => 6 variants
   *
   * Automatically pulls default pricing/shipping values from the parent product.
   */
  async generateVariants(
    productId: string,
    optionValueGroups: string[][],
  ): Promise<void> {
    // Compute Cartesian product
    const combinations = this.cartesianProduct(optionValueGroups);

    // Fetch product defaults for pricing/shipping
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        productCode: true,
        basePrice: true,
        compareAtPrice: true,
        costPrice: true,
        procurementPrice: true,
        baseSku: true,
        baseStock: true,
        weight: true,
        weightUnit: true,
        length: true,
        width: true,
        height: true,
        dimensionUnit: true,
      },
    });

    const defaults = {
      price: product?.basePrice ? Number(product.basePrice) : 0,
      compareAtPrice: product?.compareAtPrice ? Number(product.compareAtPrice) : null,
      costPrice: product?.costPrice ? Number(product.costPrice) : null,
      stock: product?.baseStock ?? 0,
      weight: product?.weight ? Number(product.weight) : null,
      weightUnit: product?.weightUnit || 'kg',
      length: product?.length ? Number(product.length) : null,
      width: product?.width ? Number(product.width) : null,
      height: product?.height ? Number(product.height) : null,
      dimensionUnit: product?.dimensionUnit || 'cm',
    };

    // Fetch display values for auto-generated titles
    const allValueIds = optionValueGroups.flat();
    const optionValues = await this.variantRepo.findOptionValuesByIds(allValueIds);
    const valueMap = new Map(optionValues.map((v) => [v.id, v.displayValue]));

    // Generate master SKUs for each combination
    const productCode = product?.productCode || productId.substring(0, 8);
    const masterSkus: string[] = [];
    for (const combo of combinations) {
      const sku = await this.masterSkuService.generateMasterSku(productCode, combo);
      masterSkus.push(sku);
    }

    // Create variants in a transaction
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < combinations.length; i++) {
        const combo = combinations[i];
        const title = combo.map((id) => valueMap.get(id) || id).join(' / ');

        const variant = await tx.productVariant.create({
          data: {
            productId,
            masterSku: masterSkus[i],
            title,
            price: defaults.price,
            compareAtPrice: defaults.compareAtPrice,
            costPrice: defaults.costPrice,
            procurementPrice: product?.procurementPrice ? Number(product.procurementPrice) : null,
            stock: defaults.stock,
            weight: defaults.weight,
            weightUnit: defaults.weightUnit,
            length: defaults.length,
            width: defaults.width,
            height: defaults.height,
            dimensionUnit: defaults.dimensionUnit,
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
