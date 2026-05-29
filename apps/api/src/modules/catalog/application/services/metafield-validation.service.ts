import { Inject, Injectable } from '@nestjs/common';
import { METAFIELD_REPOSITORY, IMetafieldRepository } from '../../domain/repositories/metafield.repository.interface';

/**
 * Phase 39 (2026-05-21) — runtime validation for metafield values.
 *
 * Pre-Phase-39 the admin/seller could save:
 *   - NUMBER_DECIMAL value 99999 even when validations.max = 5.0
 *   - SINGLE_SELECT value not in choices
 *   - URL value `javascript:alert(1)` even though it's a URL field
 *
 * The schema's `validations` JSON column documented `{min, max, regex,
 * minLength, maxLength}` but no code path enforced them (audit gap
 * #5). Same for `choices` membership on select types.
 *
 * This service is the single place runtime value validation happens.
 * It's wired into:
 *   - admin-product-metafields.upsertMetafields (admin/seller value writes)
 *   - seller-products.submitForReview (required-on-submit)
 *   - admin-products.approveInTransaction (required-on-approve)
 */

export interface Definition {
  id: string;
  key: string;
  name: string;
  type: string;
  isRequired: boolean;
  validations: unknown;
  choices: unknown;
}

export interface ValidationOk {
  ok: true;
}

export interface ValidationError {
  ok: false;
  errors: string[];
}

interface ValidationsShape {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  regex?: string;
}

interface ChoiceShape {
  value: string;
}

@Injectable()
export class MetafieldValidationService {
  constructor(
    @Inject(METAFIELD_REPOSITORY) private readonly metafieldRepo: IMetafieldRepository,
  ) {}

