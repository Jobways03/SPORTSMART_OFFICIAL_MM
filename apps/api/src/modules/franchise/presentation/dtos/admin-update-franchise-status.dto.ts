import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AdminUpdateFranchiseStatusDto {
  @IsNotEmpty({ message: 'Status is required' })
  @IsString()
  @IsIn(['PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'], {
    message: 'Status must be one of: PENDING, APPROVED, ACTIVE, SUSPENDED, DEACTIVATED',
  })
  status: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
