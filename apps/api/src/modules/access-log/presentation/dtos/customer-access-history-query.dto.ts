import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Phase 201 (#3 / #12) — query DTO for GET
 * /customer/account/access-history.
 *
 * The controller previously did `parseInt(limit, 10)` with no guard, so
 * `?limit=abc` produced NaN and reached Prisma as `take: NaN` (a runtime
 * error / unbounded read depending on the driver). This DTO coerces and
 * bounds the value. Global ValidationPipe runs with whitelist +
 * forbidNonWhitelisted, so any unexpected query key is also rejected.
 */
export class CustomerAccessHistoryQueryDto {
  // @Type(() => Number) turns the raw query string into a number BEFORE
  // @IsInt runs; without it every numeric query param fails validation.
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(500, { message: 'limit cannot exceed 500' })
  limit?: number;
}
