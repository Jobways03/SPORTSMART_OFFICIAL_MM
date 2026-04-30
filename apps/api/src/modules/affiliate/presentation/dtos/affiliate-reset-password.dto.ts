import { IsNotEmpty, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class AffiliateResetPasswordDto {
  @IsNotEmpty({ message: 'Reset token is required' })
  @IsUUID('4', { message: 'Invalid reset token' })
  resetToken: string;

  @IsNotEmpty({ message: 'New password is required' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  @Matches(/(?=.*[a-z])/, { message: 'Password must include a lowercase letter' })
  @Matches(/(?=.*[A-Z])/, { message: 'Password must include an uppercase letter' })
  @Matches(/(?=.*\d)/, { message: 'Password must include a number' })
  @Matches(/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, { message: 'Password must include a special character' })
  newPassword: string;

  @IsNotEmpty({ message: 'Please confirm your password' })
  @IsString()
  confirmPassword: string;
}
