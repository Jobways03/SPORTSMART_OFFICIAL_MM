import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AdminUpdateFranchiseVerificationDto {
  @IsNotEmpty({ message: 'Verification status is required' })
  @IsString()
  // Phase 159j — aligned to the FranchiseVerificationStatus Prisma enum.
  // Was ['PENDING', ...] which is NOT a valid enum member (the initial
  // state is NOT_VERIFIED), so the list both (a) accepted a value the DB
  // would reject and (b) blocked the legitimate VERIFIED → NOT_VERIFIED
  // admin reset the use-case FSM allows.
  @IsIn(['NOT_VERIFIED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'], {
    message:
      'Verification status must be one of: NOT_VERIFIED, UNDER_REVIEW, VERIFIED, REJECTED',
  })
  verificationStatus!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
