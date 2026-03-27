import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class MasterSkuService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates a master SKU from product code + option value abbreviations.
   * Examples:
   *   PRD-000001-BLU-8   (Color: Blue, Size: 8)
   *   PRD-000001-RED-XL  (Color: Red, Size: XL)
   *   PRD-000001         (Simple product, no variants)
   */
  async generateMasterSku(
    productCode: string,
    optionValueIds: string[],
  ): Promise<string> {
    if (optionValueIds.length === 0) {
      return productCode;
    }

    const optionValues = await this.prisma.optionValue.findMany({
      where: { id: { in: optionValueIds } },
      include: {
        optionDefinition: {
          select: { name: true, type: true },
        },
      },
      orderBy: {
        optionDefinition: { name: 'asc' },
      },
    });

    const parts = optionValues.map((ov) =>
      this.abbreviate(ov.value, ov.optionDefinition.type),
    );

    const sku = `${productCode}-${parts.join('-')}`;
    return sku.toUpperCase();
  }

  /**
   * Creates a short abbreviation of an option value based on its type.
   * SIZE: kept as-is (already short: S, M, L, 8, 10)
   * COLOR: first 3 characters
   * GENERIC: first 3 characters
   */
  private abbreviate(value: string, optionType: string): string {
    const cleaned = value.replace(/\s+/g, '').toUpperCase();

    if (optionType === 'SIZE') {
      // Sizes like "8 UK" → "8UK", "XL" → "XL", "S" → "S"
      return cleaned;
    }

    if (optionType === 'COLOR') {
      return cleaned.substring(0, 3);
    }

    return cleaned.substring(0, 3);
  }
}