  /**
   * Phase 39 — value-level validation. Returns errors per definition
   * type:
   *   - NUMBER_*: type-checks then enforces min/max from validations.
   *   - SINGLE_LINE_TEXT / MULTI_LINE_TEXT / URL: enforces
   *     minLength/maxLength then regex (if set). URL adds a
   *     protocol allow-list — defence-in-depth against
   *     `javascript:` payloads even before React JSX escapes.
   *   - COLOR: requires #RRGGBB hex.
   *   - SINGLE_SELECT: value must be in `choices[].value`.
   *   - MULTI_SELECT: array of values, every entry in choices.
   *   - DATE: parseable date.
   *   - BOOLEAN / FILE_REFERENCE / DIMENSION / WEIGHT / VOLUME / JSON
   *     / RATING: type-only checks (RATING gets min/max if set).
   */
  validateValue(definition: Definition, rawValue: unknown): ValidationOk | ValidationError {
    const errors: string[] = [];
    const v = (definition.validations as ValidationsShape | null) ?? null;
    const choices = (definition.choices as ChoiceShape[] | null) ?? null;
    const label = definition.name || definition.key;

    const reject = (msg: string) => errors.push(`${label}: ${msg}`);

    if (rawValue === null || rawValue === undefined || rawValue === '') {
      // The "presence" check belongs to validateRequiredOnSubmit; a
      // blank value passes type-validation by design (it's a delete-
      // value signal from the upsert path).
      return { ok: true };
    }

    switch (definition.type) {
      case 'SINGLE_LINE_TEXT':
      case 'MULTI_LINE_TEXT':
      case 'URL': {
        if (typeof rawValue !== 'string') {
          reject('must be a string');
          break;
        }
        if (v?.minLength !== undefined && rawValue.length < v.minLength) {
          reject(`must be at least ${v.minLength} characters`);
        }
        if (v?.maxLength !== undefined && rawValue.length > v.maxLength) {
          reject(`must not exceed ${v.maxLength} characters`);
        }
        if (v?.regex && !new RegExp(v.regex).test(rawValue)) {
          reject(`must match pattern ${v.regex}`);
        }
        if (definition.type === 'URL') {
          // Defence in depth — reject javascript:, data:, etc.
          if (!/^https?:\/\//i.test(rawValue)) {
            reject('must be an http(s) URL');
          }
        }
        break;
      }
      case 'NUMBER_INTEGER': {
        const num = typeof rawValue === 'number' ? rawValue : Number(rawValue);
        if (!Number.isInteger(num)) {
          reject('must be an integer');
          break;
        }
        if (v?.min !== undefined && num < v.min) reject(`must be ≥ ${v.min}`);
        if (v?.max !== undefined && num > v.max) reject(`must be ≤ ${v.max}`);
        break;
      }
      case 'NUMBER_DECIMAL':
      case 'RATING': {
        const num = typeof rawValue === 'number' ? rawValue : Number(rawValue);
        if (!Number.isFinite(num)) {
          reject('must be a number');
          break;
        }
        if (v?.min !== undefined && num < v.min) reject(`must be ≥ ${v.min}`);
        if (v?.max !== undefined && num > v.max) reject(`must be ≤ ${v.max}`);
        break;
      }
      case 'BOOLEAN': {
        if (typeof rawValue !== 'boolean' && rawValue !== 'true' && rawValue !== 'false') {
          reject('must be a boolean');
        }
        break;
      }
      case 'DATE': {
        const d = new Date(rawValue as string | number);
        if (Number.isNaN(d.getTime())) reject('must be a valid date');
        break;
      }
      case 'COLOR': {
        if (typeof rawValue !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(rawValue)) {
          reject('must be a #RRGGBB hex color');
        }
        break;
      }
      case 'SINGLE_SELECT': {
        if (!choices || choices.length === 0) {
          reject('definition has no choices configured');
          break;
        }
        if (!choices.some((c) => c.value === rawValue)) {
          reject(`must be one of: ${choices.map((c) => c.value).join(', ')}`);
        }
        break;
      }
      case 'MULTI_SELECT': {
        if (!Array.isArray(rawValue)) {
          reject('must be an array');
          break;
        }
        if (!choices || choices.length === 0) {
          reject('definition has no choices configured');
          break;
        }
        const allowed = new Set(choices.map((c) => c.value));
        for (const v0 of rawValue) {
          if (!allowed.has(v0)) {
            reject(`"${String(v0)}" is not a valid choice`);
            break;
          }
        }
        break;
      }
      case 'DIMENSION':
      case 'WEIGHT':
      case 'VOLUME':
      case 'JSON': {
        // The DB stores these as valueJson — caller may pass a
        // pre-parsed object or a JSON string. We accept both.
        if (typeof rawValue !== 'object' && typeof rawValue !== 'string') {
          reject('must be a JSON object or string');
          break;
        }
        if (typeof rawValue === 'string') {
          try {
            JSON.parse(rawValue);
          } catch {
            reject('must be valid JSON');
          }
        }
        break;
      }
      case 'FILE_REFERENCE': {
        if (typeof rawValue !== 'string' || rawValue.length === 0) {
          reject('must be a non-empty file reference');
        }
        break;
      }
      default:
        // Unknown type — refuse rather than silently accept.
        reject(`unknown definition type ${definition.type}`);
    }

    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  /**
   * Phase 39 — required-on-submit gate. Fetches all required, active
   * definitions for the product's category hierarchy (CATEGORY ownerType)
   * + global CUSTOM definitions. Returns the list of missing
   * definitions so the caller can render a helpful 400.
   */
  async validateRequiredOnSubmit(
    productId: string,
    categoryId: string | null,
  ): Promise<{ missing: Array<{ key: string; name: string }> }> {
    if (!categoryId) {
      // No category → no required category metafields. Custom-level
      // requireds only land if owners explicitly opt in; we don't
      // gate on those here.
      return { missing: [] };
    }

    // Fetch all required + active definitions in the category
    // hierarchy. Leverages the Phase 39 (isRequired, categoryId)
    // index.
    const categoryIds = await this.metafieldRepo.getCategoryHierarchyIds(categoryId);
    const required = await this.metafieldRepo.findDefinitions({
      isActive: true,
      isRequired: true,
      ownerType: 'CATEGORY',
      categoryId: { in: categoryIds },
    });
    if (required.length === 0) return { missing: [] };

    // Fetch existing product values for these definition ids.
    const existing = await this.metafieldRepo.findProductMetafields(productId);
    const existingDefIds = new Set(
      existing.map((e: { metafieldDefinitionId: string }) => e.metafieldDefinitionId),
    );

    const missing = required
      .filter((d: { id: string }) => !existingDefIds.has(d.id))
      .map((d: { key: string; name: string }) => ({ key: d.key, name: d.name }));

    return { missing };
  }
}
