import { IsString, IsIn, IsOptional } from 'class-validator';

export class AdminUpdateSellerVerificationDto {
  @IsString()
  @IsIn(['NOT_VERIFIED', 'VERIFIED', 'REJECTED', 'UNDER_REVIEW'])
  verificationStatus: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
