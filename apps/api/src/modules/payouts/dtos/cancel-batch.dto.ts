import { IsString, Length } from 'class-validator';

/** Phase 151 — cancel a DRAFT/EXPORTED payout batch created in error. */
export class CancelBatchDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}
