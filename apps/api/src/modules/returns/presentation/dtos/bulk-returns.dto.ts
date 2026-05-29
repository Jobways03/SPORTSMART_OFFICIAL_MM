import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeOptionalText } from '../../../../core/util/sanitize-text';

// Phase 101 (2026-05-23) — Phase 104 audit Gap #3 closure.
//
// Pre-Phase-101 bulk endpoints accepted `{ returnIds: string[] }`
// inline-typed with zero validation beyond length. A payload of
// non-UUID strings flowed through to findUnique with garbage values.
// Now class-validator catches malformed inputs at the boundary.
export class BulkReturnsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  returnIds!: string[];

  // Phase 101 — Phase 104 audit Gap #6 / #16 closures. Optional
  // bulk-level reason persisted on each per-row close (closeReason).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => sanitizeOptionalText(value, { maxLength: 500 }))
  reason?: string;

  // Phase 105 (2026-05-23) — Phase 104 audit Gap #19 closure.
  // When true, the bulk action suppresses per-row events so a 100-row
  // approve doesn't flood the seller email queue with 100 separate
  // "return approved" notifications. The bulk-level audit row + the
  // BulkJob row still record the operation.
  @IsOptional()
  silent?: boolean;
}
