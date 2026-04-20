import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminSendFranchiseMessageDto {
  @IsNotEmpty({ message: 'Subject is required' })
  @IsString()
  @MaxLength(255)
  subject: string;

  @IsNotEmpty({ message: 'Message is required' })
  @IsString()
  @MaxLength(5000)
  message: string;

  @IsOptional()
  @IsString()
  channel?: string;
}
