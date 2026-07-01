import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

// Trim string fields BEFORE the length/format validators run (the global
// ValidationPipe applies @Transform first). Mirrors the seller-register DTO.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Public "Contact us" form payload (storefront /contact page). Validated by the
 * global ValidationPipe (whitelist + forbidNonWhitelisted), so every accepted
 * field must be declared here.
 */
export class ContactDto {
  @IsNotEmpty({ message: 'First name is required' })
  @IsString()
  @Transform(trim)
  @MaxLength(80)
  firstName!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(80)
  lastName?: string;

  @IsIn(['email', 'phone', 'sms'], {
    message: 'Choose how you want us to contact you',
  })
  contactMethod!: 'email' | 'phone' | 'sms';

  @IsNotEmpty({ message: 'Please choose a reason' })
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  reason!: string;

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @MaxLength(255)
  email!: string;

  // Required only when the visitor asks to be contacted by Phone or SMS.
  // @ValidateIf skips all phone validators entirely for the Email path.
  @ValidateIf(
    (o: ContactDto) => o.contactMethod === 'phone' || o.contactMethod === 'sms',
  )
  @IsNotEmpty({ message: 'Phone number is required' })
  @IsString()
  @Transform(trim)
  @Matches(/^[+()\d\s-]{7,20}$/, {
    message: 'Please enter a valid phone number',
  })
  phone?: string;

  @IsNotEmpty({ message: 'Please enter a message' })
  @IsString()
  @Transform(trim)
  @MinLength(5, { message: 'Your message is a little short' })
  @MaxLength(4000)
  message!: string;

  // Optional CAPTCHA token — verified when a provider is configured; the
  // verifier short-circuits when CAPTCHA is disabled (dev/staging default).
  @IsOptional()
  @IsString()
  captchaToken?: string;
}
