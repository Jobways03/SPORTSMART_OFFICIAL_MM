import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @IsNotEmpty({ message: 'First name is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(2, { message: 'First name must be at least 2 characters' })
  @MaxLength(50, { message: 'First name must not exceed 50 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s]*$/, { message: 'First name must contain only letters' })
  firstName: string;

  @IsNotEmpty({ message: 'Last name is required' })
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @MinLength(1, { message: 'Last name must be at least 1 character' })
  @MaxLength(50, { message: 'Last name must not exceed 50 characters' })
  @Matches(/^[a-zA-Z][a-zA-Z\s]*$/, { message: 'Last name must contain only letters' })
  lastName: string;

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255, { message: 'Email must not exceed 255 characters' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  @Matches(/(?=.*[a-z])/, { message: 'Password must include a lowercase letter' })
  @Matches(/(?=.*[A-Z])/, { message: 'Password must include an uppercase letter' })
  @Matches(/(?=.*\d)/, { message: 'Password must include a number' })
  @Matches(/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, { message: 'Password must include a special character' })
  password: string;
}
