import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class AdminSendMessageDto {
  @IsString()
  @MinLength(1, { message: 'Subject is required' })
  @MaxLength(200, { message: 'Subject must not exceed 200 characters' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  subject: string;

  @IsString()
  @MinLength(1, { message: 'Message is required' })
  @MaxLength(5000, { message: 'Message must not exceed 5000 characters' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  message: string;

  @IsOptional()
  @IsString()
  channel?: string;
}
