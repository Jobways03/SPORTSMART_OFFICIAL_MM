import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class FranchiseStaffLoginDto {
  // The franchise's public code (SM-FR-XXXXXX) — disambiguates staff whose
  // email is only unique within a franchise.
  @IsNotEmpty()
  @IsString()
  @MaxLength(40)
  franchiseCode!: string;

  @IsNotEmpty()
  @IsEmail()
  email!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(72)
  password!: string;
}
