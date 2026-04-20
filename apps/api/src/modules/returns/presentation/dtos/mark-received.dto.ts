import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MarkReceivedDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
