import { Injectable } from '@nestjs/common';
import { EnvService } from '../../bootstrap/env/env.service';
import {
  MONEY_FIELD_REGISTRY,
  toPaise,
} from './money-field-registry';

/**
 * Phase 1.4 — opt-in dual-write helper.
 *
 * Call from a service that writes a money column:
 *
 *   const data = this.moneyDualWrite.applyPaise('return', {
 *     id, refundAmount, ...
 *   });
 *   await this.prisma.return.update({ where: { id }, data });
 *
 * The helper:
 *   - Looks up the model's money field tuples in MONEY_FIELD_REGISTRY.
 *   - For each `decimal` field present in the input, computes the paise
 *     equivalent and writes it to the corresponding `paise` field.
 *   - Returns the augmented data object (does NOT mutate the input).
 *   - No-ops when MONEY_DUAL_WRITE_ENABLED=false — returns the input
 *     untouched. This lets the helper be wired in at call sites
 *     immediately, with the actual paise writes flipped on later.
 *
 * Why a helper rather than a Prisma client extension?
 *   - $extends in Prisma v6 changes the client's TS type, requiring
 *     PrismaService consumers to update — high blast radius.
 *   - $use is deprecated/removed in v6.
 *   - Explicit call sites are easier to test and easier to spot in
 *     code review when someone forgets a money write.
 *   - Future PR 1.4-extended can add a Prisma extension for opaque
 *     auto-application; until then explicit is fine.
 *
 * The registry shape lets us add the extension later without changing
 * call sites — just stop calling applyPaise() everywhere and rely on
 * the extension instead.
 */
@Injectable()
export class MoneyDualWriteHelper {
  constructor(private readonly env: EnvService) {}

  /**
   * Augment a Prisma write payload with paise siblings for any money
   * Decimal fields present. Returns a NEW object; does not mutate
   * the input. Safe to call when no money fields are present (no-op).
   *
   * @param modelKey - the camelCased Prisma model accessor
   *                   (e.g. `return`, `commissionRecord`).
   * @param data    - the data object you'd pass to Prisma's
   *                   create / update / upsert.
   */
  applyPaise<T extends Record<string, unknown>>(
    modelKey: string,
    data: T,
  ): T {
    if (!this.enabled()) return data;
    const pairs = MONEY_FIELD_REGISTRY[modelKey];
    if (!pairs || pairs.length === 0) return data;

    const augmented: Record<string, unknown> = { ...data };
    for (const { decimal, paise } of pairs) {
      if (!(decimal in augmented)) continue;
      const decimalValue = augmented[decimal];
      // Distinguish "explicitly null" (clear the field) from
      // "computed to null" (no input). Prisma's `null` semantics:
      // setting a field to `null` clears the column; leaving it
      // undefined leaves the column unchanged. We mirror.
      if (decimalValue === null) {
        augmented[paise] = null;
        continue;
      }
      const computed = toPaise(decimalValue);
      // toPaise returns null for unparseable inputs — don't write
      // garbage. The Decimal column's NOT NULL constraint will catch
      // a real upstream error.
      if (computed !== null) {
        augmented[paise] = computed;
      }
    }
    return augmented as T;
  }

  /**
   * Variant for `createMany` — augments each row in the array.
   */
  applyPaiseMany<T extends Record<string, unknown>>(
    modelKey: string,
    rows: T[],
  ): T[] {
    if (!this.enabled() || rows.length === 0) return rows;
    return rows.map((row) => this.applyPaise(modelKey, row));
  }

  /**
   * Variant for nested `update`/`upsert` data — Prisma supports
   * `{ field: { increment: N } }`, `{ field: { decrement: N } }`,
   * `{ field: { set: V } }`. We support `set:` only (most common).
   * For `increment`/`decrement` callers should compute the new
   * absolute value and write `set:` to both columns explicitly —
   * dual-write of an arithmetic operation needs domain knowledge.
   */
  isApplicable(modelKey: string): boolean {
    return this.enabled() && (MONEY_FIELD_REGISTRY[modelKey]?.length ?? 0) > 0;
  }

  private enabled(): boolean {
    return this.env.getBoolean('MONEY_DUAL_WRITE_ENABLED', false);
  }
}
