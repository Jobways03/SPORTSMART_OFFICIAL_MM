import { IsString, IsOptional } from 'class-validator';

export class AdminUpdateProductStatusDto {
  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
