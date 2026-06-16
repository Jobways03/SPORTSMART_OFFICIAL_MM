import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 23 (2026-05-20) — class-based DTOs for admin user management.
 *
 * Pre-Phase-23 these were TypeScript interfaces — class-validator
 * decorators didn't run, the global ValidationPipe couldn't whitelist
 * extra fields, and `forbidNonWhitelisted: true` was a no-op. A
 * malicious caller could submit { name, email, password, role,
 * isSeeded: true } and silently flip the protected flag.
 *
 * The classes below enforce:
 *   - email format + lower-case normalization
 *   - role + status against the enum (no free-form values)
 *   - password complexity parity with customer/seller/franchise
 *   - field-length caps (name 100, password 128)
 *   - customRoleIds array shape + size limit
 */

export enum AdminRoleDto {
  SUPER_ADMIN = 'SUPER_ADMIN',
  SELLER_ADMIN = 'SELLER_ADMIN',
  SELLER_SUPPORT = 'SELLER_SUPPORT',
  SELLER_OPERATIONS = 'SELLER_OPERATIONS',
  AFFILIATE_ADMIN = 'AFFILIATE_ADMIN',
  RETAILER_ADMIN = 'RETAILER_ADMIN',
  FRANCHISE_ADMIN = 'FRANCHISE_ADMIN',
}

export enum AdminStatusDto {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export class CreateAdminUserDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'name is required' })
  @MaxLength(100, { message: 'name must not exceed 100 characters' })
  @Matches(/^[A-Za-z][A-Za-z .'-]*$/, {
    message:
      'name must contain only letters, spaces, periods, apostrophes or hyphens',
  })
  name!: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  @MaxLength(128, { message: 'password must not exceed 128 characters' })
  @Matches(/(?=.*[a-z])/, {
    message: 'password must include a lowercase letter',
  })
  @Matches(/(?=.*[A-Z])/, {
    message: 'password must include an uppercase letter',
  })
  @Matches(/(?=.*\d)/, { message: 'password must include a number' })
  @Matches(/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, {
    message: 'password must include a special character',
  })
  password!: string;

  @IsEnum(AdminRoleDto, {
    message: `role must be one of: ${Object.values(AdminRoleDto).join(', ')}`,
  })
  role!: AdminRoleDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: 'cannot assign more than 20 custom roles' })
  @IsString({ each: true })
  customRoleIds?: string[];
}

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[A-Za-z][A-Za-z .'-]*$/, {
    message:
      'name must contain only letters, spaces, periods, apostrophes or hyphens',
  })
  name?: string;

  @IsOptional()
  @IsEnum(AdminRoleDto)
  role?: AdminRoleDto;

  @IsOptional()
  @IsEnum(AdminStatusDto)
  status?: AdminStatusDto;
}

export class AdminListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  page?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  limit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsEnum(AdminStatusDto)
  status?: AdminStatusDto;
}
