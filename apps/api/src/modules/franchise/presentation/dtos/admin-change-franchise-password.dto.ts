import { IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class AdminChangeFranchisePasswordDto {
  @IsNotEmpty({ message: 'New password is required' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  newPassword: string;
}
