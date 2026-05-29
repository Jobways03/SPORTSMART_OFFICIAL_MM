import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsOptional,
  IsIn,
  Matches,
  MaxLength,
} from 'class-validator';

export class FranchiseAddStaffDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsNotEmpty()
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10,15}$/, { message: 'phone must be 10-15 digits' })
  phone?: string;

  @IsNotEmpty()
  @IsIn(['MANAGER', 'POS_OPERATOR', 'WAREHOUSE_STAFF'])
  role!: string;

  // Phase 159u (staff-auth B4) — NO password here. The owner no longer sets (or
  // sees) staff passwords; adding a staff issues an invitation and the staff
  // sets their own password on activation. Password complexity now lives on the
  // activation DTO (FranchiseStaffActivateDto).
}
