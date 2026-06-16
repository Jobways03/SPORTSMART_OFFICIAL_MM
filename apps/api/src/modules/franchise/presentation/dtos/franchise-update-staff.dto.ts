import {
  IsOptional,
  IsString,
  IsIn,
  IsBoolean,
  Matches,
  MaxLength,
} from 'class-validator';

export class FranchiseUpdateStaffDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z][A-Za-z .'-]*$/, {
    message: 'Must contain only letters, spaces, periods, apostrophes or hyphens',
  })
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Phone number must be a 10-digit Indian mobile number starting with 6, 7, 8, or 9',
  })
  phone?: string;

  @IsOptional()
  @IsIn(['MANAGER', 'POS_OPERATOR', 'WAREHOUSE_STAFF'])
  role?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
