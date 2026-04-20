import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CustomerMarkHandedOverDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  trackingNumber?: string;
}
