import {
  IsOptional,
  IsString,
  IsIn,
  IsBoolean,
} from 'class-validator';

export class FranchiseUpdateStaffDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(['MANAGER', 'POS_OPERATOR', 'WAREHOUSE_STAFF'])
  role?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
