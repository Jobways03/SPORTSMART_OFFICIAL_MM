import { Injectable, Inject } from '@nestjs/common';
import { VARIANT_REPOSITORY, IVariantRepository } from '../../domain/repositories/variant.repository.interface';

/**
 * Phase 42 (2026-05-21) — master SKU generator with pre-flight
 * collision handling.
 *
 * Pre-Phase-42 the service truncated COLOR/GENERIC option values to
 * three uppercased characters. "Red Cherry" and "Red Rose" both
 * produced "RED", so a variant matrix that included both values
 * generated two variants with the same masterSku — Postgres rejected
 * the second insert with P2002 and rolled back the whole batch (no
 * variants created at all).
 *
 * The fix is conservative: keep the same short abbreviation as the
 * primary slug (it's what sellers and warehouse operators expect),
 * but when two values in the same batch share an abbreviation, fall
 * back to appending a 4-char disambiguator drawn from the option
 * value id. Bulk pre-flight check still throws a 400 if disambiguator
 * collisions persist — diagnostic so the seller can rename the
 * offending values.
 */
@Injectable()
export class MasterSkuService {
  constructor(
    @Inject(VARIANT_REPOSITORY) private readonly variantRepo: IVariantRepository,
  ) {}

  /**
   * Single-combo SKU generation. Kept for the manual POST /variants
   * path (one variant at a time, no batch collision possible).
   */
  async generateMasterSku(
    productCode: string,
    optionValueIds: string[],
  ): Promise<string> {
    if (optionValueIds.length === 0) return productCode;

    const optionValues = await this.variantRepo.findOptionValuesByIds(optionValueIds);

    const parts = optionValues.map((ov) =>
      MasterSkuService.abbreviate(ov.value, ov.optionDefinition.type),
    );

    return `${productCode}-${parts.join('-')}`.toUpperCase();
  }

  /**
   * Phase 42 — batch SKU generation. Resolves abbreviation collisions
   * within the supplied set by appending a 4-char disambiguator drawn
   * from the option value id. The output preserves input order so
   * callers can pair-zip with their combo list.
   *
   * Throws if even the disambiguated SKUs collide (effectively
   * impossible — would require id-suffix collision — but we surface
   * the case anyway so the seller knows the matrix needs renaming
   * rather than silently truncating).
   */
  async generateMasterSkuBatch(
    productCode: string,
    combos: string[][],
  ): Promise<string[]> {
    if (combos.length === 0) return [];

    // Single fetch of every referenced OptionValue with its definition
    // so the per-combo loop below doesn't hit the DB N times.
    const uniqueIds = Array.from(new Set(combos.flat()));
    const optionValues = await this.variantRepo.findOptionValuesByIds(uniqueIds);
    const valueById = new Map(
      optionValues.map((ov) => [ov.id, { value: ov.value, type: ov.optionDefinition.type }]),
    );

    // First pass — naive abbreviation per combo.
    const naive: string[] = combos.map((combo) =>
      combo
        .map((id) => {
          const ov = valueById.get(id);
          if (!ov) {
            throw new Error(`Unknown option value id "${id}" in SKU batch`);
          }
          return MasterSkuService.abbreviate(ov.value, ov.type);
        })
        .join('-'),
    );

    // Per-position collision detection. We look at each component
    // position separately because the audit's failure mode is per-axis
    // (two colors collapse to "RED"), not whole-combo. For every
    // position, any value that shares an abbreviation with a different
    // value gets a disambiguator appended at that position.
    const maxLen = combos.reduce((m, c) => Math.max(m, c.length), 0);
    const disambiguatedById = new Map<string, string>(); // valueId → suffixed token

    for (let pos = 0; pos < maxLen; pos++) {
      // Token → set of value-ids that produced it at this position.
      const tokenToIds = new Map<string, Set<string>>();
      for (let i = 0; i < combos.length; i++) {
        const combo = combos[i]!;
        if (pos >= combo.length) continue;
        const id = combo[pos]!;
        const ov = valueById.get(id);
        if (!ov) continue;
        const token = MasterSkuService.abbreviate(ov.value, ov.type);
        if (!tokenToIds.has(token)) tokenToIds.set(token, new Set());
        tokenToIds.get(token)!.add(id);
      }
      for (const [, ids] of tokenToIds) {
        if (ids.size <= 1) continue;
        for (const id of ids) {
          // Last 4 of UUID with hyphens stripped, uppercased.
          const suffix = id.replace(/-/g, '').slice(-4).toUpperCase();
          const ov = valueById.get(id)!;
          disambiguatedById.set(id, `${MasterSkuService.abbreviate(ov.value, ov.type)}${suffix}`);
        }
      }
    }

    // Second pass — emit with disambiguator substitutions.
    const finalSkus = combos.map((combo, i) => {
      const parts = combo.map((id) => {
        const sub = disambiguatedById.get(id);
        if (sub) return sub;
        const ov = valueById.get(id)!;
        return MasterSkuService.abbreviate(ov.value, ov.type);
      });
      return `${productCode}-${parts.join('-')}`.toUpperCase();
    });

    // Pathological backstop: even with disambiguators two combos
    // collide. The 4-char UUID suffix collision is ~1/65k per pair —
    // we surface it explicitly instead of letting Postgres P2002.
    const seen = new Map<string, number>();
    for (let i = 0; i < finalSkus.length; i++) {
      const sku = finalSkus[i]!;
      if (seen.has(sku)) {
        const j = seen.get(sku)!;
        throw new Error(
          `Master SKU collision: combinations ${j} and ${i} produced the same SKU "${sku}". ` +
            `Rename one of the option values to disambiguate.`,
        );
      }
      seen.set(sku, i);
    }

    return finalSkus;
  }

  /**
   * Creates a short abbreviation of an option value based on its type.
   * SIZE: kept as-is (already short: S, M, L, 8, 10)
   * COLOR: first 3 characters
   * GENERIC: first 3 characters
   */
  static abbreviate(value: string, optionType: string): string {
    const cleaned = value.replace(/\s+/g, '').toUpperCase();
    if (optionType === 'SIZE') return cleaned;
    if (optionType === 'COLOR') return cleaned.substring(0, 3);
    return cleaned.substring(0, 3);
  }
}
