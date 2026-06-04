import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Phase 204 (#14) — query DTO for the chain-verify endpoints. `limit=-1`
 * previously reached Prisma `take: -1` and threw; this bounds it.
 */
export class AuditVerifyQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1)
  @Max(50_000)
  limit?: number;
}

/** Range-sample verify (#9). Bounds the window so a "sample" can't become a
 * full table scan by accident. */
export class AuditVerifyRangeDto {
  @Type(() => Number)
  @IsInt({ message: 'fromSeq must be an integer' })
  @Min(1)
  fromSeq!: number;

  @Type(() => Number)
  @IsInt({ message: 'toSeq must be an integer' })
  @Min(1)
  toSeq!: number;
}
