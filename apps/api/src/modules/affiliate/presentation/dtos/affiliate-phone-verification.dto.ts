import { IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class AffiliateSendPhoneOtpDto {
  /**
   * Optional override of the phone to verify. When omitted the
   * service uses the affiliate's existing `phone` field — so the
   * caller can verify their current number without re-supplying it.
   * When provided, the service checks uniqueness across affiliates
   * before sending the OTP, and atomically updates the phone on
   * verify.
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Phone must be a 10-digit Indian mobile starting with 6, 7, 8, or 9.',
  })
  phone?: string;
}

export class AffiliateVerifyPhoneOtpDto {
  @IsNotEmpty({ message: 'OTP is required' })
  @IsString()
  @Length(6, 6, { message: 'OTP must be 6 digits' })
  @Matches(/^\d{6}$/, { message: 'OTP must be 6 digits' })
  otp: string;
}
