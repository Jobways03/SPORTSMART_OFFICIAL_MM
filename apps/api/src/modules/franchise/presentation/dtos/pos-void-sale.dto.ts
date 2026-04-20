import { IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class PosVoidSaleDto {
  @IsNotEmpty({ message: 'Void reason is required' })
  @IsString()
  @MinLength(3, { message: 'Reason must be at least 3 characters' })
  @MaxLength(500, { message: 'Reason must not exceed 500 characters' })
  reason: string;
}
