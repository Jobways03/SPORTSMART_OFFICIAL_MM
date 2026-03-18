import { IsString, MinLength } from 'class-validator';

export class AdminChangePasswordDto {
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  newPassword: string;
}
