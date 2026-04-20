import { IsOptional, IsString, MaxLength, IsDateString } from 'class-validator';

export class ProcurementDispatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  carrierName?: string;

  /**
   * ISO 8601 date string. Admin can tell franchise when they should expect
   * the shipment. Optional — omit if not yet known.
   */
  @IsOptional()
  @IsDateString()
  expectedDeliveryAt?: string;
}
