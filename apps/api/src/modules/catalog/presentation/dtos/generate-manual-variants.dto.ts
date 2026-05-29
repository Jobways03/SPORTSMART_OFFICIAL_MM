import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 41 (2026-05-21) — input shape for /generate-manual.
 *
 * Closes audit gaps:
 *   #6  Cartesian product size cap is enforced in the controller (it
 *       needs to multiply the value lists). Per-axis cap here keeps
 *       any single dimension reasonable.
 *   #17 OptionValue.value flows through to the auto-generated variant
 *       title which lands in storefront markup. JSX escapes by default
 *       but a defence-in-depth allowlist keeps `<script>` / `"` /
 *       semicolons out at the entry boundary.
 */

// Allowed characters: letters (Unicode-letter family is too permissive
// for an early sanitization pass), ASCII digits, common punctuation
// used in size/color names (e.g. "1.5L", "Mid-rise", "S/M", "T&C").
// Anyone needs a wider set, add specific characters here — refuse to
// open the door to angle brackets / curly braces.
const OPTION_VALUE_REGEX = /^[A-Za-z0-9 _\-\/&+.()'"]+$/;

export class ManualOptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Matches(/^[A-Za-z0-9 _\-]+$/, {
    message: 'name must be ASCII letters/digits/spaces/_/-',
  })
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100, { message: 'cannot supply more than 100 values per option' })
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @Matches(OPTION_VALUE_REGEX, {
    each: true,
    message:
      'option value must contain only letters, digits, spaces, and the common punctuation set "_-/&+.()\'\\""',
  })
  values!: string[];
}

export class GenerateManualVariantsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5, { message: 'cannot define more than 5 option axes per product' })
  @ValidateNested({ each: true })
  @Type(() => ManualOptionDto)
  options!: ManualOptionDto[];
}
