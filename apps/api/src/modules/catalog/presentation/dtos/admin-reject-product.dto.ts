import { IsString } from 'class-validator';

export class AdminRejectProductDto {
  @IsString()
  reason: string;
}
