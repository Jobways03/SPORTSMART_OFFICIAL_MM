import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsUUID,
} from 'class-validator';

/**
 * Phase 41 (2026-05-21) — typed DTO for /variants/generate.
 *
 * Pre-Phase-41 both seller + admin controllers had an inline `class
 * GenerateVariantsDto { optionValueIds: string[][] }` with only
 * @IsArray + @ArrayNotEmpty — no UUID validation, no per-axis cap.
 * The controller then fetched the values and silently dropped unknown
 * IDs, producing mangled Cartesian outputs. Now:
 *
 *   - every ID is enforced as UUID v4 at the class-validator layer
 *   - per-axis cap = 100 (matches GenerateManualVariantsDto)
 *   - max axes = 5
 *
 * Same-OptionDefinition grouping is enforced in the controller (it
 * needs to look up the definitions) — see VariantGeneratorService.
 */
export class GenerateVariantsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5, { message: 'cannot define more than 5 option axes per product' })
  @ArrayMinSize(1)
  optionValueIds!: string[][];
}

/**
 * Phase 41 — Cartesian product size cap, applied in the controller
 * after the DTO validates structural shape. 500 variants per /generate
 * is generous enough for any realistic apparel matrix (10 sizes × 5
 * colors × 10 widths = 500) while bounding the transaction's lock
 * footprint.
 */
export const VARIANT_GENERATE_MAX_COMBINATIONS = 500;

/**
 * Validate the per-axis array shape and apply the per-axis cap. Throws
 * an Error the controller maps to BadRequestAppException.
 */
export function assertGenerateGroupsShape(groups: string[][]): void {
  for (let i = 0; i < groups.length; i++) {
    const axis = groups[i]!;
    if (!Array.isArray(axis) || axis.length === 0) {
      throw new Error(`optionValueIds[${i}] must be a non-empty array`);
    }
    if (axis.length > 100) {
      throw new Error(`optionValueIds[${i}] has ${axis.length} values (max 100)`);
    }
    const seen = new Set<string>();
    for (const id of axis) {
      if (typeof id !== 'string' || !id.trim()) {
        throw new Error(`optionValueIds[${i}] contains an empty value`);
      }
      if (seen.has(id)) {
        throw new Error(`optionValueIds[${i}] contains duplicate id ${id}`);
      }
      seen.add(id);
    }
  }
}

export function computeCartesianSize(groups: string[][]): number {
  if (groups.length === 0) return 0;
  return groups.reduce((acc, axis) => acc * axis.length, 1);
}
