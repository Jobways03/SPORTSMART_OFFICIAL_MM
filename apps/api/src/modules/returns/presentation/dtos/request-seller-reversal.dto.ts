import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SellerReversalItemInputDto {
  @IsString()
  @MaxLength(64)
  orderItemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class RequestSellerReversalDto {
  @IsString()
  @MaxLength(64)
  subOrderId!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SellerReversalItemInputDto)
  items!: SellerReversalItemInputDto[];
}
