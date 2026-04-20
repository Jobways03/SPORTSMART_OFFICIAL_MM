import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PosReturnItemDto {
  @IsNotEmpty({ message: 'Item ID is required' })
  @IsUUID()
  itemId: string;

  @IsNotEmpty({ message: 'Return quantity is required' })
  @IsNumber({}, { message: 'Return quantity must be a number' })
  @Min(1, { message: 'Return quantity must be at least 1' })
  returnQty: number;
}

export class PosReturnSaleDto {
  @IsArray({ message: 'Items must be an array' })
  @ValidateNested({ each: true })
  @Type(() => PosReturnItemDto)
  items: PosReturnItemDto[];
}
