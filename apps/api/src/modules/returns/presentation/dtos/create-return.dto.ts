import {
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const RETURN_REASON_CATEGORIES = [
  'DEFECTIVE',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'DAMAGED_IN_TRANSIT',
  'CHANGED_MIND',
  'SIZE_FIT_ISSUE',
  'QUALITY_ISSUE',
  'OTHER',
] as const;

export class CreateReturnItemDto {
  @IsNotEmpty()
  @IsUUID()
  orderItemId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNotEmpty()
  @IsIn(RETURN_REASON_CATEGORIES as unknown as string[])
  reasonCategory: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonDetail?: string;
}

export class CreateReturnDto {
  @IsNotEmpty()
  @IsUUID()
  subOrderId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  items: CreateReturnItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerNotes?: string;

  // ── Fair-forfeit gate ─────────────────────────────────────────
  // If QC rejects the claim, the item is forfeited (not shipped back)
  // and no refund is issued. The customer must explicitly acknowledge
  // this risk at submission time — prevents surprise-forfeit complaints.
  @IsBoolean()
  @Equals(true, {
    message:
      'You must acknowledge the forfeit policy before submitting a return.',
  })
  forfeitConsent: boolean;

  // Proof of the defect/issue the customer is claiming. The
  // *reason-based* requirement lives in ReturnService.createReturn:
  //   - DEFECTIVE / WRONG_ITEM / NOT_AS_DESCRIBED / DAMAGED_IN_TRANSIT
  //     / QUALITY_ISSUE → ≥1 photo required
  //   - CHANGED_MIND / SIZE_FIT_ISSUE → photos optional (the customer's
  //     word is enough; nothing visually to prove)
  // The DTO accepts an empty array so the service-level conditional
  // enforcement actually gets a chance to run. Sending nothing is
  // still allowed (defaults to []).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceFileUrls?: string[];
}
