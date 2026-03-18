import { IsString } from 'class-validator';

export class AdminRequestChangesDto {
  @IsString()
  note: string;
}
