import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class FranchiseStaffActivateDto {
  @IsNotEmpty()
  @IsString()
  token!: string;

  // Same complexity as add-staff (B4 — staff sets their OWN password).
  @IsNotEmpty()
  @IsString()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/, {
    message:
      'password must be 8-72 chars with at least one lowercase, one uppercase, and one digit',
  })
  password!: string;
}
