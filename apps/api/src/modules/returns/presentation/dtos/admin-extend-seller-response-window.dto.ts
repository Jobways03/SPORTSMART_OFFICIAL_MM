import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Phase 95 (2026-05-23) — Phase 94 deferred #28 closure.
//
// Admin extends the seller-response window by N hours. Cumulative
// cap of 168h enforced at the service.
export class AdminExtendSellerResponseWindowDto {
  @IsInt()
  @Min(1)
  @Max(168)
  additionalHours!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
