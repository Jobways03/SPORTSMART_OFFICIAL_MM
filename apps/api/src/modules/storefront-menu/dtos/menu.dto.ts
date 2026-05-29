import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MenuLinkType } from '@prisma/client';

/**
 * Phase 48 — single custom validator for linkRef. We tried a chain of
 * @ValidateIf decorators first but class-validator applies each
 * @ValidateIf to ALL subsequent validators on the property, so the
 * last condition wins and earlier rules never fire. A custom
 * decorator that branches internally is the idiomatic fix.
 */
function isValidLinkRefForType(
  value: unknown,
  linkType: MenuLinkType | undefined,
): { ok: true } | { ok: false; reason: string } {
  // NONE or no linkType → linkRef is allowed to be missing.
  if (linkType === MenuLinkType.NONE || linkType === undefined) {
    if (value == null || value === '') return { ok: true };
    return { ok: true }; // permissive: server defaults NONE to null
  }
  if (value == null || typeof value !== 'string' || value.trim() === '') {
    return { ok: false, reason: `linkRef is required when linkType is ${linkType}` };
  }
  const v = value.trim();
  switch (linkType) {
    case MenuLinkType.URL:
      if (!SAFE_URL_PATTERN.test(v)) {
        return { ok: false, reason: SAFE_URL_MESSAGE };
      }
      return { ok: true };
    case MenuLinkType.PAGE:
      if (!SLUG_PATTERN.test(v)) {
        return {
          ok: false,
          reason: 'linkRef must be a slug (lowercase letters, numbers, hyphens) when linkType is PAGE',
        };
      }
      return { ok: true };
    case MenuLinkType.COLLECTION:
    case MenuLinkType.CATEGORY:
    case MenuLinkType.BRAND:
    case MenuLinkType.PRODUCT:
      if (!UUID_PATTERN.test(v)) {
        return {
          ok: false,
          reason: `linkRef must be a UUID when linkType is ${linkType}`,
        };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

function IsValidMenuLinkRef(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isValidMenuLinkRef',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const result = isValidLinkRefForType(
            value,
            (args.object as { linkType?: MenuLinkType }).linkType,
          );
          return result.ok;
        },
        defaultMessage(args: ValidationArguments) {
          const result = isValidLinkRefForType(
            args.value,
            (args.object as { linkType?: MenuLinkType }).linkType,
          );
          return result.ok ? '' : result.reason;
        },
      },
    });
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Phase 48 (2026-05-21) — storefront-menu DTOs hardened.
 *
 * Pre-Phase-48 the DTOs were `@IsString()`-only on every field, which
 * let admins persist values that the storefront then rendered into
 * `<a href>` — the audit flagged this as the biggest XSS surface in
 * the admin UI. The new validators block:
 *   - `javascript:` / `data:` / `vbscript:` URI schemes in linkRef
 *   - protocol-relative `//evil.com` (open redirect)
 *   - non-UUID values for entity-backed linkTypes (CATEGORY/BRAND/…)
 *   - non-slug values for PAGE
 *   - overlong handles / labels that would break the storefront layout
 *
 * Each new validator is paired with `@ValidateIf` so the rule fires
 * only when the field is relevant to the chosen linkType.
 */

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Accepts a relative path (/foo) OR an http(s) URL. Same allowlist as
// the Phase 47 storefront-content href guard so the policy is uniform
// across admin surfaces. The lookahead `(?!\/)` after the leading `/`
// is what blocks protocol-relative URLs like `//evil.com` (open-
// redirect surface).
const SAFE_URL_PATTERN = /^(?:\/(?!\/)[^\s]*|https?:\/\/[^\s]+)$/;
const SAFE_URL_MESSAGE =
  'linkRef must be a relative path starting with "/" or an http(s) URL';

const HANDLE_PATTERN = /^[a-z][a-z0-9-]*$/;
const SLUG_PATTERN = /^[a-z0-9-]+$/;

export class CreateMenuDto {
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(64)
  @Matches(HANDLE_PATTERN, {
    message:
      'handle must be lowercase letters, numbers, and hyphens; must start with a letter',
  })
  handle!: string;

  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export class UpdateMenuDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(64)
  @Matches(HANDLE_PATTERN, {
    message:
      'handle must be lowercase letters, numbers, and hyphens; must start with a letter',
  })
  handle?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateItemDto {
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(80, { message: 'label must not exceed 80 characters' })
  label!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(80)
  displayLabel?: string | null;

  @IsOptional()
  @IsEnum(MenuLinkType)
  linkType?: MenuLinkType;

  @IsOptional()
  @MaxLength(800)
  @IsValidMenuLinkRef()
  linkRef?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  filterTags?: string[];

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  openInNewTab?: boolean;

  @IsOptional()
  @IsBoolean()
  relNofollow?: boolean;
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(80)
  displayLabel?: string | null;

  @IsOptional()
  @IsEnum(MenuLinkType)
  linkType?: MenuLinkType;

  @IsOptional()
  @MaxLength(800)
  @IsValidMenuLinkRef()
  linkRef?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  filterTags?: string[];

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  openInNewTab?: boolean;

  @IsOptional()
  @IsBoolean()
  relNofollow?: boolean;
}

export class ReorderMoveDto {
  @IsString()
  id!: string;

  @IsOptional()
  @IsString()
  parentId!: string | null;

  @IsInt()
  @Min(0)
  position!: number;
}

export class ReorderItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderMoveDto)
  moves!: ReorderMoveDto[];
}
