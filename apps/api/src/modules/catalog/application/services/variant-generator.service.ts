import { Injectable, Inject, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
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
   * Phase 41 (2026-05-21) — deterministic combination fingerprint.
   *
   * Hash the sorted optionValueIds so two variants representing the
   * same combination on a product produce the same fingerprint. The
   * partial unique index on (productId, optionFingerprint) WHERE
   * is_deleted = false makes a duplicate variant a P2002 at insert
   * time, which the controller surfaces as 409.
   *
   * Soft-deleted rows are excluded from the unique index so a
   * regeneration after soft-delete can re-use the combination.
   */
  static computeOptionFingerprint(optionValueIds: string[]): string {
    const sorted = [...optionValueIds].sort();
    return createHash('sha256').update(sorted.join('|')).digest('hex');
  }

  /**
   * Generates variants from a Cartesian product of option-value
   * groups.
   *
   * Phase 41 changes:
   *   - computes optionFingerprint per variant (Gap #3)
   *   - duplicate-combination detection prior to insert so the
   *     conflict surfaces as a 409 instead of a 500 P2002
   *   - inserts each variant individually inside one $transaction
   *     so the partial-unique violation rolls back the whole batch
   */
  /**
   * Phase 42 (2026-05-21) — accepts optional `tx`. When supplied the
   * variant inserts share the caller's transaction (Gap #1 fix);
   * otherwise the service opens its own internal transaction (legacy
   * behaviour preserved).
   */
  async generateVariants(
    productId: string,
    optionValueGroups: string[][],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const combinations = this.cartesianProduct(optionValueGroups);

    // De-dupe combinations by fingerprint up-front. The Cartesian
    // product algorithm can't produce duplicates on its own, but a
    // caller supplying ['red','red'] in one axis would otherwise
    // create two variants with the same combination.
    const seen = new Set<string>();
    const dedupedCombos: string[][] = [];
    for (const combo of combinations) {
      const fp = VariantGeneratorService.computeOptionFingerprint(combo);
      if (!seen.has(fp)) {
        seen.add(fp);
        dedupedCombos.push(combo);
      }
    }

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
      stock: 0,
      weight: product?.weight ? Number(product.weight) : null,
      weightUnit: product?.weightUnit || 'kg',
      length: product?.length ? Number(product.length) : null,
      width: product?.width ? Number(product.width) : null,
      height: product?.height ? Number(product.height) : null,
      dimensionUnit: product?.dimensionUnit || 'cm',
    };

    const allValueIds = optionValueGroups.flat();
    const optionValues = await this.variantRepo.findOptionValuesByIds(allValueIds);
    const valueMap = new Map(optionValues.map((v) => [v.id, v.displayValue]));

    const productCode = product?.productCode || productId.substring(0, 8);

    // Phase 42 (2026-05-21) — Gap #3 fix. Batch SKU generation with
    // collision-aware disambiguation. Pre-Phase-42 the per-combo loop
    // could emit "Red Cherry" and "Red Rose" both as PRD-XXX-RED-...
    // → P2002 mid-transaction → entire batch rolled back. Now the
    // batch helper appends a 4-char suffix to colliding tokens.
    const masterSkus = await this.masterSkuService.generateMasterSkuBatch(
      productCode,
      dedupedCombos,
    );

    // Phase 42 — share the caller's tx when available.
    const runInTx = async (tx: Prisma.TransactionClient | PrismaService) => {
        for (let i = 0; i < dedupedCombos.length; i++) {
          const combo = dedupedCombos[i]!;
          const fingerprint = VariantGeneratorService.computeOptionFingerprint(combo);
          // Phase 42 (2026-05-21) — Gap #12 fix. Strict valueMap
          // lookup. Pre-Phase-42 a missing id silently used the raw
          // UUID in variant.title — storefront showed "abc-def-1234
          // / Large". Now: a missing id throws, the transaction rolls
          // back, the controller surfaces the data-integrity issue.
          const title = combo
            .map((id) => {
              const dv = valueMap.get(id);
              if (dv === undefined) {
                throw new Error(
                  `Option value ${id} disappeared between validation and generation — refusing to write variant with placeholder title`,
                );
              }
              return dv;
            })
            .join(' / ');

          const variant = await tx.productVariant.create({
            data: {
              productId,
              masterSku: masterSkus[i],
              title,
              optionFingerprint: fingerprint,
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

          await tx.productVariantOptionValue.createMany({
            data: combo.map((optionValueId) => ({
              variantId: variant.id,
              optionValueId,
            })),
          });
        }
    };

    try {
      if (tx) {
        await runInTx(tx);
      } else {
        await this.prisma.$transaction(runInTx);
      }
    } catch (err: any) {
      // Translate the new partial-unique violation into a friendly
      // 409 so the controller can surface "Combination already exists".
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'One or more variant combinations already exist on this product. Clear or delete the existing variants first.',
        );
      }
      throw err;
    }
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
