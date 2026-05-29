import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

/**
 * Phase 146 — runtime validation for batch mark-paid. Previously an inline TS
 * interface (no validation): `settlements: 'not-an-array'` reached the service.
 */
export class BatchMarkPaidItemDto {
  @IsString()
  id!: string;

  @IsIn(['seller', 'franchise'])
  type!: 'seller' | 'franchise';

  // Same UTR/reference shape as the single mark-paid path (alphanumeric + _ - ;
  // XSS-safe for CSV/email surfaces).
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,40}$/, {
    message: 'reference must be 8-40 chars (letters, digits, _ or -)',
  })
  reference!: string;
}

export class BatchMarkPaidDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BatchMarkPaidItemDto)
  settlements!: BatchMarkPaidItemDto[];
}
