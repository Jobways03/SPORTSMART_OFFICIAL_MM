import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsOptional,
  IsIn,
  MinLength,
} from 'class-validator';

export class FranchiseAddStaffDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsNotEmpty()
  @IsIn(['MANAGER', 'POS_OPERATOR', 'WAREHOUSE_STAFF'])
  role: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  password: string;
}
