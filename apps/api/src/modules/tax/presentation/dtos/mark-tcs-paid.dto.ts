import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Phase 159z (GSTR-8 audit — sibling to MarkTcsFiledDto). The previous
 * controller had an ad-hoc presence check; this DTO adds bounds and a
 * uniqueness guard on the id list so a flood-payload can't blow up the
 * service. paymentReference (UTR / NEFT / RTGS handle) is mandatory
 * and capped so admin-typed slop doesn't bloat the row.
 */
export class MarkTcsPaidDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'ledgerIds must contain at least one id' })
  @ArrayMaxSize(2000, {
    message: 'ledgerIds may contain at most 2000 entries per request',
  })
  @ArrayUnique({ message: 'ledgerIds must be unique' })
  @IsString({ each: true })
  ledgerIds!: string[];

  @IsString()
  @MinLength(4, { message: 'paymentReference must be at least 4 characters' })
  @MaxLength(64, { message: 'paymentReference must be at most 64 characters' })
  paymentReference!: string;
}
