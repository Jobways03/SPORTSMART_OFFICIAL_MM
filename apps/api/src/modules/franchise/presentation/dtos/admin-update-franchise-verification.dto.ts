import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AdminUpdateFranchiseVerificationDto {
  @IsNotEmpty({ message: 'Verification status is required' })
  @IsString()
  @IsIn(['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'], {
    message: 'Verification status must be one of: PENDING, UNDER_REVIEW, VERIFIED, REJECTED',
  })
  verificationStatus: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
