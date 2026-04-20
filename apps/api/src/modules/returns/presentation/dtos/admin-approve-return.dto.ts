import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminApproveReturnDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
