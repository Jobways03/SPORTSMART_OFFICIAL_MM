import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

export class AdminListSellersDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 20;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsString()
  @IsIn(['PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'DEACTIVATED'])
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn(['NOT_VERIFIED', 'VERIFIED', 'REJECTED', 'UNDER_REVIEW'])
  verificationStatus?: string;

  @IsOptional()
  @IsString()
  @IsIn(['sellerName', 'sellerShopName', 'email', 'createdAt', 'status', 'verificationStatus', 'profileCompletionPercentage'])
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;
}
