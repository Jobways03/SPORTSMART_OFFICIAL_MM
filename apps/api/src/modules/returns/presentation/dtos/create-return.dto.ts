import {
  ArrayMinSize,
  IsArray,
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
}
