import { Inject, Injectable, Logger } from '@nestjs/common';
import { METAFIELD_REPOSITORY, IMetafieldRepository } from '../../domain/repositories/metafield.repository.interface';
import { CATEGORY_REPOSITORY, ICategoryRepository } from '../../domain/repositories/category.repository.interface';

/**
 * Phase 40 (2026-05-21) — closes audit gap #10. Validates incoming
 * filter values against the metafield definition's choices[] for
 * select/color types so:
 *
 *   GET /storefront/products?filter[material]=urandom-string
 *
 * no longer reaches the SQL layer with `urandom-string` as a value —
 * it's stripped at the controller boundary. The result is identical
 * to "no products matched" but cheaper (avoids the EXISTS subquery).
 *
 * Tolerant by design: invalid values are dropped, not 400'd. A
 * customer landing on a permalink with a stale value still gets a
 * page render with the remaining filters applied. Logged at info so
 * we can spot bot-driven URL fuzzing in observability.
 */

const SELECT_TYPES = new Set(['SINGLE_SELECT', 'MULTI_SELECT', 'COLOR']);
const NUMERIC_TYPES = new Set(['NUMBER_INTEGER', 'NUMBER_DECIMAL', 'RATING']);
const BUILT_IN_KEYS = new Set(['brand', 'availability', 'price_range']);

@Injectable()
export class StorefrontFilterValidatorService {
  private readonly logger = new Logger(StorefrontFilterValidatorService.name);

  constructor(
    @Inject(METAFIELD_REPOSITORY) private readonly metafieldRepo: IMetafieldRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepo: ICategoryRepository,
  ) {}

  /**
   * Scrub the parsed filter map by dropping values that aren't valid
   * for their definition. Returns a new map; never mutates the input.
   *
   * Built-in filters (brand, availability, price_range) are passed
   * through untouched — they aren't backed by a metafield definition.
   */
  async scrub(
    activeFilters: Map<string, string[]>,
    categoryId?: string,
  ): Promise<Map<string, string[]>> {
    if (activeFilters.size === 0) return new Map();

    // Build the category ancestor list once so each lookup is cheap.
    const categoryIds = categoryId
      ? await this.categoryRepo.findAncestorIds(categoryId)
      : [];

    const out = new Map<string, string[]>();
    for (const [key, values] of activeFilters.entries()) {
      if (BUILT_IN_KEYS.has(key)) {
        out.set(key, values);
        continue;
      }

      if (categoryIds.length === 0) {
        // No category context → can't resolve the definition. Pass
        // through; the type-aware SQL will still bound the predicate.
        out.set(key, values);
        continue;
      }

      const def = (await this.metafieldRepo.findDefinitionByKeyForCategoryHierarchy(
        key,
        categoryIds,
      )) as { type?: string; choices?: Array<{ value: string }> } | null;

      if (!def) {
        // Unknown key for this category. Drop entirely — leaving it
        // in would force the SQL to run an EXISTS that can never match.
        this.logger.debug(`Dropping unknown filter key "${key}" for category ${categoryId}`);
        continue;
      }

      if (SELECT_TYPES.has(def.type ?? '') && Array.isArray(def.choices) && def.choices.length > 0) {
        const allowed = new Set(def.choices.map((c) => c.value));
        const kept = values.filter((v) => allowed.has(v));
        if (kept.length === 0) {
          this.logger.debug(
            `Dropping filter "${key}" — no provided values matched choices: ${values.join(', ')}`,
          );
          continue;
        }
        if (kept.length !== values.length) {
          this.logger.debug(
            `Filter "${key}" — ${values.length - kept.length} value(s) outside choices, kept ${kept.length}`,
          );
        }
        out.set(key, kept);
        continue;
      }

      if (NUMERIC_TYPES.has(def.type ?? '')) {
        // Numeric filters supply a [min,max] pair. Require finite
        // numbers; drop the whole key otherwise.
        const numeric = values.filter((v) => Number.isFinite(Number(v)));
        if (numeric.length === 0) {
          this.logger.debug(`Dropping numeric filter "${key}" — values not finite`);
          continue;
        }
        out.set(key, numeric);
        continue;
      }

      // BOOLEAN / TEXT / URL / FILE_REFERENCE — no choice list to
      // validate against. Pass through.
      out.set(key, values);
    }

    return out;
  }

  /**
   * Same scrub but for the `filterObj` shape used by
   * StorefrontProductsController (Record<string, string> with
   * comma-separated values).
   */
  async scrubFilterObj(
    filterObj: Record<string, string>,
    categoryId?: string,
  ): Promise<Record<string, string>> {
    const map = new Map<string, string[]>();
    for (const [k, v] of Object.entries(filterObj)) {
      if (!v) continue;
      const values = String(v).split(',').map((s) => s.trim()).filter(Boolean);
      if (values.length > 0) map.set(k, values);
    }
    const scrubbed = await this.scrub(map, categoryId);
    const result: Record<string, string> = {};
    for (const [k, values] of scrubbed.entries()) {
      result[k] = values.join(',');
    }
    return result;
  }
}
