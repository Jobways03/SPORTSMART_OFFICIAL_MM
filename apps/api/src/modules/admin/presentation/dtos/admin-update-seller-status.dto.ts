import { IsString, IsIn, IsOptional } from 'class-validator';

export class AdminUpdateSellerStatusDto {
  @IsString()
  @IsIn(['PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'DEACTIVATED'])
  status: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
