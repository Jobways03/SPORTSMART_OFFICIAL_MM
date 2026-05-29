import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class FranchiseResendVerificationOtpDto {
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(255)
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}
