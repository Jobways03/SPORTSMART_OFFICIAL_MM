import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AdminSchedulePickupDto {
  @IsNotEmpty()
  @IsDateString()
  pickupScheduledAt: string;

  @IsOptional()
  pickupAddress?: any;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  pickupTrackingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  pickupCourier?: string;
}
